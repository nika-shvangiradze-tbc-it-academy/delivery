-- =============================================================================
-- Security hardening (production)
-- Paste into Supabase SQL Editor. Idempotent / safe to re-run.
--
-- Fixes:
--   CRITICAL: owners could UPDATE operational columns (status, courier,
--             collected_amount, etc.) via direct REST PATCH.
--   HIGH:     order INSERT could set operational fields (status, assignment…).
--   HIGH:     legacy courier_update_order trusted client collected_amount.
--   MEDIUM:   role change lacked trigger defense; grants/anon surface; RLS
--             enable not recorded in repo migrations.
--
-- Owner edits (REQUIRED):
--   Users MAY update their own rows only while status = 'pending', and only
--   for safe customer-entered fields. Operational columns are blocked by a
--   BEFORE UPDATE trigger (not frontend-only). Admins may edit any order.
--
-- Does NOT disable RLS. Does NOT use service_role. Preserves:
--   - user create-order + edit safe fields + read own orders
--   - admin table UPDATE / SELECT
--   - courier SECURITY DEFINER RPCs (trigger allows via GUC + courier check)
--   - realtime SELECT policies
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0) Ensure RLS is on (no-op if already enabled)
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.orders enable row level security;

do $$
begin
  if to_regclass('public.courier_order_events') is not null then
    execute 'alter table public.courier_order_events enable row level security';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Role helpers: tighten EXECUTE grants
-- ---------------------------------------------------------------------------
revoke all on function public.is_admin() from public;
revoke all on function public.is_courier() from public;
revoke all on function public.current_role() from public;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_courier() to authenticated;
grant execute on function public.current_role() to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Profile role protection (DB-authoritative; frontend alone is insufficient)
-- ---------------------------------------------------------------------------
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- JWT present + non-admin ⇒ cannot change/set privileged roles.
  -- auth.uid() null (SQL editor / migrations / service contexts) remains allowed
  -- so operators can promote the first admin / couriers safely.
  if tg_op = 'UPDATE'
     and new.role is distinct from old.role
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception 'Only admins can change roles';
  end if;

  if tg_op = 'INSERT'
     and new.role is distinct from 'user'
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception 'New profiles must have role user';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role
  before insert or update on public.profiles
  for each row
  execute function public.protect_profile_role();

-- Server-side default profile on signup (role always user; never from client choice)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), 'User'),
    coalesce(nullif(trim(new.raw_user_meta_data->>'phone'), ''), '-'),
    'user'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- Refresh profiles UPDATE policy (role protected by protect_profile_role trigger)
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  using (
    auth.uid() = id
    or public.is_admin()
  )
  with check (
    auth.uid() = id
    or public.is_admin()
  );

-- ---------------------------------------------------------------------------
-- 3) Orders UPDATE: owners (pending only) + admins (always) + column guard
--
-- RLS:
--   - admin: update any row
--   - owner: update only while status = 'pending'
--   - courier: NO UPDATE policy (REST PATCH denied; RPCs are SECURITY DEFINER)
--
-- Trigger enforces safe columns for owners and rejects edits after pending.
-- Name prefix "orders_00_" so this runs BEFORE orders_courier_lifecycle_bu.
-- ---------------------------------------------------------------------------
drop policy if exists "Orders update" on public.orders;
drop policy if exists "Orders update admin" on public.orders;
drop policy if exists "Orders update owner" on public.orders;
drop policy if exists "Users can update own pending orders or admins all" on public.orders;
drop policy if exists "Courier can update assigned orders" on public.orders;

create policy "Orders update"
  on public.orders for update
  using (
    public.is_admin()
    or (auth.uid() = user_id and status = 'pending')
  )
  with check (
    public.is_admin()
    or (auth.uid() = user_id and status = 'pending')
  );

-- Column-level protection for owner UPDATEs (true allowlist; future cols locked)
create or replace function public.protect_order_column_security()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Customer-entered fields owners may edit while pending, plus updated_at
  -- (server-stamped below). Every other column must match OLD exactly.
  v_user_editable text[] := array[
    'sender_name',
    'sender_phone',
    'pickup_city',
    'pickup_district',
    'pickup_address',
    'recipient_name',
    'recipient_phone',
    'delivery_city',
    'delivery_district',
    'delivery_address',
    'parcel_count',
    'delivery_date',
    'notes',
    'is_fragile',
    'amount_to_collect',
    'updated_at'
  ];
