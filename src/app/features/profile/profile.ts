import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '../../core/pipes/t.pipe';
import { Order } from '../../core/models/order.model';
import { Profile } from '../../core/models/profile.model';
import { AuthService } from '../../core/services/auth.service';
import { I18nService } from '../../core/services/i18n.service';
import { OrdersService } from '../../core/services/orders.service';
import { ProfileService } from '../../core/services/profile.service';
import { passwordMatchValidator } from '../../core/validators/password-match.validator';
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
  private readonly i18n = inject(I18nService);
  private readonly profileService = inject(ProfileService);
  private readonly ordersService = inject(OrdersService);
  private readonly fb = inject(FormBuilder);

  readonly cities = GEORGIAN_CITIES;
  readonly profile = signal<Profile | null>(null);
  readonly recentOrders = signal<Order[]>([]);
  readonly stats = signal({ total: 0, active: 0, completed: 0 });
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly changingPassword = signal(false);
  readonly passwordFormOpen = signal(false);
  readonly showNewPassword = signal(false);
  readonly showConfirmNewPassword = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly passwordErrorMessage = signal<string | null>(null);
  readonly passwordSuccessMessage = signal<string | null>(null);

  readonly statusClass = orderStatusClass;
  readonly statusLabelKey = orderStatusLabelKey;

  readonly defaultsForm = this.fb.nonNullable.group({
    full_name: ['', Validators.required],
    phone: ['', [Validators.required, Validators.minLength(6)]],
    default_city: [''],
    default_district: [''],
    default_address: [''],
  });

  readonly passwordForm = this.fb.nonNullable.group(
    {
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', Validators.required],
    },
    { validators: passwordMatchValidator('password', 'confirmPassword') },
  );

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

  togglePasswordForm(): void {
    const next = !this.passwordFormOpen();
    this.passwordFormOpen.set(next);
    if (next) {
      this.passwordSuccessMessage.set(null);
    } else {
      this.resetPasswordForm();
    }
  }

  toggleNewPasswordVisibility(): void {
    this.showNewPassword.update((v) => !v);
  }

  toggleConfirmNewPasswordVisibility(): void {
    this.showConfirmNewPassword.update((v) => !v);
  }

  isNewPasswordInvalid(): boolean {
    const control = this.passwordForm.controls.password;
    return control.invalid && control.touched;
  }

  isConfirmNewPasswordInvalid(): boolean {
    const control = this.passwordForm.controls.confirmPassword;
    if (!control.touched) {
      return false;
    }
    return control.invalid || this.passwordForm.hasError('passwordMismatch');
  }

  newPasswordErrorKey(): string | null {
    const control = this.passwordForm.controls.password;
    if (!control.touched) {
      return null;
    }
    if (control.hasError('required')) {
      return 'auth.passwordRequired';
    }
    if (control.hasError('minlength')) {
      return 'auth.passwordMinLength';
    }
    return null;
  }

  confirmNewPasswordErrorKey(): string | null {
    const control = this.passwordForm.controls.confirmPassword;
    if (!control.touched) {
      return null;
    }
    if (control.hasError('required')) {
      return 'auth.confirmPasswordRequired';
    }
    if (this.passwordForm.hasError('passwordMismatch')) {
      return 'auth.passwordsMismatch';
    }
    return null;
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

  async changePassword(): Promise<void> {
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }

    this.changingPassword.set(true);
    this.passwordErrorMessage.set(null);
    this.passwordSuccessMessage.set(null);

    const { password } = this.passwordForm.getRawValue();
    const { error } = await this.auth.updatePassword(password);

    this.changingPassword.set(false);

    if (error) {
      this.passwordErrorMessage.set(this.i18n.t(error));
      return;
    }

    this.resetPasswordForm();
    this.passwordFormOpen.set(false);
    this.passwordSuccessMessage.set(this.i18n.t('profile.passwordChangeSuccess'));
  }

  private resetPasswordForm(): void {
    this.passwordForm.reset({
      password: '',
      confirmPassword: '',
    });
    this.showNewPassword.set(false);
    this.showConfirmNewPassword.set(false);
    this.passwordErrorMessage.set(null);
  }
}
