-- =============================================================================
-- Order status: insert `office` between pickup completion and delivery start.
--
-- Flow:
--   pending → (pickup complete) → office → (delivery "აღებულია") → picked_up → delivered
--
-- Pickup cancel: orders stay pending.
-- Admin delivery assign: status unchanged (office stays office).
-- Existing statuses preserved. Idempotent / safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Expand orders.status CHECK (keep all existing values)
-- ---------------------------------------------------------------------------
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders
  add constraint orders_status_check
  check (status in ('pending', 'office', 'picked_up', 'delivered', 'cancelled'));

-- Audit table CHECKs (new_status + old_status)
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
      and t.relname = 'order_status_audit'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%new_status%'
  loop
    execute format('alter table public.order_status_audit drop constraint %I', r.conname);
  end loop;

  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'order_status_audit'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%old_status%'
  loop
    execute format('alter table public.order_status_audit drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.order_status_audit
  add constraint order_status_audit_new_status_check
  check (new_status in ('pending', 'office', 'picked_up', 'delivered', 'cancelled'));

alter table public.order_status_audit
  add constraint order_status_audit_old_status_check
  check (
    old_status is null
    or old_status in ('pending', 'office', 'picked_up', 'delivered', 'cancelled', 'accepted', 'in_transit')
  );

-- ---------------------------------------------------------------------------
-- 2) protect_order_column_security — pickup path: pending → office
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

  -- Pickup completion RPC: linked assigned pickup task + pending → office
  if public.is_courier()
     and v_write_source = 'courier_pickup_rpc'
     and old.status = 'pending'
     and new.status = 'office'
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
-- 3) courier_complete_pickup — linked orders: pending → office
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
    status = 'office',
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
    'order_status', 'office',
    'completed_at', now()
  );
end;
$$;

revoke all on function public.courier_complete_pickup(bigint) from public;
grant execute on function public.courier_complete_pickup(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Lifecycle: include office in courier active sort queue
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

  if new.status in ('pending', 'office', 'picked_up')
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
      and o.status in ('pending', 'office', 'picked_up')
      and (tg_op = 'INSERT' or o.id is distinct from new.id);

    new.courier_sort_order := v_next;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) courier_cancel_order — allow cancel from office
-- ---------------------------------------------------------------------------
create or replace function public.courier_cancel_order(
  p_order_id bigint,
  p_cancellation_reason text
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
  v_reason text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'courier' then
    raise exception 'Only couriers can call courier_cancel_order';
  end if;

  v_reason := nullif(btrim(coalesce(p_cancellation_reason, '')), '');
  if v_reason is null then
    raise exception 'Cancellation reason is required';
  end if;

  perform set_config('app.orders_write_source', 'courier_rpc', true);

  update public.orders o
  set
    status = 'cancelled',
    cancellation_reason = v_reason,
    cancelled_at = now(),
    delivered_at = null,
    payment_method = null,
    collected_amount = 0,
    updated_at = now()
  where o.id = p_order_id
    and o.assigned_courier_id = v_uid
    and o.status in ('pending', 'office', 'picked_up')
  returning * into v_order;

  if not found then
    raise exception 'Order not found or not assigned to this courier';
  end if;

  return v_order;
end;
$$;

revoke all on function public.courier_cancel_order(bigint, text) from public;
grant execute on function public.courier_cancel_order(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) courier_complete_order — delivery complete from picked_up (not office)
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
  v_payment text;
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

  v_payment := p_payment_method;
  perform set_config('app.orders_write_source', 'courier_rpc', true);

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
-- 7) Admin dashboard — include office count (picked_up remains active)
-- ---------------------------------------------------------------------------
create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_total bigint;
  v_pending bigint;
  v_office bigint;
  v_picked_up bigint;
  v_delivered bigint;
  v_cancelled bigint;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'admin' then
    raise exception 'Only admins can call admin_dashboard_stats';
  end if;

  select
    count(*),
    count(*) filter (where o.status = 'pending'),
    count(*) filter (where o.status = 'office'),
    count(*) filter (where o.status = 'picked_up'),
    count(*) filter (where o.status = 'delivered'),
    count(*) filter (where o.status = 'cancelled')
  into
    v_total,
    v_pending,
    v_office,
    v_picked_up,
    v_delivered,
    v_cancelled
  from public.orders o;

  return jsonb_build_object(
    'total', coalesce(v_total, 0)::int,
    'pending', coalesce(v_pending, 0)::int,
    'office', coalesce(v_office, 0)::int,
    'picked_up', coalesce(v_picked_up, 0)::int,
    'delivered', coalesce(v_delivered, 0)::int,
    'cancelled', coalesce(v_cancelled, 0)::int
  );
