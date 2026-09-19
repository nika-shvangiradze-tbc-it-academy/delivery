-- =============================================================================
-- One customer → one pickup_task → ONE pickup_task_locations row
-- Paste into Supabase SQL Editor. Idempotent / safe to re-run.
--
-- Changes:
--   - admin_assign_pickup: reassign existing active task OR create one task
--     with a single location from profiles.default_city/district/address
--   - admin_order_planning_breakdown: expose ONE customer profile pickup point
--   - Normalize existing active tasks that have many order-derived locations
--
-- Does NOT modify orders.assigned_courier_id or delivery assignment flow.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0) Normalize existing ACTIVE pickup tasks to ONE profile pickup location
--    Only when the customer profile has a registered default address.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_city text;
  v_district text;
  v_address text;
begin
  for r in
    select
      pt.id as task_id,
      pt.parcel_count,
      pt.customer_name,
      pt.pickup_phone,
      p.full_name,
      p.phone,
      p.default_city,
      p.default_district,
      p.default_address
    from public.pickup_tasks pt
    join public.profiles p on p.id = pt.customer_id
    where pt.status = 'assigned'
      and (
        nullif(trim(both from coalesce(p.default_city, '')), '') is not null
        or nullif(trim(both from coalesce(p.default_district, '')), '') is not null
        or nullif(trim(both from coalesce(p.default_address, '')), '') is not null
      )
  loop
    v_city := nullif(trim(both from coalesce(r.default_city, '')), '');
    v_district := nullif(trim(both from coalesce(r.default_district, '')), '');
    v_address := nullif(trim(both from coalesce(r.default_address, '')), '');

    delete from public.pickup_task_locations
    where pickup_task_id = r.task_id;

    insert into public.pickup_task_locations (
      pickup_task_id,
      city,
      district,
      address,
      parcel_count
    ) values (
      r.task_id,
      v_city,
      v_district,
      v_address,
      coalesce(r.parcel_count, 0)
    );

    update public.pickup_tasks
    set
      customer_name = coalesce(nullif(trim(both from coalesce(r.full_name, '')), ''), r.customer_name, '—'),
      pickup_phone = coalesce(nullif(trim(both from coalesce(r.phone, '')), ''), r.pickup_phone),
      pickup_city = v_city,
      pickup_district = v_district,
      pickup_address = v_address,
      location_key = lower(concat_ws('|',
        coalesce(v_city, ''),
        coalesce(v_district, ''),
        coalesce(v_address, '')
      )),
      updated_at = now()
    where id = r.task_id;
  end loop;
end $$;

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
          '—'
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
          coalesce(
            nullif(trim(both from max(b.owner_default_city)), ''),
            nullif(trim(both from mode() within group (order by b.pickup_city)), ''),
            '—'
          ) as city_key,
          b.user_id,
          coalesce(
            nullif(trim(both from max(b.owner_name)), ''),
            nullif(trim(both from mode() within group (order by b.sender_name)), ''),
            '—'
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

  -- Customer's registered pickup point (profile defaults — not order addresses)
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

  -- Active pickup task for this customer → reassign courier only
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

  -- No active task → create one task + link matching pending orders + ONE location
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
    coalesce(v_customer_name, '—'),
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
