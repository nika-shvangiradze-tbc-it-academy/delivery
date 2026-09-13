-- =============================================================================
-- Production migration: courier complete / cancel / change-status RPCs
-- Paste into Supabase SQL Editor (idempotent).
--
-- Canonical schema (from repo migrations):
--   orders.status ∈ pending|accepted|picked_up|in_transit|delivered|cancelled
--   orders.payment_method ∈ cash|card|null
--   orders.amount_to_collect numeric(12,2) NOT NULL > 0
--   orders.collected_amount numeric(12,2) NOT NULL default 0
--   orders.assigned_courier_id, delivered_at, cancelled_at, courier_sort_order
--   profiles.role ∈ user|admin|courier
--
-- Couriers have no direct UPDATE RLS on orders — these SECURITY DEFINER RPCs
-- are the write path. collected_amount is NEVER trusted from the client on
-- deliver; the DB copies amount_to_collect.
-- =============================================================================

-- Drop prior variants so CREATE is clean (identity args must match grants).
drop function if exists public.courier_complete_order(bigint, text);
drop function if exists public.courier_cancel_order(bigint);
drop function if exists public.courier_change_order_status(bigint, text);
drop function if exists public.courier_change_order_status(bigint, text, text);

-- -----------------------------------------------------------------------------
-- 1) courier_complete_order
-- -----------------------------------------------------------------------------
create or replace function public.courier_complete_order(
  p_order_id bigint,
  p_payment_method text
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

  select role into v_role
  from public.profiles
  where id = v_uid;

  if v_role is distinct from 'courier' then
    raise exception 'Only couriers can call courier_complete_order';
  end if;

  if p_payment_method is null or p_payment_method not in ('cash', 'card') then
    raise exception 'Payment method required (cash or card)';
  end if;

  update public.orders o
  set
    status = 'delivered',
    payment_method = p_payment_method,
    collected_amount = round(o.amount_to_collect, 2),
    delivered_at = now(),
    cancelled_at = null,
    updated_at = now()
  where o.id = p_order_id
    and o.assigned_courier_id = v_uid
    and o.status in ('accepted', 'picked_up', 'in_transit')
  returning * into v_order;

  if not found then
    raise exception 'Order not found or not assigned to this courier';
  end if;

  return v_order;
end;
$$;

revoke all on function public.courier_complete_order(bigint, text) from public;
grant execute on function public.courier_complete_order(bigint, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 2) courier_cancel_order
-- -----------------------------------------------------------------------------
create or replace function public.courier_cancel_order(
  p_order_id bigint
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

  select role into v_role
  from public.profiles
  where id = v_uid;

  if v_role is distinct from 'courier' then
    raise exception 'Only couriers can call courier_cancel_order';
  end if;

  update public.orders o
  set
    status = 'cancelled',
    cancelled_at = now(),
    delivered_at = null,
    updated_at = now()
  where o.id = p_order_id
    and o.assigned_courier_id = v_uid
    and o.status in ('accepted', 'picked_up', 'in_transit')
  returning * into v_order;

  if not found then
    raise exception 'Order not found or not assigned to this courier';
  end if;

  return v_order;
end;
$$;

revoke all on function public.courier_cancel_order(bigint) from public;
grant execute on function public.courier_cancel_order(bigint) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) courier_change_order_status (History correction)
--
-- Signature used by Angular:
--   p_order_id, p_status, optional p_payment_method
-- p_payment_method is required only when p_status = 'delivered'
-- (or existing row already has cash/card).
-- -----------------------------------------------------------------------------
create or replace function public.courier_change_order_status(
  p_order_id bigint,
  p_status text,
  p_payment_method text default null
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
  v_payment text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select role into v_role
  from public.profiles
  where id = v_uid;

  if v_role is distinct from 'courier' then
    raise exception 'Only couriers can call courier_change_order_status';
  end if;

  if p_status is null
     or p_status not in ('accepted', 'picked_up', 'in_transit', 'delivered', 'cancelled') then
    raise exception 'Invalid courier status';
  end if;

  if p_payment_method is not null and p_payment_method not in ('cash', 'card') then
    raise exception 'Invalid payment method';
  end if;

  -- Resolve payment for delivered; otherwise clear for active/cancelled.
  if p_status = 'delivered' then
    select
      case
        when p_payment_method in ('cash', 'card') then p_payment_method
        when o.payment_method in ('cash', 'card') then o.payment_method
        else null
      end
    into v_payment
    from public.orders o
    where o.id = p_order_id
      and o.assigned_courier_id = v_uid;

    if not found then
      raise exception 'Order not found or not assigned to this courier';
    end if;

    if v_payment is null then
      raise exception 'Payment method required (cash or card)';
    end if;

    update public.orders o
    set
      status = 'delivered',
      payment_method = v_payment,
      collected_amount = round(o.amount_to_collect, 2),
      delivered_at = now(),
      cancelled_at = null,
      updated_at = now()
    where o.id = p_order_id
      and o.assigned_courier_id = v_uid
    returning * into v_order;

  elsif p_status = 'cancelled' then
    update public.orders o
    set
      status = 'cancelled',
      payment_method = null,
      collected_amount = 0,
      cancelled_at = now(),
      delivered_at = null,
      updated_at = now()
    where o.id = p_order_id
      and o.assigned_courier_id = v_uid
    returning * into v_order;

  else
    -- accepted | picked_up | in_transit  → back to Active
    update public.orders o
    set
      status = p_status,
      payment_method = null,
      collected_amount = 0,
      delivered_at = null,
      cancelled_at = null,
      updated_at = now()
    where o.id = p_order_id
      and o.assigned_courier_id = v_uid
    returning * into v_order;
  end if;

  if not found then
    raise exception 'Order not found or not assigned to this courier';
  end if;

  return v_order;
end;
$$;

revoke all on function public.courier_change_order_status(bigint, text, text) from public;
grant execute on function public.courier_change_order_status(bigint, text, text) to authenticated;

-- Optional: notify PostgREST to reload schema cache (safe no-op if unavailable).
notify pgrst, 'reload schema';
