-- =============================================================================
-- Admin pickup dispatch via pickup_tasks (separate from delivery orders)
-- Paste into Supabase SQL Editor. Idempotent / safe to re-run.
--
-- Adds:
--   - pickup_tasks + pickup_task_orders (links existing orders; no duplicates)
--   - pickup_task_locations (multiple addresses under one customer task)
--   - enriched admin_order_planning_breakdown (customer + pickup_city)
--   - admin_assign_pickup / courier_complete_pickup RPCs
--   - RLS + realtime for pickup_tasks
--
-- One customer → one pickup_task → many pickup_task_locations.
-- Does NOT create fake delivery orders. Does NOT change delivery assignment flow.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0) Drop legacy per-order pickup columns if a prior draft added them
-- ---------------------------------------------------------------------------
alter table public.orders drop column if exists pickup_courier_id;
alter table public.orders drop column if exists pickup_assigned_at;
alter table public.orders drop column if exists pickup_completed_at;

-- Restore Orders SELECT / column protect / realtime triggers (delivery-only)
drop policy if exists "Orders select" on public.orders;
create policy "Orders select"
  on public.orders for select
  using (
    auth.uid() = user_id
    or public.is_admin()
    or (public.is_courier() and assigned_courier_id = auth.uid())
  );

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

create or replace function public.enqueue_courier_order_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.assigned_courier_id is not null then
      insert into public.courier_order_events (courier_id, order_id, event_type)
      values (old.assigned_courier_id, old.id, 'delete');
    end if;
    delete from public.courier_order_events
    where created_at < now() - interval '2 days';
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.assigned_courier_id is not null then
      insert into public.courier_order_events (courier_id, order_id, event_type)
      values (new.assigned_courier_id, new.id, 'insert');
    end if;
    return new;
  end if;

  if old.assigned_courier_id is not null then
    insert into public.courier_order_events (courier_id, order_id, event_type)
    values (old.assigned_courier_id, old.id, 'update');
  end if;

  if new.assigned_courier_id is not null
     and new.assigned_courier_id is distinct from old.assigned_courier_id then
    insert into public.courier_order_events (courier_id, order_id, event_type)
    values (new.assigned_courier_id, new.id, 'assign');
  end if;

  delete from public.courier_order_events
  where created_at < now() - interval '2 days';

  return new;
end;
$$;

drop trigger if exists orders_enqueue_courier_order_event_update on public.orders;
create trigger orders_enqueue_courier_order_event_update
  after update of
    assigned_courier_id,
    status,
    payment_method,
    collected_amount,
    delivered_at,
    cancelled_at
  on public.orders
  for each row
  execute function public.enqueue_courier_order_event();

