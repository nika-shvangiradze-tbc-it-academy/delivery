-- Re-run this in Supabase SQL editor so assign also updates status.
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
