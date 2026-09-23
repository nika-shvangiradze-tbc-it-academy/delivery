import { Injectable, computed, inject, signal } from '@angular/core';
import { Session, User } from '@supabase/supabase-js';
import { setRememberMe } from '../auth/auth-storage';
import { Profile, ProfileRow, UserRole } from '../models/profile.model';
import { parseRole } from '../utils/order-status.util';
import { SupabaseService } from './supabase.service';

export interface RegisterPayload {
  fullName: string;
  phone: string;
  email: string;
  password: string;
  rememberMe?: boolean;
}

const PROFILE_SELECT_FULL =
  'id, full_name, phone, role, default_city, default_district, default_address, created_at';
const PROFILE_SELECT_BASE = 'id, full_name, phone, role, created_at';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly supabase = inject(SupabaseService);

  private readonly sessionSignal = signal<Session | null>(null);
  private readonly userSignal = signal<User | null>(null);
  private readonly profileSignal = signal<Profile | null>(null);
  private readonly readySignal = signal(false);
  private readyResolve!: () => void;
  private readonly readyPromise = new Promise<void>((resolve) => {
    this.readyResolve = resolve;
  });

  /** Prevents duplicate profile fetches from getSession + onAuthStateChange. */
  private profileInflight: Promise<Profile | null> | null = null;
  private profileInflightUserId: string | null = null;
  private appliedAccessToken: string | null = null;
  private authListenerReady = false;

  readonly session = this.sessionSignal.asReadonly();
  readonly user = this.userSignal.asReadonly();
  readonly profile = this.profileSignal.asReadonly();
  readonly isReady = this.readySignal.asReadonly();
  readonly isAuthenticated = computed(() => Boolean(this.userSignal()));
  readonly isAdmin = computed(() => this.profileSignal()?.role === 'admin');
  readonly isCourier = computed(() => this.profileSignal()?.role === 'courier');

  constructor() {
    void this.init();
  }

  /** Resolves once the initial auth session check finishes (no polling). */
  whenReady(): Promise<void> {
    return this.readySignal() ? Promise.resolve() : this.readyPromise;
  }

  private async init(): Promise<void> {
    const { data } = await this.supabase.client.auth.getSession();
    await this.applySession(data.session);

    this.supabase.client.auth.onAuthStateChange((_event, session) => {
      // Ignore the echo of the session we already applied during bootstrap.
      if (!this.authListenerReady) {
        return;
      }
      void this.applySession(session);
    });

    this.authListenerReady = true;
    this.readySignal.set(true);
    this.readyResolve();
  }

  private async applySession(session: Session | null): Promise<void> {
    const nextToken = session?.access_token ?? null;
    const nextUserId = session?.user?.id ?? null;

    this.sessionSignal.set(session);
    this.userSignal.set(session?.user ?? null);

    if (!session?.user || !nextUserId) {
      this.appliedAccessToken = null;
      this.profileSignal.set(null);
      this.profileInflight = null;
      this.profileInflightUserId = null;
      return;
    }

    // Profile already loaded for this user (incl. token refresh) → skip refetch.
    if (nextUserId && this.profileSignal()?.id === nextUserId) {
      this.appliedAccessToken = nextToken;
      return;
    }

    // In-flight load for same user (getSession / auth echo) → await it, don't start another.
    if (this.profileInflight && this.profileInflightUserId === nextUserId) {
      await this.profileInflight;
      this.appliedAccessToken = nextToken;
      return;
    }

    const profile = await this.loadProfile(nextUserId);
    if (profile) {
      this.appliedAccessToken = nextToken;
    }
  }

  private toProfile(row: ProfileRow, email: string): Profile {
    return {
      id: row.id,
      full_name: row.full_name ?? '',
      phone: row.phone ?? '',
      email,
      role: parseRole(row.role),
      default_city: row.default_city ?? null,
      default_district: row.default_district ?? null,
      default_address: row.default_address ?? null,
      created_at: row.created_at ?? '',
    };
  }

  private isTransientNetworkError(message: string | undefined): boolean {
    if (!message) {
      return false;
    }
    return /failed to fetch|networkerror|network request failed|load failed|connection|abort|econnreset|econnrefused|etimedout/i.test(
      message,
    );
  }

  private async fetchProfileOnce(userId: string): Promise<{
    data: ProfileRow | null;
    errorMessage: string | null;
  }> {
    let { data, error } = await this.supabase.client
      .from('profiles')
      .select(PROFILE_SELECT_FULL)
      .eq('id', userId)
      .maybeSingle();

    // Migration not applied yet — fall back to existing columns so profile still loads
    if (error && /default_city|default_district|default_address/i.test(error.message)) {
      ({ data, error } = await this.supabase.client
        .from('profiles')
        .select(PROFILE_SELECT_BASE)
        .eq('id', userId)
        .maybeSingle());
    }

    return {
      data: (data as ProfileRow | null) ?? null,
      errorMessage: error?.message ?? null,
    };
  }

  async loadProfile(userId: string): Promise<Profile | null> {
    if (this.profileInflight && this.profileInflightUserId === userId) {
      return this.profileInflight;
    }

    this.profileInflightUserId = userId;
    this.profileInflight = this.loadProfileInternal(userId).finally(() => {
      if (this.profileInflightUserId === userId) {
        this.profileInflight = null;
        this.profileInflightUserId = null;
      }
    });

    return this.profileInflight;
  }

  private async loadProfileInternal(userId: string): Promise<Profile | null> {
    const maxAttempts = 3;
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const { data, errorMessage } = await this.fetchProfileOnce(userId);

        if (!errorMessage) {
          if (!data) {
            this.profileSignal.set(null);
            return null;
          }

          const email = this.userSignal()?.email ?? '';
          const profile = this.toProfile(data, email);
          this.profileSignal.set(profile);
          return profile;
        }

        lastError = errorMessage;
        if (!this.isTransientNetworkError(errorMessage) || attempt === maxAttempts) {
          break;
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (!this.isTransientNetworkError(lastError) || attempt === maxAttempts) {
          break;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }

    // Keep existing profile if a refresh failed transiently; otherwise clear.
    if (!this.profileSignal() || this.profileSignal()?.id !== userId) {
      this.profileSignal.set(null);
    }

    void lastError;
    return this.profileSignal()?.id === userId ? this.profileSignal() : null;
  }

  async register(payload: RegisterPayload): Promise<{ error: string | null }> {
    setRememberMe(payload.rememberMe !== false);

    try {
      const { data, error } = await this.supabase.client.auth.signUp({
        email: payload.email,
        password: payload.password,
        options: {
          data: {
            full_name: payload.fullName,
            phone: payload.phone,
          },
        },
      });

      if (error) {
        return { error: this.mapAuthError(error) };
      }

      const userId = data.user?.id;
      if (!userId) {
        return { error: 'auth.genericError' };
      }

      const { error: profileError } = await this.supabase.client.from('profiles').upsert(
        {
          id: userId,
          full_name: payload.fullName,
          phone: payload.phone,
          // Role is enforced by DB (insert check + protect_profile_role trigger).
          // Never accept admin/courier from the client.
          role: 'user',
        },
        { onConflict: 'id' },
      );

      if (profileError) {
        return { error: this.mapAuthError(profileError) };
      }

      if (data.session) {
        await this.applySession(data.session);
      } else {
        await this.loadProfile(userId);
      }

      return { error: null };
    } catch (err) {
      return { error: this.mapAuthError(err) };
    }
  }

  async login(
    email: string,
    password: string,
    rememberMe = true,
  ): Promise<{ error: string | null }> {
    setRememberMe(rememberMe);

    try {
      const { data, error } = await this.supabase.client.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return { error: this.mapAuthError(error) };
      }

      await this.applySession(data.session);
      return { error: null };
    } catch (err) {
      return { error: this.mapAuthError(err) };
    }
  }

  /**
   * Maps Supabase/Auth errors to i18n keys. Never returns raw technical messages.
   */
  private mapAuthError(error: unknown): string {
    const message = this.extractErrorMessage(error).toLowerCase();
    const code = this.extractErrorCode(error).toLowerCase();

    if (
      code === 'invalid_credentials' ||
      message.includes('invalid login credentials') ||
      message.includes('invalid credentials') ||
      message.includes('email not confirmed')
    ) {
      return 'auth.invalidCredentials';
    }

    if (
      code === 'user_already_exists' ||
      message.includes('user already registered') ||
      message.includes('already been registered') ||
      message.includes('already registered')
    ) {
      return 'auth.emailAlreadyRegistered';
    }

    if (
      code === 'weak_password' ||
      (message.includes('password') &&
        (message.includes('weak') ||
          message.includes('at least') ||
          message.includes('too short') ||
          message.includes('least 6')))
    ) {
      return 'auth.weakPassword';
    }

    if (
      code === 'over_request_rate_limit' ||
      message.includes('rate limit') ||
      message.includes('too many requests') ||
      message.includes('too many attempts')
    ) {
      return 'auth.rateLimited';
    }

    if (
      this.isTransientNetworkError(message) ||
      message.includes('failed to fetch') ||
      message.includes('network')
    ) {
      return 'auth.networkError';
    }

    if (
      message.includes('unable to validate email') ||
      message.includes('invalid email') ||
      (message.includes('email address') && message.includes('invalid'))
    ) {
      return 'auth.emailInvalid';
    }

    return 'auth.genericError';
  }

  private extractErrorMessage(error: unknown): string {
    if (!error) {
      return '';
    }
    if (typeof error === 'string') {
      return error;
    }
    if (typeof error === 'object' && 'message' in error) {
      const msg = (error as { message?: unknown }).message;
      return typeof msg === 'string' ? msg : '';
    }
    return '';
  }

  private extractErrorCode(error: unknown): string {
    if (!error || typeof error !== 'object') {
      return '';
    }
    if ('code' in error && typeof (error as { code?: unknown }).code === 'string') {
      return (error as { code: string }).code;
    }
    return '';
  }

  async logout(): Promise<{ error: string | null }> {
    const { error } = await this.supabase.client.auth.signOut();
    this.appliedAccessToken = null;
    this.profileInflight = null;
    this.profileInflightUserId = null;
    this.profileSignal.set(null);
    this.userSignal.set(null);
    this.sessionSignal.set(null);
    return { error: error?.message ?? null };
  }

  /**
   * Updates the password for the currently authenticated Supabase Auth user only.
   * Does not write to profiles or any custom table. Never logs the password.
   */
  async updatePassword(newPassword: string): Promise<{ error: string | null }> {
    if (!this.userSignal() || !this.sessionSignal()) {
      return { error: 'auth.passwordChangeUnauthorized' };
    }

    const { error } = await this.supabase.client.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      return { error: 'auth.passwordChangeFailed' };
    }

    return { error: null };
  }

  setProfile(profile: Profile | null): void {
    this.profileSignal.set(profile);
    if (profile) {
      this.appliedAccessToken = this.sessionSignal()?.access_token ?? this.appliedAccessToken;
    }
  }

  homePathForRole(role?: UserRole | null): string {
    const resolved = role ?? this.profileSignal()?.role;
    if (resolved === 'admin') return '/admin';
    if (resolved === 'courier') return '/courier';
    return '/profile';
  }

  /**
   * Ensures profile is loaded, then returns the deterministic role home path.
   * Used after login so admins never briefly land on the user area.
   */
  async resolveHomePath(): Promise<string> {
    const user = this.userSignal();
    if (!user) {
      return '/login';
    }
    const profile = this.profileSignal() ?? (await this.loadProfile(user.id));
    return this.homePathForRole(profile?.role ?? null);
  }
}
