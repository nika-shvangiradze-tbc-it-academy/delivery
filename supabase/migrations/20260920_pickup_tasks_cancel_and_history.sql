-- =============================================================================
-- Pickup tasks: cancel + history + admin list
-- File: 20260920_pickup_tasks_cancel_and_history.sql
-- Paste into Supabase SQL Editor. Idempotent / safe to re-run.
--
-- Adds:
--   - pickup_tasks.cancelled_at, cancellation_reason
--   - status: assigned | picked_up | completed | cancelled
--   - courier_complete_pickup (security definer)
--   - courier_cancel_pickup (security definer) — task only; orders stay pending
--   - admin_get_pickup_tasks
--
-- Does NOT modify orders.assigned_courier_id or delivery assignment.
-- Does NOT grant couriers direct UPDATE on orders / pickup_tasks.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0) Columns
-- ---------------------------------------------------------------------------
alter table public.pickup_tasks
  add column if not exists cancelled_at timestamptz;

alter table public.pickup_tasks
  add column if not exists cancellation_reason text;

-- ---------------------------------------------------------------------------
-- 1) Status constraint — only recreate if needed
-- ---------------------------------------------------------------------------
do $$
declare
  c_name text;
  c_def text;
  needs_replace boolean := true;
begin
  select con.conname, pg_get_constraintdef(con.oid)
  into c_name, c_def
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'pickup_tasks'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%status%'
  limit 1;

  if c_def is not null
     and c_def ilike '%assigned%'
     and c_def ilike '%picked_up%'
     and c_def ilike '%completed%'
     and c_def ilike '%cancelled%' then
    needs_replace := false;
  end if;

  if needs_replace then
    if c_name is not null then
      execute format('alter table public.pickup_tasks drop constraint %I', c_name);
    end if;

    -- Preserve existing rows; do not rewrite statuses.
    alter table public.pickup_tasks
      add constraint pickup_tasks_status_check
      check (status in ('assigned', 'picked_up', 'completed', 'cancelled'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Courier event trigger (complete / cancel / assign)
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_pickup_task_courier_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id bigint;
  v_event text;
begin
  select pto.order_id
  into v_order_id
  from public.pickup_task_orders pto
  where pto.pickup_task_id = new.id
  order by pto.order_id
  limit 1;

  if v_order_id is not null and new.assigned_courier_id is not null then
    v_event := case
      when new.status in ('picked_up', 'completed') then 'pickup_complete'
      when new.status = 'cancelled' then 'pickup_cancel'
      else 'pickup_assign'
    end;

    insert into public.courier_order_events (courier_id, order_id, event_type)
    values (new.assigned_courier_id, v_order_id, v_event);
  end if;

  delete from public.courier_order_events
  where created_at < now() - interval '2 days';

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Column protect — pickup complete path only (no courier UPDATE policy)
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

  if public.is_courier()
     and old.assigned_courier_id is not distinct from auth.uid() then
    if new.id is distinct from old.id
       or new.user_id is distinct from old.user_id then
      raise exception 'Couriers cannot change order identity fields';
    end if;
    return new;
  end if;

  -- Pickup completion RPC: linked assigned pickup task + pending → picked_up
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
-- 4) courier_complete_pickup
--    Keep parameter name p_pickup_task_id (existing frontend).
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

  perform set_config('app.orders_write_source', 'courier_pickup_rpc', true);

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
    'success', true,
    'updated', v_updated,
    'pickup_task_id', p_pickup_task_id,
    'status', 'picked_up',
    'completed_at', now()
  );
end;
$$;

