-- Fragile package flag + realtime trigger coverage for is_fragile
-- Safe to re-run (idempotent).

-- 1) Column
alter table public.orders
  add column if not exists is_fragile boolean not null default false;

-- Existing rows stay false via NOT NULL DEFAULT; belt-and-suspenders:
update public.orders
set is_fragile = coalesce(is_fragile, false);

-- 2) Keep PostgREST schema cache in sync
notify pgrst, 'reload schema';

-- 3) Ensure orders is in supabase_realtime (do not add twice)
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'orders'
  ) then
    execute 'alter publication supabase_realtime add table public.orders';
  end if;
end $$;

-- 4) Ensure courier_order_events stays published (if table exists)
do $$
begin
  if to_regclass('public.courier_order_events') is not null
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'courier_order_events'
     ) then
    execute 'alter publication supabase_realtime add table public.courier_order_events';
  end if;
end $$;

alter table public.orders replica identity full;

-- 5) Recreate UPDATE trigger so is_fragile changes ping couriers
--    (only if the enqueue function from courier_orders_realtime migration exists)
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'enqueue_courier_order_event'
  ) then
    drop trigger if exists orders_enqueue_courier_order_event_update on public.orders;

    create trigger orders_enqueue_courier_order_event_update
      after update of
        assigned_courier_id,
        status,
        payment_method,
        collected_amount,
        delivered_at,
        cancelled_at,
        is_fragile
      on public.orders
      for each row
      execute function public.enqueue_courier_order_event();
  end if;
end $$;
