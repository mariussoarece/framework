-- 006_classes_weeks_blocks.sql
-- Two kinds of timetable entries:
--   open  : a window (e.g. 09:00-17:00) cut into sessions of slot_minutes; clients pick a session
--   class : one named class (title, instructor) at a fixed time; slot_minutes = its length
-- Both repeat weekly from valid_from, either forever (valid_until null) or until valid_until.
-- Entries may not overlap on the same weekday (checked here, so the app can't get it wrong).
-- availability_exceptions:
--   closed, no times      -> whole day off
--   closed, start/end set -> blocked times within that day (aligned to sessions by the app)

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.availability
  add column kind        text not null default 'open' check (kind in ('open', 'class')),
  add column title       text check (title is null or length(trim(title)) between 1 and 60),
  add column instructor  text check (instructor is null or length(trim(instructor)) between 1 and 60),
  add column valid_from  date not null default current_date,
  add column valid_until date,
  add constraint availability_class_has_title check (kind = 'open' or title is not null),
  add constraint availability_valid_range check (valid_until is null or valid_until >= valid_from),
  add constraint availability_class_one_session
    check (kind = 'open' or end_time = start_time + make_interval(mins => slot_minutes));

alter table public.bookings
  add column availability_id uuid references public.availability (id) on delete set null,
  add column title      text,
  add column instructor text;
create index bookings_availability_idx on public.bookings (availability_id, starts_at);

create index availability_exceptions_block_idx on public.availability_exceptions (organization_id, day)
  where closed and start_time is not null;

-- ---------------------------------------------------------------------------
-- No overlapping entries
-- ---------------------------------------------------------------------------
create function app.weekday_en(d int) returns text language sql immutable as $$
  select (array['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'])[d + 1]
$$;

create function app.check_availability_clash() returns trigger language plpgsql as $$
declare c public.availability;
begin
  select * into c from public.availability a
   where a.organization_id = new.organization_id
     and a.weekday = new.weekday
     and a.id <> new.id
     and a.start_time < new.end_time and new.start_time < a.end_time
     and a.valid_from <= coalesce(new.valid_until, 'infinity'::date)
     and new.valid_from <= coalesce(a.valid_until, 'infinity'::date)
   limit 1;
  if found then
    -- schedule_clash|<weekday 0-6>|<start>|<end>|<title or empty>  (the app turns this into a sentence)
    raise exception 'schedule_clash|%|%|%|%', c.weekday, to_char(c.start_time, 'HH24:MI'),
      to_char(c.end_time, 'HH24:MI'), coalesce(c.title, '') using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger availability_no_clash before insert or update on public.availability
  for each row execute function app.check_availability_clash();

-- ---------------------------------------------------------------------------
-- Slots (replaces 003/005 versions): validity dates, blocked times, kind/title/instructor
-- ---------------------------------------------------------------------------
drop function if exists public.available_slots(date, int);
drop function if exists app.slots_for(uuid, date, int);

create function app.slots_for(p_org uuid, p_from date, p_days int, p_include_blocked boolean default false)
returns table (starts_at timestamptz, ends_at timestamptz, capacity int, booked int,
               price_cents int, currency text, availability_id uuid, kind text,
               title text, instructor text, blocked boolean)
language sql stable security definer set search_path = public, app as $$
  with org as (
    select timezone from public.organizations where id = p_org
  ),
  days as (
    select d::date as day
    from generate_series(p_from, p_from + (greatest(p_days, 1) - 1), interval '1 day') d
  ),
  windows as (
    select dy.day, a.id as availability_id, a.kind, a.title, a.instructor,
           a.start_time, a.end_time, a.slot_minutes, a.capacity, a.price_cents, a.currency
    from days dy
    join public.availability a
      on a.organization_id = p_org and a.weekday = extract(dow from dy.day)
     and a.valid_from <= dy.day and (a.valid_until is null or dy.day <= a.valid_until)
    where not exists (select 1 from public.availability_exceptions e
                      where e.organization_id = p_org and e.day = dy.day and e.closed and e.start_time is null)
    union all
    select e.day, null, 'open', null, null, e.start_time, e.end_time, e.slot_minutes, e.capacity, e.price_cents, 'EUR'
    from public.availability_exceptions e
    join days dy on dy.day = e.day
    where e.organization_id = p_org and not e.closed
  ),
  slots as (
    select w.day, t as local_start, t + make_interval(mins => w.slot_minutes) as local_end,
           w.availability_id, w.kind, w.title, w.instructor, w.capacity, w.price_cents, w.currency
    from windows w
    cross join lateral generate_series(
      w.day + w.start_time,
      w.day + w.end_time - make_interval(mins => w.slot_minutes),
      make_interval(mins => w.slot_minutes)) as t
  ),
  marked as (
    select s.*,
           exists (select 1 from public.availability_exceptions e
                   where e.organization_id = p_org and e.day = s.day and e.closed and e.start_time is not null
                     and e.start_time < s.local_end::time and e.end_time > s.local_start::time) as blocked,
           (s.local_start at time zone (select timezone from org)) as st,
           (s.local_end at time zone (select timezone from org)) as en
    from slots s
  )
  select m.st, m.en, m.capacity,
         (select count(*)::int from public.bookings b
          where b.organization_id = p_org and b.starts_at = m.st
            and b.status in ('pending', 'accepted')) as booked,
         m.price_cents, m.currency, m.availability_id, m.kind, m.title, m.instructor, m.blocked
  from marked m
  where m.st > now() and (p_include_blocked or not m.blocked)
  order by m.st
$$;

-- What clients see: free and full sessions (remaining 0 = full; the app shows "Full").
create function public.available_slots(p_from date default current_date, p_days int default 14)
returns table (starts_at timestamptz, ends_at timestamptz, remaining int, capacity int,
               price_cents int, currency text, availability_id uuid, kind text, title text, instructor text)
language sql stable security definer set search_path = public, app as $$
  select s.starts_at, s.ends_at, greatest(s.capacity - s.booked, 0), s.capacity, s.price_cents, s.currency,
         s.availability_id, s.kind, s.title, s.instructor
  from app.slots_for(app.my_org(), p_from, least(p_days, 62)) s
  where app.uid() is not null
$$;

create or replace function public.request_booking(p_starts_at timestamptz)
returns public.bookings
language plpgsql security definer set search_path = public, app as $$
declare
  u    uuid := app.require_login();
  p    public.profiles;
  org  public.organizations;
  slot record;
  b    public.bookings;
  price int;
begin
  select * into p from public.profiles where id = u;
  if p.role is distinct from 'client' or p.organization_id is null then
    raise exception 'only_clients_can_book' using errcode = 'P0001';
  end if;
  select * into org from public.organizations where id = p.organization_id;
  if org.status not in ('trial', 'active') then
    raise exception 'organization_unavailable' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(org.id::text || p_starts_at::text, 0));

  if exists (select 1 from public.bookings
             where client_id = u and starts_at = p_starts_at
               and status in ('pending', 'accepted')) then
    raise exception 'already_booked' using errcode = 'P0001';
  end if;

  select * into slot
  from app.slots_for(org.id, (p_starts_at at time zone org.timezone)::date, 1) s
  where s.starts_at = p_starts_at
  limit 1;
  if slot is null or slot.booked >= slot.capacity then
    raise exception 'slot_unavailable' using errcode = 'P0001';
  end if;

  price := case when org.plan = 'none' then 0 else slot.price_cents end;

  insert into public.bookings (organization_id, client_id, starts_at, ends_at, price_cents, currency,
                               payment_status, availability_id, title, instructor)
  values (org.id, u, slot.starts_at, slot.ends_at, price, slot.currency,
          case when price > 0 then 'requires_payment' else 'not_required' end,
          slot.availability_id, slot.title, slot.instructor)
  returning * into b;
  return b;
