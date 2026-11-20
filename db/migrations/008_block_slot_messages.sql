-- 008_block_slot_messages.sql
-- block_slot: say why it can't block (whole day off, or the session no longer exists)
-- instead of a generic error.
create or replace function public.block_slot(p_starts_at timestamptz, p_block boolean)
returns void
language plpgsql security definer set search_path = public, app as $$
declare
  o    uuid := app.require_manager();
  tz   text := (select timezone from public.organizations where id = o);
  d    date := (p_starts_at at time zone tz)::date;
  s    record;
begin
  if exists (select 1 from public.availability_exceptions e
             where e.organization_id = o and e.day = d and e.closed and e.start_time is null) then
    raise exception 'day_off' using errcode = 'P0001';
  end if;
  select * into s from app.slots_for(o, d, 1, true) x where x.starts_at = p_starts_at limit 1;
  if s is null then raise exception 'slot_not_found' using errcode = 'P0001'; end if;
  if p_block then
    if s.booked > 0 then raise exception 'slot_has_bookings' using errcode = 'P0001'; end if;
    if not s.blocked then
      insert into public.availability_exceptions (organization_id, day, closed, start_time, end_time)
      values (o, d, true, (p_starts_at at time zone tz)::time, (s.ends_at at time zone tz)::time);
    end if;
  else
    delete from public.availability_exceptions
     where organization_id = o and day = d and closed and start_time is not null
       and start_time < (s.ends_at at time zone tz)::time and end_time > (p_starts_at at time zone tz)::time;
  end if;
end $$;