revoke all on function public.courier_complete_pickup(bigint) from public;
grant execute on function public.courier_complete_pickup(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) courier_cancel_pickup — task only; orders remain pending
-- ---------------------------------------------------------------------------
create or replace function public.courier_cancel_pickup(
  p_task_id bigint,
  p_reason text
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
  v_reason text := nullif(trim(both from coalesce(p_reason, '')), '');
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'courier' then
    raise exception 'Only couriers can call courier_cancel_pickup';
  end if;

  if p_task_id is null then
    raise exception 'Pickup task is required';
  end if;

  if v_reason is null then
    raise exception 'Cancellation reason is required';
  end if;

  if char_length(v_reason) > 500 then
    raise exception 'Cancellation reason is too long (max 500)';
  end if;

  select * into v_task
  from public.pickup_tasks
  where id = p_task_id
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

  -- Do NOT touch orders.status / assigned_courier_id / pickup_task_orders
  update public.pickup_tasks
  set
    status = 'cancelled',
    cancelled_at = now(),
    cancellation_reason = v_reason,
    updated_at = now()
  where id = p_task_id;

  return jsonb_build_object(
    'success', true,
    'pickup_task_id', p_task_id,
    'status', 'cancelled',
    'cancellation_reason', v_reason
  );
end;
$$;

revoke all on function public.courier_cancel_pickup(bigint, text) from public;
grant execute on function public.courier_cancel_pickup(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) admin_get_pickup_tasks — all statuses, one location, newest first
-- ---------------------------------------------------------------------------
create or replace function public.admin_get_pickup_tasks(
  p_status text default 'all'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_status text := lower(coalesce(nullif(trim(p_status), ''), 'all'));
  v_tasks jsonb := '[]'::jsonb;
  v_counts jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'admin' then
    raise exception 'Only admins can call admin_get_pickup_tasks';
  end if;

  if v_status not in ('all', 'assigned', 'picked_up', 'completed', 'cancelled') then
    raise exception 'Invalid pickup task status filter';
  end if;

  select jsonb_build_object(
    'assigned', count(*) filter (where pt.status = 'assigned'),
    'picked_up', count(*) filter (where pt.status = 'picked_up'),
    'completed', count(*) filter (where pt.status = 'completed'),
    'cancelled', count(*) filter (where pt.status = 'cancelled')
  )
  into v_counts
  from public.pickup_tasks pt;

  select coalesce(
    jsonb_agg(row_data order by (row_data->>'created_at') desc, (row_data->>'id')::bigint desc),
    '[]'::jsonb
  )
  into v_tasks
  from (
    select jsonb_build_object(
      'id', pt.id,
      'customer_id', pt.customer_id,
      'customer_name', pt.customer_name,
      'pickup_phone', pt.pickup_phone,
      'assigned_courier_id', pt.assigned_courier_id,
      'courier_name', cp.full_name,
      'status', pt.status,
      'order_count', pt.order_count,
      'parcel_count', pt.parcel_count,
      'pickup_city', coalesce(loc.city, pt.pickup_city),
      'pickup_district', coalesce(loc.district, pt.pickup_district),
      'pickup_address', coalesce(loc.address, pt.pickup_address),
      'completed_at', pt.completed_at,
      'cancelled_at', pt.cancelled_at,
      'cancellation_reason', pt.cancellation_reason,
      'created_at', pt.created_at,
      'updated_at', pt.updated_at,
      'locations', case
        when loc.id is not null then jsonb_build_array(
          jsonb_build_object(
            'id', loc.id,
            'pickup_task_id', loc.pickup_task_id,
            'city', loc.city,
            'district', loc.district,
            'address', loc.address,
            'parcel_count', loc.parcel_count,
            'created_at', loc.created_at
          )
        )
        when coalesce(pt.pickup_city, pt.pickup_district, pt.pickup_address) is not null then
          jsonb_build_array(
            jsonb_build_object(
              'id', 0,
              'pickup_task_id', pt.id,
              'city', pt.pickup_city,
              'district', pt.pickup_district,
              'address', pt.pickup_address,
              'parcel_count', pt.parcel_count,
              'created_at', pt.created_at
            )
          )
        else '[]'::jsonb
      end
    ) as row_data
    from public.pickup_tasks pt
    left join public.profiles cp on cp.id = pt.assigned_courier_id
    left join lateral (
      select l.*
      from public.pickup_task_locations l
      where l.pickup_task_id = pt.id
      order by l.id
      limit 1
    ) loc on true
    where v_status = 'all' or pt.status = v_status
  ) s;

  return jsonb_build_object(
    'tasks', coalesce(v_tasks, '[]'::jsonb),
    'counts', coalesce(
      v_counts,
      jsonb_build_object(
        'assigned', 0,
        'picked_up', 0,
        'completed', 0,
        'cancelled', 0
      )
    )
  );
end;
$$;

revoke all on function public.admin_get_pickup_tasks(text) from public;
grant execute on function public.admin_get_pickup_tasks(text) to authenticated;

-- Defense in depth: no direct courier UPDATE on orders / pickup_tasks
drop policy if exists "Orders update by courier" on public.orders;
drop policy if exists "Couriers update assigned orders" on public.orders;
drop policy if exists "Courier update orders" on public.orders;
drop policy if exists "Pickup tasks update" on public.pickup_tasks;
drop policy if exists "Pickup tasks update by courier" on public.pickup_tasks;
