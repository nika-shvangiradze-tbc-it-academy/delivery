import type { SupportedStorage } from '@supabase/supabase-js';

/** Preference key — always in localStorage so it survives the chosen session store. */
export const AUTH_REMEMBER_KEY = 'delivery-auth-remember';

/**
 * Custom Supabase auth storage:
 * - Remember me ON  → localStorage (survives browser restart)
 * - Remember me OFF → sessionStorage (cleared when the browser session ends)
 *
 * On read, sessionStorage is preferred when present so a fresh "session-only"
 * login wins over a stale localStorage session from a previous visit.
 */
export function createAuthStorage(): SupportedStorage {
  return {
    getItem: (key) => {
      if (typeof window === 'undefined') {
        return null;
      }
      return sessionStorage.getItem(key) ?? localStorage.getItem(key);
    },
    setItem: (key, value) => {
      if (typeof window === 'undefined') {
        return;
      }
      if (isRememberMeEnabled()) {
        localStorage.setItem(key, value);
        sessionStorage.removeItem(key);
      } else {
        sessionStorage.setItem(key, value);
        localStorage.removeItem(key);
      }
    },
    removeItem: (key) => {
      if (typeof window === 'undefined') {
        return;
      }
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    },
  };
}

export function isRememberMeEnabled(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }
  return localStorage.getItem(AUTH_REMEMBER_KEY) !== '0';
}

/** Call before signIn / signUp so the next persist goes to the right store. */
export function setRememberMe(enabled: boolean): void {
  if (typeof window === 'undefined') {
    return;
  }
  localStorage.setItem(AUTH_REMEMBER_KEY, enabled ? '1' : '0');
  if (!enabled) {
    // Drop any previously persisted durable session before writing session-only.
    clearLocalAuthTokens();
  }
}

function clearLocalAuthTokens(): void {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && (key.startsWith('sb-') || key.includes('auth-token'))) {
      keys.push(key);
    }
  }
  for (const key of keys) {
    localStorage.removeItem(key);
  }
}
