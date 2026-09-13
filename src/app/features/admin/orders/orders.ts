import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '../../../core/pipes/t.pipe';
import { ORDER_STATUSES, Order, OrderStatus } from '../../../core/models/order.model';
import { CourierOption } from '../../../core/models/profile.model';
import { AdminService } from '../../../core/services/admin.service';
import { orderStatusClass, orderStatusLabelKey } from '../../../core/utils/order-status.util';
import { DeliveryHeader } from '../../../layout/delivery-header/delivery-header';

@Component({
  selector: 'app-admin-orders',
  imports: [DeliveryHeader, TranslatePipe, ReactiveFormsModule, FormsModule, DatePipe],
  templateUrl: './orders.html',
  styleUrl: './orders.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminOrders implements OnInit {
  private readonly adminService = inject(AdminService);
  private readonly fb = inject(FormBuilder);

  readonly orders = signal<Order[]>([]);
  readonly couriers = signal<CourierOption[]>([]);
  readonly selectedOrder = signal<Order | null>(null);
  readonly selectedIds = signal<Set<number>>(new Set());
  readonly bulkCourierId = signal<string | null>(null);
  readonly loading = signal(true);
  readonly updating = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly statuses = ORDER_STATUSES;

  readonly statusClass = orderStatusClass;
  readonly statusLabelKey = orderStatusLabelKey;

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

  courierName(courierId: string | null): string {
    if (!courierId) {
      return '—';
    }
    return this.couriers().find((c) => c.id === courierId)?.full_name ?? '—';
  }

  isSelected(orderId: number): boolean {
    return this.selectedIds().has(orderId);
  }

  toggleOrder(orderId: number, checked: boolean): void {
    this.selectedIds.update((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(orderId);
      } else {
        next.delete(orderId);
      }
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
    if (!ORDER_STATUSES.includes(status) || status === order.status) {
      return;
    }

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
