-- The class reminder comes 1 hour before (one reminder per booking).
create or replace function public.queue_reminders()
returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with due as (
    update public.bookings b
       set reminded_at = now()
     where b.status = 'accepted'
       and b.reminded_at is null
       and b.starts_at > now()
       and b.starts_at <= now() + interval '1 hour'
       and b.created_at < b.starts_at - interval '1 hour'   -- booked at the last minute: no reminder
    returning b.id
  )
  insert into public.events (type, payload)
  select 'booking.reminder', jsonb_build_object('booking_id', id) from due;
  get diagnostics n = row_count;
  return n;
end $$;
