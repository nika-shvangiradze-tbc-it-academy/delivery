-- Courier persistent sort order + history timestamps
-- Run in Supabase SQL editor after previous courier migrations.

-- 1) Columns
alter table public.orders
  add column if not exists courier_sort_order integer;

alter table public.orders
  add column if not exists cancelled_at timestamptz;

create index if not exists orders_courier_sort_idx
  on public.orders (assigned_courier_id, courier_sort_order nulls last);

create index if not exists orders_cancelled_at_idx
  on public.orders (cancelled_at);

-- 2) Assignment / cancel / deliver hooks (BEFORE UPDATE/INSERT)
create or replace function public.orders_courier_lifecycle_hooks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  -- cancelled_at
  if new.status = 'cancelled' then
    if tg_op = 'INSERT' or old.status is distinct from 'cancelled' then
      new.cancelled_at := coalesce(new.cancelled_at, now());
    end if;
  else
    new.cancelled_at := null;
  end if;

  -- delivered_at (admin path; courier RPC also sets this)
  if new.status = 'delivered' then
    if tg_op = 'INSERT' or old.status is distinct from 'delivered' then
      new.delivered_at := coalesce(new.delivered_at, now());
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'delivered' and new.status is distinct from 'delivered' then
    new.delivered_at := null;
  end if;

  -- Clear sort when unassigned
  if new.assigned_courier_id is null then
    new.courier_sort_order := null;
    return new;
  end if;

  -- Assign to end of courier active list on new assignment or missing sort
  if new.status in ('accepted', 'picked_up', 'in_transit')
     and (
       tg_op = 'INSERT'
       or old.assigned_courier_id is distinct from new.assigned_courier_id
       or new.courier_sort_order is null
     )
  then
    select coalesce(max(o.courier_sort_order), 0) + 10
      into v_next
    from public.orders o
    where o.assigned_courier_id = new.assigned_courier_id
      and o.status in ('accepted', 'picked_up', 'in_transit')
      and (tg_op = 'INSERT' or o.id is distinct from new.id);

    new.courier_sort_order := v_next;
  end if;

  return new;
end;
$$;

drop trigger if exists orders_courier_lifecycle_bi on public.orders;
create trigger orders_courier_lifecycle_bi
  before insert on public.orders
  for each row
  execute function public.orders_courier_lifecycle_hooks();

drop trigger if exists orders_courier_lifecycle_bu on public.orders;
create trigger orders_courier_lifecycle_bu
  before update on public.orders
  for each row
  execute function public.orders_courier_lifecycle_hooks();

-- 3) Backfill sort for existing active assigned orders
with ranked as (
  select
    id,
    row_number() over (
      partition by assigned_courier_id
      order by delivery_date asc nulls last, created_at asc, id asc
    ) * 10 as sort_pos
  from public.orders
  where assigned_courier_id is not null
    and status in ('accepted', 'picked_up', 'in_transit')
)
update public.orders o
set courier_sort_order = ranked.sort_pos
from ranked
where o.id = ranked.id;

-- Backfill cancelled_at from updated_at where missing
update public.orders
set cancelled_at = coalesce(cancelled_at, updated_at)
where status = 'cancelled'
  and cancelled_at is null;

-- 4) Secure reorder RPC
create or replace function public.courier_reorder_orders(order_ids bigint[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_count integer;
  v_expected integer;
  v_id bigint;
  v_idx integer := 0;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is distinct from 'courier' then
    raise exception 'Only couriers can reorder orders';
  end if;

  if order_ids is null then
    raise exception 'order_ids required';
  end if;

  v_expected := coalesce(array_length(order_ids, 1), 0);
  if v_expected = 0 then
    return;
  end if;

  if (
    select count(distinct x)
    from unnest(order_ids) as t(x)
  ) is distinct from v_expected then
    raise exception 'Duplicate order ids in reorder list';
  end if;

  select count(*)::integer into v_count
  from public.orders o
  where o.id = any (order_ids)
    and o.assigned_courier_id = auth.uid()
    and o.status in ('accepted', 'picked_up', 'in_transit');

  if v_count is distinct from v_expected then
    raise exception 'Invalid reorder: every order must be assigned to you and active';
  end if;

  foreach v_id in array order_ids loop
    v_idx := v_idx + 1;
    update public.orders
    set
      courier_sort_order = v_idx * 10,
      updated_at = now()
    where id = v_id
      and assigned_courier_id = auth.uid()
      and status in ('accepted', 'picked_up', 'in_transit');
  end loop;
end;
$$;

revoke all on function public.courier_reorder_orders(bigint[]) from public;
grant execute on function public.courier_reorder_orders(bigint[]) to authenticated;

-- 5) Refresh admin_assign_courier (sort handled by trigger)
create or replace function public.admin_assign_courier(
  p_order_id bigint,
  p_courier_id uuid
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  if not public.is_admin() then
    raise exception 'Only admins can assign couriers';
  end if;

  if p_courier_id is not null then
    if not exists (
      select 1 from public.profiles p
      where p.id = p_courier_id and p.role = 'courier'
    ) then
      raise exception 'Target profile is not a courier';
    end if;
  end if;

  update public.orders o
  set
    assigned_courier_id = p_courier_id,
    courier_sort_order = case when p_courier_id is null then null else o.courier_sort_order end,
    status = case
      when p_courier_id is not null then 'accepted'
      when o.status = 'accepted' then 'pending'
      else o.status
    end,
    updated_at = now()
  where o.id = p_order_id
  returning * into v_order;

  if v_order.id is null then
    raise exception 'Order not found';
  end if;

  return v_order;
end;
$$;

-- 6) Keep courier_update_order aligned with delivered/cancelled timestamps
create or replace function public.courier_update_order(
  p_order_id bigint,
  p_status text,
  p_payment_method text,
  p_collected_amount numeric
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_role text;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'courier' then
    raise exception 'Only couriers can call courier_update_order';
  end if;

  if p_status is null or p_status not in ('accepted', 'picked_up', 'in_transit', 'delivered') then
    raise exception 'Invalid courier status';
  end if;

  if p_payment_method is not null and p_payment_method not in ('cash', 'card') then
    raise exception 'Invalid payment method';
  end if;

  if p_collected_amount is null or p_collected_amount < 0 then
    raise exception 'Invalid collected amount';
  end if;

  update public.orders o
  set
    status = p_status,
    payment_method = p_payment_method,
    collected_amount = round(p_collected_amount, 2),
    delivered_at = case
      when p_status = 'delivered' then coalesce(o.delivered_at, now())
      else null
    end,
    cancelled_at = null,
    updated_at = now()
  where o.id = p_order_id
    and o.assigned_courier_id = v_uid
  returning * into v_order;

  if v_order.id is null then
    raise exception 'Order not found or not assigned to this courier';
  end if;

  return v_order;
end;
$$;

revoke all on function public.courier_update_order(bigint, text, text, numeric) from public;
grant execute on function public.courier_update_order(bigint, text, text, numeric) to authenticated;
