import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '../../../core/pipes/t.pipe';
import { AuthService } from '../../../core/services/auth.service';
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
  private readonly router = inject(Router);

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
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);

    const value = this.form.getRawValue();
    const { error } = await this.auth.register({
      fullName: value.fullName,
      phone: value.phone,
      email: value.email,
      password: value.password,
      rememberMe: value.rememberMe,
    });

    this.loading.set(false);

    if (error) {
      this.errorMessage.set(error);
      return;
    }

    await this.router.navigateByUrl(await this.auth.resolveHomePath());
  }
}
