-- Fix courier_reorder_orders to match courier active queue after office status.
-- UI loads pending | office | picked_up (+ legacy accepted | in_transit).
-- Previous RPC only allowed pending | picked_up → rejected office rows in the list.
-- No schema / RLS changes.

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
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select role into v_role from public.profiles where id = v_uid;
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

  -- Same active set as COURIER_ACTIVE_STATUS_FILTER / lifecycle sort queue.
  select count(*)::integer into v_count
  from public.orders o
  where o.id = any (order_ids)
    and o.assigned_courier_id = v_uid
    and o.status in ('pending', 'office', 'picked_up', 'accepted', 'in_transit');

  if v_count is distinct from v_expected then
    raise exception 'Invalid reorder: every order must be assigned to you and active';
  end if;

  perform set_config('app.orders_write_source', 'courier_rpc', true);

  foreach v_id in array order_ids loop
    v_idx := v_idx + 1;
    update public.orders
    set
      courier_sort_order = v_idx * 10,
      updated_at = now()
    where id = v_id
      and assigned_courier_id = v_uid
      and status in ('pending', 'office', 'picked_up', 'accepted', 'in_transit');
  end loop;
end;
$$;

revoke all on function public.courier_reorder_orders(bigint[]) from public;
grant execute on function public.courier_reorder_orders(bigint[]) to authenticated;

notify pgrst, 'reload schema';
