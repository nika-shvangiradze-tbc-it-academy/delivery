export type UserRole = 'user' | 'admin' | 'courier';

export interface Profile {
  id: string;
  full_name: string;
  phone: string;
  /** From auth.users — not stored in profiles table */
  email: string;
  role: UserRole;
  created_at: string;
}

export interface ProfileRow {
  id: string;
  full_name: string;
  phone: string;
  role: UserRole;
  created_at: string;
}

export interface ProfileUpdate {
  full_name?: string;
  phone?: string;
}

export interface CourierOption {
  id: string;
  full_name: string;
  phone: string;
}
