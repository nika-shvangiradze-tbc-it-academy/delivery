-- =============================================================================
-- Courier cancellation reason
-- - orders.cancellation_reason (nullable text)
-- - courier_cancel_order(p_order_id, p_cancellation_reason) requires trimmed reason
-- - Immutable after first write (including Admin)
-- - Preserves audit log, RLS, protect_order_column_security, Realtime
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Column
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists cancellation_reason text;

comment on column public.orders.cancellation_reason is
  'Courier cancellation reason. Set once via courier_cancel_order; immutable thereafter.';

-- Existing cancelled rows may remain NULL (pre-feature cancels). Acceptable.

-- ---------------------------------------------------------------------------
-- 2) Harden INSERT: callers cannot seed a cancellation reason
-- ---------------------------------------------------------------------------
drop policy if exists "Orders insert" on public.orders;
drop policy if exists "Users can create own orders" on public.orders;

create policy "Orders insert"
  on public.orders for insert
  with check (
    auth.uid() = user_id
    and status = 'pending'
    and assigned_courier_id is null
    and coalesce(collected_amount, 0) = 0
    and payment_method is null
    and delivered_at is null
    and cancelled_at is null
    and courier_sort_order is null
    and cancellation_reason is null
  );

-- ---------------------------------------------------------------------------
-- 3) Immutability trigger (applies to EVERYONE, including Admin)
-- ---------------------------------------------------------------------------
-- Once set, never change (including clear to NULL).
-- Initial NULL → value is allowed for non-admin writers (courier RPC).
-- Admin cannot set or change the field (bypasses column allowlist otherwise).
create or replace function public.protect_cancellation_reason_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Once written, never change (Admin included).
  if old.cancellation_reason is not null
     and new.cancellation_reason is distinct from old.cancellation_reason then
    raise exception 'Cancellation reason cannot be changed';
  end if;

  -- Initial write
  if old.cancellation_reason is null
     and new.cancellation_reason is not null then
    new.cancellation_reason := nullif(btrim(new.cancellation_reason), '');
    if new.cancellation_reason is null then
      raise exception 'Cancellation reason is required';
    end if;

    -- Admin must never manually seed this operational field.
    -- Couriers set it only via courier_cancel_order (RPC).
    if public.is_admin() then
      raise exception 'Cancellation reason can only be set by courier cancellation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists orders_01_protect_cancellation_reason on public.orders;
create trigger orders_01_protect_cancellation_reason
  before update on public.orders
  for each row
  execute function public.protect_cancellation_reason_immutable();

revoke all on function public.protect_cancellation_reason_immutable() from public;

-- ---------------------------------------------------------------------------
-- 4) courier_cancel_order — require reason; set payment fields atomically
-- ---------------------------------------------------------------------------
drop function if exists public.courier_cancel_order(bigint);
drop function if exists public.courier_cancel_order(bigint, text);

create or replace function public.courier_cancel_order(
  p_order_id bigint,
  p_cancellation_reason text
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
  v_reason text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'courier' then
    raise exception 'Only couriers can call courier_cancel_order';
  end if;

  v_reason := nullif(btrim(coalesce(p_cancellation_reason, '')), '');
  if v_reason is null then
    raise exception 'Cancellation reason is required';
  end if;

  perform set_config('app.orders_write_source', 'courier_rpc', true);

  update public.orders o
  set
    status = 'cancelled',
    cancellation_reason = v_reason,
    cancelled_at = now(),
    delivered_at = null,
    payment_method = null,
    collected_amount = 0,
    updated_at = now()
  where o.id = p_order_id
    and o.assigned_courier_id = v_uid
    and o.status in ('pending', 'picked_up')
  returning * into v_order;

  if not found then
    raise exception 'Order not found or not assigned to this courier';
  end if;

  return v_order;
end;
$$;

revoke all on function public.courier_cancel_order(bigint, text) from public;
grant execute on function public.courier_cancel_order(bigint, text) to authenticated;

-- Note: courier_change_order_status intentionally does NOT clear or overwrite
-- cancellation_reason. Immutability trigger preserves historical reason if the
-- order later returns to picked_up / delivered.