end $$;

-- ---------------------------------------------------------------------------
-- Week overview for everyone: each entry per day, with how many are booked
-- ---------------------------------------------------------------------------
create function public.week_overview(p_from date, p_days int default 7)
returns table (day date, availability_id uuid, kind text, title text, instructor text,
               start_time time, end_time time, slot_minutes int, capacity int, booked int, day_off boolean)
language sql stable security definer set search_path = public, app as $$
  with org as (
    select id, timezone from public.organizations where id = app.my_org()
  ),
  days as (
    select d::date as day
    from generate_series(p_from, p_from + (least(greatest(p_days, 1), 31) - 1), interval '1 day') d
  )
  select dy.day, a.id, a.kind, a.title, a.instructor, a.start_time, a.end_time, a.slot_minutes, a.capacity,
         (select count(*)::int from public.bookings b
          where b.organization_id = org.id and b.status in ('pending', 'accepted')
            and b.starts_at >= ((dy.day + a.start_time) at time zone org.timezone)
            and b.starts_at <  ((dy.day + a.end_time) at time zone org.timezone)) as booked,
         exists (select 1 from public.availability_exceptions e
                 where e.organization_id = org.id and e.day = dy.day and e.closed and e.start_time is null) as day_off
  from org
  cross join days dy
  join public.availability a
    on a.organization_id = org.id and a.weekday = extract(dow from dy.day)
   and a.valid_from <= dy.day and (a.valid_until is null or dy.day <= a.valid_until)
  where app.uid() is not null
  order by dy.day, a.start_time
$$;

-- ---------------------------------------------------------------------------
-- Owner actions
-- ---------------------------------------------------------------------------
create function app.require_manager() returns uuid
language plpgsql stable security definer set search_path = public, app as $$
declare o uuid := app.my_org();
begin
  if o is null or not app.can_manage(o) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return o;
end $$;

-- Creates one entry per weekday (all or nothing), or updates one entry (p_id).
create function public.save_availability(
  p_id uuid, p_weekdays int[], p_kind text, p_title text, p_instructor text,
  p_start time, p_end time, p_slot_minutes int, p_capacity int, p_price_cents int,
  p_valid_from date, p_valid_until date)
