-- =============================================================================
-- Order status audit log (append-only, trigger-written)
-- Paste into Supabase SQL Editor. DO NOT weaken existing RLS / RPCs / Realtime.
--
-- Creates:
--   public.order_status_audit
--   trigger on public.orders (status change → audit insert)
--   admin-only SELECT RLS
--   hardens courier_change_order_status: no pending (picked_up|delivered|cancelled)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Audit table
-- ---------------------------------------------------------------------------
create table if not exists public.order_status_audit (
  id bigserial primary key,
  order_id bigint not null references public.orders (id) on delete cascade,
  changed_by uuid references public.profiles (id) on delete set null,
  changed_by_role text,
  old_status text,
  new_status text not null,
  source text,
  changed_at timestamptz not null default now(),
  constraint order_status_audit_new_status_check
    check (new_status in ('pending', 'picked_up', 'delivered', 'cancelled')),
  constraint order_status_audit_old_status_check
    check (
      old_status is null
      or old_status in ('pending', 'picked_up', 'delivered', 'cancelled', 'accepted', 'in_transit')
    ),
  constraint order_status_audit_role_check
    check (
      changed_by_role is null
      or changed_by_role in ('admin', 'courier', 'user', 'system')
    ),
  constraint order_status_audit_source_check
    check (
      source is null
      or source in ('admin', 'courier', 'user', 'system')
    )
);

create index if not exists order_status_audit_order_changed_at_idx
  on public.order_status_audit (order_id, changed_at desc);

create index if not exists order_status_audit_changed_by_changed_at_idx
  on public.order_status_audit (changed_by, changed_at desc);

comment on table public.order_status_audit is
  'Immutable order status change log. Written only by trigger; clients cannot insert/update/delete.';

-- ---------------------------------------------------------------------------
-- 2) Append-only: block client UPDATE/DELETE (and direct INSERT)
-- ---------------------------------------------------------------------------
create or replace function public.order_status_audit_forbid_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'order_status_audit is append-only (trigger writes only)';
end;
$$;

drop trigger if exists order_status_audit_forbid_update on public.order_status_audit;
create trigger order_status_audit_forbid_update
  before update on public.order_status_audit
  for each row
  execute function public.order_status_audit_forbid_mutation();

drop trigger if exists order_status_audit_forbid_delete on public.order_status_audit;
create trigger order_status_audit_forbid_delete
  before delete on public.order_status_audit
  for each row
  execute function public.order_status_audit_forbid_mutation();

-- ---------------------------------------------------------------------------
-- 3) Status-change audit writer (SECURITY DEFINER, fixed search_path)
-- ---------------------------------------------------------------------------
create or replace function public.log_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_source_raw text;
  v_source text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  if v_uid is not null then
    select p.role into v_role
    from public.profiles p
    where p.id = v_uid;
  end if;

  -- Prefer explicit write-source GUC set by admin/courier RPCs.
  v_source_raw := nullif(current_setting('app.orders_write_source', true), '');

  if v_source_raw in ('courier_rpc', 'courier') then
    v_source := 'courier';
  elsif v_source_raw in ('admin_rpc', 'admin') then
    v_source := 'admin';
  elsif v_uid is null then
    v_source := 'system';
    v_role := coalesce(v_role, 'system');
  elsif v_role in ('admin', 'courier', 'user') then
    v_source := v_role;
  else
    v_source := 'system';
    v_role := coalesce(v_role, 'system');
  end if;

  insert into public.order_status_audit (
    order_id,
    changed_by,
    changed_by_role,
    old_status,
    new_status,
    source,
    changed_at
  ) values (
    new.id,
    v_uid,
    v_role,
    old.status,
    new.status,
    v_source,
    now()
  );

  return new;
end;
$$;

drop trigger if exists orders_log_status_change on public.orders;
create trigger orders_log_status_change
  after update of status on public.orders
  for each row
  when (new.status is distinct from old.status)
  execute function public.log_order_status_change();

