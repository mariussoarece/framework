-- 003_functions.sql
-- Actions the app calls through the API (POST /rest/v1/rpc/<name>).
-- They run with elevated rights but check who is calling first.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function app.jwt_email() returns text
language sql stable as $$
  select current_setting('request.jwt.claims', true)::jsonb ->> 'email'
$$;

-- "Yoga With Mărius!" -> "yogawithmarius"
create function app.make_join_code(p_name text) returns text
language plpgsql as $$
declare
  base text;
  code text;
  n    int := 1;
begin
  base := lower(translate(p_name, 'ĂăÂâÎîȘșŞşȚțŢţ', 'AaAaIiSsSsTtTt'));
  base := regexp_replace(base, '[^a-z0-9]', '', 'g');
  if length(base) < 3 then
    base := base || 'org';
  end if;
  base := left(base, 34);
  code := base;
  while exists (select 1 from public.organizations where join_code = code) loop
    n := n + 1;
    code := base || n;
  end loop;
  return code;
end $$;

create function app.require_login() returns uuid
language plpgsql stable as $$
declare u uuid := app.uid();
begin
  if u is null then
    raise exception 'not_logged_in' using errcode = '28000';
  end if;
  return u;
end $$;

-- ---------------------------------------------------------------------------
-- Onboarding
-- ---------------------------------------------------------------------------

-- Owner path: create the organization and become its owner.
create function public.create_organization(p_name text, p_plan text default 'commission')
returns public.organizations
language plpgsql security definer set search_path = public, app as $$
declare
  u   uuid := app.require_login();
  p   public.profiles;
  org public.organizations;
begin
  select * into p from public.profiles where id = u;

  if p.role = 'super_admin' then
    raise exception 'super_admin_cannot_own' using errcode = 'P0001';
  end if;
  if p.role = 'owner' and exists (
       select 1 from public.organizations o
       where o.id = p.organization_id and o.status <> 'closed') then
    raise exception 'already_owner' using errcode = 'P0001';
  end if;
  if p_plan not in ('none', 'commission', 'flat') then
    raise exception 'invalid_plan' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.organizations
             where name_key = lower(trim(p_name)) and status <> 'closed') then
    raise exception 'name_taken' using errcode = 'P0001';
  end if;

  insert into public.organizations (name, join_code, owner_id, plan)
  values (trim(p_name), app.make_join_code(p_name), u, p_plan)
  returning * into org;

  insert into public.profiles (id, email, role, organization_id)
  values (u, app.jwt_email(), 'owner', org.id)
  on conflict (id) do update
    set role = 'owner', organization_id = org.id,
        email = coalesce(excluded.email, public.profiles.email);

  insert into public.home_settings (organization_id) values (org.id);
  insert into public.home_buttons (organization_id, type, label, icon, position) values
    (org.id, 'scheduling', 'Scheduling', 'calendar', 0),
    (org.id, 'workouts', 'Workout Maintenance', 'dumbbell', 1);

  return org;
end $$;

-- Shows the name before the client confirms joining.
create function public.find_organization(p_code text default null)
returns table (id uuid, name text, join_code text, is_default boolean)
language sql stable security definer set search_path = public, app as $$
  select o.id, o.name, o.join_code, o.is_default
  from public.organizations o
  where o.status <> 'closed'
    and case when p_code is null or trim(p_code) = ''
             then o.is_default
             else o.join_code = lower(trim(p_code)) end
$$;

-- Client path: join with a code, or the default organization without one.
create function public.join_organization(p_code text default null)
returns public.organizations
language plpgsql security definer set search_path = public, app as $$
declare
  u   uuid := app.require_login();
  p   public.profiles;
  org public.organizations;
begin
  select * into p from public.profiles where id = u;
  if p.role = 'super_admin' then
    raise exception 'super_admin_cannot_join' using errcode = 'P0001';
  end if;
  if p.role = 'owner' and exists (
       select 1 from public.organizations o
       where o.id = p.organization_id and o.status <> 'closed') then
    raise exception 'owner_cannot_join' using errcode = 'P0001';
  end if;

  select o.* into org from public.organizations o
  where o.status <> 'closed'
    and case when p_code is null or trim(p_code) = ''
             then o.is_default
             else o.join_code = lower(trim(p_code)) end;
  if org.id is null then
    raise exception 'organization_not_found' using errcode = 'P0001';
  end if;

  insert into public.profiles (id, email, role, organization_id)
  values (u, app.jwt_email(), 'client', org.id)
  on conflict (id) do update
    set role = 'client', organization_id = org.id,
        email = coalesce(excluded.email, public.profiles.email);

  return org;
