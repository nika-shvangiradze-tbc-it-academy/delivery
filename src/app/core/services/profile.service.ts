import { Injectable, inject } from '@angular/core';
import { Profile, ProfileRow, ProfileUpdate } from '../models/profile.model';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

@Injectable({
  providedIn: 'root',
})
export class ProfileService {
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);

  async getCurrentProfile(): Promise<Profile | null> {
    const user = this.auth.user();
    if (!user) {
      return null;
    }
    return this.auth.loadProfile(user.id);
  }

  async updateCurrentProfile(update: ProfileUpdate): Promise<{ data: Profile | null; error: string | null }> {
    const user = this.auth.user();
    if (!user) {
      return { data: null, error: 'Not authenticated' };
    }

    const { data, error } = await this.supabase.client
      .from('profiles')
      .update(update)
      .eq('id', user.id)
      .select('id, full_name, phone, role, created_at')
      .single();

    if (error) {
      return { data: null, error: error.message };
    }

    const profile: Profile = {
      ...(data as ProfileRow),
      email: user.email ?? '',
    };
    this.auth.setProfile(profile);
    return { data: profile, error: null };
  }

  async getProfileById(userId: string): Promise<{ data: Profile | null; error: string | null }> {
    const { data, error } = await this.supabase.client
      .from('profiles')
      .select('id, full_name, phone, role, created_at')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      return { data: null, error: error.message };
    }

    if (!data) {
      return { data: null, error: null };
    }

    const email = this.auth.user()?.id === userId ? (this.auth.user()?.email ?? '') : '';
    return {
      data: {
        ...(data as ProfileRow),
        email,
      },
      error: null,
    };
  }
}
