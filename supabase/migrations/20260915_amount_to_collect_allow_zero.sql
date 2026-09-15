-- Allow amount_to_collect = 0 (COD may be zero).
-- Previously: check (amount_to_collect > 0)

alter table public.orders
  drop constraint if exists orders_amount_to_collect_positive;

alter table public.orders
  add constraint orders_amount_to_collect_non_negative
  check (amount_to_collect >= 0);
