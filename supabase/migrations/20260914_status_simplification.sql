-- =============================================================================
-- Status simplification: pending | picked_up | delivered | cancelled
--
-- DO NOT auto-apply — paste into Supabase SQL Editor after review.
-- Idempotent / safe to re-run.
--
-- 1) Maps legacy statuses:
--      accepted   → picked_up
--      in_transit → picked_up
-- 2) Replaces orders.status CHECK constraint
-- 3) Updates courier RPCs + lifecycle trigger + admin_assign_courier
-- 4) Preserves all existing order rows and assigned_courier_id
-- 5) Keeps owner edit rule: users may update own orders only while pending
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Data migration (must run BEFORE constraint swap)
-- ---------------------------------------------------------------------------
update public.orders
set
  status = 'picked_up',
  updated_at = now()
where status in ('accepted', 'in_transit');

-- ---------------------------------------------------------------------------
-- 2) Replace CHECK constraint
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'orders'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%status%'
  loop
    execute format('alter table public.orders drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.orders
  add constraint orders_status_check
  check (status in ('pending', 'picked_up', 'delivered', 'cancelled'));

-- ---------------------------------------------------------------------------
-- 3) Lifecycle trigger — active queue = assigned pending | picked_up
-- ---------------------------------------------------------------------------
create or replace function public.orders_courier_lifecycle_hooks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  if new.status = 'cancelled' then
    if tg_op = 'INSERT' or old.status is distinct from 'cancelled' then
      new.cancelled_at := coalesce(new.cancelled_at, now());
    end if;
  else
    new.cancelled_at := null;
  end if;

  if new.status = 'delivered' then
    if tg_op = 'INSERT' or old.status is distinct from 'delivered' then
      new.delivered_at := coalesce(new.delivered_at, now());
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'delivered' and new.status is distinct from 'delivered' then
    new.delivered_at := null;
  end if;

  if new.assigned_courier_id is null then
    new.courier_sort_order := null;
    return new;
  end if;

  -- Assign to end of courier active list on new assignment or missing sort.
  -- Pending stays pending when assigned; sort still applies.
  if new.status in ('pending', 'picked_up')
     and (
       tg_op = 'INSERT'
       or old.assigned_courier_id is distinct from new.assigned_courier_id
       or new.courier_sort_order is null
     )
  then
    select coalesce(max(o.courier_sort_order), 0) + 10
      into v_next
    from public.orders o
    where o.assigned_courier_id = new.assigned_courier_id
      and o.status in ('pending', 'picked_up')
      and (tg_op = 'INSERT' or o.id is distinct from new.id);

    new.courier_sort_order := v_next;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) admin_assign_courier — keep pending on assign (no hidden status)
-- ---------------------------------------------------------------------------
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
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select role into v_role from public.profiles where id = auth.uid();
  if v_role is distinct from 'admin' then
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

  perform set_config('app.orders_write_source', 'admin_rpc', true);

  update public.orders o
  set
    assigned_courier_id = p_courier_id,
    -- Assign: keep current status (typically pending).
    -- Unassign: return to pending waiting pool.
    status = case
      when p_courier_id is null then 'pending'
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

-- ---------------------------------------------------------------------------
-- 5) courier_complete_order — from pending | picked_up
-- ---------------------------------------------------------------------------
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

  select role into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'courier' then
    raise exception 'Only couriers can call courier_complete_order';
  end if;

  if p_payment_method is null or p_payment_method not in ('cash', 'card') then
    raise exception 'Payment method required (cash or card)';
  end if;

  perform set_config('app.orders_write_source', 'courier_rpc', true);

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
    and o.status in ('pending', 'picked_up')
  returning * into v_order;

  if not found then
    raise exception 'Order not found or not assigned to this courier';
  end if;

  return v_order;
end;
$$;

revoke all on function public.courier_complete_order(bigint, text) from public;
grant execute on function public.courier_complete_order(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) courier_cancel_order — from pending | picked_up
-- ---------------------------------------------------------------------------
create or replace function public.courier_cancel_order(p_order_id bigint)
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
    raise exception 'Only couriers can call courier_cancel_order';
  end if;

  perform set_config('app.orders_write_source', 'courier_rpc', true);

  update public.orders o
  set
    status = 'cancelled',
    cancelled_at = now(),
    delivered_at = null,
    updated_at = now()
  where o.id = p_order_id
    and o.assigned_courier_id = v_uid
    and o.status in ('pending', 'picked_up')
  returning * into v_order;

  if not found then
    raise exception 'Order not found or not assigned to this courier';
  end if;

  return v_order;
end;
$$;

revoke all on function public.courier_cancel_order(bigint) from public;
grant execute on function public.courier_cancel_order(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 7) courier_change_order_status — 4 statuses only
-- ---------------------------------------------------------------------------
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

  select role into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'courier' then
    raise exception 'Only couriers can call courier_change_order_status';
  end if;

  if p_status is null
     or p_status not in ('pending', 'picked_up', 'delivered', 'cancelled') then
    raise exception 'Invalid courier status';
  end if;

  if p_payment_method is not null and p_payment_method not in ('cash', 'card') then
    raise exception 'Invalid payment method';
  end if;

  perform set_config('app.orders_write_source', 'courier_rpc', true);

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
    -- pending | picked_up → back to Active
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

-- ---------------------------------------------------------------------------
-- 8) courier_update_order (legacy) — aligned with 4 statuses
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

  if p_status is null or p_status not in ('pending', 'picked_up', 'delivered') then
    raise exception 'Invalid courier status';
  end if;

  if p_status = 'delivered' then
    if p_payment_method is null or p_payment_method not in ('cash', 'card') then
      raise exception 'Payment method required (cash or card)';
    end if;
  elsif p_payment_method is not null and p_payment_method not in ('cash', 'card') then
    raise exception 'Invalid payment method';
  end if;

  -- p_collected_amount is IGNORED (API compatibility).
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
    and o.status in ('pending', 'picked_up', 'delivered')
  returning * into v_order;

  if v_order.id is null then
    raise exception 'Order not found or not assigned to this courier';
  end if;

  return v_order;
end;
$$;

revoke all on function public.courier_update_order(bigint, text, text, numeric) from public;
grant execute on function public.courier_update_order(bigint, text, text, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 9) courier_reorder_orders — pending | picked_up
-- ---------------------------------------------------------------------------
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
    and o.status in ('pending', 'picked_up');

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
      and status in ('pending', 'picked_up');
  end loop;
end;
$$;

revoke all on function public.courier_reorder_orders(bigint[]) from public;
grant execute on function public.courier_reorder_orders(bigint[]) to authenticated;

-- Optional: reload PostgREST schema cache
notify pgrst, 'reload schema';
