import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../../core/pipes/t.pipe';
import { Order } from '../../../core/models/order.model';
import { OrdersService } from '../../../core/services/orders.service';
import {
  formatGel,
  orderStatusClass,
  orderStatusLabelKey,
} from '../../../core/utils/order-status.util';
import { DeliveryHeader } from '../../../layout/delivery-header/delivery-header';

@Component({
  selector: 'app-my-orders',
  imports: [DeliveryHeader, TranslatePipe, DatePipe, RouterLink],
  templateUrl: './my-orders.html',
  styleUrl: './my-orders.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyOrders implements OnInit {
  private readonly ordersService = inject(OrdersService);

  readonly orders = signal<Order[]>([]);
  readonly expandedId = signal<number | null>(null);
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);

  readonly statusClass = orderStatusClass;
  readonly statusLabelKey = orderStatusLabelKey;
  readonly formatGel = formatGel;

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    const { data, error } = await this.ordersService.getMyOrders();
    this.orders.set(data);
    this.errorMessage.set(error);
    this.loading.set(false);
  }

  toggleDetails(orderId: number): void {
    this.expandedId.update((current) => (current === orderId ? null : orderId));
  }
}