revoke all on function public.log_order_status_change() from public;
revoke all on function public.order_status_audit_forbid_mutation() from public;

-- ---------------------------------------------------------------------------
-- 4) RLS — admin SELECT only; no client INSERT/UPDATE/DELETE
-- ---------------------------------------------------------------------------
alter table public.order_status_audit enable row level security;

drop policy if exists "Order status audit admin select" on public.order_status_audit;
create policy "Order status audit admin select"
  on public.order_status_audit
  for select
  to authenticated
  using (public.is_admin());

-- Explicitly no INSERT/UPDATE/DELETE policies for authenticated/anon.
-- Trigger runs as SECURITY DEFINER and bypasses RLS for inserts.

revoke all on table public.order_status_audit from public;
revoke all on table public.order_status_audit from anon;
grant select on table public.order_status_audit to authenticated;
-- No INSERT/UPDATE/DELETE grants to authenticated/anon.

grant select, usage on sequence public.order_status_audit_id_seq to postgres;
-- Sequence used only by trigger/definer path; do not grant to authenticated.

-- ---------------------------------------------------------------------------
-- 5) Harden courier_change_order_status — History cannot go back to pending
--    Allowed: picked_up | delivered | cancelled (no accepted/in_transit/pending)
-- ---------------------------------------------------------------------------
create or replace function public.courier_change_order_status(
  p_order_id bigint,
  p_status text,
  p_payment_method text default null
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
  v_payment text;
  v_current text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'courier' then
    raise exception 'Only couriers can call courier_change_order_status';
  end if;

  -- Final correction statuses only (no pending / accepted / in_transit).
  if p_status is null
     or p_status not in ('picked_up', 'delivered', 'cancelled') then
    raise exception 'Invalid courier status';
  end if;

  if p_payment_method is not null and p_payment_method not in ('cash', 'card') then
    raise exception 'Invalid payment method';
  end if;

  select o.status into v_current
  from public.orders o
  where o.id = p_order_id
    and o.assigned_courier_id = v_uid;

  if not found then
    raise exception 'Order not found or not assigned to this courier';
  end if;

  -- Belt-and-suspenders: history rows must never return to pending via this RPC.
  if v_current in ('delivered', 'cancelled') and p_status = 'pending' then
    raise exception 'Cannot set history orders back to pending';
  end if;

  perform set_config('app.orders_write_source', 'courier_rpc', true);

  if p_status = 'delivered' then
    select
      case
        when p_payment_method in ('cash', 'card') then p_payment_method
        when o.payment_method in ('cash', 'card') then o.payment_method
        else null
      end
    into v_payment
    from public.orders o
    where o.id = p_order_id
      and o.assigned_courier_id = v_uid;

    if v_payment is null then
      raise exception 'Payment method required (cash or card)';
    end if;

    update public.orders o
    set
      status = 'delivered',
      payment_method = v_payment,
      collected_amount = round(o.amount_to_collect, 2),
      delivered_at = now(),
      cancelled_at = null,
      updated_at = now()
    where o.id = p_order_id
      and o.assigned_courier_id = v_uid
    returning * into v_order;

  elsif p_status = 'cancelled' then
    update public.orders o
    set
      status = 'cancelled',
      payment_method = null,
      collected_amount = 0,
      cancelled_at = now(),
      delivered_at = null,
      updated_at = now()
    where o.id = p_order_id
      and o.assigned_courier_id = v_uid
    returning * into v_order;

  else
    -- picked_up → back to Active queue
    update public.orders o
    set
      status = 'picked_up',
      payment_method = null,
      collected_amount = 0,
      delivered_at = null,
      cancelled_at = null,
      updated_at = now()
    where o.id = p_order_id
      and o.assigned_courier_id = v_uid
    returning * into v_order;
  end if;

  if not found then
    raise exception 'Order not found or not assigned to this courier';
  end if;

  return v_order;
end;
$$;

revoke all on function public.courier_change_order_status(bigint, text, text) from public;
grant execute on function public.courier_change_order_status(bigint, text, text) to authenticated;