-- ---------------------------------------------------------------------------
-- 1) pickup_tasks + junction to existing orders
-- ---------------------------------------------------------------------------
create table if not exists public.pickup_tasks (
  id bigint generated always as identity primary key,
  customer_id uuid not null references public.profiles (id) on delete restrict,
  assigned_courier_id uuid not null references public.profiles (id) on delete restrict,
  status text not null default 'assigned'
    check (status in ('assigned', 'completed', 'cancelled')),
  order_count int not null default 0 check (order_count >= 0),
  parcel_count int not null default 0 check (parcel_count >= 0),
  customer_name text,
  pickup_phone text,
  pickup_city text,
  pickup_district text,
  pickup_address text,
  location_key text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pickup_tasks_courier_status_idx
  on public.pickup_tasks (assigned_courier_id, status);

create index if not exists pickup_tasks_customer_status_idx
  on public.pickup_tasks (customer_id, status);

create table if not exists public.pickup_task_orders (
  pickup_task_id bigint not null references public.pickup_tasks (id) on delete cascade,
  order_id bigint not null references public.orders (id) on delete cascade,
  primary key (pickup_task_id, order_id)
);

drop index if exists public.pickup_task_orders_active_order_uidx;

create index if not exists pickup_task_orders_order_idx
  on public.pickup_task_orders (order_id);

-- Multiple pickup addresses under one customer pickup task
create table if not exists public.pickup_task_locations (
  id bigint generated always as identity primary key,
  pickup_task_id bigint not null references public.pickup_tasks (id) on delete cascade,
  city text,
  district text,
  address text,
  parcel_count int not null default 0 check (parcel_count >= 0),
  created_at timestamptz not null default now()
);

create index if not exists pickup_task_locations_task_idx
  on public.pickup_task_locations (pickup_task_id);

create index if not exists orders_status_user_id_idx
  on public.orders (status, user_id);

create index if not exists orders_status_pickup_city_idx
  on public.orders (status, pickup_city);

alter table public.pickup_tasks enable row level security;
alter table public.pickup_task_orders enable row level security;
alter table public.pickup_task_locations enable row level security;

drop policy if exists "Pickup tasks select" on public.pickup_tasks;
create policy "Pickup tasks select"
  on public.pickup_tasks for select
  using (
    public.is_admin()
    or (public.is_courier() and assigned_courier_id = auth.uid())
  );

drop policy if exists "Pickup task orders select" on public.pickup_task_orders;
create policy "Pickup task orders select"
  on public.pickup_task_orders for select
  using (
    public.is_admin()
    or exists (
      select 1
      from public.pickup_tasks t
      where t.id = pickup_task_id
        and t.assigned_courier_id = auth.uid()
        and public.is_courier()
    )
  );

drop policy if exists "Pickup task locations select" on public.pickup_task_locations;
create policy "Pickup task locations select"
  on public.pickup_task_locations for select
  using (
    public.is_admin()
    or exists (
      select 1
      from public.pickup_tasks t
      where t.id = pickup_task_id
        and t.assigned_courier_id = auth.uid()
        and public.is_courier()
    )
  );

grant select on public.pickup_tasks to authenticated;
grant select on public.pickup_task_orders to authenticated;
grant select on public.pickup_task_locations to authenticated;

-- Realtime for courier panel
alter table public.pickup_tasks replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pickup_tasks'
  ) then
    execute 'alter publication supabase_realtime add table public.pickup_tasks';
  end if;
end $$;

-- Ping courier when pickup task status/assignment changes (after links exist)
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
        when new.status = 'completed' then 'pickup_complete'
        else 'pickup_assign'
      end
    );
  end if;

  delete from public.courier_order_events
  where created_at < now() - interval '2 days';

  return new;
end;
$$;

drop trigger if exists pickup_tasks_enqueue_courier_event on public.pickup_tasks;
create trigger pickup_tasks_enqueue_courier_event
  after update of assigned_courier_id, status on public.pickup_tasks
  for each row
  execute function public.enqueue_pickup_task_courier_event();

-- Company helper (from prior planning migration)
create or replace function public.admin_is_company_customer(
  p_sender_name text,
  p_owner_name text
)
returns boolean
language sql
immutable
as $$
  select
    coalesce(p_sender_name, '') ~* '(შპს|სს\.|(^|[[:space:]])სს([[:space:]]|$)|ი/მ|ი\.მ\.|LLC|LTD|Limited|კომპანია|Company|Corp\.?)'
    or coalesce(p_owner_name, '') ~* '(შპს|სს\.|(^|[[:space:]])სს([[:space:]]|$)|ი/მ|ი\.მ\.|LLC|LTD|Limited|კომპანია|Company|Corp\.?)'
    or (
      nullif(trim(both from coalesce(p_sender_name, '')), '') is not null
      and nullif(trim(both from coalesce(p_owner_name, '')), '') is not null
      and lower(trim(both from p_sender_name)) is distinct from lower(trim(both from p_owner_name))
    );
$$;

