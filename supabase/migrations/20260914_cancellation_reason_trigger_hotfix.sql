-- HOTFIX: re-apply only the immutability trigger (safe to run alone).
-- Paste into Supabase SQL Editor if cancel still fails with a reason entered.

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
    if public.is_admin() then
      raise exception 'Cancellation reason can only be set by courier cancellation';
    end if;
  end if;

  return new;
end;
$$;