begin
  -- Admin always. SQL editor / migrations (no JWT) allowed.
  -- Do NOT trust app.orders_write_source alone (admin_rpc / courier_rpc).
  if public.is_admin() or auth.uid() is null then
    return new;
  end if;

  -- Courier SECURITY DEFINER RPCs bypass RLS but still fire triggers.
  -- Direct REST UPDATE remains denied by RLS (no courier UPDATE policy).
  -- Bypass only with verified courier role + assignment to this order.
  if public.is_courier()
     and old.assigned_courier_id is not distinct from auth.uid() then
    if new.id is distinct from old.id
       or new.user_id is distinct from old.user_id then
      raise exception 'Couriers cannot change order identity fields';
    end if;
    return new;
  end if;

  -- Normal owner: editable only while pending; only allowlisted customer fields
  if auth.uid() is not distinct from old.user_id then
    if old.status is distinct from 'pending' then
      raise exception 'Order can only be edited while pending';
    end if;

    if (to_jsonb(new) - v_user_editable)
       is distinct from
       (to_jsonb(old) - v_user_editable) then
      raise exception 'Users may only edit customer order fields';
    end if;

    -- Never trust client-supplied updated_at
    new.updated_at := now();
    return new;
  end if;

  raise exception 'Not allowed to update this order';
end;
$$;

drop trigger if exists orders_00_protect_columns on public.orders;
drop trigger if exists orders_protect_column_security on public.orders;
create trigger orders_00_protect_columns
  before update on public.orders
  for each row
  execute function public.protect_order_column_security();

revoke all on function public.protect_order_column_security() from public;

-- Harden INSERT: cannot self-assign courier / fake delivered / set money fields
drop policy if exists "Orders insert" on public.orders;
drop policy if exists "Users can create own orders" on public.orders;

create policy "Orders insert"
  on public.orders for insert
  with check (
    auth.uid() = user_id
    and status = 'pending'
    and assigned_courier_id is null
    and coalesce(collected_amount, 0) = 0
    and payment_method is null
    and delivered_at is null
    and cancelled_at is null
    and courier_sort_order is null
  );

-- SELECT unchanged in intent (owner / admin / assigned courier)
drop policy if exists "Orders select" on public.orders;
create policy "Orders select"
  on public.orders for select
  using (
    auth.uid() = user_id
    or public.is_admin()
    or (public.is_courier() and assigned_courier_id = auth.uid())
  );

-- Explicitly no DELETE policies (default deny under RLS)

-- ---------------------------------------------------------------------------
-- 4) Safe CHECK constraints (compatible with existing data patterns)
-- ---------------------------------------------------------------------------
alter table public.orders
  drop constraint if exists orders_collected_amount_nonnegative;

alter table public.orders
  add constraint orders_collected_amount_nonnegative
  check (collected_amount >= 0);

-- status / payment_method / parcel_count / amount_to_collect already constrained
-- in prior migrations / schema.sql — do not re-add destructively.

-- ---------------------------------------------------------------------------
-- 5) Legacy courier_update_order: never trust client collected_amount
--    Prefer courier_complete_order / courier_change_order_status / cancel.
-- ---------------------------------------------------------------------------
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
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'courier' then
    raise exception 'Only couriers can call courier_update_order';
  end if;

  if p_status is null or p_status not in ('accepted', 'picked_up', 'in_transit', 'delivered') then
    raise exception 'Invalid courier status';
  end if;

  if p_status = 'delivered' then
    if p_payment_method is null or p_payment_method not in ('cash', 'card') then
      raise exception 'Payment method required (cash or card)';
    end if;
  elsif p_payment_method is not null and p_payment_method not in ('cash', 'card') then
    raise exception 'Invalid payment method';
  end if;

  -- p_collected_amount is IGNORED (kept in signature for API compatibility).
  -- Delivered amount is always derived from amount_to_collect.
  perform set_config('app.orders_write_source', 'courier_rpc', true);

  update public.orders o
  set
    status = p_status,
    payment_method = case
      when p_status = 'delivered' then p_payment_method
      else null
    end,
    collected_amount = case
      when p_status = 'delivered' then round(o.amount_to_collect, 2)
      else 0
    end,
    delivered_at = case
      when p_status = 'delivered' then coalesce(o.delivered_at, now())
      else null
    end,
    cancelled_at = null,
    updated_at = now()
  where o.id = p_order_id
    and o.assigned_courier_id = v_uid
    and o.status in ('accepted', 'picked_up', 'in_transit', 'delivered')
  returning * into v_order;

  if v_order.id is null then
    raise exception 'Order not found or not assigned to this courier';
  end if;

  return v_order;
end;
$$;

revoke all on function public.courier_update_order(bigint, text, text, numeric) from public;
grant execute on function public.courier_update_order(bigint, text, text, numeric) to authenticated;