-- ---------------------------------------------------------------------------
-- 2) Enriched planning breakdown (customer | pickup_city)
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

  if v_status not in ('pending', 'active', 'delivered', 'cancelled', 'all') then
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
    is_company boolean
  ) on commit drop;

  insert into tmp_admin_plan_base (
    id, user_id, sender_name, sender_phone, pickup_city, pickup_district, pickup_address,
    parcel_count, amount_to_collect, owner_name, owner_phone, is_company
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
    public.admin_is_company_customer(o.sender_name, p.full_name)
  from public.orders o
  left join public.profiles p on p.id = o.user_id
  where
    case v_status
      when 'pending' then o.status = 'pending'
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
          nullif(trim(both from mode() within group (order by b.sender_name)), ''),
          nullif(trim(both from max(b.owner_name)), ''),
          '—'
        ),
        'order_count', count(*)::int,
        'user_id', b.user_id,
        'is_company', bool_or(b.is_company),
        'phone', coalesce(
          nullif(trim(both from mode() within group (order by nullif(trim(both from b.sender_phone), ''))), ''),
          nullif(trim(both from max(b.owner_phone)), ''),
          null
        ),
        'parcel_count', coalesce(sum(b.parcel_count), 0)::int,
        'total_amount', coalesce(sum(b.amount_to_collect), 0),
        'location_count', (
          select count(*)::int
          from (
            select 1
            from tmp_admin_plan_base l
            where l.user_id is not distinct from b.user_id
            group by
              lower(coalesce(trim(both from l.pickup_city), '')),
              lower(coalesce(trim(both from l.pickup_district), '')),
              lower(coalesce(trim(both from l.pickup_address), ''))
          ) locs
        ),
        'cities', coalesce(
          (
            select jsonb_agg(city order by city)
            from (
              select distinct nullif(trim(both from c.pickup_city), '') as city
              from tmp_admin_plan_base c
              where c.user_id is not distinct from b.user_id
                and nullif(trim(both from c.pickup_city), '') is not null
            ) cities
          ),
          '[]'::jsonb
        ),
        'pickup_locations', coalesce(
          (
            select jsonb_agg(loc order by (loc->>'order_count')::int desc, loc->>'label')
            from (
              select jsonb_build_object(
                'key', concat_ws('|',
                  lower(coalesce(trim(both from l.pickup_city), '')),
                  lower(coalesce(trim(both from l.pickup_district), '')),
                  lower(coalesce(trim(both from l.pickup_address), ''))
                ),
                'label', concat_ws(', ',
                  nullif(trim(both from l.pickup_city), ''),
                  nullif(trim(both from l.pickup_district), ''),
                  nullif(trim(both from l.pickup_address), '')
                ),
                'city', nullif(trim(both from l.pickup_city), ''),
                'district', nullif(trim(both from l.pickup_district), ''),
                'address', nullif(trim(both from l.pickup_address), ''),
                'order_count', count(*)::int,
                'parcel_count', coalesce(sum(l.parcel_count), 0)::int,
                'total_amount', coalesce(sum(l.amount_to_collect), 0)
              ) as loc
              from tmp_admin_plan_base l
              where l.user_id is not distinct from b.user_id
              group by
                lower(coalesce(trim(both from l.pickup_city), '')),
                lower(coalesce(trim(both from l.pickup_district), '')),
                lower(coalesce(trim(both from l.pickup_address), '')),
                nullif(trim(both from l.pickup_city), ''),
                nullif(trim(both from l.pickup_district), ''),
                nullif(trim(both from l.pickup_address), '')
            ) locs
          ),
          '[]'::jsonb
        )
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
          'pickup_city', nullif(c.city_key, '—'),
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
          coalesce(nullif(trim(both from b.pickup_city), ''), '—') as city_key,
          b.user_id,
          coalesce(
            nullif(trim(both from mode() within group (order by b.sender_name)), ''),
            nullif(trim(both from max(b.owner_name)), ''),
            '—'
          ) as label,
          count(*)::int as order_count,
          bool_or(b.is_company) as is_company
        from tmp_admin_plan_base b
        group by 1, b.user_id
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
-- 3) Admin creates ONE Pickup Task per customer + pickup_task_locations rows
-- ---------------------------------------------------------------------------
drop function if exists public.admin_assign_pickup(uuid, text[], uuid, text, date, text, text);
drop function if exists public.admin_assign_pickup(uuid, uuid, text, date, text, text);

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
  v_task_id bigint;
  v_order_ids bigint[];
  v_order_count int;
  v_parcel_count int;
  v_locations_created int := 0;
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

  create temporary table tmp_pickup_orders (
    id bigint primary key,
    sender_name text,
    sender_phone text,
    owner_phone text,
    pickup_city text,
    pickup_district text,
    pickup_address text,
    parcel_count int
  ) on commit drop;

  insert into tmp_pickup_orders (
    id, sender_name, sender_phone, owner_phone,
    pickup_city, pickup_district, pickup_address, parcel_count
  )
  select
    o.id,
    o.sender_name,
    o.sender_phone,
    p.phone,
    o.pickup_city,
    o.pickup_district,
    o.pickup_address,
    o.parcel_count
  from public.orders o
  left join public.profiles p on p.id = o.user_id
  where o.user_id = p_customer_user_id
    and case v_status
      when 'pending' then o.status = 'pending'
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
    coalesce(sum(t.parcel_count), 0)::int,
    nullif(trim(both from mode() within group (order by t.sender_name)), ''),
    coalesce(
      nullif(trim(both from mode() within group (order by nullif(trim(both from t.sender_phone), ''))), ''),
      nullif(trim(both from max(t.owner_phone)), '')
    )
  into
    v_order_ids,
    v_order_count,
    v_parcel_count,
    v_customer_name,
    v_phone
  from tmp_pickup_orders t;

  if v_order_ids is null or cardinality(v_order_ids) = 0 then
    raise exception 'No matching pending orders (or already on an active pickup task)';
  end if;

  -- One task per customer; address details live in pickup_task_locations
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
    coalesce(v_customer_name, '—'),
    v_phone,
    null,
    null,
    null,
    null
  )
  returning id into v_task_id;

  insert into public.pickup_task_orders (pickup_task_id, order_id)
  select v_task_id, unnest(v_order_ids);

  insert into public.pickup_task_locations (
    pickup_task_id,
    city,
    district,
    address,
    parcel_count
  )
  select
    v_task_id,
    nullif(trim(both from t.pickup_city), ''),
    nullif(trim(both from t.pickup_district), ''),
    nullif(trim(both from t.pickup_address), ''),
    coalesce(sum(t.parcel_count), 0)::int
  from tmp_pickup_orders t
  group by
    lower(coalesce(trim(both from t.pickup_city), '')),
    lower(coalesce(trim(both from t.pickup_district), '')),
    lower(coalesce(trim(both from t.pickup_address), '')),
    nullif(trim(both from t.pickup_city), ''),
    nullif(trim(both from t.pickup_district), ''),
    nullif(trim(both from t.pickup_address), '');

  get diagnostics v_locations_created = row_count;

  insert into public.courier_order_events (courier_id, order_id, event_type)
  values (p_courier_id, v_order_ids[1], 'pickup_assign');

  return jsonb_build_object(
    'tasks_created', 1,
    'locations_created', v_locations_created,
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

-- ---------------------------------------------------------------------------
-- 4) Courier completes a Pickup Task → linked orders pending → picked_up
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

  update public.orders o
  set
    status = case
      when o.status = 'pending' then 'picked_up'
      else o.status
    end,
    updated_at = now()
  where o.id in (
      select pto.order_id
      from public.pickup_task_orders pto
      where pto.pickup_task_id = p_pickup_task_id
    )
    and o.status in ('pending', 'picked_up', 'accepted', 'in_transit');

  get diagnostics v_updated = row_count;

  update public.pickup_tasks
  set
    status = 'completed',
    completed_at = coalesce(completed_at, now()),
    updated_at = now()
  where id = p_pickup_task_id;

  return jsonb_build_object(
    'updated', v_updated,
    'pickup_task_id', p_pickup_task_id
  );
end;
$$;

-- Drop old bigint[] overload if present from prior draft
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'courier_complete_pickup'
      and pg_get_function_identity_arguments(p.oid) = 'bigint[]'
  ) then
    execute 'drop function public.courier_complete_pickup(bigint[])';
  end if;
end $$;

revoke all on function public.courier_complete_pickup(bigint) from public;
grant execute on function public.courier_complete_pickup(bigint) to authenticated;
