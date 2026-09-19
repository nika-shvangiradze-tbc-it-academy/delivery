import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../../core/pipes/t.pipe';
import { GEORGIAN_CITIES, isDeliveryDateAllowed, minDeliveryDateIso } from '../../../core/constants/cities';
import {
  MY_ORDERS_PAGE_SIZE,
  MyOrdersPeriodPreset,
  MyOrdersStatusCounts,
  MyOrdersStatusFilter,
  Order,
  UserDeliveredAnalytics,
} from '../../../core/models/order.model';
import { OrderRealtimeService } from '../../../core/services/order-realtime.service';
import { OrdersService } from '../../../core/services/orders.service';
import {
  centsToNumber,
  formatGel,
  formatGelGrouped,
  formatTbilisiDotDateTime,
  orderStatusClass,
  orderStatusLabelKey,
  toCents,
} from '../../../core/utils/order-status.util';
import {
  isIsoDateOnly,
  tbilisiPreviousMonthDateRange,
  tbilisiThisMonthDateRange,
  tbilisiThisYearDateRange,
  tbilisiTodayIso,
  tbilisiYmdParts,
} from '../../../core/utils/tbilisi-time.util';
import { DeliveryHeader } from '../../../layout/delivery-header/delivery-header';

const EMPTY_COUNTS: MyOrdersStatusCounts = {
  all: 0,
  pending: 0,
  office: 0,
  picked_up: 0,
  delivered: 0,
  cancelled: 0,
};

const EMPTY_ANALYTICS: UserDeliveredAnalytics = {
  order_count: 0,
  parcel_count: 0,
  amount_to_collect: 0,
};

const GEORGIAN_MONTHS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: 'იანვარი' },
  { value: 2, label: 'თებერვალი' },
  { value: 3, label: 'მარტი' },
  { value: 4, label: 'აპრილი' },
  { value: 5, label: 'მაისი' },
  { value: 6, label: 'ივნისი' },
  { value: 7, label: 'ივლისი' },
  { value: 8, label: 'აგვისტო' },
  { value: 9, label: 'სექტემბერი' },
  { value: 10, label: 'ოქტომბერი' },
  { value: 11, label: 'ნოემბერი' },
  { value: 12, label: 'დეკემბერი' },
];

function amountNonNegativeValidator(control: AbstractControl): ValidationErrors | null {
  const amount = centsToNumber(toCents(control.value));
  return amount >= 0 ? null : { amountInvalid: true };
}

