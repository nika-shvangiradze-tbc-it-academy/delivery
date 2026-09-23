import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '../../../core/pipes/t.pipe';
import { AuthService } from '../../../core/services/auth.service';
import { I18nService } from '../../../core/services/i18n.service';
import { passwordMatchValidator } from '../../../core/validators/password-match.validator';
import { DeliveryHeader } from '../../../layout/delivery-header/delivery-header';

@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe, DeliveryHeader],
  templateUrl: './register.html',
  styleUrl: './register.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Register implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);

  @ViewChild('authFormEl') private readonly authFormEl?: ElementRef<HTMLFormElement>;

  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly showPassword = signal(false);
  readonly showConfirmPassword = signal(false);

  readonly form = this.fb.nonNullable.group(
    {
      fullName: ['', [Validators.required, Validators.minLength(2)]],
      phone: ['', [Validators.required, Validators.minLength(6)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', Validators.required],
      rememberMe: [true],
    },
    { validators: passwordMatchValidator('password', 'confirmPassword') },
  );

  async ngOnInit(): Promise<void> {
    await this.auth.whenReady();
    if (this.auth.isAuthenticated()) {
      await this.router.navigateByUrl(await this.auth.resolveHomePath());
    }
  }

  togglePasswordVisibility(): void {
    this.showPassword.update((v) => !v);
  }

  toggleConfirmPasswordVisibility(): void {
    this.showConfirmPassword.update((v) => !v);
  }

  isFieldInvalid(controlName: 'fullName' | 'phone' | 'email'): boolean {
    const control = this.form.controls[controlName];
    return control.invalid && control.touched;
  }

  fieldErrorKey(controlName: 'fullName' | 'phone' | 'email'): string | null {
    const control = this.form.controls[controlName];
    if (!control.touched) {
      return null;
    }
    if (controlName === 'fullName') {
      return control.hasError('required') || control.hasError('minlength')
        ? 'auth.fullNameRequired'
        : null;
    }
    if (controlName === 'phone') {
      return control.hasError('required') || control.hasError('minlength')
        ? 'auth.phoneRequired'
        : null;
    }
    if (control.hasError('required')) {
      return 'auth.emailRequired';
    }
    if (control.hasError('email')) {
      return 'auth.emailInvalid';
    }
    return null;
  }

  isPasswordInvalid(): boolean {
    const control = this.form.controls.password;
    return control.invalid && control.touched;
  }

  isConfirmPasswordInvalid(): boolean {
    const control = this.form.controls.confirmPassword;
    if (!control.touched) {
      return false;
    }
    return control.invalid || this.form.hasError('passwordMismatch');
  }

  passwordErrorKey(): string | null {
    const control = this.form.controls.password;
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

  confirmPasswordErrorKey(): string | null {
    const control = this.form.controls.confirmPassword;
    if (!control.touched) {
      return null;
    }
    if (control.hasError('required')) {
      return 'auth.confirmPasswordRequired';
    }
    if (this.form.hasError('passwordMismatch')) {
      return 'auth.passwordsMismatch';
    }
    return null;
  }

  async onSubmit(): Promise<void> {
    if (this.loading()) {
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.focusFirstInvalid();
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);

    try {
      const value = this.form.getRawValue();
      const { error } = await this.auth.register({
        fullName: value.fullName,
        phone: value.phone,
        email: value.email,
        password: value.password,
        rememberMe: value.rememberMe,
      });

      if (error) {
        this.errorMessage.set(this.i18n.t(error));
        return;
      }

      await this.router.navigateByUrl(await this.auth.resolveHomePath());
    } catch {
      this.errorMessage.set(this.i18n.t('auth.genericError'));
    } finally {
      this.loading.set(false);
    }
  }

  private focusFirstInvalid(): void {
    const form = this.authFormEl?.nativeElement;
    if (!form) {
      return;
    }
    const invalid = form.querySelector<HTMLElement>('input.ng-invalid');
    invalid?.focus();
  }
}
