-- 023: memberships (like gym passes), sold by the owner to clients, paid at the location.
--
--   membership_plans      what the owner offers: "8 classes / 30 days / 250 RON", "Unlimited / 30 days"
--   plan_classes          which classes (timetable entries) a plan covers
--   memberships           a client's membership: requested -> active (owner approves) -> used up / expired
--   bookings.membership_id  the membership a booking uses (set automatically when the client books)
--
-- Classes used = bookings on the membership that are waiting or confirmed; a declined or
-- cancelled booking gives the class back.

create table public.membership_plans (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 60),
  description     text check (description is null or length(description) <= 500),
  price_cents     int  not null default 0 check (price_cents >= 0),
  currency        text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  classes         int  check (classes is null or classes between 1 and 500),   -- null = unlimited
  valid_days      int  not null check (valid_days between 1 and 730),
  active          boolean not null default true,                                -- false = no longer offered
  created_at      timestamptz not null default now()
);
create index membership_plans_org_idx on public.membership_plans (organization_id);

create table public.plan_classes (
  plan_id         uuid not null references public.membership_plans (id) on delete cascade,
  availability_id uuid not null references public.availability (id) on delete cascade,
  primary key (plan_id, availability_id)
);
create index plan_classes_availability_idx on public.plan_classes (availability_id);

create table public.memberships (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  plan_id         uuid not null references public.membership_plans (id) on delete restrict,
  client_id       uuid not null references public.profiles (id) on delete cascade,
  status          text not null default 'pending'
                  check (status in ('pending', 'active', 'declined', 'cancelled')),
  -- copied from the plan when requested, so later plan changes don't change it
  name            text not null,
  classes         int,
  valid_days      int not null,
  price_cents     int not null,
  currency        text not null,
  starts_on       date,           -- set when the owner approves
  ends_on         date,
  created_at      timestamptz not null default now(),
  decided_at      timestamptz
);
create index memberships_org_idx on public.memberships (organization_id, status);
create index memberships_client_idx on public.memberships (client_id, status);

alter table public.bookings
  add column if not exists membership_id uuid references public.memberships (id) on delete set null;
create index if not exists bookings_membership_idx on public.bookings (membership_id) where membership_id is not null;

-- ---------------------------------------------------------------------------- reading
alter table public.membership_plans enable row level security;
alter table public.plan_classes enable row level security;
alter table public.memberships enable row level security;
grant select on public.membership_plans, public.plan_classes, public.memberships to authenticated;
grant all on public.membership_plans, public.plan_classes, public.memberships to service_role;

create policy membership_plans_read on public.membership_plans for select to authenticated
  using (app.is_member_of(organization_id) or app.can_manage(organization_id));
create policy plan_classes_read on public.plan_classes for select to authenticated
  using (exists (select 1 from public.membership_plans p where p.id = plan_id
                  and (app.is_member_of(p.organization_id) or app.can_manage(p.organization_id))));
create policy memberships_read on public.memberships for select to authenticated
  using (client_id = app.uid() or app.can_manage(organization_id));

-- classes used (waiting or confirmed bookings)
create or replace function app.membership_used(p_membership uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.bookings
   where membership_id = p_membership and status in ('pending', 'accepted')
$$;

-- ---------------------------------------------------------------------------- owner: plans
create or replace function public.save_membership_plan(
  p_id uuid, p_name text, p_description text, p_price_cents int, p_currency text,
  p_classes int, p_valid_days int, p_active boolean default true)
returns public.membership_plans
language plpgsql security definer set search_path = public, app as $$
declare
  o uuid := app.require_manager();
  r public.membership_plans;
begin
  if coalesce(length(btrim(p_name)), 0) = 0 then raise exception 'name_missing' using errcode = 'P0001'; end if;
  if p_currency !~ '^[A-Z]{3}$' then raise exception 'invalid_currency' using errcode = 'P0001'; end if;
  if p_id is null then
    insert into public.membership_plans (organization_id, name, description, price_cents, currency, classes, valid_days, active)
    values (o, btrim(p_name), nullif(btrim(p_description), ''), p_price_cents, p_currency, p_classes, p_valid_days,
            coalesce(p_active, true))
    returning * into r;
  else
    update public.membership_plans set
      name = btrim(p_name), description = nullif(btrim(p_description), ''), price_cents = p_price_cents,
      currency = p_currency, classes = p_classes, valid_days = p_valid_days, active = coalesce(p_active, true)
    where id = p_id and organization_id = o
    returning * into r;
    if r.id is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  end if;
  return r;
end $$;

-- which plans cover a class (replaces the list)
create or replace function public.set_class_plans(p_availability uuid, p_plans uuid[])
returns void
language plpgsql security definer set search_path = public, app as $$
declare o uuid := app.require_manager();
begin
  if not exists (select 1 from public.availability where id = p_availability and organization_id = o) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(coalesce(p_plans, '{}')) x(id)
              where not exists (select 1 from public.membership_plans p where p.id = x.id and p.organization_id = o)) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  delete from public.plan_classes where availability_id = p_availability;
  insert into public.plan_classes (plan_id, availability_id)
  select distinct x.id, p_availability from unnest(coalesce(p_plans, '{}')) x(id);
end $$;

-- ---------------------------------------------------------------------------- client: request
create or replace function public.request_membership(p_plan uuid)
returns public.memberships
language plpgsql security definer set search_path = public, app as $$
declare
  u  uuid := app.require_login();
  pr public.profiles;
  pl public.membership_plans;
  m  public.memberships;
