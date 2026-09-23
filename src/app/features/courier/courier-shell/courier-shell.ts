import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { CourierRealtimeService } from '../../../core/services/courier-realtime.service';
import { TranslatePipe } from '../../../core/pipes/t.pipe';
import i18next from 'i18next';

@Component({
  selector: 'app-courier-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TranslatePipe],
  templateUrl: './courier-shell.html',
  styleUrl: './courier-shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CourierShell {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly realtime = inject(CourierRealtimeService);

  private static readonly SCROLL_TOP_THRESHOLD_PX = 280;

  readonly courierName = computed(() => this.auth.profile()?.full_name ?? i18next.t('ui.courier'));
  readonly loggingOut = signal(false);
  readonly logoutError = signal<string | null>(null);
  readonly showScrollTop = signal(false);

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

  @HostListener('window:scroll')
  onWindowScroll(): void {
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    this.showScrollTop.set(y > CourierShell.SCROLL_TOP_THRESHOLD_PX);
  }

  scrollToTop(): void {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async onLogoClick(): Promise<void> {
    const target = '/courier/orders';
    if (!this.router.url.startsWith(target)) {
      await this.router.navigateByUrl(target);
    }
    this.realtime.requestManualRefresh();
  }

  async logout(): Promise<void> {
    if (this.loggingOut()) {
      return;
    }

    this.loggingOut.set(true);
    this.logoutError.set(null);

    try {
      this.realtime.disconnect();
      const { error } = await this.auth.logout();

      if (error) {
        this.logoutError.set(error);
        this.loggingOut.set(false);
        return;
      }

      await this.router.navigateByUrl('/login');
    } catch (err) {
      const message = err instanceof Error ? err.message : i18next.t('courier.logoutFailed');
      this.logoutError.set(message);
      this.loggingOut.set(false);
    }
  }
}