-- Harden reorder: require auth.uid()
create or replace function public.courier_reorder_orders(order_ids bigint[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_count integer;
  v_expected integer;
  v_id bigint;
  v_idx integer := 0;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'courier' then
    raise exception 'Only couriers can reorder orders';
  end if;

  if order_ids is null then
    raise exception 'order_ids required';
  end if;

  v_expected := coalesce(array_length(order_ids, 1), 0);
  if v_expected = 0 then
    return;
  end if;

  if (
    select count(distinct x)
    from unnest(order_ids) as t(x)
  ) is distinct from v_expected then
    raise exception 'Duplicate order ids in reorder list';
  end if;

  select count(*)::integer into v_count
  from public.orders o
  where o.id = any (order_ids)
    and o.assigned_courier_id = v_uid
    and o.status in ('accepted', 'picked_up', 'in_transit');

  if v_count is distinct from v_expected then
    raise exception 'Invalid reorder: every order must be assigned to you and active';
  end if;

  perform set_config('app.orders_write_source', 'courier_rpc', true);

  foreach v_id in array order_ids loop
    v_idx := v_idx + 1;
    update public.orders
    set
      courier_sort_order = v_idx * 10,
      updated_at = now()
    where id = v_id
      and assigned_courier_id = v_uid
      and status in ('accepted', 'picked_up', 'in_transit');
  end loop;
end;
$$;

revoke all on function public.courier_reorder_orders(bigint[]) from public;
grant execute on function public.courier_reorder_orders(bigint[]) to authenticated;

-- Ensure complete/cancel/change remain authenticated-only.
-- Column guard allows these via is_courier() + assigned_courier_id = auth.uid()
-- (SECURITY DEFINER bypasses RLS; triggers still run with caller uid).
revoke all on function public.courier_complete_order(bigint, text) from public;
grant execute on function public.courier_complete_order(bigint, text) to authenticated;

revoke all on function public.courier_cancel_order(bigint) from public;
grant execute on function public.courier_cancel_order(bigint) to authenticated;

revoke all on function public.courier_change_order_status(bigint, text, text) from public;
grant execute on function public.courier_change_order_status(bigint, text, text) to authenticated;

revoke all on function public.admin_assign_courier(bigint, uuid) from public;
grant execute on function public.admin_assign_courier(bigint, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) courier_order_events: deny client writes; SELECT only via RLS
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.courier_order_events') is not null then
    execute 'revoke all on table public.courier_order_events from anon';
    execute 'revoke all on table public.courier_order_events from authenticated';
    execute 'grant select on table public.courier_order_events to authenticated';

    -- Keep SELECT policy; ensure no write policies exist
    execute 'drop policy if exists "Courier order events insert" on public.courier_order_events';
    execute 'drop policy if exists "Courier order events update" on public.courier_order_events';
    execute 'drop policy if exists "Courier order events delete" on public.courier_order_events';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7) Table grants: least privilege for anon / authenticated
-- ---------------------------------------------------------------------------
-- anon: no data access
revoke all on table public.profiles from anon;
revoke all on table public.orders from anon;

-- authenticated: needed ops only (RLS still applies)
revoke all on table public.profiles from authenticated;
grant select, insert, update on table public.profiles to authenticated;

revoke all on table public.orders from authenticated;
grant select, insert, update on table public.orders to authenticated;
-- UPDATE grant + RLS "Orders update": owners only while pending; admins always.
-- Allowlist trigger: owners may change only customer fields; future cols locked.
-- Couriers have no UPDATE RLS policy (RPC-only writes).
-- DELETE intentionally not granted.

-- Sequences (order id generation on insert)
do $$
declare
  seq_name text;
begin
  select pg_get_serial_sequence('public.orders', 'id') into seq_name;
  if seq_name is not null then
    execute format('grant usage, select on sequence %s to authenticated', seq_name);
    execute format('revoke all on sequence %s from anon', seq_name);
  end if;
end $$;

-- Delivery-date trigger: fix search_path
create or replace function public.enforce_delivery_date_not_today_or_past()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.delivery_date is null or new.delivery_date <= (timezone('Asia/Tbilisi', now()))::date then
      raise exception 'delivery_date must be tomorrow or later';
    end if;
  elsif tg_op = 'UPDATE' and new.delivery_date is distinct from old.delivery_date then
    if new.delivery_date is null or new.delivery_date <= (timezone('Asia/Tbilisi', now()))::date then
      raise exception 'delivery_date must be tomorrow or later';
    end if;
  end if;
  return new;
end;
$$;

-- Trigger helpers must not be callable by clients
revoke all on function public.handle_new_user() from public;
revoke all on function public.protect_profile_role() from public;

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'enqueue_courier_order_event'
  ) then
    execute 'revoke all on function public.enqueue_courier_order_event() from public';
  end if;

  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'orders_courier_lifecycle_hooks'
  ) then
    execute 'revoke all on function public.orders_courier_lifecycle_hooks() from public';
  end if;
end $$;

notify pgrst, 'reload schema';
