import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '../../../core/pipes/t.pipe';
import { GEORGIAN_CITIES, isDeliveryDateAllowed, minDeliveryDateIso } from '../../../core/constants/cities';
import { AuthService } from '../../../core/services/auth.service';
import { OrdersService } from '../../../core/services/orders.service';
import { ProfileService } from '../../../core/services/profile.service';
import { DeliveryHeader } from '../../../layout/delivery-header/delivery-header';
import { centsToNumber, toCents } from '../../../core/utils/order-status.util';
import { DeliveryPriceCalculator } from '../../delivery-price-calculator/delivery-price-calculator';

type CreateOrderField =
  | 'sender_name'
  | 'sender_phone'
  | 'pickup_city'
  | 'pickup_district'
  | 'pickup_address'
  | 'recipient_name'
  | 'recipient_phone'
  | 'delivery_city'
  | 'delivery_district'
  | 'delivery_address'
  | 'parcel_count'
  | 'delivery_date'
  | 'amount_to_collect';

/** Visual / focus order for first-invalid scroll. */
const FIELD_ORDER: readonly CreateOrderField[] = [
  'sender_name',
  'sender_phone',
  'pickup_city',
  'pickup_district',
  'pickup_address',
  'recipient_name',
  'recipient_phone',
  'delivery_city',
  'delivery_district',
  'delivery_address',
  'parcel_count',
  'delivery_date',
  'amount_to_collect',
] as const;

function requiredTrimmed(control: AbstractControl): ValidationErrors | null {
  const value = control.value;
  if (value === null || value === undefined) {
    return { required: true };
  }
  if (typeof value === 'string' && value.trim() === '') {
    return { required: true };
  }
  return null;
}

function futureDeliveryDateValidator(control: AbstractControl): ValidationErrors | null {
  const value = String(control.value ?? '').trim();
  if (!value) {
    return null;
  }
  return isDeliveryDateAllowed(value) ? null : { deliveryDateTooSoon: true };
}

/** Empty handled by requiredTrimmed; numeric 0 is valid; negatives fail. */
function amountNonNegativeValidator(control: AbstractControl): ValidationErrors | null {
  const raw = control.value;
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return null;
  }
  const normalized = String(raw).replace(/[^\d,.\-]/g, '').replace(',', '.').trim();
  if (normalized === '' || normalized === '-' || normalized === '.') {
    return { amountInvalid: true };
  }
  const amount = centsToNumber(toCents(raw));
  if (!Number.isFinite(amount) || amount < 0) {
    return { amountInvalid: true };
  }
  return null;
}

/** Digits-only length check aligned with app-wide min 6 digits; trims whitespace. */
function phoneValidator(control: AbstractControl): ValidationErrors | null {
  const raw = String(control.value ?? '').trim();
  if (!raw) {
    return null;
  }
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 6) {
    return { phoneInvalid: true };
  }
  return null;
}

