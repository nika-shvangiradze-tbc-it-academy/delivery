-- Atomic bulk order creation for authenticated customers (Excel import).
-- Mirrors manual OrdersService.createOrder + "Orders insert" RLS checks.
--
-- Effective orders columns used on customer create (schema.sql + migrations):
--   user_id, sender_name, sender_phone,
--   pickup_city, pickup_district, pickup_address,
--   recipient_name, recipient_phone,
--   delivery_city, delivery_district, delivery_address,
--   parcel_count, delivery_date, notes, is_fragile,
--   status, amount_to_collect,
--   assigned_courier_id, collected_amount, payment_method,
--   delivered_at, cancelled_at, cancellation_reason, courier_sort_order
--
-- Manual create inserts customer fields + user_id + status='pending' + notes;
-- remaining lifecycle fields use DB defaults / explicit nulls matching INSERT RLS.

create or replace function public.customer_bulk_create_orders(p_orders jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_count integer;
  v_idx integer := 0;
  v_item jsonb;
  v_sender_name text;
  v_sender_phone text;
  v_pickup_city text;
  v_pickup_district text;
  v_pickup_address text;
  v_recipient_name text;
  v_recipient_phone text;
  v_delivery_city text;
  v_delivery_district text;
  v_delivery_address text;
  v_parcel_count integer;
  v_delivery_date date;
  v_amount numeric(12, 2);
  v_is_fragile boolean;
  v_notes text;
  v_phone_digits text;
  v_ids bigint[] := '{}';
  -- Same rule as trg_orders_delivery_date / enforce_delivery_date_not_today_or_past:
  -- delivery_date must be strictly after today in Asia/Tbilisi.
  v_today_tbilisi date := (timezone('Asia/Tbilisi', now()))::date;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'user' then
    raise exception 'Only customers can bulk create orders';
  end if;

  if p_orders is null or jsonb_typeof(p_orders) <> 'array' then
    raise exception 'orders must be a JSON array';
  end if;

  v_count := jsonb_array_length(p_orders);
  if v_count = 0 then
    raise exception 'No orders to create';
  end if;
  if v_count > 700 then
    raise exception 'Too many orders (max 700)';
  end if;

  -- Validate every row before inserting any (atomic all-or-nothing).
  for v_item in
    select value
    from jsonb_array_elements(p_orders)
  loop
    v_idx := v_idx + 1;

    -- Reject spoofed ownership / operational fields if a client sends them.
    if v_item ? 'user_id'
       or v_item ? 'assigned_courier_id'
       or v_item ? 'status'
       or v_item ? 'collected_amount'
       or v_item ? 'payment_method'
       or v_item ? 'delivered_at'
       or v_item ? 'cancelled_at'
       or v_item ? 'cancellation_reason'
       or v_item ? 'courier_sort_order' then
      raise exception 'Row %: forbidden fields', v_idx;
    end if;

    v_sender_name := nullif(btrim(coalesce(v_item->>'sender_name', '')), '');
    v_sender_phone := nullif(btrim(coalesce(v_item->>'sender_phone', '')), '');
    v_pickup_city := nullif(btrim(coalesce(v_item->>'pickup_city', '')), '');
    v_pickup_district := nullif(btrim(coalesce(v_item->>'pickup_district', '')), '');
    v_pickup_address := nullif(btrim(coalesce(v_item->>'pickup_address', '')), '');
    v_recipient_name := nullif(btrim(coalesce(v_item->>'recipient_name', '')), '');
    v_recipient_phone := nullif(btrim(coalesce(v_item->>'recipient_phone', '')), '');
    v_delivery_city := nullif(btrim(coalesce(v_item->>'delivery_city', '')), '');
    v_delivery_district := nullif(btrim(coalesce(v_item->>'delivery_district', '')), '');
    v_delivery_address := nullif(btrim(coalesce(v_item->>'delivery_address', '')), '');
    v_notes := nullif(btrim(coalesce(v_item->>'notes', '')), '');

    if v_sender_name is null
       or v_sender_phone is null
       or v_pickup_city is null
       or v_pickup_district is null
       or v_pickup_address is null
       or v_recipient_name is null
       or v_recipient_phone is null
       or v_delivery_city is null
       or v_delivery_district is null
       or v_delivery_address is null then
      raise exception 'Row %: required fields missing', v_idx;
    end if;

    -- Same client phone rule as create-order (≥ 6 digits).
    v_phone_digits := regexp_replace(v_sender_phone, '\D', '', 'g');
    if length(v_phone_digits) < 6 then
      raise exception 'Row %: invalid sender phone', v_idx;
    end if;
    v_phone_digits := regexp_replace(v_recipient_phone, '\D', '', 'g');
    if length(v_phone_digits) < 6 then
      raise exception 'Row %: invalid recipient phone', v_idx;
    end if;

    begin
      v_parcel_count := (v_item->>'parcel_count')::integer;
    exception
      when others then
        raise exception 'Row %: invalid parcel_count', v_idx;
    end;
    if v_parcel_count is null or v_parcel_count < 1 then
      raise exception 'Row %: parcel_count must be >= 1', v_idx;
    end if;

    begin
      v_delivery_date := (v_item->>'delivery_date')::date;
    exception
      when others then
        raise exception 'Row %: invalid delivery_date', v_idx;
    end;
    if v_delivery_date is null or v_delivery_date <= v_today_tbilisi then
      raise exception 'Row %: delivery_date must be tomorrow or later', v_idx;
    end if;

    begin
      v_amount := coalesce((v_item->>'amount_to_collect')::numeric, 0);
    exception
      when others then
        raise exception 'Row %: invalid amount_to_collect', v_idx;
    end;
    if v_amount < 0 then
      raise exception 'Row %: amount_to_collect must be >= 0', v_idx;
    end if;

    begin
      v_is_fragile := coalesce((v_item->>'is_fragile')::boolean, false);
    exception
      when others then
        raise exception 'Row %: invalid is_fragile', v_idx;
    end;
  end loop;

  -- Single multi-row insert; any error rolls back the whole function transaction.
  with src as (
    select
      nullif(btrim(coalesce(e.item->>'sender_name', '')), '') as sender_name,
      nullif(btrim(coalesce(e.item->>'sender_phone', '')), '') as sender_phone,
      nullif(btrim(coalesce(e.item->>'pickup_city', '')), '') as pickup_city,
      nullif(btrim(coalesce(e.item->>'pickup_district', '')), '') as pickup_district,
      nullif(btrim(coalesce(e.item->>'pickup_address', '')), '') as pickup_address,
      nullif(btrim(coalesce(e.item->>'recipient_name', '')), '') as recipient_name,
      nullif(btrim(coalesce(e.item->>'recipient_phone', '')), '') as recipient_phone,
      nullif(btrim(coalesce(e.item->>'delivery_city', '')), '') as delivery_city,
      nullif(btrim(coalesce(e.item->>'delivery_district', '')), '') as delivery_district,
      nullif(btrim(coalesce(e.item->>'delivery_address', '')), '') as delivery_address,
      (e.item->>'parcel_count')::integer as parcel_count,
      (e.item->>'delivery_date')::date as delivery_date,
      coalesce((e.item->>'amount_to_collect')::numeric, 0) as amount_to_collect,
      coalesce((e.item->>'is_fragile')::boolean, false) as is_fragile,
      nullif(btrim(coalesce(e.item->>'notes', '')), '') as notes,
      e.ord
    from jsonb_array_elements(p_orders) with ordinality as e(item, ord)
  ),
  inserted as (
    insert into public.orders (
      user_id,
      sender_name,
      sender_phone,
      pickup_city,
      pickup_district,
      pickup_address,
      recipient_name,
      recipient_phone,
      delivery_city,
      delivery_district,
      delivery_address,
      parcel_count,
      delivery_date,
      amount_to_collect,
      is_fragile,
      notes,
      status,
      assigned_courier_id,
      collected_amount,
      payment_method,
      delivered_at,
      cancelled_at,
      cancellation_reason,
      courier_sort_order
    )
    select
      v_uid,
      s.sender_name,
      s.sender_phone,
      s.pickup_city,
      s.pickup_district,
      s.pickup_address,
      s.recipient_name,
      s.recipient_phone,
      s.delivery_city,
      s.delivery_district,
      s.delivery_address,
      s.parcel_count,
      s.delivery_date,
      round(s.amount_to_collect, 2),
      s.is_fragile,
      s.notes,
      'pending',
      null,
      0,
      null,
      null,
      null,
      null,
      null
    from src s
    order by s.ord
    returning id
  )
  select coalesce(array_agg(id), '{}'::bigint[]) into v_ids
  from inserted;

  return jsonb_build_object(
    'created_count', coalesce(array_length(v_ids, 1), 0),
    'ids', to_jsonb(v_ids)
  );
end;
$$;

revoke all on function public.customer_bulk_create_orders(jsonb) from public;
grant execute on function public.customer_bulk_create_orders(jsonb) to authenticated;

NOTIFY pgrst, 'reload schema';
