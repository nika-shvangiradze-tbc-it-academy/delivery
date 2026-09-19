-- Customer can read own pickup tasks (for My Orders cancellation reason display).
-- Does NOT grant write access; cancel/complete remain courier RPCs only.

drop policy if exists "Pickup tasks select" on public.pickup_tasks;
create policy "Pickup tasks select"
  on public.pickup_tasks for select
  using (
    public.is_admin()
    or (public.is_courier() and assigned_courier_id = auth.uid())
    or customer_id = auth.uid()
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
        and (
          (public.is_courier() and t.assigned_courier_id = auth.uid())
          or t.customer_id = auth.uid()
        )
    )
  );
