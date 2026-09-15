-- Admin hard-delete for orders + allow cascade cleanup of status audit rows.
-- Paste into Supabase SQL Editor. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1) Allow order_status_audit rows to be removed when parent order is deleted.
--    Direct client DELETE/UPDATE on audit remains blocked.
-- ---------------------------------------------------------------------------
create or replace function public.order_status_audit_forbid_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- FK ON DELETE CASCADE fires nested triggers (depth > 1).
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  raise exception 'order_status_audit is append-only (trigger writes only)';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Admin-only DELETE on orders
-- ---------------------------------------------------------------------------
drop policy if exists "Orders delete admin" on public.orders;
create policy "Orders delete admin"
  on public.orders for delete
  using (public.is_admin());
