import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '../../../core/pipes/t.pipe';
import { ORDER_STATUSES, Order, OrderStatus } from '../../../core/models/order.model';
import { AdminService } from '../../../core/services/admin.service';
import { orderStatusClass, orderStatusLabelKey } from '../../../core/utils/order-status.util';
import { DeliveryHeader } from '../../../layout/delivery-header/delivery-header';

@Component({
  selector: 'app-admin-orders',
  imports: [DeliveryHeader, TranslatePipe, ReactiveFormsModule, DatePipe],
  templateUrl: './orders.html',
  styleUrl: './orders.scss',
})
export class AdminOrders implements OnInit {
  private readonly adminService = inject(AdminService);
  private readonly fb = inject(FormBuilder);

  readonly orders = signal<Order[]>([]);
  readonly selectedOrder = signal<Order | null>(null);
  readonly loading = signal(true);
  readonly updating = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly statuses = ORDER_STATUSES;

  readonly statusClass = orderStatusClass;
  readonly statusLabelKey = orderStatusLabelKey;

  readonly filtersForm = this.fb.nonNullable.group({
    search: [''],
    status: ['' as OrderStatus | ''],
    pickupCity: [''],
    deliveryCity: [''],
    deliveryDate: [''],
  });

  async ngOnInit(): Promise<void> {
    await this.loadOrders();
  }

  async loadOrders(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);

    const filters = this.filtersForm.getRawValue();
    const { data, error } = await this.adminService.getAllOrders(filters);
    this.orders.set(data);
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

  async onStatusChange(orderId: number, event: Event): Promise<void> {
    const select = event.target as HTMLSelectElement | null;
    const status = select?.value as OrderStatus | undefined;
    if (!status || !ORDER_STATUSES.includes(status)) {
      return;
    }

    this.updating.set(true);
    const { data, error } = await this.adminService.updateOrderStatus(orderId, status);
    this.updating.set(false);

    if (error || !data) {
      this.errorMessage.set(error ?? 'Failed to update status');
      await this.loadOrders();
      return;
    }

    this.orders.update((list) => list.map((order) => (order.id === orderId ? data : order)));
    if (this.selectedOrder()?.id === orderId) {
      this.selectedOrder.set(data);
    }
  }
}
