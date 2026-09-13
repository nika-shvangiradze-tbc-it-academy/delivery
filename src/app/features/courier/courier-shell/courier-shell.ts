import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

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

  readonly courierName = computed(() => this.auth.profile()?.full_name ?? 'კურიერი');

  async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}
