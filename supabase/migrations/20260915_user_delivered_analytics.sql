-- =============================================================================
-- User delivered-order analytics RPC + supporting index
-- Paste into Supabase SQL Editor. Idempotent / safe to re-run.
--
-- SECURITY:
-- - SECURITY DEFINER with fixed search_path = public
-- - Requires auth.uid()
-- - NEVER accepts user_id from the client
-- - Scopes exclusively to orders.user_id = auth.uid() AND status = 'delivered'
-- - Financial source: amount_to_collect (customer COD / configured collect total)
--
-- Date filtering uses delivered_at with Asia/Tbilisi calendar-day boundaries
-- via index-friendly timestamptz comparisons (NOT timezone()::date in WHERE).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Index for user My Orders delivered filtering / analytics
-- ---------------------------------------------------------------------------
create index if not exists orders_user_status_delivered_at_idx
  on public.orders (user_id, status, delivered_at desc);

-- Stable user list ordering helper (created_at DESC, id DESC) under user_id
create index if not exists orders_user_created_at_id_desc_idx
  on public.orders (user_id, created_at desc, id desc);

-- ---------------------------------------------------------------------------
-- user_delivered_analytics — owner-only aggregation (no full row fetch)
-- ---------------------------------------------------------------------------
create or replace function public.user_delivered_analytics(
  p_date_from date default null,
  p_date_to date default null,
  p_year integer default null,
  p_month integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_from date := p_date_from;
  v_to date := p_date_to;
  v_order_count int;
  v_parcel_count bigint;
  v_amount numeric;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_month is not null and (p_month < 1 or p_month > 12) then
    raise exception 'Invalid month';
  end if;

  if p_year is not null and (p_year < 2000 or p_year > 2100) then
    raise exception 'Invalid year';
  end if;

  -- Month+year wins over raw dates; year-only next; else use p_date_from/p_date_to.
  if p_year is not null and p_month is not null then
    v_from := make_date(p_year, p_month, 1);
    v_to := (v_from + interval '1 month' - interval '1 day')::date;
  elsif p_year is not null then
    v_from := make_date(p_year, 1, 1);
    v_to := make_date(p_year, 12, 31);
  end if;

  if v_from is not null
     and v_to is not null
     and v_from > v_to then
    raise exception 'Invalid date range';
  end if;

  select
    count(*)::int,
    coalesce(sum(o.parcel_count), 0)::bigint,
    coalesce(sum(o.amount_to_collect), 0)
  into
    v_order_count,
    v_parcel_count,
    v_amount
  from public.orders o
  where o.user_id = v_uid
    and o.status = 'delivered'
    and (
      v_from is null
      or o.delivered_at >= (v_from::timestamp at time zone 'Asia/Tbilisi')
    )
    and (
      v_to is null
      or o.delivered_at < ((v_to + 1)::timestamp at time zone 'Asia/Tbilisi')
    );

  return jsonb_build_object(
    'order_count', coalesce(v_order_count, 0),
    'parcel_count', coalesce(v_parcel_count, 0),
    'amount_to_collect', coalesce(v_amount, 0)
  );
end;
$$;

revoke all on function public.user_delivered_analytics(date, date, integer, integer) from public;
grant execute on function public.user_delivered_analytics(date, date, integer, integer) to authenticated;
