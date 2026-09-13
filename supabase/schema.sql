-- Suggested Supabase schema for Location delivery auth/orders.
-- Apply in the Supabase SQL editor. Enable RLS and adjust policies as needed.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  phone text not null,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  sender_name text not null,
  sender_phone text not null,
  pickup_city text not null,
  pickup_district text not null,
  pickup_address text not null,
  recipient_name text not null,
  recipient_phone text not null,
  delivery_city text not null,
  delivery_district text not null,
  delivery_address text not null,
  parcel_count integer not null default 1 check (parcel_count > 0),
  delivery_date date not null,
  notes text,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'picked_up', 'in_transit', 'delivered', 'cancelled')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.orders enable row level security;

-- Helper: current user is admin
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- Profiles policies
create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());

-- Orders policies
create policy "Users can read own orders"
  on public.orders for select
  using (auth.uid() = user_id or public.is_admin());

create policy "Users can create own orders"
  on public.orders for insert
  with check (auth.uid() = user_id);

create policy "Users can update own pending orders or admins all"
  on public.orders for update
  using (auth.uid() = user_id or public.is_admin())
  with check (auth.uid() = user_id or public.is_admin());
