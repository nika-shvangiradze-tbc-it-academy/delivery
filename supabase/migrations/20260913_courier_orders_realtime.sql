-- Courier Realtime: publication + replica identity + assignment-safe event pings
-- Run in Supabase SQL editor. Safe to re-run (idempotent checks).

-- ---------------------------------------------------------------------------
-- 0) Verification (run separately anytime):
--
--   select schemaname, tablename
--   from pg_publication_tables
--   where pubname = 'supabase_realtime'
--     and schemaname = 'public'
--     and tablename in ('orders', 'courier_order_events');
--
-- ---------------------------------------------------------------------------

-- 1) Enable REPLICA IDENTITY FULL so UPDATE payloads can include old row fields
--    (assigned_courier_id) when Realtime delivers them.
alter table public.orders replica identity full;

-- 2) Add orders to supabase_realtime publication only if missing
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

-- 3) Courier-scoped ping table so unassign / reassignment-away still notify the
--    previous courier under RLS (orders SELECT only allows assigned rows).
create table if not exists public.courier_order_events (
  id bigint generated always as identity primary key,
  courier_id uuid not null references public.profiles (id) on delete cascade,
  order_id bigint not null,
  event_type text not null,
  created_at timestamptz not null default now()
);

create index if not exists courier_order_events_courier_created_idx
  on public.courier_order_events (courier_id, created_at desc);

alter table public.courier_order_events enable row level security;

drop policy if exists "Courier order events select" on public.courier_order_events;
create policy "Courier order events select"
  on public.courier_order_events for select
  using (
    courier_id = auth.uid()
    or public.is_admin()
  );

-- No client inserts/updates/deletes — trigger only (security definer).

create or replace function public.enqueue_courier_order_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.assigned_courier_id is not null then
      insert into public.courier_order_events (courier_id, order_id, event_type)
      values (old.assigned_courier_id, old.id, 'delete');
    end if;
    delete from public.courier_order_events
    where created_at < now() - interval '2 days';
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.assigned_courier_id is not null then
      insert into public.courier_order_events (courier_id, order_id, event_type)
      values (new.assigned_courier_id, new.id, 'insert');
    end if;
    return new;
  end if;

  -- UPDATE of assignment / status / payment fields
  if old.assigned_courier_id is not null then
    insert into public.courier_order_events (courier_id, order_id, event_type)
    values (old.assigned_courier_id, old.id, 'update');
  end if;

  if new.assigned_courier_id is not null
     and new.assigned_courier_id is distinct from old.assigned_courier_id then
    insert into public.courier_order_events (courier_id, order_id, event_type)
    values (new.assigned_courier_id, new.id, 'assign');
  end if;

  delete from public.courier_order_events
  where created_at < now() - interval '2 days';

  return new;
end;
$$;

drop trigger if exists orders_enqueue_courier_order_event on public.orders;
create trigger orders_enqueue_courier_order_event
  after insert or delete on public.orders
  for each row
  execute function public.enqueue_courier_order_event();

drop trigger if exists orders_enqueue_courier_order_event_update on public.orders;
create trigger orders_enqueue_courier_order_event_update
  after update of
    assigned_courier_id,
    status,
    payment_method,
    collected_amount,
    delivered_at,
    cancelled_at
  on public.orders
  for each row
  execute function public.enqueue_courier_order_event();

-- 4) Publish courier_order_events for Realtime (only if missing)
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'courier_order_events'
  ) then
    execute 'alter publication supabase_realtime add table public.courier_order_events';
  end if;
end $$;

alter table public.courier_order_events replica identity full;
