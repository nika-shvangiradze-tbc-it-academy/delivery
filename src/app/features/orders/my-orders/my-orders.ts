import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
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
import { Order, OrderStatus } from '../../../core/models/order.model';
import { OrderRealtimeService } from '../../../core/services/order-realtime.service';
import { OrdersService } from '../../../core/services/orders.service';
import {
  centsToNumber,
  formatGel,
  orderStatusClass,
  orderStatusLabelKey,
  toCents,
} from '../../../core/utils/order-status.util';
import { DeliveryHeader } from '../../../layout/delivery-header/delivery-header';

export type MyOrdersStatusFilter = OrderStatus;

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

  readonly orders = signal<Order[]>([]);
  readonly statusFilter = signal<MyOrdersStatusFilter>('pending');
  readonly expandedId = signal<number | null>(null);
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly editingOrder = signal<Order | null>(null);
  readonly saving = signal(false);
  readonly editError = signal<string | null>(null);

  readonly cities = GEORGIAN_CITIES;
  readonly minDeliveryDate = minDeliveryDateIso();
  readonly statusClass = orderStatusClass;
  readonly statusLabelKey = orderStatusLabelKey;
  readonly formatGel = formatGel;

  readonly statusFilters: ReadonlyArray<{ id: MyOrdersStatusFilter; label: string }> = [
    { id: 'pending', label: 'მოლოდინში' },
    { id: 'picked_up', label: 'აღებული' },
    { id: 'delivered', label: 'ჩაბარებული' },
    { id: 'cancelled', label: 'გაუქმებული' },
  ];

  readonly emptyByStatus: Record<MyOrdersStatusFilter, string> = {
    pending: 'მოლოდინში შეკვეთები არ არის.',
    picked_up: 'აღებული შეკვეთები არ არის.',
    delivered: 'ჩაბარებული შეკვეთები არ არის.',
    cancelled: 'გაუქმებული შეკვეთები არ არის.',
  };

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

  constructor() {
    this.orderRealtime.userChanges$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((change) => {
        void this.onRealtimeChange(change);
      });
  }

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    await this.fetchOrders();
    this.loading.set(false);
  }

  async selectStatusFilter(status: MyOrdersStatusFilter): Promise<void> {
    if (this.statusFilter() === status) {
      return;
    }
    this.statusFilter.set(status);
    this.expandedId.set(null);
    this.loading.set(true);
    await this.fetchOrders();
    this.loading.set(false);
  }

  emptyMessage(): string {
    return this.emptyByStatus[this.statusFilter()];
  }

  toggleDetails(orderId: number): void {
    this.expandedId.update((current) => (current === orderId ? null : orderId));
  }

  canEdit(order: Order): boolean {
    return order.status === 'pending';
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
      return 'ამანათების რაოდენობა უნდა იყოს 1 ან მეტი.';
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
      this.expandedId.update((current) => (current === deletedId ? null : current));
      if (this.editingOrder()?.id === deletedId) {
        this.closeEdit();
      }
      return;
    }

    // Owner-scoped soft reload (RLS already limits to this user's orders).
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
        await this.fetchOrders();
      } while (this.softReloadQueued);
    } finally {
      this.softReloadInFlight = false;
    }
  }

  private async fetchOrders(): Promise<void> {
    const { data, error } = await this.ordersService.getMyOrders(this.statusFilter());
    this.orders.set(data);
    this.errorMessage.set(error);

    const expanded = this.expandedId();
    if (expanded !== null && !data.some((o) => o.id === expanded)) {
      this.expandedId.set(null);
    }

    const editing = this.editingOrder();
    if (editing) {
      const latest = data.find((o) => o.id === editing.id);
      if (!latest || latest.status !== 'pending') {
        this.closeEdit();
      } else {
        this.editingOrder.set(latest);
      }
    }
  }
}
