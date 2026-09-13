import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Order } from '../../../core/models/order.model';
import { CourierService } from '../../../core/services/courier.service';
import {
  courierStatusLabel,
  formatGel,
  historyCompletedAt,
  orderStatusClass,
  paymentMethodLabel,
} from '../../../core/utils/order-status.util';

@Component({
  selector: 'app-courier-history',
  imports: [DatePipe],
  templateUrl: './courier-history.html',
  styleUrl: './courier-history.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CourierHistory implements OnInit {
  private readonly courierService = inject(CourierService);

  readonly orders = signal<Order[]>([]);
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);

  readonly statusClass = orderStatusClass;
  readonly statusLabel = courierStatusLabel;
  readonly formatGel = formatGel;
  readonly paymentLabel = paymentMethodLabel;
  readonly completedAt = historyCompletedAt;

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);

    const { data, error } = await this.courierService.getMyHistoryOrders();
    this.orders.set(data);
    this.errorMessage.set(error);
    this.loading.set(false);
  }
}