returns setof public.availability
language plpgsql security definer set search_path = public, app as $$
declare
  o   uuid := app.require_manager();
  old public.availability;
  wd  int;
  most int;
  e_end time := case when p_kind = 'class' then p_start + make_interval(mins => p_slot_minutes) else p_end end;
begin
  if p_kind not in ('open', 'class') then raise exception 'invalid_kind' using errcode = 'P0001'; end if;
  if p_weekdays is null or cardinality(p_weekdays) = 0 then raise exception 'no_days' using errcode = 'P0001'; end if;

  if p_id is not null then
    select * into old from public.availability where id = p_id and organization_id = o for update;
    if old.id is null then raise exception 'not_found' using errcode = 'P0001'; end if;
    -- changing when sessions happen would strand existing bookings
    if (old.weekday, old.start_time, old.end_time, old.slot_minutes) is distinct from
       (p_weekdays[1], p_start, e_end, p_slot_minutes)
       and exists (select 1 from public.bookings b where b.availability_id = p_id
                   and b.status in ('pending', 'accepted') and b.starts_at > now()) then
      raise exception 'rule_has_bookings' using errcode = 'P0001';
    end if;
    select max(n) into most from (
      select count(*) as n from public.bookings b where b.availability_id = p_id
         and b.status in ('pending', 'accepted') and b.starts_at > now() group by b.starts_at) x;
    if coalesce(most, 0) > p_capacity then
      raise exception 'capacity_below_booked' using errcode = 'P0001';
    end if;
    return query
      update public.availability set
        weekday = p_weekdays[1], kind = p_kind,
        title = nullif(trim(p_title), ''), instructor = nullif(trim(p_instructor), ''),
        start_time = p_start, end_time = e_end, slot_minutes = p_slot_minutes,
        capacity = p_capacity, price_cents = p_price_cents,
        valid_from = coalesce(p_valid_from, old.valid_from), valid_until = p_valid_until
      where id = p_id
      returning *;
    return;
  end if;

  foreach wd in array p_weekdays loop
    return query
      insert into public.availability (organization_id, weekday, kind, title, instructor, start_time, end_time,
                                       slot_minutes, capacity, price_cents, valid_from, valid_until)
      values (o, wd, p_kind, nullif(trim(p_title), ''), nullif(trim(p_instructor), ''), p_start, e_end,
              p_slot_minutes, p_capacity, p_price_cents, coalesce(p_valid_from, current_date), p_valid_until)
      returning *;
  end loop;
end $$;

create function public.delete_availability(p_id uuid)
returns void
language plpgsql security definer set search_path = public, app as $$
declare o uuid := app.require_manager();
begin
  if exists (select 1 from public.bookings b where b.availability_id = p_id
             and b.status in ('pending', 'accepted') and b.starts_at > now()) then
    raise exception 'rule_has_bookings' using errcode = 'P0001';
  end if;
  delete from public.availability where id = p_id and organization_id = o;
end $$;

-- All sessions of one day, including blocked ones (for the owner's Time off screen).
create function public.day_slots(p_day date)
returns table (starts_at timestamptz, ends_at timestamptz, booked int, capacity int,
               kind text, title text, blocked boolean)
language sql stable security definer set search_path = public, app as $$
  select s.starts_at, s.ends_at, s.booked, s.capacity, s.kind, s.title, s.blocked
  from app.slots_for(app.require_manager(), p_day, 1, true) s
$$;

-- Blocks or unblocks one session.
create function public.block_slot(p_starts_at timestamptz, p_block boolean)
returns void
language plpgsql security definer set search_path = public, app as $$
declare
  o    uuid := app.require_manager();
  tz   text := (select timezone from public.organizations where id = o);
  d    date := (p_starts_at at time zone tz)::date;
  s    record;
begin
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

-- ---------------------------------------------------------------------------
-- Timetable changes go through the functions above (clash, booking and capacity checks)
-- ---------------------------------------------------------------------------
revoke insert, update, delete on public.availability from authenticated;

revoke all on function public.save_availability(uuid, int[], text, text, text, time, time, int, int, int, date, date),
  public.delete_availability(uuid), public.day_slots(date), public.block_slot(timestamptz, boolean),
  public.week_overview(date, int), public.available_slots(date, int) from public;
grant execute on function public.save_availability(uuid, int[], text, text, text, time, time, int, int, int, date, date),
  public.delete_availability(uuid), public.day_slots(date), public.block_slot(timestamptz, boolean),
  public.week_overview(date, int), public.available_slots(date, int) to authenticated, service_role;
revoke execute on function app.slots_for(uuid, date, int, boolean) from public, authenticated;
grant execute on function app.slots_for(uuid, date, int, boolean) to service_role;
grant execute on function app.require_manager(), app.weekday_en(int) to authenticated, service_role;
