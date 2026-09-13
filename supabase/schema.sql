-- Base reference schema (see also migrations/20260913_courier_role.sql for upgrades).

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  phone text not null,
  role text not null default 'user' check (role in ('user', 'admin', 'courier')),
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  assigned_courier_id uuid references public.profiles (id) on delete set null,
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
  payment_method text check (payment_method is null or payment_method in ('cash', 'card')),
  collected_amount numeric(12, 2) not null default 0,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
