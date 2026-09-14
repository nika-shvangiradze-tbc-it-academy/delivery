import { AuthService } from '../services/auth.service';

/** Resolves when AuthService finishes its initial session check (no polling). */
export function waitForAuthReady(auth: AuthService): Promise<void> {
  return auth.whenReady();
}
