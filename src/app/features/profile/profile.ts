import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '../../core/pipes/t.pipe';
import { Order } from '../../core/models/order.model';
import { Profile } from '../../core/models/profile.model';
import { AuthService } from '../../core/services/auth.service';
import { OrdersService } from '../../core/services/orders.service';
import { ProfileService } from '../../core/services/profile.service';
import { orderStatusClass, orderStatusLabelKey } from '../../core/utils/order-status.util';
import { GEORGIAN_CITIES } from '../../core/constants/cities';
import { DeliveryHeader } from '../../layout/delivery-header/delivery-header';

@Component({
  selector: 'app-profile',
  imports: [DeliveryHeader, TranslatePipe, RouterLink, DatePipe, ReactiveFormsModule],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfilePage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly profileService = inject(ProfileService);
  private readonly ordersService = inject(OrdersService);
  private readonly fb = inject(FormBuilder);

  readonly cities = GEORGIAN_CITIES;
  readonly profile = signal<Profile | null>(null);
  readonly recentOrders = signal<Order[]>([]);
  readonly stats = signal({ total: 0, active: 0, completed: 0 });
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  readonly statusClass = orderStatusClass;
  readonly statusLabelKey = orderStatusLabelKey;

  readonly defaultsForm = this.fb.nonNullable.group({
    full_name: ['', Validators.required],
    phone: ['', [Validators.required, Validators.minLength(6)]],
    default_city: [''],
    default_district: [''],
    default_address: [''],
  });

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);

    const [profile, statsResult, ordersResult] = await Promise.all([
      this.profileService.getCurrentProfile(),
      this.ordersService.getMyOrderStats(),
      this.ordersService.getMyRecentOrders(5),
    ]);

    const current = profile ?? this.auth.profile();
    this.profile.set(current);

    if (current) {
      this.defaultsForm.patchValue({
        full_name: current.full_name ?? '',
        phone: current.phone ?? '',
        default_city: current.default_city ?? '',
        default_district: current.default_district ?? '',
        default_address: current.default_address ?? '',
      });
    }

    if (statsResult.error || ordersResult.error) {
      this.errorMessage.set(statsResult.error ?? ordersResult.error);
    } else {
      this.stats.set(statsResult.data);
      this.recentOrders.set(ordersResult.data);
    }

    this.loading.set(false);
  }

  async saveDefaults(): Promise<void> {
    if (this.defaultsForm.invalid) {
      this.defaultsForm.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    const value = this.defaultsForm.getRawValue();
    const { data, error } = await this.profileService.updateCurrentProfile({
      full_name: value.full_name,
      phone: value.phone,
      default_city: value.default_city || null,
      default_district: value.default_district || null,
      default_address: value.default_address || null,
    });

    this.saving.set(false);

    if (error || !data) {
      this.errorMessage.set(error ?? 'შენახვა ვერ მოხერხდა');
      return;
    }

    this.profile.set(data);
    this.successMessage.set('მონაცემები შენახულია');
  }
}
