import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '../../../core/pipes/t.pipe';
import { AuthService } from '../../../core/services/auth.service';
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
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

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

  async onSubmit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);

    const { email, password, rememberMe } = this.form.getRawValue();
    const { error } = await this.auth.login(email, password, rememberMe);

    this.loading.set(false);

    if (error) {
      this.errorMessage.set(error);
      return;
    }

    await this.router.navigateByUrl(await this.resolvePostLoginPath());
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
