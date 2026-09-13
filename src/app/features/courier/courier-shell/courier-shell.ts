import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
  private readonly destroyRef = inject(DestroyRef);

  readonly courierName = computed(() => this.auth.profile()?.full_name ?? 'კურიერი');

  constructor() {
    effect(() => {
      const ready = this.auth.isReady();
      const isCourier = this.auth.isCourier();
      const userId = this.auth.user()?.id ?? null;

      if (ready && isCourier && userId) {
        this.realtime.connect(userId);
      } else {
        this.realtime.disconnect();
      }
    });

    this.destroyRef.onDestroy(() => {
      this.realtime.disconnect();
    });
  }

  async logout(): Promise<void> {
    this.realtime.disconnect();
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}
