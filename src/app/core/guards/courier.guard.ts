import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { waitForAuthReady } from '../utils/wait-for-auth-ready';

export const courierGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await waitForAuthReady(auth);

  const user = auth.user();
  if (!user) {
    return router.createUrlTree(['/login']);
  }

  const profile = auth.profile() ?? (await auth.loadProfile(user.id));

  if (profile?.role === 'courier') {
    return true;
  }

  if (profile?.role === 'admin') {
    return router.createUrlTree(['/admin']);
  }

  return router.createUrlTree(['/']);
};
