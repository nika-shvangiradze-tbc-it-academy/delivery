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
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../../core/pipes/t.pipe';
import { Order } from '../../../core/models/order.model';
import { OrderRealtimeService } from '../../../core/services/order-realtime.service';
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
  private readonly orderRealtime = inject(OrderRealtimeService);
  private readonly destroyRef = inject(DestroyRef);

  readonly orders = signal<Order[]>([]);
  readonly expandedId = signal<number | null>(null);
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);

  readonly statusClass = orderStatusClass;
  readonly statusLabelKey = orderStatusLabelKey;
  readonly formatGel = formatGel;

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

  toggleDetails(orderId: number): void {
    this.expandedId.update((current) => (current === orderId ? null : orderId));
  }

  private async onRealtimeChange(change: {
    eventType: 'INSERT' | 'UPDATE' | 'DELETE';
    orderId: number | null;
  }): Promise<void> {
    if (change.eventType === 'DELETE' && change.orderId != null) {
      const deletedId = change.orderId;
      this.orders.update((list) => list.filter((item) => item.id !== deletedId));
      this.expandedId.update((current) => (current === deletedId ? null : current));
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
    const { data, error } = await this.ordersService.getMyOrders();
    this.orders.set(data);
    this.errorMessage.set(error);

    const expanded = this.expandedId();
    if (expanded !== null && !data.some((o) => o.id === expanded)) {
      this.expandedId.set(null);
    }
  }
}