@Component({
  selector: 'app-my-orders',
  imports: [DeliveryHeader, TranslatePipe, DatePipe, RouterLink, ReactiveFormsModule],
  templateUrl: './my-orders.html',
  styleUrl: './my-orders.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyOrders implements OnInit {
  private readonly ordersService = inject(OrdersService);
  private readonly orderRealtime = inject(OrderRealtimeService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);

  readonly pageSize = MY_ORDERS_PAGE_SIZE;
  readonly months = GEORGIAN_MONTHS;

  readonly orders = signal<Order[]>([]);
  readonly listTotal = signal(0);
  readonly statusFilter = signal<MyOrdersStatusFilter>('all');
  readonly statusCounts = signal<MyOrdersStatusCounts>(EMPTY_COUNTS);
  readonly countsLoading = signal(true);
  readonly expandedId = signal<number | null>(null);
  readonly loading = signal(true);
  readonly loadingMore = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly editingOrder = signal<Order | null>(null);
  readonly saving = signal(false);
  readonly editError = signal<string | null>(null);

  readonly periodPreset = signal<MyOrdersPeriodPreset>('all');
  readonly filterYear = signal<number | null>(null);
  readonly filterMonth = signal<number | null>(null);
  readonly customFrom = signal('');
  readonly customTo = signal('');
  readonly dateRangeError = signal<string | null>(null);
  readonly yearOptions = signal<number[]>([]);

  readonly analytics = signal<UserDeliveredAnalytics>(EMPTY_ANALYTICS);
  readonly analyticsLoading = signal(false);
  readonly analyticsError = signal<string | null>(null);

  readonly cities = GEORGIAN_CITIES;
  readonly minDeliveryDate = minDeliveryDateIso();
  readonly statusClass = orderStatusClass;
  readonly statusLabelKey = orderStatusLabelKey;
  readonly formatGel = formatGel;
  readonly formatGelGrouped = formatGelGrouped;
  readonly formatDeliveredAt = formatTbilisiDotDateTime;

  readonly statusFilters: ReadonlyArray<{ id: MyOrdersStatusFilter; labelKey: string }> = [
    { id: 'all', labelKey: 'orders.allOrders' },
    { id: 'pending', labelKey: 'orders.status.pending' },
    { id: 'office', labelKey: 'orders.status.office' },
    { id: 'picked_up', labelKey: 'orders.status.picked_up' },
    { id: 'delivered', labelKey: 'orders.status.delivered' },
    { id: 'cancelled', labelKey: 'orders.status.cancelled' },
  ];

  readonly periodPresets: ReadonlyArray<{ id: MyOrdersPeriodPreset; labelKey: string }> = [
    { id: 'all', labelKey: 'orders.periodAll' },
    { id: 'today', labelKey: 'orders.periodToday' },
    { id: 'this_month', labelKey: 'orders.periodThisMonth' },
    { id: 'previous_month', labelKey: 'orders.periodPreviousMonth' },
    { id: 'this_year', labelKey: 'orders.periodThisYear' },
    { id: 'custom', labelKey: 'orders.periodCustom' },
  ];

  readonly emptyByStatus: Record<MyOrdersStatusFilter, string> = {
    all: 'orders.emptyAll',
    pending: 'orders.emptyPending',
    office: 'orders.emptyOffice',
    picked_up: 'orders.emptyPickedUp',
    delivered: 'orders.emptyDelivered',
    cancelled: 'orders.emptyCancelled',
  };

  readonly hasMore = computed(() => this.orders().length < this.listTotal());
  readonly averageAmount = computed(() => {
    const stats = this.analytics();
    if (!stats.order_count) {
      return 0;
    }
    return stats.amount_to_collect / stats.order_count;
  });
  readonly showDeliveredAnalytics = computed(() => this.statusFilter() === 'delivered');
  readonly showAllSummary = computed(() => this.statusFilter() === 'all');

  readonly editForm = this.fb.nonNullable.group({
    sender_name: ['', Validators.required],
    sender_phone: ['', [Validators.required, Validators.minLength(6)]],
    pickup_city: ['', Validators.required],
    pickup_district: ['', Validators.required],
    pickup_address: ['', Validators.required],
    recipient_name: ['', Validators.required],
    recipient_phone: ['', [Validators.required, Validators.minLength(6)]],
    delivery_city: ['', Validators.required],
    delivery_district: ['', Validators.required],
    delivery_address: ['', Validators.required],
    parcel_count: [1, [Validators.required, Validators.min(1)]],
    delivery_date: ['', Validators.required],
    amount_to_collect: ['', [Validators.required, amountNonNegativeValidator]],
    notes: [''],
    is_fragile: [false],
  });

  private softReloadInFlight = false;
  private softReloadQueued = false;
  private loadedPages = 1;

  constructor() {
    this.orderRealtime.userChanges$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((change) => {
        void this.onRealtimeChange(change);
      });
  }

  async ngOnInit(): Promise<void> {
    const { year } = tbilisiYmdParts();
    this.filterYear.set(year);
    this.filterMonth.set(null);
    this.yearOptions.set(this.buildDefaultYears(year));

    this.loading.set(true);
    this.countsLoading.set(true);
    await Promise.all([this.refreshCounts(), this.refreshYears(), this.fetchOrders(true)]);
    this.loading.set(false);
    this.countsLoading.set(false);
  }

  isPeriodActive(preset: MyOrdersPeriodPreset): boolean {
    const current = this.periodPreset();
    if (current === preset) {
      return true;
    }
    if (preset === 'this_year' && current === 'year_only') {
      return this.filterYear() === tbilisiYmdParts().year;
    }
    return false;
  }

  countFor(status: MyOrdersStatusFilter): number {
    const counts = this.statusCounts();
    return counts[status];
  }

  emptyMessageKey(): string {
    if (this.statusFilter() === 'delivered' && this.periodPreset() !== 'all') {
      return 'orders.analyticsEmpty';
    }
    return this.emptyByStatus[this.statusFilter()];
  }

  async selectStatusFilter(status: MyOrdersStatusFilter): Promise<void> {
    if (this.statusFilter() === status) {
      return;
    }
    this.statusFilter.set(status);
    this.expandedId.set(null);
    this.loading.set(true);
    if (status === 'delivered') {
      await Promise.all([this.fetchOrders(true), this.fetchAnalytics()]);
    } else {
      await this.fetchOrders(true);
    }
    this.loading.set(false);
  }

  async selectPeriodPreset(preset: MyOrdersPeriodPreset): Promise<void> {
    if (preset === 'custom') {
      this.periodPreset.set('custom');
      this.filterMonth.set(null);
      if (!this.customFrom() && !this.customTo()) {
        const today = tbilisiTodayIso();
        this.customFrom.set(today);
        this.customTo.set(today);
      }
      this.dateRangeError.set(null);
      await this.reloadDelivered();
      return;
    }

    this.periodPreset.set(preset);
    this.filterMonth.set(null);
    this.customFrom.set('');
    this.customTo.set('');
    this.dateRangeError.set(null);

    if (preset === 'this_year') {
      this.filterYear.set(tbilisiYmdParts().year);
    }

    await this.reloadDelivered();
  }

  async onMonthChange(raw: string): Promise<void> {
    const month = raw === '' ? null : Number(raw);
    this.filterMonth.set(month != null && Number.isFinite(month) ? month : null);
    const year = this.filterYear() ?? tbilisiYmdParts().year;
    this.filterYear.set(year);

    if (month == null) {
      this.periodPreset.set('year_only');
    } else {
      this.periodPreset.set('month_year');
    }
    this.customFrom.set('');
    this.customTo.set('');
    this.dateRangeError.set(null);
    await this.reloadDelivered();
  }

  async onYearChange(raw: string): Promise<void> {
    const year = Number(raw);
    if (!Number.isFinite(year)) {
      return;
    }
    this.filterYear.set(year);
    this.customFrom.set('');
    this.customTo.set('');
    this.dateRangeError.set(null);
    this.periodPreset.set(this.filterMonth() != null ? 'month_year' : 'year_only');
    await this.reloadDelivered();
  }

  async onCustomFromChange(value: string): Promise<void> {
    this.customFrom.set(value);
    this.periodPreset.set('custom');
    await this.applyCustomRange();
  }

  async onCustomToChange(value: string): Promise<void> {
    this.customTo.set(value);
    this.periodPreset.set('custom');
    await this.applyCustomRange();
  }

  async clearDeliveredFilters(): Promise<void> {
    const { year } = tbilisiYmdParts();
    this.periodPreset.set('all');
    this.filterYear.set(year);
    this.filterMonth.set(null);
    this.customFrom.set('');
    this.customTo.set('');
    this.dateRangeError.set(null);
    await this.reloadDelivered();
  }

  async retryAnalytics(): Promise<void> {
    await this.fetchAnalytics();
  }

  async loadMore(): Promise<void> {
    if (this.loadingMore() || !this.hasMore()) {
      return;
    }
    this.loadingMore.set(true);
    await this.fetchOrders(false);
    this.loadingMore.set(false);
  }

  toggleDetails(orderId: number): void {
    this.expandedId.update((current) => (current === orderId ? null : orderId));
  }

  canEdit(order: Order): boolean {
    return order.status === 'pending';
  }

  /** Pickup-task cancel only — not delivery order.cancellation_reason. */
  hasPickupCancellation(order: Order): boolean {
    return (
      order.pickup_task_status === 'cancelled' &&
      !!order.pickup_cancellation_reason?.trim()
    );
  }

  openEdit(order: Order): void {
    if (!this.canEdit(order)) {
      return;
    }

    this.successMessage.set(null);
    this.editError.set(null);
    this.editingOrder.set(order);
    this.editForm.reset({
      sender_name: order.sender_name,
      sender_phone: order.sender_phone,
      pickup_city: order.pickup_city,
      pickup_district: order.pickup_district,
      pickup_address: order.pickup_address,
      recipient_name: order.recipient_name,
      recipient_phone: order.recipient_phone,
      delivery_city: order.delivery_city,
      delivery_district: order.delivery_district,
      delivery_address: order.delivery_address,
      parcel_count: order.parcel_count,
      delivery_date: order.delivery_date,
      amount_to_collect: formatGel(order.amount_to_collect),
      notes: order.notes ?? '',
      is_fragile: order.is_fragile,
    });
  }

  closeEdit(): void {
    this.editingOrder.set(null);
    this.editError.set(null);
    this.saving.set(false);
  }

  async saveEdit(): Promise<void> {
    const order = this.editingOrder();
    if (!order || this.saving()) {
      return;
    }

    if (this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      this.editError.set(this.firstValidationMessage());
      return;
    }

    const value = this.editForm.getRawValue();
    if (
      !isDeliveryDateAllowed(value.delivery_date, {
        allowExistingPast: true,
        originalValue: order.delivery_date,
      })
    ) {
      this.editError.set('მიწოდების თარიღი უნდა იყოს ხვალ ან უფრო გვიან.');
      return;
    }

    this.saving.set(true);
    this.editError.set(null);

    const { data, error } = await this.ordersService.updateMyPendingOrder(
      order.id,
      {
        sender_name: value.sender_name,
        sender_phone: value.sender_phone,
        pickup_city: value.pickup_city,
        pickup_district: value.pickup_district,
        pickup_address: value.pickup_address,
        recipient_name: value.recipient_name,
        recipient_phone: value.recipient_phone,
        delivery_city: value.delivery_city,
        delivery_district: value.delivery_district,
        delivery_address: value.delivery_address,
        parcel_count: value.parcel_count,
        delivery_date: value.delivery_date,
        amount_to_collect: centsToNumber(toCents(value.amount_to_collect)),
        notes: value.notes || null,
        is_fragile: value.is_fragile,
      },
      { originalDeliveryDate: order.delivery_date },
    );

    this.saving.set(false);

    if (error || !data) {
      this.editError.set(error ?? 'შენახვა ვერ მოხერხდა');
      return;
    }

    this.orders.update((list) => list.map((item) => (item.id === data.id ? data : item)));
    this.successMessage.set(`შეკვეთა #${data.id} წარმატებით განახლდა`);
    this.closeEdit();
  }

  private firstValidationMessage(): string {
    const c = this.editForm.controls;
    if (c.amount_to_collect.hasError('amountInvalid')) {
      return 'ასაღები თანხა უნდა იყოს 0 ან მეტი.';
    }
    if (c.parcel_count.invalid) {
      return 'გადასაცემი ერთეულების რაოდენობა უნდა იყოს 1 ან მეტი.';
    }
    return 'გთხოვთ შეავსოთ ყველა სავალდებულო ველი.';
  }

  private async onRealtimeChange(change: {
    eventType: 'INSERT' | 'UPDATE' | 'DELETE';
    orderId: number | null;
  }): Promise<void> {
    if (change.eventType === 'DELETE' && change.orderId != null) {
      const deletedId = change.orderId;
      this.orders.update((list) => list.filter((item) => item.id !== deletedId));
      this.listTotal.update((total) => Math.max(0, total - 1));
      this.expandedId.update((current) => (current === deletedId ? null : current));
      if (this.editingOrder()?.id === deletedId) {
        this.closeEdit();
      }
      await this.refreshCounts();
      if (this.showDeliveredAnalytics()) {
        await this.fetchAnalytics();
      }
      return;
    }

    await this.softReload();
  }

  private async softReload(): Promise<void> {
    if (this.softReloadInFlight) {
      this.softReloadQueued = true;
      return;
    }

    this.softReloadInFlight = true;
    try {
      do {
        this.softReloadQueued = false;
        await Promise.all([
          this.refreshCounts(),
          this.refreshVisibleOrders(),
          this.showDeliveredAnalytics() ? this.fetchAnalytics() : Promise.resolve(),
        ]);
      } while (this.softReloadQueued);
    } finally {
      this.softReloadInFlight = false;
    }
  }

  private async reloadDelivered(): Promise<void> {
    this.loading.set(true);
    await Promise.all([this.fetchOrders(true), this.fetchAnalytics()]);
    this.loading.set(false);
  }

  private async applyCustomRange(): Promise<void> {
    const from = this.customFrom().trim();
    const to = this.customTo().trim();

    if (isIsoDateOnly(from) && isIsoDateOnly(to) && from > to) {
      this.dateRangeError.set('orders.invalidDateRange');
      return;
    }

    this.dateRangeError.set(null);
    if (!isIsoDateOnly(from) || !isIsoDateOnly(to)) {
      return;
    }

    await this.reloadDelivered();
  }

  private resolveDeliveredRange(): {
    deliveredFrom: string | null;
    deliveredTo: string | null;
    year: number | null;
    month: number | null;
  } {
    const preset = this.periodPreset();

    if (preset === 'month_year') {
      const year = this.filterYear();
      const month = this.filterMonth();
      return {
        deliveredFrom: null,
        deliveredTo: null,
        year,
        month,
      };
    }

    if (preset === 'year_only' || (preset === 'this_year' && this.filterMonth() == null)) {
      const year = this.filterYear() ?? tbilisiYmdParts().year;
      return {
        deliveredFrom: null,
        deliveredTo: null,
        year,
        month: null,
      };
    }

    if (preset === 'all') {
      return { deliveredFrom: null, deliveredTo: null, year: null, month: null };
    }

    if (preset === 'today') {
      const today = tbilisiTodayIso();
      return { deliveredFrom: today, deliveredTo: today, year: null, month: null };
    }

    if (preset === 'this_month') {
      const range = tbilisiThisMonthDateRange();
      return { deliveredFrom: range.from, deliveredTo: range.to, year: null, month: null };
    }

    if (preset === 'previous_month') {
      const range = tbilisiPreviousMonthDateRange();
      return { deliveredFrom: range.from, deliveredTo: range.to, year: null, month: null };
    }

    if (preset === 'this_year') {
      const range = tbilisiThisYearDateRange();
      return { deliveredFrom: range.from, deliveredTo: range.to, year: null, month: null };
    }

    // custom
    const from = this.customFrom().trim();
    const to = this.customTo().trim();
    return {
      deliveredFrom: isIsoDateOnly(from) ? from : null,
      deliveredTo: isIsoDateOnly(to) ? to : null,
      year: null,
      month: null,
    };
  }

  private async fetchOrders(reset: boolean): Promise<void> {
    if (reset) {
      this.loadedPages = 1;
    } else {
      this.loadedPages += 1;
    }

    const page = reset ? 1 : this.loadedPages;
    const range =
      this.statusFilter() === 'delivered'
        ? this.resolveDeliveredRange()
        : { deliveredFrom: null, deliveredTo: null, year: null, month: null };

    // For list filtering, convert month/year into date bounds client-side.
    let deliveredFrom = range.deliveredFrom;
    let deliveredTo = range.deliveredTo;
    if (range.year != null && range.month != null) {
      const days = new Date(range.year, range.month, 0).getDate();
      deliveredFrom = `${range.year}-${String(range.month).padStart(2, '0')}-01`;
      deliveredTo = `${range.year}-${String(range.month).padStart(2, '0')}-${String(days).padStart(2, '0')}`;
    } else if (range.year != null) {
      deliveredFrom = `${range.year}-01-01`;
      deliveredTo = `${range.year}-12-31`;
    }

    if (
      this.statusFilter() === 'delivered' &&
      this.periodPreset() === 'custom' &&
      this.dateRangeError()
    ) {
      if (reset) {
        this.orders.set([]);
        this.listTotal.set(0);
      }
      return;
    }

    const result = await this.ordersService.getMyOrders({
      status: this.statusFilter(),
      page,
      pageSize: this.pageSize,
      deliveredFrom,
      deliveredTo,
    });

    this.errorMessage.set(result.error);
    this.listTotal.set(result.total);

    if (reset) {
      this.orders.set(result.data);
    } else {
      this.orders.update((list) => {
        const seen = new Set(list.map((o) => o.id));
        return [...list, ...result.data.filter((o) => !seen.has(o.id))];
      });
    }

    const expanded = this.expandedId();
    if (expanded !== null && !this.orders().some((o) => o.id === expanded)) {
      this.expandedId.set(null);
    }

    const editing = this.editingOrder();
    if (editing) {
      const latest = this.orders().find((o) => o.id === editing.id);
      if (!latest || latest.status !== 'pending') {
        this.closeEdit();
      } else {
        this.editingOrder.set(latest);
      }
    }
  }

  /** Soft-reload all currently visible pages without collapsing Load More progress. */
  private async refreshVisibleOrders(): Promise<void> {
    const pages = Math.max(1, this.loadedPages);
    const range =
      this.statusFilter() === 'delivered'
        ? this.resolveDeliveredRange()
        : { deliveredFrom: null, deliveredTo: null, year: null, month: null };

    let deliveredFrom = range.deliveredFrom;
    let deliveredTo = range.deliveredTo;
    if (range.year != null && range.month != null) {
      const days = new Date(range.year, range.month, 0).getDate();
      deliveredFrom = `${range.year}-${String(range.month).padStart(2, '0')}-01`;
      deliveredTo = `${range.year}-${String(range.month).padStart(2, '0')}-${String(days).padStart(2, '0')}`;
    } else if (range.year != null) {
      deliveredFrom = `${range.year}-01-01`;
      deliveredTo = `${range.year}-12-31`;
    }

    const result = await this.ordersService.getMyOrders({
      status: this.statusFilter(),
      page: 1,
      pageSize: pages * this.pageSize,
      deliveredFrom,
      deliveredTo,
    });

    if (!result.error) {
      this.orders.set(result.data);
      this.listTotal.set(result.total);
      this.loadedPages = Math.max(1, Math.ceil(result.data.length / this.pageSize) || 1);
    } else {
      this.errorMessage.set(result.error);
    }
  }

  private async fetchAnalytics(): Promise<void> {
    if (this.statusFilter() !== 'delivered') {
      return;
    }

    if (this.periodPreset() === 'custom' && this.dateRangeError()) {
      this.analytics.set(EMPTY_ANALYTICS);
      return;
    }

    this.analyticsLoading.set(true);
    this.analyticsError.set(null);

    const range = this.resolveDeliveredRange();
    const { data, error } = await this.ordersService.getMyDeliveredAnalytics({
      dateFrom: range.deliveredFrom,
      dateTo: range.deliveredTo,
      year: range.year,
      month: range.month,
    });

    this.analytics.set(data);
    this.analyticsError.set(error ? 'orders.analyticsError' : null);
    this.analyticsLoading.set(false);
  }

  private async refreshCounts(): Promise<void> {
    const { data, error } = await this.ordersService.getMyOrderStatusCounts();
    if (!error) {
      this.statusCounts.set(data);
    }
    this.countsLoading.set(false);
  }

  private async refreshYears(): Promise<void> {
    const { data } = await this.ordersService.getMyOrderYears();
    if (data.length) {
      this.yearOptions.set(data);
    }
  }

  private buildDefaultYears(currentYear: number): number[] {
    const years: number[] = [];
    for (let y = currentYear; y >= currentYear - 5; y -= 1) {
      years.push(y);
    }
    return years;
  }
}