function integerMinOneValidator(control: AbstractControl): ValidationErrors | null {
  const raw = control.value;
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    return { parcelMin: true };
  }
  return null;
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
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly cities = GEORGIAN_CITIES;
  readonly minDeliveryDate = minDeliveryDateIso();
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    sender_name: ['', requiredTrimmed],
    sender_phone: ['', [requiredTrimmed, phoneValidator]],
    pickup_city: ['', Validators.required],
    pickup_district: ['', requiredTrimmed],
    pickup_address: ['', requiredTrimmed],
    recipient_name: ['', requiredTrimmed],
    recipient_phone: ['', [requiredTrimmed, phoneValidator]],
    delivery_city: ['', Validators.required],
    delivery_district: ['', requiredTrimmed],
    delivery_address: ['', requiredTrimmed],
    parcel_count: [1, [Validators.required, integerMinOneValidator]],
    delivery_date: ['', [Validators.required, futureDeliveryDateValidator]],
    amount_to_collect: ['', [requiredTrimmed, amountNonNegativeValidator]],
    notes: [''],
    is_fragile: [false],
    remember_sender: [true],
  });

  async ngOnInit(): Promise<void> {
    const profile = (await this.profileService.getCurrentProfile()) ?? this.auth.profile();
    if (profile) {
      this.form.patchValue({
        sender_name: profile.full_name ?? '',
        sender_phone: profile.phone ?? '',
        pickup_city: profile.default_city ?? '',
        pickup_district: profile.default_district ?? '',
        pickup_address: profile.default_address ?? '',
      });
    }

    this.applyCalculatorPrefill();
  }

  isFieldInvalid(field: CreateOrderField): boolean {
    const control = this.form.controls[field];
    return control.invalid && (control.touched || control.dirty);
  }

  fieldErrorId(field: CreateOrderField): string {
    return `create-order-${field}-error`;
  }

  getFieldError(field: CreateOrderField): string | null {
    const control = this.form.controls[field];
    if (!control.invalid || !(control.touched || control.dirty)) {
      return null;
    }

    if (field === 'sender_phone' || field === 'recipient_phone') {
      if (control.hasError('required')) {
        return field === 'sender_phone'
          ? 'გთხოვთ მიუთითოთ გამგზავნის ტელეფონი'
          : 'გთხოვთ მიუთითოთ მიმღების ტელეფონი';
      }
      if (control.hasError('phoneInvalid') || control.hasError('minlength')) {
        return 'მიუთითეთ სწორი ტელეფონის ნომერი';
      }
    }

    if (field === 'parcel_count') {
      if (control.hasError('required')) {
        return 'გთხოვთ მიუთითოთ გადასაცემი ერთეულების რაოდენობა';
      }
      if (control.hasError('parcelMin') || control.hasError('min')) {
        return 'რაოდენობა უნდა იყოს მინიმუმ 1';
      }
    }

    if (field === 'delivery_date') {
      if (control.hasError('required')) {
        return 'გთხოვთ აირჩიოთ მიწოდების თარიღი';
      }
      if (control.hasError('deliveryDateTooSoon')) {
        return 'აირჩიეთ დაშვებული მიწოდების თარიღი';
      }
    }

    if (field === 'amount_to_collect') {
      if (control.hasError('required')) {
        return 'გთხოვთ მიუთითოთ თანხა';
      }
      if (control.hasError('amountInvalid')) {
        return 'თანხა არ შეიძლება იყოს 0 ₾-ზე ნაკლები';
      }
    }

    if (control.hasError('required')) {
      const requiredMessages: Record<CreateOrderField, string> = {
        sender_name: 'გთხოვთ მიუთითოთ გამგზავნის სახელი',
        sender_phone: 'გთხოვთ მიუთითოთ გამგზავნის ტელეფონი',
        pickup_city: 'გთხოვთ აირჩიოთ აღების ქალაქი',
        pickup_district: 'გთხოვთ მიუთითოთ აღების უბანი',
        pickup_address: 'გთხოვთ მიუთითოთ აღების მისამართი',
        recipient_name: 'გთხოვთ მიუთითოთ მიმღების სახელი',
        recipient_phone: 'გთხოვთ მიუთითოთ მიმღების ტელეფონი',
        delivery_city: 'გთხოვთ აირჩიოთ მიწოდების ქალაქი',
        delivery_district: 'გთხოვთ მიუთითოთ მიწოდების უბანი',
        delivery_address: 'გთხოვთ მიუთითოთ მიწოდების მისამართი',
        parcel_count: 'გთხოვთ მიუთითოთ გადასაცემი ერთეულების რაოდენობა',
        delivery_date: 'გთხოვთ აირჩიოთ მიწოდების თარიღი',
        amount_to_collect: 'გთხოვთ მიუთითოთ თანხა',
      };
      return requiredMessages[field];
    }

    return 'გთხოვთ შეავსოთ ეს ველი სწორად';
  }

  async onSubmit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.errorMessage.set(null);
      this.scrollToFirstInvalidField();
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);

    const value = this.form.getRawValue();
    const amount = centsToNumber(toCents(value.amount_to_collect));

    const { error } = await this.ordersService.createOrder({
      sender_name: value.sender_name.trim(),
      sender_phone: value.sender_phone.trim(),
      pickup_city: value.pickup_city,
      pickup_district: value.pickup_district.trim(),
      pickup_address: value.pickup_address.trim(),
      recipient_name: value.recipient_name.trim(),
      recipient_phone: value.recipient_phone.trim(),
      delivery_city: value.delivery_city,
      delivery_district: value.delivery_district.trim(),
      delivery_address: value.delivery_address.trim(),
      parcel_count: value.parcel_count,
      delivery_date: value.delivery_date,
      amount_to_collect: amount,
      is_fragile: value.is_fragile,
      notes: value.notes || null,
    });

    if (error) {
      this.loading.set(false);
      this.errorMessage.set(error);
      return;
    }

    if (value.remember_sender) {
      await this.profileService.saveSenderDefaults({
        full_name: value.sender_name.trim(),
        phone: value.sender_phone.trim(),
        default_city: value.pickup_city,
        default_district: value.pickup_district.trim(),
        default_address: value.pickup_address.trim(),
      });
    }

    DeliveryPriceCalculator.clearDraft();
    this.loading.set(false);
    await this.router.navigateByUrl('/my-orders');
  }

  private scrollToFirstInvalidField(): void {
    const first = FIELD_ORDER.find((field) => this.form.controls[field].invalid);
    if (!first) {
      return;
    }

    // Wait for aria-invalid / error nodes to paint after markAllAsTouched.
    requestAnimationFrame(() => {
      const root = this.host.nativeElement;
      const control = root.querySelector(`[data-field="${first}"]`) as HTMLElement | null;
      const input = control?.querySelector('input, select, textarea') as HTMLElement | null;
      const target = input ?? control;
      if (!target) {
        return;
      }
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      input?.focus({ preventScroll: true });
    });
  }

  private applyCalculatorPrefill(): void {
    const params = this.route.snapshot.queryParamMap;
    const draft = DeliveryPriceCalculator.readDraft();

    const pickup =
      this.normalizeCity(params.get('pickup_city')) ??
      this.normalizeCity(draft?.pickup_city ?? null);
    const delivery =
      this.normalizeCity(params.get('delivery_city')) ??
      this.normalizeCity(draft?.delivery_city ?? null);
    const parcelRaw = params.get('parcel_count') ?? (draft ? String(draft.parcel_count) : null);
    const parcelCount = this.normalizeParcelCount(parcelRaw);

    const patch: {
      pickup_city?: string;
      delivery_city?: string;
      parcel_count?: number;
    } = {};

    if (pickup) {
      patch.pickup_city = pickup;
    }
    if (delivery) {
      patch.delivery_city = delivery;
    }
    if (parcelCount !== null) {
      patch.parcel_count = parcelCount;
    }

    if (Object.keys(patch).length > 0) {
      this.form.patchValue(patch);
    }

    if (pickup || delivery || parcelCount !== null) {
      DeliveryPriceCalculator.clearDraft();
    }
  }

  private normalizeCity(value: string | null): string | null {
    if (!value) {
      return null;
    }
    return (GEORGIAN_CITIES as readonly string[]).includes(value) ? value : null;
  }

  private normalizeParcelCount(value: string | null): number | null {
    if (!value) {
      return null;
    }
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n < 1) {
      return null;
    }
    return n;
  }
}
