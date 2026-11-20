-- 009_longer_sessions.sql
-- Sessions and classes up to 10 hours (600 minutes); before: 480.
alter table public.availability drop constraint availability_slot_minutes_check;
alter table public.availability add constraint availability_slot_minutes_check check (slot_minutes between 10 and 600);
alter table public.availability_exceptions drop constraint availability_exceptions_slot_minutes_check;
alter table public.availability_exceptions add constraint availability_exceptions_slot_minutes_check
  check (slot_minutes is null or slot_minutes between 10 and 600);
