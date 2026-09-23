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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '../../../core/pipes/t.pipe';
import { AuthService } from '../../../core/services/auth.service';
import { I18nService } from '../../../core/services/i18n.service';
import { DeliveryHeader } from '../../../layout/delivery-header/delivery-header';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe, DeliveryHeader],
  templateUrl: './login.html',
  styleUrl: './login.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Login implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  @ViewChild('authFormEl') private readonly authFormEl?: ElementRef<HTMLFormElement>;

  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
    rememberMe: [true],
  });

  async ngOnInit(): Promise<void> {
    await this.auth.whenReady();
    if (this.auth.isAuthenticated()) {
      await this.router.navigateByUrl(await this.resolvePostLoginPath());
    }
  }

  isFieldInvalid(controlName: 'email' | 'password'): boolean {
    const control = this.form.controls[controlName];
    return control.invalid && control.touched;
  }

  fieldErrorKey(controlName: 'email' | 'password'): string | null {
    const control = this.form.controls[controlName];
    if (!control.touched) {
      return null;
    }
    if (controlName === 'email') {
      if (control.hasError('required')) {
        return 'auth.emailRequired';
      }
      if (control.hasError('email')) {
        return 'auth.emailInvalid';
      }
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
      const { email, password, rememberMe } = this.form.getRawValue();
      const { error } = await this.auth.login(email, password, rememberMe);

      if (error) {
        this.errorMessage.set(this.i18n.t(error));
        return;
      }

      await this.router.navigateByUrl(await this.resolvePostLoginPath());
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

  private async resolvePostLoginPath(): Promise<string> {
    const home = await this.auth.resolveHomePath();
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    if (!this.isSafeInternalUrl(returnUrl)) {
      return home;
    }

    // Admin/courier stay on role home; user pages are not for them.
    if (home === '/admin' || home === '/courier') {
      return home;
    }

    return returnUrl;
  }

  private isSafeInternalUrl(url: string | null): url is string {
    return Boolean(url && url.startsWith('/') && !url.startsWith('//') && !url.includes('://'));
  }
}
