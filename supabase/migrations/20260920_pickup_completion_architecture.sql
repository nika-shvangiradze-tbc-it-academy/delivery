-- =============================================================================
-- Pickup completion architecture
-- Paste into Supabase SQL Editor. Idempotent / safe to re-run.
--
-- - pickup_tasks.status: assigned | picked_up | cancelled
-- - courier_complete_pickup SECURITY DEFINER RPC (no courier UPDATE on orders)
-- - protect_order_column_security allows only verified pickup-complete path
-- - Does NOT change delivery assignment (orders.assigned_courier_id)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0) Status constraint: completed → picked_up
-- ---------------------------------------------------------------------------
do $$
declare
  c_name text;
begin
  select con.conname into c_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'pickup_tasks'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%status%';

  if c_name is not null then
    execute format('alter table public.pickup_tasks drop constraint %I', c_name);
  end if;
end $$;

update public.pickup_tasks
set
  status = 'picked_up',
  completed_at = coalesce(completed_at, updated_at, now()),
  updated_at = now()
where status = 'completed';

alter table public.pickup_tasks
  add constraint pickup_tasks_status_check
  check (status in ('assigned', 'picked_up', 'cancelled'));

-- ---------------------------------------------------------------------------
-- 1) Courier event trigger: picked_up = pickup_complete
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_pickup_task_courier_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id bigint;
begin
  select pto.order_id
  into v_order_id
  from public.pickup_task_orders pto
  where pto.pickup_task_id = new.id
  order by pto.order_id
  limit 1;

  if v_order_id is not null and new.assigned_courier_id is not null then
    insert into public.courier_order_events (courier_id, order_id, event_type)
    values (
      new.assigned_courier_id,
      v_order_id,
      case
        when new.status in ('picked_up', 'completed') then 'pickup_complete'
        else 'pickup_assign'
      end
    );
  end if;

  delete from public.courier_order_events
  where created_at < now() - interval '2 days';

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Column protect: allow pickup RPC pending → picked_up only
--    Couriers still have NO direct UPDATE policy on orders.
-- ---------------------------------------------------------------------------
create or replace function public.protect_order_column_security()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
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
  v_write_source text := nullif(current_setting('app.orders_write_source', true), '');
begin
  if public.is_admin() or auth.uid() is null then
    return new;
  end if;

  -- Delivery courier RPCs (assigned delivery courier on the order)
  if public.is_courier()
     and old.assigned_courier_id is not distinct from auth.uid() then
    if new.id is distinct from old.id
       or new.user_id is distinct from old.user_id then
      raise exception 'Couriers cannot change order identity fields';
    end if;
    return new;
  end if;

  -- Pickup completion RPC only: linked assigned pickup task + pending → picked_up
  if public.is_courier()
     and v_write_source = 'courier_pickup_rpc'
     and old.status = 'pending'
     and new.status = 'picked_up'
     and exists (
       select 1
       from public.pickup_task_orders pto
       join public.pickup_tasks pt on pt.id = pto.pickup_task_id
       where pto.order_id = old.id
         and pt.assigned_courier_id = auth.uid()
         and pt.status = 'assigned'
     ) then
    if new.id is distinct from old.id
       or new.user_id is distinct from old.user_id
       or new.assigned_courier_id is distinct from old.assigned_courier_id then
      raise exception 'Pickup completion cannot change order identity or delivery courier';
    end if;
    return new;
  end if;

  if auth.uid() is not distinct from old.user_id then
    if old.status is distinct from 'pending' then
      raise exception 'Order can only be edited while pending';
    end if;

    if (to_jsonb(new) - v_user_editable)
       is distinct from
       (to_jsonb(old) - v_user_editable) then
      raise exception 'Users may only edit customer order fields';
    end if;

    new.updated_at := now();
    return new;
  end if;

  raise exception 'Not allowed to update this order';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) courier_complete_pickup — SECURITY DEFINER, no client order UPDATE
-- ---------------------------------------------------------------------------
create or replace function public.courier_complete_pickup(
  p_pickup_task_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_task public.pickup_tasks%rowtype;
  v_updated int := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'courier' then
    raise exception 'Only couriers can call courier_complete_pickup';
  end if;

  if p_pickup_task_id is null then
    raise exception 'Pickup task is required';
  end if;

  select * into v_task
  from public.pickup_tasks
  where id = p_pickup_task_id
  for update;

  if not found then
    raise exception 'Pickup task not found';
  end if;

  if v_task.assigned_courier_id is distinct from v_uid then
    raise exception 'Not your pickup task';
  end if;

  if v_task.status is distinct from 'assigned' then
    raise exception 'Pickup task is not active';
  end if;

  -- Narrow allowlist for protect_order_column_security (pickup path only)
  perform set_config('app.orders_write_source', 'courier_pickup_rpc', true);

  -- Linked pending orders → picked_up (does NOT set assigned_courier_id)
  update public.orders o
  set
    status = 'picked_up',
    updated_at = now()
  where o.id in (
      select pto.order_id
      from public.pickup_task_orders pto
      where pto.pickup_task_id = p_pickup_task_id
    )
    and o.status = 'pending';

  get diagnostics v_updated = row_count;

  update public.pickup_tasks
  set
    status = 'picked_up',
    completed_at = coalesce(completed_at, now()),
    updated_at = now()
  where id = p_pickup_task_id;

  return jsonb_build_object(
    'updated', v_updated,
    'pickup_task_id', p_pickup_task_id,
    'status', 'picked_up'
  );
end;
$$;

revoke all on function public.courier_complete_pickup(bigint) from public;
grant execute on function public.courier_complete_pickup(bigint) to authenticated;

-- Ensure no direct courier UPDATE policy on orders (defense in depth)
drop policy if exists "Orders update by courier" on public.orders;
drop policy if exists "Couriers update assigned orders" on public.orders;
drop policy if exists "Courier update orders" on public.orders;
