-- =============================================================================
-- Admin dashboard order counters (server-side aggregation)
-- Paste into Supabase SQL Editor. Idempotent / safe to re-run.
--
-- SECURITY:
-- - SECURITY DEFINER with fixed search_path = public
-- - Requires auth.uid()
-- - Verifies profiles.role = 'admin' (never trusts client role claims)
-- - Accepts NO parameters (no user_id / role from frontend)
-- - Returns ONLY five aggregate integers as JSONB (never individual order rows)
-- =============================================================================

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
    count(*) filter (where o.status = 'picked_up'),
    count(*) filter (where o.status = 'delivered'),
    count(*) filter (where o.status = 'cancelled')
  into
    v_total,
    v_pending,
    v_picked_up,
    v_delivered,
    v_cancelled
  from public.orders o;

  return jsonb_build_object(
    'total', coalesce(v_total, 0)::int,
    'pending', coalesce(v_pending, 0)::int,
    'picked_up', coalesce(v_picked_up, 0)::int,
    'delivered', coalesce(v_delivered, 0)::int,
    'cancelled', coalesce(v_cancelled, 0)::int
  );
end;
$$;

revoke all on function public.admin_dashboard_stats() from public;
grant execute on function public.admin_dashboard_stats() to authenticated;

notify pgrst, 'reload schema';