end;
$$;

revoke all on function public.admin_dashboard_stats() from public;
grant execute on function public.admin_dashboard_stats() to authenticated;

-- ---------------------------------------------------------------------------
-- 7b) admin_assign_courier — unassign keeps office (does not force pending)
--     DROP required: RETURNS public.orders tracks table row type changes.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_assign_courier(bigint, uuid);

create function public.admin_assign_courier(
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
    -- Assign: keep current status (pending/office stay as-is).
    -- Unassign: office stays office; otherwise return to pending waiting pool.
    status = case
      when p_courier_id is null and o.status = 'office' then 'office'
      when p_courier_id is null then 'pending'
      else o.status
    end,
    updated_at = now()
  where o.id = p_order_id
  returning * into v_order;

  if not found then
    raise exception 'Order not found';
  end if;

  return v_order;
end;
$$;

revoke all on function public.admin_assign_courier(bigint, uuid) from public;
grant execute on function public.admin_assign_courier(bigint, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8) Planning RPCs — support office status group
-- ---------------------------------------------------------------------------
-- 1) Planning breakdown: ONE customer profile pickup location (not per-order)
-- ---------------------------------------------------------------------------
create or replace function public.admin_order_planning_breakdown(
  p_status_group text default 'pending',
  p_group_by text default 'customer',
  p_delivery_date date default null,
  p_delivered_date_from date default null,
  p_delivered_date_to date default null,
  p_pickup_city text default null,
  p_delivery_city text default null,
  p_courier_id text default null,
  p_customer_type text default 'all',
  p_customer_user_id uuid default null,
  p_payment_method text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_group text := lower(coalesce(nullif(trim(p_group_by), ''), 'customer'));
  v_status text := lower(coalesce(nullif(trim(p_status_group), ''), 'pending'));
  v_pickup text := nullif(trim(p_pickup_city), '');
  v_delivery text := nullif(trim(p_delivery_city), '');
  v_customer_type text := lower(coalesce(nullif(trim(p_customer_type), ''), 'all'));
  v_payment text := nullif(trim(p_payment_method), '');
  v_courier_raw text := nullif(trim(p_courier_id), '');
  v_courier_uuid uuid;
  v_unassigned boolean := false;
  v_total int := 0;
  v_groups jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'admin' then
    raise exception 'Only admins can call admin_order_planning_breakdown';
  end if;

  if v_group = 'pickup_location' then
    v_group := 'customer';
  end if;

  if v_group not in ('customer', 'pickup_city') then
    raise exception 'Invalid group_by';
  end if;

  if v_status not in ('pending', 'office', 'active', 'delivered', 'cancelled', 'all') then
    raise exception 'Invalid status group';
  end if;

  if v_customer_type not in ('all', 'company', 'individual') then
    raise exception 'Invalid customer type';
  end if;

  if v_payment is not null and v_payment not in ('cash', 'card') then
    raise exception 'Invalid payment method';
  end if;

  if p_delivered_date_from is not null
     and p_delivered_date_to is not null
     and p_delivered_date_from > p_delivered_date_to then
    raise exception 'Invalid date range';
  end if;

  if v_courier_raw is not null then
    if v_courier_raw = 'unassigned' then
      v_unassigned := true;
    else
      begin
        v_courier_uuid := v_courier_raw::uuid;
      exception
        when invalid_text_representation then
          raise exception 'Invalid courier id';
      end;
    end if;
  end if;

  create temporary table tmp_admin_plan_base (
    id bigint,
    user_id uuid,
    sender_name text,
    sender_phone text,
    pickup_city text,
    pickup_district text,
    pickup_address text,
    parcel_count int,
    amount_to_collect numeric,
    owner_name text,
    owner_phone text,
    owner_default_city text,
    owner_default_district text,
    owner_default_address text,
    is_company boolean
  ) on commit drop;

  insert into tmp_admin_plan_base (
    id, user_id, sender_name, sender_phone, pickup_city, pickup_district, pickup_address,
    parcel_count, amount_to_collect, owner_name, owner_phone,
    owner_default_city, owner_default_district, owner_default_address, is_company
  )
  select
    o.id,
    o.user_id,
    o.sender_name,
    o.sender_phone,
    o.pickup_city,
    o.pickup_district,
    o.pickup_address,
    o.parcel_count,
    o.amount_to_collect,
    p.full_name,
    p.phone,
    p.default_city,
    p.default_district,
    p.default_address,
    public.admin_is_company_customer(o.sender_name, p.full_name)
  from public.orders o
  left join public.profiles p on p.id = o.user_id
  where
    case v_status
      when 'pending' then o.status = 'pending'
      when 'office' then o.status = 'office'
      when 'active' then o.status in ('picked_up', 'accepted', 'in_transit')
      when 'delivered' then o.status = 'delivered'
      when 'cancelled' then o.status = 'cancelled'
      else true
    end
    and (
      v_status = 'delivered'
      or p_delivery_date is null
      or o.delivery_date = p_delivery_date
    )
    and (
      v_status is distinct from 'delivered'
      or (
        (p_delivered_date_from is null or o.delivery_date >= p_delivered_date_from)
        and (p_delivered_date_to is null or o.delivery_date <= p_delivered_date_to)
      )
    )
    and (v_pickup is null or o.pickup_city = v_pickup)
    and (v_delivery is null or o.delivery_city = v_delivery)
    and (
      v_courier_raw is null
      or (v_unassigned and o.assigned_courier_id is null)
      or (not v_unassigned and o.assigned_courier_id = v_courier_uuid)
    )
    and (p_customer_user_id is null or o.user_id = p_customer_user_id)
    and (v_payment is null or o.payment_method = v_payment)
    and (
      v_customer_type = 'all'
      or (v_customer_type = 'company' and public.admin_is_company_customer(o.sender_name, p.full_name))
      or (v_customer_type = 'individual' and not public.admin_is_company_customer(o.sender_name, p.full_name))
    );

  select count(*)::int into v_total from tmp_admin_plan_base;

  if v_group = 'customer' then
    select coalesce(
      jsonb_agg(row_data order by (row_data->>'order_count')::int desc, row_data->>'label'),
      '[]'::jsonb
    )
    into v_groups
    from (
      select jsonb_build_object(
        'key', coalesce(b.user_id::text, 'unknown'),
        'label', coalesce(
          nullif(trim(both from max(b.owner_name)), ''),
          nullif(trim(both from mode() within group (order by b.sender_name)), ''),
          'â€”'
        ),
        'order_count', count(*)::int,
        'user_id', b.user_id,
        'is_company', bool_or(b.is_company),
        'phone', coalesce(
          nullif(trim(both from max(b.owner_phone)), ''),
          nullif(trim(both from mode() within group (order by nullif(trim(both from b.sender_phone), ''))), ''),
          null
        ),
        'parcel_count', coalesce(sum(b.parcel_count), 0)::int,
        'total_amount', coalesce(sum(b.amount_to_collect), 0),
        -- One registered customer pickup point (profile defaults)
        'location_count', case
          when nullif(trim(both from max(b.owner_default_city)), '') is not null
            or nullif(trim(both from max(b.owner_default_district)), '') is not null
            or nullif(trim(both from max(b.owner_default_address)), '') is not null
          then 1
          else 0
        end,
        'cities', case
          when nullif(trim(both from max(b.owner_default_city)), '') is not null then
            jsonb_build_array(nullif(trim(both from max(b.owner_default_city)), ''))
          else '[]'::jsonb
        end,
        'pickup_locations', case
          when nullif(trim(both from max(b.owner_default_city)), '') is not null
            or nullif(trim(both from max(b.owner_default_district)), '') is not null
            or nullif(trim(both from max(b.owner_default_address)), '') is not null
          then jsonb_build_array(
            jsonb_build_object(
              'key', lower(concat_ws('|',
                coalesce(nullif(trim(both from max(b.owner_default_city)), ''), ''),
                coalesce(nullif(trim(both from max(b.owner_default_district)), ''), ''),
                coalesce(nullif(trim(both from max(b.owner_default_address)), ''), '')
              )),
              'label', concat_ws(', ',
                nullif(trim(both from max(b.owner_default_city)), ''),
                nullif(trim(both from max(b.owner_default_district)), ''),
                nullif(trim(both from max(b.owner_default_address)), '')
              ),
              'city', nullif(trim(both from max(b.owner_default_city)), ''),
              'district', nullif(trim(both from max(b.owner_default_district)), ''),
              'address', nullif(trim(both from max(b.owner_default_address)), ''),
              'order_count', count(*)::int,
              'parcel_count', coalesce(sum(b.parcel_count), 0)::int,
              'total_amount', coalesce(sum(b.amount_to_collect), 0)
            )
          )
          else '[]'::jsonb
        end
      ) as row_data
      from tmp_admin_plan_base b
      group by b.user_id
    ) s;

  else
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'key', c.city_key,
          'label', c.city_key,
          'order_count', c.order_count,
          'pickup_city', nullif(c.city_key, 'â€”'),
          'children', c.children
        )
        order by c.city_key
      ),
      '[]'::jsonb
    )
    into v_groups
    from (
      select
        cust.city_key,
        sum(cust.order_count)::int as order_count,
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'key', coalesce(cust.user_id::text, 'unknown'),
              'label', cust.label,
              'order_count', cust.order_count,
              'user_id', cust.user_id,
              'is_company', cust.is_company
            )
            order by cust.order_count desc, cust.label
          ),
          '[]'::jsonb
        ) as children
      from (
        select
          coalesce(
            nullif(trim(both from max(b.owner_default_city)), ''),
            nullif(trim(both from mode() within group (order by b.pickup_city)), ''),
            'â€”'
          ) as city_key,
          b.user_id,
          coalesce(
            nullif(trim(both from max(b.owner_name)), ''),
            nullif(trim(both from mode() within group (order by b.sender_name)), ''),
            'â€”'
          ) as label,
          count(*)::int as order_count,
          bool_or(b.is_company) as is_company
        from tmp_admin_plan_base b
        group by b.user_id
      ) cust
      group by cust.city_key
    ) c;
  end if;

  return jsonb_build_object(
    'total', v_total,
    'groups', coalesce(v_groups, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_order_planning_breakdown(
  text, text, date, date, date, text, text, text, text, uuid, text
) from public;
grant execute on function public.admin_order_planning_breakdown(
  text, text, date, date, date, text, text, text, text, uuid, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) admin_assign_pickup: reassign OR create one task + one profile location
-- ---------------------------------------------------------------------------
create or replace function public.admin_assign_pickup(
  p_customer_user_id uuid,
  p_courier_id uuid,
  p_status_group text default 'pending',
  p_delivery_date date default null,
  p_pickup_city text default null,
  p_delivery_city text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_courier_role text;
  v_status text := lower(coalesce(nullif(trim(p_status_group), ''), 'pending'));
  v_pickup text := nullif(trim(p_pickup_city), '');
  v_delivery text := nullif(trim(p_delivery_city), '');
  v_customer_name text;
  v_phone text;
  v_default_city text;
  v_default_district text;
  v_default_address text;
  v_task_id bigint;
  v_order_ids bigint[];
  v_order_count int;
  v_parcel_count int;
  v_existing_order_count int;
  v_anchor_order_id bigint;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'admin' then
    raise exception 'Only admins can call admin_assign_pickup';
  end if;

  if p_customer_user_id is null then
    raise exception 'Customer is required';
  end if;

  if p_courier_id is null then
    raise exception 'Courier is required';
  end if;

  select role into v_courier_role from public.profiles where id = p_courier_id;
  if v_courier_role is distinct from 'courier' then
    raise exception 'Invalid courier';
  end if;

  -- Customer's registered pickup point (profile defaults â€” not order addresses)
  select
    nullif(trim(both from coalesce(full_name, '')), ''),
    nullif(trim(both from coalesce(phone, '')), ''),
    nullif(trim(both from coalesce(default_city, '')), ''),
    nullif(trim(both from coalesce(default_district, '')), ''),
    nullif(trim(both from coalesce(default_address, '')), '')
  into
    v_customer_name,
    v_phone,
    v_default_city,
    v_default_district,
    v_default_address
  from public.profiles
  where id = p_customer_user_id;

  if not found then
    raise exception 'Customer not found';
  end if;

  -- Active pickup task for this customer â†’ reassign courier only
  select pt.id
  into v_task_id
  from public.pickup_tasks pt
  where pt.customer_id = p_customer_user_id
    and pt.status = 'assigned'
  order by pt.id desc
  limit 1;

  if v_task_id is not null then
    -- Lock the chosen row, then update courier (same task id, same linked orders)
    perform 1 from public.pickup_tasks where id = v_task_id for update;

    update public.pickup_tasks
    set
      assigned_courier_id = p_courier_id,
      updated_at = now()
    where id = v_task_id;

    select count(*)::int
    into v_existing_order_count
    from public.pickup_task_orders
    where pickup_task_id = v_task_id;

    select pto.order_id
    into v_anchor_order_id
    from public.pickup_task_orders pto
    where pto.pickup_task_id = v_task_id
    order by pto.order_id
    limit 1;

    if v_anchor_order_id is not null then
      insert into public.courier_order_events (courier_id, order_id, event_type)
      values (p_courier_id, v_anchor_order_id, 'pickup_assign');
    end if;

    return jsonb_build_object(
      'tasks_created', 0,
      'tasks_updated', 1,
      'locations_created', 0,
      'orders_linked', coalesce(v_existing_order_count, 0),
      'updated', coalesce(v_existing_order_count, 0),
      'pickup_task_id', v_task_id,
      'courier_id', p_courier_id,
      'customer_user_id', p_customer_user_id
    );
  end if;

  -- No active task â†’ create one task + link matching pending orders + ONE location
  create temporary table tmp_pickup_orders (
    id bigint primary key,
    parcel_count int
  ) on commit drop;

  insert into tmp_pickup_orders (id, parcel_count)
  select
    o.id,
    o.parcel_count
  from public.orders o
  where o.user_id = p_customer_user_id
    and case v_status
      when 'pending' then o.status = 'pending'
      when 'office' then o.status = 'office'
      when 'active' then o.status in ('picked_up', 'accepted', 'in_transit')
      when 'delivered' then o.status = 'delivered'
      when 'cancelled' then o.status = 'cancelled'
      else true
    end
    and (p_delivery_date is null or o.delivery_date = p_delivery_date)
    and (v_pickup is null or o.pickup_city = v_pickup)
    and (v_delivery is null or o.delivery_city = v_delivery)
    and not exists (
      select 1
      from public.pickup_task_orders pto
      join public.pickup_tasks pt on pt.id = pto.pickup_task_id
      where pto.order_id = o.id
        and pt.status = 'assigned'
    );

  select
    array_agg(t.id order by t.id),
    count(*)::int,
    coalesce(sum(t.parcel_count), 0)::int
  into
    v_order_ids,
    v_order_count,
    v_parcel_count
  from tmp_pickup_orders t;

  if v_order_ids is null or cardinality(v_order_ids) = 0 then
    raise exception 'No matching pending orders for pickup assignment';
  end if;

  if v_default_city is null
     and v_default_district is null
     and v_default_address is null then
    raise exception
      'Customer has no registered pickup address (set profiles.default_city / default_district / default_address)';
  end if;

  insert into public.pickup_tasks (
    customer_id,
    assigned_courier_id,
    status,
    order_count,
    parcel_count,
    customer_name,
    pickup_phone,
    pickup_city,
    pickup_district,
    pickup_address,
    location_key
  ) values (
    p_customer_user_id,
    p_courier_id,
    'assigned',
    v_order_count,
    v_parcel_count,
    coalesce(v_customer_name, 'â€”'),
    v_phone,
    v_default_city,
    v_default_district,
    v_default_address,
    lower(concat_ws('|',
      coalesce(v_default_city, ''),
      coalesce(v_default_district, ''),
      coalesce(v_default_address, '')
    ))
  )
  returning id into v_task_id;

  insert into public.pickup_task_orders (pickup_task_id, order_id)
  select v_task_id, unnest(v_order_ids);

  -- Exactly ONE location = customer's registered pickup point
  insert into public.pickup_task_locations (
    pickup_task_id,
    city,
    district,
    address,
    parcel_count
  ) values (
    v_task_id,
    v_default_city,
    v_default_district,
    v_default_address,
    v_parcel_count
  );

  insert into public.courier_order_events (courier_id, order_id, event_type)
  values (p_courier_id, v_order_ids[1], 'pickup_assign');

  return jsonb_build_object(
    'tasks_created', 1,
    'tasks_updated', 0,
    'locations_created', 1,
    'orders_linked', v_order_count,
    'updated', v_order_count,
    'pickup_task_id', v_task_id,
    'courier_id', p_courier_id,
    'customer_user_id', p_customer_user_id
  );
end;
$$;

revoke all on function public.admin_assign_pickup(
  uuid, uuid, text, date, text, text
) from public;
grant execute on function public.admin_assign_pickup(
  uuid, uuid, text, date, text, text
) to authenticated;

notify pgrst, 'reload schema';
