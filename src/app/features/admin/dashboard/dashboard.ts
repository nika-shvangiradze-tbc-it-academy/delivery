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
import { AdminDashboardStats, Order } from '../../../core/models/order.model';
import { AdminService } from '../../../core/services/admin.service';
import { OrderRealtimeService } from '../../../core/services/order-realtime.service';
import { orderStatusClass, orderStatusLabelKey } from '../../../core/utils/order-status.util';
import { DeliveryHeader } from '../../../layout/delivery-header/delivery-header';

@Component({
  selector: 'app-admin-dashboard',
  imports: [DeliveryHeader, TranslatePipe, RouterLink, DatePipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminDashboard implements OnInit {
  private readonly adminService = inject(AdminService);
  private readonly orderRealtime = inject(OrderRealtimeService);
  private readonly destroyRef = inject(DestroyRef);

  readonly stats = signal<AdminDashboardStats>({
    totalUsers: 0,
    totalOrders: 0,
    pendingOrders: 0,
    officeOrders: 0,
    pickedUpOrders: 0,
    deliveredOrders: 0,
    cancelledOrders: 0,
  });
  readonly recentOrders = signal<Order[]>([]);
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);

  readonly statusClass = orderStatusClass;
  readonly statusLabelKey = orderStatusLabelKey;

  private softReloadInFlight = false;
  private softReloadQueued = false;

  constructor() {
    this.orderRealtime.adminChanges$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        void this.softReload();
      });
  }

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    await this.fetchDashboard();
    this.loading.set(false);
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
        await this.fetchDashboard();
      } while (this.softReloadQueued);
    } finally {
      this.softReloadInFlight = false;
    }
  }

  private async fetchDashboard(): Promise<void> {
    const [statsResult, recentResult] = await Promise.all([
      this.adminService.getDashboardStats(),
      this.adminService.getRecentOrders(8),
    ]);

    this.stats.set(statsResult.data);
    this.recentOrders.set(recentResult.data);
    const nextError = statsResult.error ?? recentResult.error;
    if (nextError) {
      this.errorMessage.set(nextError);
    }
  }
}
