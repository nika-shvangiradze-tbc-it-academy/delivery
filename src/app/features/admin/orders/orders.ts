import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import {
  AbstractControl,
  FormBuilder,
  FormsModule,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { TranslatePipe } from '../../../core/pipes/t.pipe';
import {
  ADMIN_COURIER_UNASSIGNED,
  ADMIN_ORDER_PAGE_SIZES,
  ADMIN_PAGE_SIZE_STORAGE_KEY,
  ADMIN_STATUS_GROUPS,
  AdminDatePreset,
  AdminDeliveredAnalytics,
  AdminOrderFilters,
  AdminOrderPageSize,
  AdminPaymentMethodFilter,
  AdminStatusGroup,
  ORDER_STATUSES,
  Order,
  OrderStatus,
  OrderStatusAuditEntry,
} from '../../../core/models/order.model';
import { CourierOption } from '../../../core/models/profile.model';
import { AdminService } from '../../../core/services/admin.service';
import {
  OrderRealtimeChange,
  OrderRealtimeService,
} from '../../../core/services/order-realtime.service';
import { OrdersService } from '../../../core/services/orders.service';
import {
  auditRoleLabelKa,
  formatGel,
  formatTbilisiDateTime,
  formatTbilisiDotDateTime,
  normalizeOrder,
  orderStatusClass,
  orderStatusLabelKey,
  orderStatusSelectClass,
  paymentMethodLabel,
  centsToNumber,
  toCents,
  courierStatusLabel,
} from '../../../core/utils/order-status.util';
import {
  GEORGIAN_CITIES,
  isDeliveryDateAllowed,
  minDeliveryDateIso,
  toDateInputValue,
} from '../../../core/constants/cities';
import { DeliveryHeader } from '../../../layout/delivery-header/delivery-header';

function amountPositiveValidator(control: AbstractControl): ValidationErrors | null {
  const amount = centsToNumber(toCents(control.value));
  return amount > 0 ? null : { amountInvalid: true };
}

function readStoredPageSize(): AdminOrderPageSize {
  try {
    const raw = localStorage.getItem(ADMIN_PAGE_SIZE_STORAGE_KEY);
    const n = raw ? Number(raw) : NaN;
    if ((ADMIN_ORDER_PAGE_SIZES as readonly number[]).includes(n)) {
      return n as AdminOrderPageSize;
    }
  } catch {
    // ignore storage errors
  }
  return 50;
}

const EMPTY_ANALYTICS: AdminDeliveredAnalytics = {
  summary: {
    order_count: 0,
    parcel_count: 0,
    total_amount: 0,
    cash_amount: 0,
    card_amount: 0,
  },
  by_city: [],
  by_courier: [],
};

const EMPTY_MESSAGES: Record<AdminStatusGroup, string> = {
  pending: 'მოლოდინში შეკვეთები არ არის',
  active: 'აქტიური შეკვეთები არ მოიძებნა',
  delivered: 'ჩაბარებული შეკვეთები არ მოიძებნა',
  cancelled: 'გაუქმებული შეკვეთები არ მოიძებნა',
  all: 'შეკვეთები არ მოიძებნა',
};

const TAB_LABELS: Record<AdminStatusGroup, string> = {
  pending: 'მოლოდინში',
  active: 'აქტიური',
  delivered: 'ჩაბარებული',
  cancelled: 'გაუქმებული',
  all: 'ყველა',
};

@Component({
  selector: 'app-admin-orders',
  imports: [DeliveryHeader, TranslatePipe, ReactiveFormsModule, FormsModule, DatePipe],
  templateUrl: './orders.html',
  styleUrl: './orders.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminOrders implements OnInit {
  private readonly adminService = inject(AdminService);
  private readonly ordersService = inject(OrdersService);
  private readonly orderRealtime = inject(OrderRealtimeService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  /** Ignores stale responses when filters change rapidly. */
  private loadGeneration = 0;
  private analyticsGeneration = 0;
  /** Prevents overlapping soft reloads from Realtime bursts. */
  private softReloadInFlight = false;
  private softReloadQueued = false;

  readonly cities = GEORGIAN_CITIES;
  readonly minDeliveryDate = minDeliveryDateIso();
  readonly statusGroups = ADMIN_STATUS_GROUPS;
  readonly pageSizes = ADMIN_ORDER_PAGE_SIZES;
  readonly unassignedCourier = ADMIN_COURIER_UNASSIGNED;
  readonly tabLabels = TAB_LABELS;

  readonly orders = signal<Order[]>([]);
  readonly couriers = signal<CourierOption[]>([]);
  readonly selectedOrder = signal<Order | null>(null);
  readonly editingOrder = signal<Order | null>(null);
  readonly auditOrder = signal<Order | null>(null);
  readonly auditEntries = signal<OrderStatusAuditEntry[]>([]);
  readonly auditLoading = signal(false);
  readonly auditError = signal<string | null>(null);
  readonly selectedIds = signal<Set<number>>(new Set());
  readonly bulkCourierId = signal<string | null>(null);
  readonly loading = signal(true);
  readonly analyticsLoading = signal(false);
  readonly updating = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly statuses = ORDER_STATUSES;

  readonly statusGroup = signal<AdminStatusGroup>('pending');
  readonly page = signal(1);
  readonly pageSize = signal<AdminOrderPageSize>(readStoredPageSize());
  readonly total = signal(0);
  readonly datePreset = signal<AdminDatePreset>('all');
  readonly analytics = signal<AdminDeliveredAnalytics>(EMPTY_ANALYTICS);

  readonly statusClass = orderStatusClass;
  readonly statusSelectClass = orderStatusSelectClass;
  readonly statusLabelKey = orderStatusLabelKey;
  readonly statusLabelKa = courierStatusLabel;
  readonly formatGel = formatGel;
  readonly paymentLabel = paymentMethodLabel;
  readonly formatAuditTime = formatTbilisiDateTime;
  readonly formatCancelTime = formatTbilisiDotDateTime;
  readonly roleLabel = auditRoleLabelKa;

  readonly selectedCount = computed(() => this.selectedIds().size);
  readonly allSelected = computed(
    () => this.orders().length > 0 && this.selectedIds().size === this.orders().length,
  );
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  readonly emptyMessage = computed(() => EMPTY_MESSAGES[this.statusGroup()]);
  readonly showDeliveredAnalytics = computed(() => this.statusGroup() === 'delivered');
  readonly rangeFrom = computed(() => {
    if (this.total() === 0) return 0;
    return (this.page() - 1) * this.pageSize() + 1;
  });
  readonly rangeTo = computed(() => Math.min(this.page() * this.pageSize(), this.total()));
  readonly pageNumbers = computed(() => this.buildPageNumbers(this.page(), this.totalPages()));

  readonly filtersForm = this.fb.nonNullable.group({
    search: [''],
    pickupCity: [''],
    deliveryCity: [''],
    deliveryDate: [''],
    courierId: [''],
    deliveredDateFrom: [''],
    deliveredDateTo: [''],
    paymentMethod: ['all' as AdminPaymentMethodFilter],
  });

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
    amount_to_collect: ['', [Validators.required, amountPositiveValidator]],
    notes: [''],
    is_fragile: [false],
  });

  async ngOnInit(): Promise<void> {
    this.filtersForm.controls.search.valueChanges
      .pipe(debounceTime(400), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        void this.resetPageAndLoad();
      });

    this.filtersForm.controls.pickupCity.valueChanges
      .pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.resetPageAndLoad());

    this.filtersForm.controls.deliveryCity.valueChanges
      .pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.resetPageAndLoad());

    this.filtersForm.controls.courierId.valueChanges
      .pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.resetPageAndLoad());

    this.filtersForm.controls.paymentMethod.valueChanges
      .pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.resetPageAndLoad());

    this.filtersForm.controls.deliveredDateFrom.valueChanges
      .pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.statusGroup() === 'delivered') {
          void this.resetPageAndLoad();
        }
      });

    this.filtersForm.controls.deliveredDateTo.valueChanges
      .pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.statusGroup() === 'delivered') {
          void this.resetPageAndLoad();
        }
      });

    this.filtersForm.controls.deliveryDate.valueChanges
      .pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.datePreset() === 'custom' && this.statusGroup() !== 'delivered') {
          void this.resetPageAndLoad();
        }
      });

    this.orderRealtime.adminChanges$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((change) => {
        void this.onRealtimeChange(change);
      });

    await Promise.all([this.loadOrders(), this.loadCouriers()]);
  }

  async loadCouriers(): Promise<void> {
    const { data, error } = await this.adminService.getCouriers();
    if (error) {
      this.errorMessage.set(error);
      return;
    }
    this.couriers.set(data);
  }

  currentFilters(): AdminOrderFilters {
    const form = this.filtersForm.getRawValue();
    const payment = form.paymentMethod;
    const isDelivered = this.statusGroup() === 'delivered';
    const from = form.deliveredDateFrom.trim();
    const to = form.deliveredDateTo.trim();

    return {
      statusGroup: this.statusGroup(),
      date: isDelivered ? null : this.resolveDeliveryDate(form.deliveryDate),
      deliveredDateFrom: isDelivered && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null,
      deliveredDateTo: isDelivered && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : null,
      pickupCity: form.pickupCity || null,
      city: form.deliveryCity || null,
      courierId: form.courierId || null,
      paymentMethod: isDelivered
        ? payment === 'cash' || payment === 'card'
          ? payment
          : 'all'
        : 'all',
      search: form.search,
      page: this.page(),
      pageSize: this.pageSize(),
    };
  }

  async loadOrders(): Promise<void> {
    const generation = ++this.loadGeneration;
    this.loading.set(true);
    this.errorMessage.set(null);

    const filters = this.currentFilters();
    const analyticsPromise =
      filters.statusGroup === 'delivered' ? this.loadDeliveredAnalytics(filters) : Promise.resolve();

    const [result] = await Promise.all([
      this.adminService.getAdminOrders(filters),
      analyticsPromise,
    ]);

    if (generation !== this.loadGeneration) {
      return;
    }

    this.orders.set(result.data);
    this.total.set(result.total);
    this.selectedIds.set(new Set());
    this.errorMessage.set(result.error);
    this.loading.set(false);

    if (filters.statusGroup !== 'delivered') {
      this.analytics.set(EMPTY_ANALYTICS);
    }
  }

  selectStatusGroup(group: AdminStatusGroup): void {
    if (this.statusGroup() === group) return;
    this.statusGroup.set(group);
    this.resetPageAndLoad();
  }

  onDatePresetChange(preset: AdminDatePreset): void {
    this.datePreset.set(preset);
    if (preset === 'today') {
      this.filtersForm.controls.deliveryDate.setValue(toDateInputValue(new Date()), {
        emitEvent: false,
      });
    } else if (preset === 'tomorrow') {
      this.filtersForm.controls.deliveryDate.setValue(minDeliveryDateIso(), { emitEvent: false });
    } else if (preset === 'all') {
      this.filtersForm.controls.deliveryDate.setValue('', { emitEvent: false });
    }
    this.resetPageAndLoad();
  }

  onPageSizeChange(size: number): void {
    const next = (this.pageSizes as readonly number[]).includes(size)
      ? (size as AdminOrderPageSize)
      : 50;
    this.pageSize.set(next);
    try {
      localStorage.setItem(ADMIN_PAGE_SIZE_STORAGE_KEY, String(next));
    } catch {
      // ignore storage errors
    }
    this.resetPageAndLoad();
  }

  async onFilter(): Promise<void> {
    await this.resetPageAndLoad();
  }

  async goToPage(page: number): Promise<void> {
    const clamped = Math.min(Math.max(1, page), this.totalPages());
    if (clamped === this.page()) return;
    this.page.set(clamped);
    await this.loadOrders();
  }

  async nextPage(): Promise<void> {
    await this.goToPage(this.page() + 1);
  }

  async prevPage(): Promise<void> {
    await this.goToPage(this.page() - 1);
  }

  openDetails(order: Order): void {
    this.selectedOrder.set(order);
  }

  closeDetails(): void {
    this.selectedOrder.set(null);
  }

  openEdit(order: Order): void {
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
  }

  async openAuditHistory(order: Order): Promise<void> {
    this.auditOrder.set(order);
    this.auditEntries.set([]);
    this.auditError.set(null);
    this.auditLoading.set(true);

    const { data, error } = await this.adminService.getOrderStatusAudit(order.id);
    this.auditLoading.set(false);

    if (this.auditOrder()?.id !== order.id) {
      return;
    }

    if (error) {
      this.auditError.set(error);
      this.auditEntries.set([]);
      return;
    }

    this.auditEntries.set(data);
  }

  closeAuditHistory(): void {
    this.auditOrder.set(null);
    this.auditEntries.set([]);
    this.auditError.set(null);
    this.auditLoading.set(false);
  }

  async saveEdit(): Promise<void> {
    const order = this.editingOrder();
    if (!order) return;

    if (this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      this.errorMessage.set('გთხოვთ შეავსოთ ყველა სავალდებულო ველი.');
      return;
    }

    const value = this.editForm.getRawValue();
    if (
      !isDeliveryDateAllowed(value.delivery_date, {
        allowExistingPast: true,
        originalValue: order.delivery_date,
      })
    ) {
      this.errorMessage.set('მიწოდების თარიღი უნდა იყოს ხვალ ან უფრო გვიან.');
      return;
    }

    this.updating.set(true);
    this.errorMessage.set(null);

    const { data, error } = await this.ordersService.updateOrderDetails(
      order.id,
      {
        ...value,
        amount_to_collect: centsToNumber(toCents(value.amount_to_collect)),
        notes: value.notes || null,
      },
      { originalDeliveryDate: order.delivery_date },
    );

    this.updating.set(false);

    if (error || !data) {
      this.errorMessage.set(error ?? 'შენახვა ვერ მოხერხდა');
      return;
    }

    this.patchOrDropOrder(data);
    this.successMessage.set(`შეკვეთა #${order.id} განახლდა`);
    this.closeEdit();
    if (this.statusGroup() === 'delivered') {
      void this.loadDeliveredAnalytics(this.currentFilters());
    }
  }

  courierName(courierId: string | null): string {
    if (!courierId) return '—';
    return this.couriers().find((c) => c.id === courierId)?.full_name ?? '—';
  }

  isSelected(orderId: number): boolean {
    return this.selectedIds().has(orderId);
  }

  toggleOrder(orderId: number, checked: boolean): void {
    this.selectedIds.update((current) => {
      const next = new Set(current);
      if (checked) next.add(orderId);
      else next.delete(orderId);
      return next;
    });
  }

  toggleSelectAll(checked: boolean): void {
    if (!checked) {
      this.selectedIds.set(new Set());
      return;
    }
    this.selectedIds.set(new Set(this.orders().map((order) => order.id)));
  }

  async assignSelected(): Promise<void> {
    const courierId = this.bulkCourierId();
    const ids = [...this.selectedIds()];
    if (!courierId) {
      this.errorMessage.set('აირჩიე კურიერი');
      return;
    }
    if (ids.length === 0) {
      this.errorMessage.set('მონიშნე ერთი ან მეტი შეკვეთა');
      return;
    }

    this.updating.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    const { data, error } = await this.adminService.assignCouriersBulk(ids, courierId);
    this.updating.set(false);

    if (error) {
      this.errorMessage.set(error);
      return;
    }

    this.selectedIds.set(new Set());
    this.successMessage.set(`${data.length} შეკვეთა მიენიჭა კურიერს`);
    await this.loadOrders();
  }

  async unassignSelected(): Promise<void> {
    const ids = [...this.selectedIds()];
    if (ids.length === 0) {
      this.errorMessage.set('მონიშნე ერთი ან მეტი შეკვეთა');
      return;
    }

    this.updating.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    const { data, error } = await this.adminService.assignCouriersBulk(ids, null);
    this.updating.set(false);

    if (error) {
      this.errorMessage.set(error);
      return;
    }

    this.selectedIds.set(new Set());
    this.successMessage.set(`${data.length} შეკვეთიდან კურიერი მოიხსნა`);
    await this.loadOrders();
  }

  async updateOrderStatus(order: Order, status: OrderStatus): Promise<void> {
    if (!ORDER_STATUSES.includes(status) || status === order.status) return;

    const previousStatus = order.status;
    this.updating.set(true);
    this.errorMessage.set(null);

    this.orders.update((list) =>
      list.map((item) => (item.id === order.id ? { ...item, status } : item)),
    );

    const { data, error } = await this.adminService.updateOrderStatus(order.id, status);
    this.updating.set(false);

    if (error || !data) {
      this.orders.update((list) =>
        list.map((item) =>
          item.id === order.id ? { ...item, status: previousStatus } : item,
        ),
      );
      this.errorMessage.set(error ?? 'სტატუსის განახლება ვერ მოხერხდა');
      return;
    }

    this.patchOrDropOrder(data);
    if (this.statusGroup() === 'delivered' || status === 'delivered' || previousStatus === 'delivered') {
      void this.loadDeliveredAnalytics(this.currentFilters());
    }
  }

  /**
   * Keep list aligned with active tab/filters after mutations
   * (Realtime-compatible: update matching row or drop non-matching).
   */
  private patchOrDropOrder(order: Order): void {
    const matches = this.adminService.orderMatchesAdminFilters(order, this.currentFilters());
    if (!matches) {
      this.orders.update((list) => list.filter((item) => item.id !== order.id));
      this.total.update((n) => Math.max(0, n - 1));
      return;
    }
    this.orders.update((list) => list.map((item) => (item.id === order.id ? order : item)));
  }

  /**
   * Realtime: patch visible rows when possible; otherwise soft-refresh
   * the current page only (never load full history).
   */
  private async onRealtimeChange(change: OrderRealtimeChange): Promise<void> {
    if (this.updating()) {
      return;
    }

    if (change.eventType === 'DELETE') {
      const deletedId = change.orderId ?? change.oldRow?.id ?? null;
      if (deletedId != null && this.orders().some((o) => o.id === deletedId)) {
        this.orders.update((list) => list.filter((item) => item.id !== deletedId));
        this.total.update((n) => Math.max(0, n - 1));
        this.selectedIds.update((ids) => {
          if (!ids.has(deletedId)) return ids;
          const next = new Set(ids);
          next.delete(deletedId);
          return next;
        });
        await this.softReloadCurrentPage();
      } else if (this.statusGroup() === 'delivered') {
        void this.loadDeliveredAnalytics(this.currentFilters());
      }
      return;
    }

    const normalized = normalizeOrder(
      (change.newRow ?? undefined) as Partial<Order> & { id?: number | string },
    );
    // Incomplete Realtime payloads → current-page soft reload (safe with pagination).
    if (!normalized?.id || !change.newRow?.status) {
      await this.softReloadCurrentPage();
      return;
    }

    const filters = this.currentFilters();
    const inList = this.orders().some((o) => o.id === normalized.id);
    const matches = this.adminService.orderMatchesAdminFilters(normalized, filters);

    if (inList && matches) {
      this.patchOrDropOrder(normalized);
      this.syncOpenModals(normalized);
      if (filters.statusGroup === 'delivered') {
        void this.loadDeliveredAnalytics(filters);
      }
      return;
    }

    if (inList && !matches) {
      this.patchOrDropOrder(normalized);
      this.closeModalsForOrder(normalized.id);
      await this.softReloadCurrentPage();
      return;
    }

    if (!inList && matches) {
      await this.softReloadCurrentPage();
      return;
    }

    // Not visible — still refresh delivered analytics if status could affect totals.
    if (
      filters.statusGroup === 'delivered' &&
      (normalized.status === 'delivered' || change.oldRow?.status === 'delivered')
    ) {
      void this.loadDeliveredAnalytics(filters);
    }
  }

  private syncOpenModals(order: Order): void {
    if (this.selectedOrder()?.id === order.id) {
      this.selectedOrder.set(order);
    }
  }

  private closeModalsForOrder(orderId: number): void {
    if (this.selectedOrder()?.id === orderId) {
      this.selectedOrder.set(null);
    }
    if (this.editingOrder()?.id === orderId) {
      this.editingOrder.set(null);
    }
  }

  /** Current-page reload without full-page loading flash. */
  private async softReloadCurrentPage(): Promise<void> {
    if (this.softReloadInFlight) {
      this.softReloadQueued = true;
      return;
    }

    this.softReloadInFlight = true;
    try {
      do {
        this.softReloadQueued = false;
        const generation = ++this.loadGeneration;
        const filters = this.currentFilters();
        const analyticsPromise =
          filters.statusGroup === 'delivered'
            ? this.loadDeliveredAnalytics(filters)
            : Promise.resolve();

        const [result] = await Promise.all([
          this.adminService.getAdminOrders(filters),
          analyticsPromise,
        ]);

        if (generation !== this.loadGeneration) {
          return;
        }

        this.orders.set(result.data);
        this.total.set(result.total);
        this.selectedIds.update((ids) => {
          if (ids.size === 0) return ids;
          const visible = new Set(result.data.map((o) => o.id));
          const next = new Set([...ids].filter((id) => visible.has(id)));
          return next;
        });
        if (result.error) {
          this.errorMessage.set(result.error);
        }
      } while (this.softReloadQueued);
    } finally {
      this.softReloadInFlight = false;
    }
  }

  private async loadDeliveredAnalytics(filters: AdminOrderFilters): Promise<void> {
    const generation = ++this.analyticsGeneration;
    this.analyticsLoading.set(true);

    const { data, error } = await this.adminService.getDeliveredAnalytics({
      dateFrom: filters.deliveredDateFrom,
      dateTo: filters.deliveredDateTo,
      city: filters.city,
      courierId: filters.courierId,
      paymentMethod: filters.paymentMethod,
    });

    if (generation !== this.analyticsGeneration) {
      return;
    }

    this.analytics.set(data);
    this.analyticsLoading.set(false);
    if (error && !this.errorMessage()) {
      this.errorMessage.set(error);
    }
  }

  private async resetPageAndLoad(): Promise<void> {
    this.page.set(1);
    await this.loadOrders();
  }

  private resolveDeliveryDate(formDate: string): string | null {
    const preset = this.datePreset();
    if (preset === 'all') return null;
    if (preset === 'today') return toDateInputValue(new Date());
    if (preset === 'tomorrow') return minDeliveryDateIso();
    return formDate.trim() || null;
  }

  private buildPageNumbers(current: number, total: number): number[] {
    if (total <= 1) return [1];
    const windowSize = 5;
    let start = Math.max(1, current - Math.floor(windowSize / 2));
    let end = Math.min(total, start + windowSize - 1);
    start = Math.max(1, end - windowSize + 1);

    const pages: number[] = [];
    for (let p = start; p <= end; p += 1) {
      pages.push(p);
    }
    return pages;
  }
}
