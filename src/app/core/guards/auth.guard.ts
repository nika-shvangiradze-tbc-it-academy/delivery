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

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await waitForAuthReady(auth);

  if (auth.isAuthenticated()) {
    return true;
  }

  return router.createUrlTree(['/login']);
};
