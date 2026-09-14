import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { waitForAuthReady } from '../utils/wait-for-auth-ready';

/**
 * Keeps admin/courier on their role home when they hit the public landing (`/`).
 * Guests and normal users stay on the landing page.
 */
export const roleHomeGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await waitForAuthReady(auth);

  const user = auth.user();
  if (!user) {
    return true;
  }

  const profile = auth.profile() ?? (await auth.loadProfile(user.id));
  if (profile?.role === 'admin') {
    return router.createUrlTree(['/admin']);
  }
  if (profile?.role === 'courier') {
    return router.createUrlTree(['/courier']);
  }

  return true;
};
