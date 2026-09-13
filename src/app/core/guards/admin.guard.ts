import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

async function waitForAuthReady(auth: AuthService): Promise<void> {
  if (auth.isReady()) {
    return;
  }

  await new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      if (auth.isReady()) {
        clearInterval(interval);
        resolve();
      }
    }, 20);
  });
}

export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await waitForAuthReady(auth);

  const user = auth.user();
  if (!user) {
    return router.createUrlTree(['/login']);
  }

  const profile = auth.profile() ?? (await auth.loadProfile(user.id));

  if (profile?.role === 'admin') {
    return true;
  }

  return router.createUrlTree(['/']);
};