end $$;

-- ---------------------------------------------------------------------------
-- Scheduling
-- ---------------------------------------------------------------------------

-- Free slots of an organization, in its own time zone.
create function app.slots_for(p_org uuid, p_from date, p_days int)
returns table (starts_at timestamptz, ends_at timestamptz, capacity int,
               booked int, price_cents int, currency text)
language sql stable security definer set search_path = public, app as $$
  with org as (
    select timezone from public.organizations where id = p_org
  ),
  days as (
    select d::date as day
    from generate_series(p_from, p_from + (greatest(p_days, 1) - 1), interval '1 day') d
  ),
  windows as (
    -- regular weekly hours, unless the day is closed
    select dy.day, a.start_time, a.end_time, a.slot_minutes, a.capacity,
           a.price_cents, a.currency
    from days dy
    join public.availability a
      on a.organization_id = p_org and a.weekday = extract(dow from dy.day)
    where not exists (select 1 from public.availability_exceptions e
                      where e.organization_id = p_org and e.day = dy.day and e.closed)
    union all
    -- one-off extra windows
    select e.day, e.start_time, e.end_time, e.slot_minutes, e.capacity,
           e.price_cents, 'EUR'
    from public.availability_exceptions e
    join days dy on dy.day = e.day
    where e.organization_id = p_org and not e.closed
  ),
  slots as (
    select (t at time zone (select timezone from org)) as starts_at,
           ((t + make_interval(mins => w.slot_minutes)) at time zone (select timezone from org)) as ends_at,
           w.capacity, w.price_cents, w.currency
    from windows w
    cross join lateral generate_series(
      w.day + w.start_time,
      w.day + w.end_time - make_interval(mins => w.slot_minutes),
      make_interval(mins => w.slot_minutes)) as t
  )
  select s.starts_at, s.ends_at, s.capacity,
         (select count(*)::int from public.bookings b
          where b.organization_id = p_org and b.starts_at = s.starts_at
            and b.status in ('pending', 'accepted')) as booked,
         s.price_cents, s.currency
  from slots s
  where s.starts_at > now()
  order by s.starts_at
$$;

create function public.available_slots(p_from date default current_date, p_days int default 14)
returns table (starts_at timestamptz, ends_at timestamptz, remaining int,
               price_cents int, currency text)
language sql stable security definer set search_path = public, app as $$
  select s.starts_at, s.ends_at, s.capacity - s.booked, s.price_cents, s.currency
  from app.slots_for(app.my_org(), p_from, least(p_days, 62)) s
  where app.uid() is not null and s.capacity > s.booked
$$;

create function public.request_booking(p_starts_at timestamptz)
returns public.bookings
language plpgsql security definer set search_path = public, app as $$
declare
  u    uuid := app.require_login();
  p    public.profiles;
  org  public.organizations;
  slot record;
  b    public.bookings;
begin
  select * into p from public.profiles where id = u;
  if p.role is distinct from 'client' or p.organization_id is null then
    raise exception 'only_clients_can_book' using errcode = 'P0001';
  end if;
  select * into org from public.organizations where id = p.organization_id;
  if org.status not in ('trial', 'active') then
    raise exception 'organization_unavailable' using errcode = 'P0001';
  end if;

  -- one booking at a time per slot, so capacity can't be oversold
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

  insert into public.bookings (organization_id, client_id, starts_at, ends_at,
                               price_cents, currency)
  values (org.id, u, slot.starts_at, slot.ends_at,
          case when org.plan = 'none' then 0 else slot.price_cents end, slot.currency)
  returning * into b;
  return b;
end $$;

create function public.decide_booking(p_booking uuid, p_accept boolean)
returns public.bookings
language plpgsql security definer set search_path = public, app as $$
declare b public.bookings;
begin
  perform app.require_login();
  select * into b from public.bookings where id = p_booking for update;
  if b.id is null or not app.can_manage(b.organization_id) then
    raise exception 'booking_not_found' using errcode = 'P0001';
  end if;
  if b.status <> 'pending' then
    raise exception 'booking_not_pending' using errcode = 'P0001';
  end if;
  update public.bookings
     set status = case when p_accept then 'accepted' else 'declined' end,
         decided_at = now()
   where id = p_booking
  returning * into b;
  return b;
end $$;

create function public.cancel_booking(p_booking uuid)
returns public.bookings
language plpgsql security definer set search_path = public, app as $$
declare
  u uuid := app.require_login();
  b public.bookings;
  who text;
