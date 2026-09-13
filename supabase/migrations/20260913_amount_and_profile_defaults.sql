-- Safe migration: profile defaults + amount_to_collect
-- Run in Supabase SQL editor.

-- 1) Profile saved sender/address fields
alter table public.profiles
  add column if not exists default_city text;

alter table public.profiles
  add column if not exists default_district text;

alter table public.profiles
  add column if not exists default_address text;

-- 2) amount_to_collect (safe for existing rows)
alter table public.orders
  add column if not exists amount_to_collect numeric(12, 2);

-- Backfill existing nulls with a temporary placeholder so NOT NULL can be applied.
-- Review/adjust these values in admin later if needed.
update public.orders
set amount_to_collect = 1
where amount_to_collect is null;

alter table public.orders
  alter column amount_to_collect set default 1;

alter table public.orders
  alter column amount_to_collect set not null;

alter table public.orders
  drop constraint if exists orders_amount_to_collect_positive;

alter table public.orders
  add constraint orders_amount_to_collect_positive
  check (amount_to_collect > 0);

-- 3) Delivery date must be tomorrow or later for NEW inserts / future updates
-- (Does not rewrite historical rows.)
create or replace function public.enforce_delivery_date_not_today_or_past()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'INSERT' then
    if new.delivery_date is null or new.delivery_date <= (timezone('Asia/Tbilisi', now()))::date then
      raise exception 'delivery_date must be tomorrow or later';
    end if;
  elsif TG_OP = 'UPDATE' and new.delivery_date is distinct from old.delivery_date then
    if new.delivery_date is null or new.delivery_date <= (timezone('Asia/Tbilisi', now()))::date then
      raise exception 'delivery_date must be tomorrow or later';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_delivery_date on public.orders;
create trigger trg_orders_delivery_date
  before insert or update on public.orders
  for each row
  execute function public.enforce_delivery_date_not_today_or_past();
