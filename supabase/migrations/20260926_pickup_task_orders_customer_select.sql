-- Customer SELECT on pickup_task_orders via authoritative order ownership.
-- Fixes 403 / empty reads on USER My Orders enrichment:
--   GET /rest/v1/pickup_task_orders?order_id=in.(...)
--
-- Relationships (authoritative):
--   pickup_task_orders.order_id  → orders.id
--   orders.user_id               → auth.users.id / profiles.id
--   pickup_task_orders.pickup_task_id → pickup_tasks.id
--   pickup_tasks.customer_id     → same customer uuid (set at admin assign)
--
-- Does NOT disable RLS. Does NOT grant anon. Does NOT open public reads.
-- Does NOT change pickup complete/cancel RPCs or order status flow.

-- ---------------------------------------------------------------------------
-- 1) Ensure table privileges (authenticated only)
-- ---------------------------------------------------------------------------
grant select on public.pickup_tasks to authenticated;
grant select on public.pickup_task_orders to authenticated;

revoke all on public.pickup_tasks from anon;
revoke all on public.pickup_task_orders from anon;

alter table public.pickup_tasks enable row level security;
alter table public.pickup_task_orders enable row level security;

-- ---------------------------------------------------------------------------
-- 2) SECURITY DEFINER helpers — boolean ownership checks only
--    Bypass nested RLS so junction ↔ task policies cannot recurse.
--    Never return row data; always scoped to auth.uid().
-- ---------------------------------------------------------------------------
create or replace function public.customer_owns_order(p_order_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.orders o
    where o.id = p_order_id
      and o.user_id = auth.uid()
  );
$$;

create or replace function public.customer_owns_pickup_task(p_pickup_task_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.pickup_task_orders pto
    inner join public.orders o on o.id = pto.order_id
    where pto.pickup_task_id = p_pickup_task_id
      and o.user_id = auth.uid()
  );
$$;

revoke all on function public.customer_owns_order(bigint) from public;
revoke all on function public.customer_owns_order(bigint) from anon;
grant execute on function public.customer_owns_order(bigint) to authenticated;

revoke all on function public.customer_owns_pickup_task(bigint) from public;
revoke all on function public.customer_owns_pickup_task(bigint) from anon;
grant execute on function public.customer_owns_pickup_task(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) pickup_tasks SELECT
--    Admin: all
--    Assigned courier: own assignments
--    Customer: customer_id match OR owns a linked order (authoritative)
-- ---------------------------------------------------------------------------
drop policy if exists "Pickup tasks select" on public.pickup_tasks;
create policy "Pickup tasks select"
  on public.pickup_tasks
  for select
  to authenticated
  using (
    public.is_admin()
    or (public.is_courier() and assigned_courier_id = auth.uid())
    or customer_id = auth.uid()
    or public.customer_owns_pickup_task(id)
  );

-- ---------------------------------------------------------------------------
-- 4) pickup_task_orders SELECT
--    Admin: all
--    Assigned courier: rows for their pickup_tasks
--    Customer: rows whose linked order.user_id = auth.uid()
--              (authoritative; also keep customer_id path as secondary)
-- ---------------------------------------------------------------------------
drop policy if exists "Pickup task orders select" on public.pickup_task_orders;
create policy "Pickup task orders select"
  on public.pickup_task_orders
  for select
  to authenticated
  using (
    public.is_admin()
    or public.customer_owns_order(order_id)
    or exists (
      select 1
      from public.pickup_tasks t
      where t.id = pickup_task_id
        and public.is_courier()
        and t.assigned_courier_id = auth.uid()
    )
    or exists (
      select 1
      from public.pickup_tasks t
      where t.id = pickup_task_id
        and t.customer_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 5) Refresh PostgREST schema cache
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';
