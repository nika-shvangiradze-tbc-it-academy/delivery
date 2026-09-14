import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { createAuthStorage } from '../auth/auth-storage';

@Injectable({
  providedIn: 'root',
})
export class SupabaseService {
  readonly client: SupabaseClient;

  constructor() {
    const url = environment.supabaseUrl || 'https://placeholder.supabase.co';
    const key = environment.supabaseKey || 'public-anon-key';

    this.client = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: createAuthStorage(),
      },
    });
  }

  get isConfigured(): boolean {
    return Boolean(environment.supabaseUrl && environment.supabaseKey);
  }
}
