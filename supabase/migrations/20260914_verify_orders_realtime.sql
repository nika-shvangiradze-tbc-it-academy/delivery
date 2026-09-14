-- Verify / ensure orders Realtime publication + replica identity
-- Safe to re-run. Does NOT weaken RLS.
--
-- Why REPLICA IDENTITY FULL:
--   Courier reassignment needs payload.old.assigned_courier_id so Courier A
--   can drop an order that was moved to Courier B. Default replica identity
--   (primary key only) omits old non-PK columns on UPDATE.
-- Tradeoff:
--   Slightly larger WAL / Realtime payloads for orders UPDATEs.
--   Acceptable at ~1500 orders/day and ~30 couriers.
--
-- Verification:
--
--   select schemaname, tablename
--   from pg_publication_tables
--   where pubname = 'supabase_realtime'
--     and schemaname = 'public'
--     and tablename in ('orders', 'courier_order_events');
--
--   select relreplident
--   from pg_class
--   where oid = 'public.orders'::regclass;
--   -- 'f' = FULL

-- 1) Replica identity (required for reliable old-row courier reassignment)
alter table public.orders replica identity full;

-- 2) Publication: add only if missing
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
