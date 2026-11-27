-- 016: owners send push messages to their clients; the class reminder comes 30 minutes before.

-- 1. Messages from an owner to all the clients of their organization ----------
create table if not exists public.announcements (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by      uuid references public.profiles(id) on delete set null,
  title           text not null check (length(btrim(title)) between 1 and 80),
  body            text not null check (length(btrim(body)) between 1 and 500),
  created_at      timestamptz not null default now()
);
create index if not exists announcements_org_idx on public.announcements (organization_id, created_at desc);

alter table public.announcements enable row level security;
grant select on public.announcements to authenticated;

-- the organization's owner and its clients can read its messages; writing only via send_announcement()
drop policy if exists announcements_read on public.announcements;
create policy announcements_read on public.announcements for select to authenticated
  using (organization_id = app.my_org() or app.is_super_admin());

create or replace function public.send_announcement(p_title text, p_body text)
returns public.announcements
language plpgsql security definer set search_path = public, app as $$
declare
  org uuid := app.my_org();
  a   public.announcements;
begin
  if app.my_role() <> 'owner' or org is null then
    raise exception 'owner_only' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.organizations where id = org and status in ('paused', 'closed')) then
    raise exception 'organization_paused' using errcode = 'P0001';
  end if;
  if coalesce(length(btrim(p_title)), 0) = 0 or coalesce(length(btrim(p_body)), 0) = 0 then
    raise exception 'message_empty' using errcode = 'P0001';
  end if;
  if length(btrim(p_title)) > 80 or length(btrim(p_body)) > 500 then
    raise exception 'message_too_long' using errcode = 'P0001';
  end if;
  -- clients should not be flooded: at most 5 messages a day per organization
  if (select count(*) from public.announcements
       where organization_id = org and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'too_many_messages' using errcode = 'P0001';
  end if;

  insert into public.announcements (organization_id, created_by, title, body)
  values (org, app.uid(), btrim(p_title), btrim(p_body))
  returning * into a;

  insert into public.events (type, payload)
  values ('announcement.created', jsonb_build_object('announcement_id', a.id));
  return a;
end $$;

revoke all on function public.send_announcement(text, text) from public;
grant execute on function public.send_announcement(text, text) to authenticated;

-- 2. Reminder 30 minutes before a confirmed session (was 2 hours) --------------
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
       and b.starts_at <= now() + interval '30 minutes'
       and b.created_at < b.starts_at - interval '30 minutes'   -- booked at the last minute: no reminder
    returning b.id
  )
  insert into public.events (type, payload)
  select 'booking.reminder', jsonb_build_object('booking_id', id) from due;
  get diagnostics n = row_count;
  return n;
end $$;
