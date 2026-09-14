import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
} from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { CourierRealtimeService } from '../../../core/services/courier-realtime.service';

@Component({
  selector: 'app-courier-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './courier-shell.html',
  styleUrl: './courier-shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CourierShell {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly realtime = inject(CourierRealtimeService);

  readonly courierName = computed(() => this.auth.profile()?.full_name ?? 'კურიერი');

  constructor() {
    // Channel lifecycle is owned by OrderRealtimeService (auth-driven).
    // Keep an idempotent connect while the courier shell is mounted.
    effect(() => {
      const ready = this.auth.isReady();
      const isCourier = this.auth.isCourier();
      const userId = this.auth.user()?.id ?? null;

      if (ready && isCourier && userId) {
        this.realtime.connect(userId);
      }
    });
  }

  async onLogoClick(): Promise<void> {
    const target = '/courier/orders';
    if (!this.router.url.startsWith(target)) {
      await this.router.navigateByUrl(target);
    }
    this.realtime.requestManualRefresh();
  }

  async logout(): Promise<void> {
    this.realtime.disconnect();
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}
