-- Three more notifications:
--   1. a reminder to the client 2 hours before a confirmed session
--   2. the super admin hears about new uploads waiting for approval
--   3. clients hear about new workouts
-- Uploads and workouts are grouped: one notification for several added within a few minutes.

-- 1. Reminders --------------------------------------------------------------
alter table public.bookings add column if not exists reminded_at timestamptz;

-- Run by the server every minute: queues one reminder per confirmed booking
-- that starts within the next 2 hours. Returns how many were queued.
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
       and b.starts_at <= now() + interval '2 hours'
       and b.created_at < b.starts_at - interval '2 hours'   -- booked at the last minute: no reminder needed
    returning b.id
  )
  insert into public.events (type, payload)
  select 'booking.reminder', jsonb_build_object('booking_id', id) from due;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.queue_reminders() from public, authenticated;
grant execute on function public.queue_reminders() to service_role;

-- 2. New uploads waiting for approval ------------------------------------
create or replace function app.media_uploaded_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pending'
     and not exists (select 1 from public.profiles p where p.id = new.uploaded_by and p.role = 'super_admin')
     and not exists (select 1 from public.events e
                      where e.type = 'media.uploaded' and e.done_at is null
                        and e.payload ->> 'organization_id' = new.organization_id::text) then
    -- wait 2 minutes, so a batch of uploads becomes one notification
    insert into public.events (type, payload, run_after)
    values ('media.uploaded', jsonb_build_object('organization_id', new.organization_id), now() + interval '2 minutes');
  end if;
  return new;
end $$;

drop trigger if exists media_uploaded on public.media;
create trigger media_uploaded after insert on public.media
  for each row execute function app.media_uploaded_event();

-- 3. New workouts --------------------------------------------------------
create or replace function app.workout_created_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.events e
                  where e.type = 'workout.created' and e.done_at is null
                    and e.payload ->> 'organization_id' = new.organization_id::text) then
    -- wait 10 minutes: the owner is often adding several, and their pictures
    insert into public.events (type, payload, run_after)
    values ('workout.created',
            jsonb_build_object('organization_id', new.organization_id, 'since', new.created_at),
            now() + interval '10 minutes');
  end if;
  return new;
end $$;

drop trigger if exists workout_created on public.workouts;
create trigger workout_created after insert on public.workouts
  for each row execute function app.workout_created_event();
