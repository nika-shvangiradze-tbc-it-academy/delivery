import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe } from '../../../core/pipes/t.pipe';
import { AuthService } from '../../../core/services/auth.service';
import { OrdersService } from '../../../core/services/orders.service';
import { ProfileService } from '../../../core/services/profile.service';
import { DeliveryHeader } from '../../../layout/delivery-header/delivery-header';

@Component({
  selector: 'app-create-order',
  imports: [DeliveryHeader, ReactiveFormsModule, TranslatePipe],
  templateUrl: './create-order.html',
  styleUrl: './create-order.scss',
})
export class CreateOrder implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly ordersService = inject(OrdersService);
  private readonly profileService = inject(ProfileService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    sender_name: ['', Validators.required],
    sender_phone: ['', Validators.required],
    pickup_city: ['', Validators.required],
    pickup_district: ['', Validators.required],
    pickup_address: ['', Validators.required],
    recipient_name: ['', Validators.required],
    recipient_phone: ['', Validators.required],
    delivery_city: ['', Validators.required],
    delivery_district: ['', Validators.required],
    delivery_address: ['', Validators.required],
    parcel_count: [1, [Validators.required, Validators.min(1)]],
    delivery_date: ['', Validators.required],
    notes: [''],
  });

  async ngOnInit(): Promise<void> {
    const profile = (await this.profileService.getCurrentProfile()) ?? this.auth.profile();
    if (!profile) {
      return;
    }

    this.form.patchValue({
      sender_name: profile.full_name ?? '',
      sender_phone: profile.phone ?? '',
    });
  }

  async onSubmit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    const value = this.form.getRawValue();
    const { error } = await this.ordersService.createOrder({
      ...value,
      notes: value.notes || null,
    });

    this.loading.set(false);

    if (error) {
      this.errorMessage.set(error);
      return;
    }

    this.successMessage.set('orders.createSuccess');
    this.form.reset({
      parcel_count: 1,
      notes: '',
      sender_name: value.sender_name,
      sender_phone: value.sender_phone,
    });
    await this.router.navigateByUrl('/my-orders');
  }
}
