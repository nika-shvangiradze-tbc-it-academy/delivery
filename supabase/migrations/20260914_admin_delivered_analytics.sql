-- =============================================================================
-- Admin delivered-order analytics RPC + supporting indexes
-- Paste into Supabase SQL Editor. Idempotent / safe to re-run.
--
-- DO NOT weaken RLS. SECURITY DEFINER is gated by auth.uid() + profiles.role.
-- Frontend role claims are never trusted.
--
-- Financial source: collected_amount (authoritative finalized amount set by
-- courier_complete_order / courier_change_order_status from amount_to_collect).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Indexes for delivered analytics / filtered pagination
-- (skips duplicates of existing admin/courier indexes)
-- ---------------------------------------------------------------------------

-- Delivered rollups & delivered_at date-range filters
create index if not exists orders_status_delivered_at_desc_idx
  on public.orders (status, delivered_at desc);

-- City breakdown / filter under a status tab
create index if not exists orders_status_delivery_city_idx
  on public.orders (status, delivery_city);

-- Payment method filter on delivered (and other tabs)
create index if not exists orders_status_payment_method_idx
  on public.orders (status, payment_method);

-- Stable Admin list ordering: created_at DESC, id DESC
create index if not exists orders_created_at_id_desc_idx
  on public.orders (created_at desc, id desc);

-- ---------------------------------------------------------------------------
-- admin_delivered_analytics — admin-only aggregation (no full row fetch)
-- ---------------------------------------------------------------------------
create or replace function public.admin_delivered_analytics(
  p_date_from date default null,
  p_date_to date default null,
  p_city text default null,
  p_courier_id text default null,
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
  v_city text := nullif(trim(p_city), '');
  v_payment text := nullif(trim(p_payment_method), '');
  v_courier_raw text := nullif(trim(p_courier_id), '');
  v_courier_uuid uuid;
  v_unassigned boolean := false;
  v_summary jsonb;
  v_by_city jsonb;
  v_by_courier jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'admin' then
    raise exception 'Only admins can call admin_delivered_analytics';
  end if;

  if v_payment is not null and v_payment not in ('cash', 'card') then
    raise exception 'Invalid payment method';
  end if;

  if p_date_from is not null
     and p_date_to is not null
     and p_date_from > p_date_to then
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

  -- Summary totals (status = delivered only)
  select jsonb_build_object(
    'order_count', count(*)::int,
    'parcel_count', coalesce(sum(o.parcel_count), 0)::bigint,
    'total_amount', coalesce(sum(o.collected_amount), 0),
    'cash_amount', coalesce(sum(o.collected_amount) filter (where o.payment_method = 'cash'), 0),
    'card_amount', coalesce(sum(o.collected_amount) filter (where o.payment_method = 'card'), 0)
  )
  into v_summary
  from public.orders o
  where o.status = 'delivered'
    and (
      p_date_from is null
      or o.delivered_at >= (p_date_from::timestamp at time zone 'Asia/Tbilisi')
    )
    and (
      p_date_to is null
      or o.delivered_at < ((p_date_to + 1)::timestamp at time zone 'Asia/Tbilisi')
    )
    and (v_city is null or o.delivery_city = v_city)
    and (
      v_courier_raw is null
      or (v_unassigned and o.assigned_courier_id is null)
      or (not v_unassigned and o.assigned_courier_id = v_courier_uuid)
    )
    and (v_payment is null or o.payment_method = v_payment);

  -- City breakdown (dynamic grouping — no hardcoded cities)
  select coalesce(jsonb_agg(row_data order by row_data->>'city'), '[]'::jsonb)
  into v_by_city
  from (
    select jsonb_build_object(
      'city', coalesce(nullif(trim(o.delivery_city), ''), '—'),
      'order_count', count(*)::int,
      'parcel_count', coalesce(sum(o.parcel_count), 0)::bigint,
      'total_amount', coalesce(sum(o.collected_amount), 0),
      'cash_amount', coalesce(sum(o.collected_amount) filter (where o.payment_method = 'cash'), 0),
      'card_amount', coalesce(sum(o.collected_amount) filter (where o.payment_method = 'card'), 0)
    ) as row_data
    from public.orders o
    where o.status = 'delivered'
      and (
        p_date_from is null
        or o.delivered_at >= (p_date_from::timestamp at time zone 'Asia/Tbilisi')
      )
      and (
        p_date_to is null
        or o.delivered_at < ((p_date_to + 1)::timestamp at time zone 'Asia/Tbilisi')
      )
      and (v_city is null or o.delivery_city = v_city)
      and (
        v_courier_raw is null
        or (v_unassigned and o.assigned_courier_id is null)
        or (not v_unassigned and o.assigned_courier_id = v_courier_uuid)
      )
      and (v_payment is null or o.payment_method = v_payment)
    group by coalesce(nullif(trim(o.delivery_city), ''), '—')
  ) city_rows;

  -- Courier breakdown (includes unassigned)
  select coalesce(jsonb_agg(row_data order by (row_data->>'order_count')::int desc), '[]'::jsonb)
  into v_by_courier
  from (
    select jsonb_build_object(
      'courier_id', o.assigned_courier_id,
      'full_name', coalesce(nullif(trim(p.full_name), ''), 'მიუნიჭებელი'),
      'order_count', count(*)::int,
      'parcel_count', coalesce(sum(o.parcel_count), 0)::bigint,
      'total_amount', coalesce(sum(o.collected_amount), 0),
      'cash_amount', coalesce(sum(o.collected_amount) filter (where o.payment_method = 'cash'), 0),
      'card_amount', coalesce(sum(o.collected_amount) filter (where o.payment_method = 'card'), 0)
    ) as row_data
    from public.orders o
    left join public.profiles p on p.id = o.assigned_courier_id
    where o.status = 'delivered'
      and (
        p_date_from is null
        or o.delivered_at >= (p_date_from::timestamp at time zone 'Asia/Tbilisi')
      )
      and (
        p_date_to is null
        or o.delivered_at < ((p_date_to + 1)::timestamp at time zone 'Asia/Tbilisi')
      )
      and (v_city is null or o.delivery_city = v_city)
      and (
        v_courier_raw is null
        or (v_unassigned and o.assigned_courier_id is null)
        or (not v_unassigned and o.assigned_courier_id = v_courier_uuid)
      )
      and (v_payment is null or o.payment_method = v_payment)
    group by o.assigned_courier_id, coalesce(nullif(trim(p.full_name), ''), 'მიუნიჭებელი')
  ) courier_rows;

  return jsonb_build_object(
    'summary', coalesce(v_summary, jsonb_build_object(
      'order_count', 0,
      'parcel_count', 0,
      'total_amount', 0,
      'cash_amount', 0,
      'card_amount', 0
    )),
    'by_city', coalesce(v_by_city, '[]'::jsonb),
    'by_courier', coalesce(v_by_courier, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_delivered_analytics(date, date, text, text, text) from public;
grant execute on function public.admin_delivered_analytics(date, date, text, text, text) to authenticated;
