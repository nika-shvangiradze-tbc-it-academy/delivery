import { Injectable, inject } from '@angular/core';
import { Profile, ProfileRow, ProfileUpdate } from '../models/profile.model';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { parseRole } from '../utils/order-status.util';

const PROFILE_COLUMNS_FULL =
  'id, full_name, phone, role, default_city, default_district, default_address, created_at';
const PROFILE_COLUMNS_BASE = 'id, full_name, phone, role, created_at';

@Injectable({
  providedIn: 'root',
})
export class ProfileService {
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);

  private mapRow(row: ProfileRow, email: string): Profile {
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

  private isMissingDefaultsColumn(message: string): boolean {
    return /default_city|default_district|default_address/i.test(message);
  }

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

    let { data, error } = await this.supabase.client
      .from('profiles')
      .update(update)
      .eq('id', user.id)
      .select(PROFILE_COLUMNS_FULL)
      .single();

    if (error && this.isMissingDefaultsColumn(error.message)) {
      const baseUpdate: ProfileUpdate = {
        full_name: update.full_name,
        phone: update.phone,
      };
      ({ data, error } = await this.supabase.client
        .from('profiles')
        .update(baseUpdate)
        .eq('id', user.id)
        .select(PROFILE_COLUMNS_BASE)
        .single());

      if (!error) {
        // Columns not migrated yet — name/phone saved, defaults skipped
        const profile = this.mapRow(data as ProfileRow, user.email ?? '');
        this.auth.setProfile(profile);
        return {
          data: profile,
          error:
            'პროფილი შეინახა, მაგრამ default მისამართის ველები ჯერ არ არსებობს ბაზაში. გაუშვი SQL მიგრაცია.',
        };
      }
    }

    if (error) {
      return { data: null, error: error.message };
    }

    const profile = this.mapRow(data as ProfileRow, user.email ?? '');
    this.auth.setProfile(profile);
    return { data: profile, error: null };
  }

  async saveSenderDefaults(payload: {
    full_name: string;
    phone: string;
    default_city: string;
    default_district: string;
    default_address: string;
  }): Promise<{ data: Profile | null; error: string | null }> {
    return this.updateCurrentProfile({
      full_name: payload.full_name,
      phone: payload.phone,
      default_city: payload.default_city,
      default_district: payload.default_district,
      default_address: payload.default_address,
    });
  }

  async getProfileById(userId: string): Promise<{ data: Profile | null; error: string | null }> {
    let { data, error } = await this.supabase.client
      .from('profiles')
      .select(PROFILE_COLUMNS_FULL)
      .eq('id', userId)
      .maybeSingle();

    if (error && this.isMissingDefaultsColumn(error.message)) {
      ({ data, error } = await this.supabase.client
        .from('profiles')
        .select(PROFILE_COLUMNS_BASE)
        .eq('id', userId)
        .maybeSingle());
    }

    if (error) {
      return { data: null, error: error.message };
    }

    if (!data) {
      return { data: null, error: null };
    }

    const email = this.auth.user()?.id === userId ? (this.auth.user()?.email ?? '') : '';
    return { data: this.mapRow(data as ProfileRow, email), error: null };
  }
}
