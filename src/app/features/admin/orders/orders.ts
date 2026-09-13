import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import {
  AbstractControl,
  FormBuilder,
  FormsModule,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { TranslatePipe } from '../../../core/pipes/t.pipe';
import { ORDER_STATUSES, Order, OrderStatus } from '../../../core/models/order.model';
import { CourierOption } from '../../../core/models/profile.model';
import { AdminService } from '../../../core/services/admin.service';
import { OrdersService } from '../../../core/services/orders.service';
import {
  formatGel,
  orderStatusClass,
  orderStatusLabelKey,
  paymentMethodLabel,
  centsToNumber,
  toCents,
} from '../../../core/utils/order-status.util';
import {
  GEORGIAN_CITIES,
  isDeliveryDateAllowed,
  minDeliveryDateIso,
} from '../../../core/constants/cities';
import { DeliveryHeader } from '../../../layout/delivery-header/delivery-header';

function amountPositiveValidator(control: AbstractControl): ValidationErrors | null {
  const amount = centsToNumber(toCents(control.value));
  return amount > 0 ? null : { amountInvalid: true };
}

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
  private readonly fb = inject(FormBuilder);

  readonly cities = GEORGIAN_CITIES;
  readonly minDeliveryDate = minDeliveryDateIso();
  readonly orders = signal<Order[]>([]);
  readonly couriers = signal<CourierOption[]>([]);
  readonly selectedOrder = signal<Order | null>(null);
  readonly editingOrder = signal<Order | null>(null);
  readonly selectedIds = signal<Set<number>>(new Set());
  readonly bulkCourierId = signal<string | null>(null);
  readonly loading = signal(true);
  readonly updating = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly statuses = ORDER_STATUSES;

  readonly statusClass = orderStatusClass;
  readonly statusLabelKey = orderStatusLabelKey;
  readonly formatGel = formatGel;
  readonly paymentLabel = paymentMethodLabel;

  readonly selectedCount = computed(() => this.selectedIds().size);
  readonly allSelected = computed(
    () => this.orders().length > 0 && this.selectedIds().size === this.orders().length,
  );

  readonly filtersForm = this.fb.nonNullable.group({
    search: [''],
    status: ['' as OrderStatus | ''],
    pickupCity: [''],
    deliveryCity: [''],
    deliveryDate: [''],
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
  });

  async ngOnInit(): Promise<void> {
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

  async loadOrders(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);

    const filters = this.filtersForm.getRawValue();
    const { data, error } = await this.adminService.getAllOrders(filters);
    this.orders.set(data);
    this.selectedIds.set(new Set());
    this.errorMessage.set(error);
    this.loading.set(false);
  }

  async onFilter(): Promise<void> {
    await this.loadOrders();
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
    });
  }

  closeEdit(): void {
    this.editingOrder.set(null);
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

    this.orders.update((list) => list.map((item) => (item.id === order.id ? data : item)));
    this.successMessage.set(`შეკვეთა #${order.id} განახლდა`);
    this.closeEdit();
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

    const byId = new Map(data.map((order) => [order.id, order]));
    this.orders.update((list) => list.map((order) => byId.get(order.id) ?? order));
    this.selectedIds.set(new Set());
    this.successMessage.set(`${data.length} შეკვეთა მიენიჭა კურიერს`);
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

    const byId = new Map(data.map((order) => [order.id, order]));
    this.orders.update((list) => list.map((order) => byId.get(order.id) ?? order));
    this.selectedIds.set(new Set());
    this.successMessage.set(`${data.length} შეკვეთიდან კურიერი მოიხსნა`);
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

    this.orders.update((list) => list.map((item) => (item.id === order.id ? data : item)));
  }
}
