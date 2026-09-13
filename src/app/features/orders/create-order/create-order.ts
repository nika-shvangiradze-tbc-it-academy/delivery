import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe } from '../../../core/pipes/t.pipe';
import { GEORGIAN_CITIES, isDeliveryDateAllowed, minDeliveryDateIso } from '../../../core/constants/cities';
import { AuthService } from '../../../core/services/auth.service';
import { OrdersService } from '../../../core/services/orders.service';
import { ProfileService } from '../../../core/services/profile.service';
import { DeliveryHeader } from '../../../layout/delivery-header/delivery-header';
import { centsToNumber, toCents } from '../../../core/utils/order-status.util';

function futureDeliveryDateValidator(control: AbstractControl): ValidationErrors | null {
  const value = String(control.value ?? '');
  if (!value) {
    return null;
  }
  return isDeliveryDateAllowed(value) ? null : { deliveryDateTooSoon: true };
}

function amountPositiveValidator(control: AbstractControl): ValidationErrors | null {
  const amount = centsToNumber(toCents(control.value));
  return amount > 0 ? null : { amountInvalid: true };
}

@Component({
  selector: 'app-create-order',
  imports: [DeliveryHeader, ReactiveFormsModule, TranslatePipe],
  templateUrl: './create-order.html',
  styleUrl: './create-order.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateOrder implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly ordersService = inject(OrdersService);
  private readonly profileService = inject(ProfileService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly cities = GEORGIAN_CITIES;
  readonly minDeliveryDate = minDeliveryDateIso();
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    sender_name: ['', Validators.required],
    sender_phone: ['', [Validators.required, Validators.minLength(6)]],
    pickup_city: ['', Validators.required],
    pickup_district: ['', Validators.required],
    pickup_address: ['', Validators.required],
    recipient_name: ['', Validators.required],
    recipient_phone: ['', [Validators.required, Validators.minLength(6)]],
    delivery_city: ['', Validators.required],
    delivery_district: ['', Validators.required],
    delivery_address: ['', Validators.required],
    parcel_count: [1, [Validators.required, Validators.min(1)]],
    delivery_date: ['', [Validators.required, futureDeliveryDateValidator]],
    amount_to_collect: ['', [Validators.required, amountPositiveValidator]],
    notes: [''],
    remember_sender: [true],
  });

  async ngOnInit(): Promise<void> {
    const profile = (await this.profileService.getCurrentProfile()) ?? this.auth.profile();
    if (!profile) {
      return;
    }

    this.form.patchValue({
      sender_name: profile.full_name ?? '',
      sender_phone: profile.phone ?? '',
      pickup_city: profile.default_city ?? '',
      pickup_district: profile.default_district ?? '',
      pickup_address: profile.default_address ?? '',
    });
  }

  async onSubmit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.errorMessage.set(this.firstValidationMessage());
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);

    const value = this.form.getRawValue();
    const amount = centsToNumber(toCents(value.amount_to_collect));

    const { error } = await this.ordersService.createOrder({
      sender_name: value.sender_name,
      sender_phone: value.sender_phone,
      pickup_city: value.pickup_city,
      pickup_district: value.pickup_district,
      pickup_address: value.pickup_address,
      recipient_name: value.recipient_name,
      recipient_phone: value.recipient_phone,
      delivery_city: value.delivery_city,
      delivery_district: value.delivery_district,
      delivery_address: value.delivery_address,
      parcel_count: value.parcel_count,
      delivery_date: value.delivery_date,
      amount_to_collect: amount,
      notes: value.notes || null,
    });

    if (error) {
      this.loading.set(false);
      this.errorMessage.set(error);
      return;
    }

    if (value.remember_sender) {
      await this.profileService.saveSenderDefaults({
        full_name: value.sender_name,
        phone: value.sender_phone,
        default_city: value.pickup_city,
        default_district: value.pickup_district,
        default_address: value.pickup_address,
      });
    }

    this.loading.set(false);
    await this.router.navigateByUrl('/my-orders');
  }

  private firstValidationMessage(): string {
    const c = this.form.controls;
    if (c.delivery_date.hasError('deliveryDateTooSoon')) {
      return 'მიწოდების თარიღი უნდა იყოს ხვალ ან უფრო გვიან.';
    }
    if (c.amount_to_collect.hasError('amountInvalid')) {
      return 'ასაღები თანხა უნდა იყოს 0-ზე მეტი.';
    }
    return 'გთხოვთ შეავსოთ ყველა სავალდებულო ველი.';
  }
}
