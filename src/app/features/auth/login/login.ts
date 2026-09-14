import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
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
      await this.router.navigateByUrl(await this.auth.resolveHomePath());
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

    await this.router.navigateByUrl(await this.auth.resolveHomePath());
  }
}
