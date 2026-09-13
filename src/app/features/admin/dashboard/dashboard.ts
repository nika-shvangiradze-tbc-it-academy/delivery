import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../../core/pipes/t.pipe';
import { AdminDashboardStats, Order } from '../../../core/models/order.model';
import { AdminService } from '../../../core/services/admin.service';
import { orderStatusClass, orderStatusLabelKey } from '../../../core/utils/order-status.util';
import { DeliveryHeader } from '../../../layout/delivery-header/delivery-header';

@Component({
  selector: 'app-admin-dashboard',
  imports: [DeliveryHeader, TranslatePipe, RouterLink, DatePipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class AdminDashboard implements OnInit {
  private readonly adminService = inject(AdminService);

  readonly stats = signal<AdminDashboardStats>({
    totalUsers: 0,
    totalOrders: 0,
    pendingOrders: 0,
    acceptedOrders: 0,
    pickedUpOrders: 0,
    inTransitOrders: 0,
    deliveredOrders: 0,
    cancelledOrders: 0,
  });
  readonly recentOrders = signal<Order[]>([]);
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);

  readonly statusClass = orderStatusClass;
  readonly statusLabelKey = orderStatusLabelKey;

  async ngOnInit(): Promise<void> {
    this.loading.set(true);

    const [statsResult, recentResult] = await Promise.all([
      this.adminService.getDashboardStats(),
      this.adminService.getRecentOrders(8),
    ]);

    this.stats.set(statsResult.data);
    this.recentOrders.set(recentResult.data);
    this.errorMessage.set(statsResult.error ?? recentResult.error);
    this.loading.set(false);
  }
}
