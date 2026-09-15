import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { waitForAuthReady } from '../utils/wait-for-auth-ready';

/** Auth required; admin/courier are sent to their role home (not user pages). */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await waitForAuthReady(auth);

  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/login'], {
      queryParams: { returnUrl: state.url },
    });
  }

  const user = auth.user();
  if (!user) {
    return router.createUrlTree(['/login'], {
      queryParams: { returnUrl: state.url },
    });
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
