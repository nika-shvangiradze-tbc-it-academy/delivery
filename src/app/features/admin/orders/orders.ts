import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '../../../core/pipes/t.pipe';
import { ORDER_STATUSES, Order, OrderStatus } from '../../../core/models/order.model';
import { AdminService } from '../../../core/services/admin.service';
import { orderStatusClass, orderStatusLabelKey } from '../../../core/utils/order-status.util';
import { DeliveryHeader } from '../../../layout/delivery-header/delivery-header';

@Component({
  selector: 'app-admin-orders',
  imports: [DeliveryHeader, TranslatePipe, ReactiveFormsModule, FormsModule, DatePipe],
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

  async updateOrderStatus(order: Order, status: OrderStatus): Promise<void> {
    if (!ORDER_STATUSES.includes(status) || status === order.status) {
      return;
    }

    const previousStatus = order.status;
    this.updating.set(true);
    this.errorMessage.set(null);

    // Optimistic local update for this row only
    this.orders.update((list) =>
      list.map((item) => (item.id === order.id ? { ...item, status } : item)),
    );
    if (this.selectedOrder()?.id === order.id) {
      this.selectedOrder.update((current) => (current ? { ...current, status } : current));
    }

    const { data, error } = await this.adminService.updateOrderStatus(order.id, status);
    this.updating.set(false);

    if (error || !data) {
      // Revert only this row
      this.orders.update((list) =>
        list.map((item) =>
          item.id === order.id ? { ...item, status: previousStatus } : item,
        ),
      );
      if (this.selectedOrder()?.id === order.id) {
        this.selectedOrder.update((current) =>
          current ? { ...current, status: previousStatus } : current,
        );
      }
      this.errorMessage.set(error ?? 'Failed to update status');
      return;
    }

    this.orders.update((list) =>
      list.map((item) => (item.id === order.id ? data : item)),
    );
    if (this.selectedOrder()?.id === order.id) {
      this.selectedOrder.set(data);
    }
  }
}
