

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


