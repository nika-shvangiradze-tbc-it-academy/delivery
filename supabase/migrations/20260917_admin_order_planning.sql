-- =============================================================================
-- Admin order planning breakdown (dispatcher aggregates)
-- Paste into Supabase SQL Editor. Idempotent / safe to re-run.
--
-- SECURITY:
-- - SECURITY DEFINER with fixed search_path = public
-- - Requires auth.uid()
-- - Verifies profiles.role = 'admin' (never trusts client role claims)
-- - Returns ONLY aggregated buckets / id pages (never full order row payloads
--   beyond ids needed for a second narrow select)
--
-- Does not change order write paths, RLS policies, or Realtime.
-- =============================================================================

create index if not exists orders_status_user_id_idx
  on public.orders (status, user_id);

create index if not exists orders_status_pickup_city_idx
  on public.orders (status, pickup_city);

-- ---------------------------------------------------------------------------
-- Shared company heuristic (sender markers OR sender ≠ account owner name)
-- ---------------------------------------------------------------------------
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

revoke all on function public.admin_is_company_customer(text, text) from public;
grant execute on function public.admin_is_company_customer(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_order_planning_breakdown — aggregated buckets for dispatcher UI
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

  if v_group not in ('customer', 'pickup_city', 'pickup_location') then
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
    pickup_city text,
    pickup_district text,
    pickup_address text,
    owner_name text,
    is_company boolean
  ) on commit drop;

  insert into tmp_admin_plan_base (
    id, user_id, sender_name, pickup_city, pickup_district, pickup_address, owner_name, is_company
  )
  select
    o.id,
    o.user_id,
    o.sender_name,
    o.pickup_city,
    o.pickup_district,
    o.pickup_address,
    p.full_name,
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
        'is_company', bool_or(b.is_company)
      ) as row_data
      from tmp_admin_plan_base b
      group by b.user_id
    ) s;

  elsif v_group = 'pickup_city' then
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

  else
    select coalesce(
      jsonb_agg(row_data order by (row_data->>'order_count')::int desc, row_data->>'label'),
      '[]'::jsonb
    )
    into v_groups
    from (
      select jsonb_build_object(
        'key', loc.loc_key,
        'label', coalesce(nullif(loc.loc_label, ''), '—'),
        'order_count', count(*)::int,
        'pickup_city', nullif(trim(both from max(b.pickup_city)), '')
      ) as row_data
      from tmp_admin_plan_base b
      cross join lateral (
        select
          concat_ws(
            ' · ',
            nullif(trim(both from b.pickup_city), ''),
            nullif(trim(both from b.pickup_district), ''),
            nullif(trim(both from b.pickup_address), '')
          ) as loc_label,
          concat_ws(
            '|',
            lower(coalesce(trim(both from b.pickup_city), '')),
            lower(coalesce(trim(both from b.pickup_district), '')),
            lower(coalesce(trim(both from b.pickup_address), ''))
          ) as loc_key
      ) loc
      group by loc.loc_key, loc.loc_label
    ) s;
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
-- admin_orders_ids_for_customer_type — page of ids when company/individual filter
-- ---------------------------------------------------------------------------
create or replace function public.admin_orders_ids_for_customer_type(
  p_status_group text default 'pending',
  p_customer_type text default 'company',
  p_delivery_date date default null,
  p_delivered_date_from date default null,
  p_delivered_date_to date default null,
  p_pickup_city text default null,
  p_delivery_city text default null,
  p_courier_id text default null,
  p_customer_user_id uuid default null,
  p_payment_method text default null,
  p_search text default null,
  p_page int default 1,
  p_page_size int default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_status text := lower(coalesce(nullif(trim(p_status_group), ''), 'pending'));
  v_customer_type text := lower(coalesce(nullif(trim(p_customer_type), ''), 'company'));
  v_pickup text := nullif(trim(p_pickup_city), '');
  v_delivery text := nullif(trim(p_delivery_city), '');
  v_payment text := nullif(trim(p_payment_method), '');
  v_courier_raw text := nullif(trim(p_courier_id), '');
  v_courier_uuid uuid;
  v_unassigned boolean := false;
  v_search text := nullif(trim(p_search), '');
  v_page int := greatest(coalesce(p_page, 1), 1);
  v_size int := least(greatest(coalesce(p_page_size, 50), 1), 100);
  v_offset int;
  v_total int := 0;
  v_ids bigint[];
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'admin' then
    raise exception 'Only admins can call admin_orders_ids_for_customer_type';
  end if;

  if v_customer_type not in ('company', 'individual') then
    raise exception 'Invalid customer type';
  end if;

  if v_status not in ('pending', 'active', 'delivered', 'cancelled', 'all') then
    raise exception 'Invalid status group';
  end if;

  if v_payment is not null and v_payment not in ('cash', 'card') then
    raise exception 'Invalid payment method';
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

  v_offset := (v_page - 1) * v_size;

  create temporary table tmp_admin_type_ids (
    id bigint primary key,
    created_at timestamptz not null
  ) on commit drop;

  insert into tmp_admin_type_ids (id, created_at)
  select o.id, o.created_at
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
      (v_customer_type = 'company' and public.admin_is_company_customer(o.sender_name, p.full_name))
      or (v_customer_type = 'individual' and not public.admin_is_company_customer(o.sender_name, p.full_name))
    )
    and (
      v_search is null
      or (
        (v_search ~ '^[0-9]+$' and o.id = v_search::bigint)
        or o.recipient_name ilike '%' || v_search || '%'
        or o.recipient_phone ilike '%' || v_search || '%'
        or o.sender_name ilike '%' || v_search || '%'
        or o.sender_phone ilike '%' || v_search || '%'
        or coalesce(p.full_name, '') ilike '%' || v_search || '%'
      )
    );

  select count(*)::int into v_total from tmp_admin_type_ids;

  select coalesce(array_agg(id order by created_at desc, id desc), '{}'::bigint[])
  into v_ids
  from (
    select id, created_at
    from tmp_admin_type_ids
    order by created_at desc, id desc
    offset v_offset
    limit v_size
  ) page;

  return jsonb_build_object(
    'total', v_total,
    'ids', to_jsonb(coalesce(v_ids, '{}'::bigint[]))
  );
end;
$$;

revoke all on function public.admin_orders_ids_for_customer_type(
  text, text, date, date, date, text, text, text, uuid, text, text, int, int
) from public;
grant execute on function public.admin_orders_ids_for_customer_type(
  text, text, date, date, date, text, text, text, uuid, text, text, int, int
) to authenticated;
