import { Injectable, computed, inject, signal } from '@angular/core';
import { Session, User } from '@supabase/supabase-js';
import { Profile, ProfileRow } from '../models/profile.model';
import { parseRole } from '../utils/order-status.util';
import { SupabaseService } from './supabase.service';

export interface RegisterPayload {
  fullName: string;
  phone: string;
  email: string;
  password: string;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly supabase = inject(SupabaseService);

  private readonly sessionSignal = signal<Session | null>(null);
  private readonly userSignal = signal<User | null>(null);
  private readonly profileSignal = signal<Profile | null>(null);
  private readonly readySignal = signal(false);

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

  private async init(): Promise<void> {
    const { data } = await this.supabase.client.auth.getSession();
    await this.applySession(data.session);

    this.supabase.client.auth.onAuthStateChange((_event, session) => {
      void this.applySession(session);
    });

    this.readySignal.set(true);
  }

  private async applySession(session: Session | null): Promise<void> {
    this.sessionSignal.set(session);
    this.userSignal.set(session?.user ?? null);

    if (session?.user) {
      await this.loadProfile(session.user.id);
    } else {
      this.profileSignal.set(null);
    }
  }

  private toProfile(row: ProfileRow, email: string): Profile {
    return {
      id: row.id,
      full_name: row.full_name ?? '',
      phone: row.phone ?? '',
      email,
      role: parseRole(row.role),
      created_at: row.created_at ?? '',
    };
  }

  async loadProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await this.supabase.client
      .from('profiles')
      .select('id, full_name, phone, role, created_at')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error('Failed to load profile', error.message);
      this.profileSignal.set(null);
      return null;
    }

    if (!data) {
      this.profileSignal.set(null);
      return null;
    }

    const email = this.userSignal()?.email ?? '';
    const profile = this.toProfile(data as ProfileRow, email);
    this.profileSignal.set(profile);
    return profile;
  }

  async register(payload: RegisterPayload): Promise<{ error: string | null }> {
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
      return { error: error.message };
    }

    const userId = data.user?.id;
    if (!userId) {
      return { error: 'Registration succeeded but user was not returned.' };
    }

    const { error: profileError } = await this.supabase.client.from('profiles').upsert(
      {
        id: userId,
        full_name: payload.fullName,
        phone: payload.phone,
        role: 'user',
      },
      { onConflict: 'id' },
    );

    if (profileError) {
      return { error: profileError.message };
    }

    if (data.session) {
      await this.applySession(data.session);
    } else {
      await this.loadProfile(userId);
    }

    return { error: null };
  }

  async login(email: string, password: string): Promise<{ error: string | null }> {
    const { data, error } = await this.supabase.client.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return { error: error.message };
    }

    await this.applySession(data.session);
    return { error: null };
  }

  async logout(): Promise<{ error: string | null }> {
    const { error } = await this.supabase.client.auth.signOut();
    this.profileSignal.set(null);
    this.userSignal.set(null);
    this.sessionSignal.set(null);
    return { error: error?.message ?? null };
  }

  setProfile(profile: Profile | null): void {
    this.profileSignal.set(profile);
  }

  homePathForRole(): string {
    const role = this.profileSignal()?.role;
    if (role === 'admin') return '/admin';
    if (role === 'courier') return '/courier';
    return '/profile';
  }
}
