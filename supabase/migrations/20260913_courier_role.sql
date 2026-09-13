-- Courier role + order assignment + payment collection
-- Run in Supabase SQL editor on the existing project.

-- 1) Profiles: allow courier role
alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('user', 'admin', 'courier'));

-- 2) Orders: assignment + payment + delivered_at + updated_at
alter table public.orders
  add column if not exists assigned_courier_id uuid references public.profiles (id) on delete set null;

alter table public.orders
  add column if not exists payment_method text
  check (payment_method is null or payment_method in ('cash', 'card'));

alter table public.orders
  add column if not exists collected_amount numeric(12, 2) not null default 0;

alter table public.orders
  add column if not exists delivered_at timestamptz;

alter table public.orders
  add column if not exists updated_at timestamptz not null default now();

-- 3) Indexes for courier queries / daily totals
create index if not exists orders_assigned_courier_id_idx
  on public.orders (assigned_courier_id);

create index if not exists orders_status_idx
  on public.orders (status);

create index if not exists orders_delivered_at_idx
  on public.orders (delivered_at);

create index if not exists orders_courier_status_delivered_idx
  on public.orders (assigned_courier_id, status, delivered_at);

-- 4) Role helpers
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

create or replace function public.is_courier()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'courier'
  );
$$;

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role from public.profiles p where p.id = auth.uid();
$$;

-- 5) Refresh RLS policies for profiles
drop policy if exists "Users can read own profile" on public.profiles;
drop policy if exists "Users can insert own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Admins can read all profiles" on public.profiles;
drop policy if exists "Profiles select" on public.profiles;

create policy "Profiles select"
  on public.profiles for select
  using (
    auth.uid() = id
    or public.is_admin()
  );

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id and role = 'user');

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id or public.is_admin())
  with check (
    (auth.uid() = id and role = (select p.role from public.profiles p where p.id = auth.uid()))
    or public.is_admin()
  );

-- 6) Refresh RLS policies for orders
drop policy if exists "Users can read own orders" on public.orders;
drop policy if exists "Users can create own orders" on public.orders;
drop policy if exists "Users can update own pending orders or admins all" on public.orders;
drop policy if exists "Orders select" on public.orders;
drop policy if exists "Orders insert" on public.orders;
drop policy if exists "Orders update" on public.orders;
drop policy if exists "Courier can read assigned orders" on public.orders;
drop policy if exists "Courier can update assigned orders" on public.orders;

create policy "Orders select"
  on public.orders for select
  using (
    auth.uid() = user_id
    or public.is_admin()
    or (public.is_courier() and assigned_courier_id = auth.uid())
  );

create policy "Orders insert"
  on public.orders for insert
  with check (auth.uid() = user_id);

-- Users/admins may update via table policy.
-- Couriers should use courier_update_order RPC (column-safe).
create policy "Orders update"
  on public.orders for update
  using (auth.uid() = user_id or public.is_admin())
  with check (auth.uid() = user_id or public.is_admin());

-- 7) Secure courier update RPC (column-level control)
create or replace function public.courier_update_order(
  p_order_id bigint,
  p_status text,
  p_payment_method text,
  p_collected_amount numeric
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_role text;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is distinct from 'courier' then
    raise exception 'Only couriers can call courier_update_order';
  end if;

  if p_status is null or p_status not in ('accepted', 'picked_up', 'in_transit', 'delivered') then
    raise exception 'Invalid courier status';
  end if;

  if p_payment_method is not null and p_payment_method not in ('cash', 'card') then
    raise exception 'Invalid payment method';
  end if;

  if p_collected_amount is null or p_collected_amount < 0 then
    raise exception 'Invalid collected amount';
  end if;

  update public.orders o
  set
    status = p_status,
    payment_method = p_payment_method,
    collected_amount = round(p_collected_amount, 2),
    delivered_at = case
      when p_status = 'delivered' then coalesce(o.delivered_at, now())
      else null
    end,
    updated_at = now()
  where o.id = p_order_id
    and o.assigned_courier_id = auth.uid()
  returning * into v_order;

  if v_order.id is null then
    raise exception 'Order not found or not assigned to this courier';
  end if;

  return v_order;
end;
$$;

revoke all on function public.courier_update_order(bigint, text, text, numeric) from public;
grant execute on function public.courier_update_order(bigint, text, text, numeric) to authenticated;

-- 8) Admin assign courier helper (optional convenience)
create or replace function public.admin_assign_courier(
  p_order_id bigint,
  p_courier_id uuid
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  if not public.is_admin() then
    raise exception 'Only admins can assign couriers';
  end if;

  if p_courier_id is not null then
    if not exists (
      select 1 from public.profiles p
      where p.id = p_courier_id and p.role = 'courier'
    ) then
      raise exception 'Target profile is not a courier';
    end if;
  end if;

  update public.orders o
  set
    assigned_courier_id = p_courier_id,
    status = case
      when p_courier_id is not null then 'accepted'
      when o.status = 'accepted' then 'pending'
      else o.status
    end,
    updated_at = now()
  where o.id = p_order_id
  returning * into v_order;

  if v_order.id is null then
    raise exception 'Order not found';
  end if;

  return v_order;
end;
$$;

revoke all on function public.admin_assign_courier(bigint, uuid) from public;
grant execute on function public.admin_assign_courier(bigint, uuid) to authenticated;
