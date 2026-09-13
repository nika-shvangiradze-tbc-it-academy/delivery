import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { TranslatePipe } from '../../core/pipes/t.pipe';
import { Order } from '../../core/models/order.model';
import { Profile } from '../../core/models/profile.model';
import { AuthService } from '../../core/services/auth.service';
import { OrdersService } from '../../core/services/orders.service';
import { ProfileService } from '../../core/services/profile.service';
import { orderStatusClass, orderStatusLabelKey } from '../../core/utils/order-status.util';
import { DeliveryHeader } from '../../layout/delivery-header/delivery-header';

@Component({
  selector: 'app-profile',
  imports: [DeliveryHeader, TranslatePipe, RouterLink, DatePipe],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class ProfilePage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly profileService = inject(ProfileService);
  private readonly ordersService = inject(OrdersService);

  readonly profile = signal<Profile | null>(null);
  readonly recentOrders = signal<Order[]>([]);
  readonly stats = signal({ total: 0, active: 0, completed: 0 });
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);

  readonly statusClass = orderStatusClass;
  readonly statusLabelKey = orderStatusLabelKey;

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);

    const [profile, statsResult, ordersResult] = await Promise.all([
      this.profileService.getCurrentProfile(),
      this.ordersService.getMyOrderStats(),
      this.ordersService.getMyRecentOrders(5),
    ]);

    this.profile.set(profile ?? this.auth.profile());

    if (statsResult.error || ordersResult.error) {
      this.errorMessage.set(statsResult.error ?? ordersResult.error);
    } else {
      this.stats.set(statsResult.data);
      this.recentOrders.set(ordersResult.data);
    }

    this.loading.set(false);
  }
}