begin
  select * into b from public.bookings where id = p_booking for update;
  if b.id is null then
    raise exception 'booking_not_found' using errcode = 'P0001';
  end if;
  if b.client_id = u then
    who := 'client';
  elsif app.can_manage(b.organization_id) then
    who := 'owner';
  else
    raise exception 'booking_not_found' using errcode = 'P0001';
  end if;
  if b.status not in ('pending', 'accepted') then
    raise exception 'booking_not_active' using errcode = 'P0001';
  end if;
  update public.bookings set status = 'cancelled', cancelled_by = who
   where id = p_booking
  returning * into b;
  return b;
end $$;

-- ---------------------------------------------------------------------------
-- Super admin
-- ---------------------------------------------------------------------------
create function public.review_media(p_media uuid, p_approve boolean, p_reason text default null)
returns public.media
language plpgsql security definer set search_path = public, app as $$
declare m public.media;
begin
  if not app.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.media
     set status = case when p_approve then 'approved' else 'rejected' end,
         reject_reason = case when p_approve then null else p_reason end,
         reviewed_by = app.uid(), reviewed_at = now()
   where id = p_media and status = 'pending'
  returning * into m;
  if m.id is null then
    raise exception 'media_not_pending' using errcode = 'P0001';
  end if;
  return m;
end $$;

create function public.set_default_organization(p_org uuid)
returns void
language plpgsql security definer set search_path = public, app as $$
begin
  if not app.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.organizations set is_default = false where is_default;
  update public.organizations set is_default = true where id = p_org and status <> 'closed';
  if not found then
    raise exception 'organization_not_found' using errcode = 'P0001';
  end if;
end $$;

-- Called by the Node server (service role) when an owner deletes their account
-- or after 60 days unpaid. Returns the clients to email; the server then
-- deletes the media files from disk and refunds paid bookings in Stripe.
create function app.close_organization(p_org uuid)
returns table (client_id uuid, email text, language text)
language plpgsql security definer set search_path = public, app as $$
begin
  if exists (select 1 from public.organizations where id = p_org and is_default) then
    raise exception 'cannot_close_default' using errcode = 'P0001';
  end if;

  update public.bookings set status = 'cancelled', cancelled_by = 'system'
   where organization_id = p_org and status in ('pending', 'accepted')
     and starts_at > now();

  return query
    select pr.id, pr.email, pr.language from public.profiles pr
    where pr.organization_id = p_org and pr.role = 'client';

  update public.profiles set organization_id = null where organization_id = p_org;
  delete from public.section_workouts where organization_id = p_org;
  delete from public.workout_media where organization_id = p_org;
  delete from public.sections where organization_id = p_org;
  delete from public.workouts where organization_id = p_org;
  update public.home_settings set background_media_id = null, foreground_media_id = null,
         description = null where organization_id = p_org;
  -- media rows stay until the server has removed the files, then it deletes them
  update public.organizations set status = 'closed', closed_at = now() where id = p_org;
end $$;

-- ---------------------------------------------------------------------------
-- Events for the Node server (LISTEN booking_events / media_events)
-- ---------------------------------------------------------------------------
create function app.notify_booking() returns trigger language plpgsql as $$
begin
  perform pg_notify('booking_events', json_build_object(
    'op', tg_op, 'id', new.id, 'organization_id', new.organization_id,
    'client_id', new.client_id, 'status', new.status,
    'old_status', case when tg_op = 'UPDATE' then old.status end)::text);
  return new;
end $$;

create trigger bookings_notify after insert or update of status on public.bookings
  for each row execute function app.notify_booking();

create function app.notify_media() returns trigger language plpgsql as $$
begin
  perform pg_notify('media_events', json_build_object(
    'op', tg_op, 'id', new.id, 'organization_id', new.organization_id,
    'status', new.status)::text);
  return new;
end $$;

create trigger media_notify after insert or update of status on public.media
  for each row execute function app.notify_media();

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke all on all functions in schema public from public;
grant execute on function
  public.create_organization(text, text),
  public.find_organization(text),
  public.join_organization(text),
  public.available_slots(date, int),
  public.request_booking(timestamptz),
  public.decide_booking(uuid, boolean),
  public.cancel_booking(uuid),
  public.review_media(uuid, boolean, text),
  public.set_default_organization(uuid)
to authenticated;

revoke execute on function app.close_organization(uuid), app.slots_for(uuid, date, int)
  from authenticated, public;
grant execute on all functions in schema app to service_role;