begin
  select * into pr from public.profiles where id = u;
  select * into pl from public.membership_plans where id = p_plan;
  if pl.id is null or not pl.active or pr.role is distinct from 'client'
     or pr.organization_id is distinct from pl.organization_id then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.memberships where client_id = u and plan_id = p_plan and status = 'pending') then
    raise exception 'membership_already_requested' using errcode = 'P0001';
  end if;
  insert into public.memberships (organization_id, plan_id, client_id, name, classes, valid_days, price_cents, currency)
  values (pl.organization_id, pl.id, u, pl.name, pl.classes, pl.valid_days, pl.price_cents, pl.currency)
  returning * into m;
  insert into public.events (type, payload) values ('membership.requested', jsonb_build_object('membership_id', m.id));
  return m;
end $$;

-- ---------------------------------------------------------------------------- owner: approve / decline / cancel
create or replace function public.decide_membership(p_id uuid, p_accept boolean)
returns public.memberships
language plpgsql security definer set search_path = public, app as $$
declare
  o  uuid := app.require_manager();
  tz text;
  m  public.memberships;
begin
  select timezone into tz from public.organizations where id = o;
  update public.memberships set
    status = case when p_accept then 'active' else 'declined' end,
    starts_on = case when p_accept then (now() at time zone tz)::date end,
    ends_on = case when p_accept then (now() at time zone tz)::date + valid_days - 1 end,
    decided_at = now()
  where id = p_id and organization_id = o and status = 'pending'
  returning * into m;
  if m.id is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  insert into public.events (type, payload)
  values ('membership.decided', jsonb_build_object('membership_id', m.id, 'accepted', p_accept));
  return m;
end $$;

-- the owner cancels any membership; a client can withdraw a request still waiting
create or replace function public.cancel_membership(p_id uuid)
returns void
language plpgsql security definer set search_path = public, app as $$
declare
  u uuid := app.require_login();
  m public.memberships;
begin
  select * into m from public.memberships where id = p_id;
  if m.id is null or not (app.can_manage(m.organization_id) or (m.client_id = u and m.status = 'pending')) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  update public.memberships set status = 'cancelled', decided_at = now() where id = p_id;
  -- future bookings stay; they just stop using this membership
  update public.bookings set membership_id = null where membership_id = p_id and starts_at > now();
end $$;

-- ---------------------------------------------------------------------------- lists with what is left
create or replace function public.list_memberships(p_client uuid default null)
returns table (id uuid, client_id uuid, client_name text, client_email text, plan_id uuid, name text,
               status text, classes int, valid_days int, used int, remaining int, starts_on date, ends_on date,
               expired boolean, price_cents int, currency text, created_at timestamptz)
language sql stable security definer set search_path = public, app as $$
  select m.id, m.client_id, coalesce(nullif(p.display_name, ''), p.email), p.email, m.plan_id, m.name,
         m.status, m.classes, m.valid_days, app.membership_used(m.id),
         case when m.classes is null then null else greatest(m.classes - app.membership_used(m.id), 0) end,
         m.starts_on, m.ends_on,
         m.ends_on is not null and m.ends_on < (now() at time zone o.timezone)::date,
         m.price_cents, m.currency, m.created_at
    from public.memberships m
    join public.profiles p on p.id = m.client_id
    join public.organizations o on o.id = m.organization_id
   where (m.client_id = app.uid() or app.can_manage(m.organization_id))
     and (p_client is null or m.client_id = p_client)
   order by (m.status = 'pending') desc, m.created_at desc
$$;

-- ---------------------------------------------------------------------------- bookings use a membership
-- When a client books a class covered by one of their active memberships (valid that day,
-- classes left), the booking uses it. Earliest-ending membership first.
create or replace function app.attach_membership() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  tz  text;
  day date;
begin
  if new.membership_id is not null or new.availability_id is null then return new; end if;
  select timezone into tz from public.organizations where id = new.organization_id;
  day := (new.starts_at at time zone tz)::date;
  select m.id into new.membership_id
    from public.memberships m
    join public.plan_classes pc on pc.plan_id = m.plan_id and pc.availability_id = new.availability_id
   where m.client_id = new.client_id and m.status = 'active'
     and day between m.starts_on and m.ends_on
     and (m.classes is null or app.membership_used(m.id) < m.classes)
   order by m.ends_on, m.created_at
   limit 1;
  return new;
end $$;

drop trigger if exists bookings_attach_membership on public.bookings;
create trigger bookings_attach_membership before insert on public.bookings
  for each row execute function app.attach_membership();

revoke all on function public.save_membership_plan(uuid, text, text, int, text, int, int, boolean),
  public.set_class_plans(uuid, uuid[]), public.request_membership(uuid), public.decide_membership(uuid, boolean),
  public.cancel_membership(uuid), public.list_memberships(uuid) from public;
grant execute on function public.save_membership_plan(uuid, text, text, int, text, int, int, boolean),
  public.set_class_plans(uuid, uuid[]), public.request_membership(uuid), public.decide_membership(uuid, boolean),
  public.cancel_membership(uuid), public.list_memberships(uuid) to authenticated, service_role;
grant execute on function app.membership_used(uuid) to authenticated, service_role;

-- the owner's red number on the app icon also counts membership requests
create or replace function app.badge_count(p_user uuid)
returns int
language sql stable security definer set search_path = public as $$
  select case p.role
    when 'owner' then (
      (select count(*)::int from public.bookings b
        where b.organization_id = p.organization_id and b.status = 'pending' and b.starts_at > now())
      + (select count(*)::int from public.memberships m
          where m.organization_id = p.organization_id and m.status = 'pending'))
    when 'super_admin' then (
      (select count(*)::int from public.media m where m.status = 'pending')
      + (select count(*)::int from public.content_reports r where r.status = 'open'))
    else 0 end
  from public.profiles p where p.id = p_user
$$;
