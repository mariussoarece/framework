-- 007_reports_admin.sql
-- Content reports (Apple requires a way to report user-uploaded content) and
-- the super admin's organization tools.

-- New reports notify the super admin (server: event "report.created").
create function app.report_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.events (type, payload)
  values ('report.created', jsonb_build_object('report_id', new.id));
  return new;
end $$;

create trigger content_reports_event after insert on public.content_reports
  for each row execute function app.report_event();

create function app.require_super_admin() returns void
language plpgsql stable security definer set search_path = public, app as $$
begin
  if not app.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Organizations overview
-- ---------------------------------------------------------------------------
create function public.admin_organizations()
returns table (id uuid, name text, join_code text, plan text, status text, is_default boolean,
               trial_ends_at timestamptz, created_at timestamptz, owner_email text,
               clients int, open_reports int)
language plpgsql stable security definer set search_path = public, app as $$
begin
  perform app.require_super_admin();
  return query
    select o.id, o.name, o.join_code, o.plan, o.status, o.is_default, o.trial_ends_at, o.created_at,
           (select p.email from public.profiles p where p.id = o.owner_id),
           (select count(*)::int from public.profiles p where p.organization_id = o.id and p.role = 'client'),
           (select count(*)::int from public.content_reports r where r.organization_id = o.id and r.status = 'open')
    from public.organizations o
    where o.status <> 'closed'
    order by o.is_default desc, o.name;
end $$;

-- Pause or re-activate an organization (closing goes through the server, which also
-- refunds and emails clients).
create function public.admin_set_org_status(p_org uuid, p_status text)
returns void
language plpgsql security definer set search_path = public, app as $$
begin
  perform app.require_super_admin();
  if p_status not in ('trial', 'active', 'paused') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  update public.organizations set status = p_status where id = p_org and status <> 'closed';
  if not found then
    raise exception 'organization_not_found' using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------
create function public.admin_reports(p_status text default 'open')
returns table (id uuid, status text, reason text, created_at timestamptz,
               organization_id uuid, organization_name text,
               workout_id uuid, workout_name text, media_id uuid, media_kind text,
               reporter_email text)
language plpgsql stable security definer set search_path = public, app as $$
begin
  perform app.require_super_admin();
  return query
    select r.id, r.status, r.reason, r.created_at, r.organization_id, o.name,
           r.workout_id, w.name, r.media_id, m.kind, p.email
    from public.content_reports r
    join public.organizations o on o.id = r.organization_id
    left join public.workouts w on w.id = r.workout_id
    left join public.media m on m.id = r.media_id
    left join public.profiles p on p.id = r.reporter_id
    where r.status = p_status
    order by r.created_at desc
    limit 200;
end $$;

create function public.resolve_report(p_id uuid)
returns void
language plpgsql security definer set search_path = public, app as $$
begin
  perform app.require_super_admin();
  update public.content_reports set status = 'resolved' where id = p_id;
end $$;

-- One open report per person per workout (tapping twice doesn't create two).
create unique index content_reports_one_open_uq on public.content_reports (reporter_id, workout_id)
  where status = 'open' and workout_id is not null;

revoke all on function public.admin_organizations(), public.admin_set_org_status(uuid, text),
  public.admin_reports(text), public.resolve_report(uuid) from public;
grant execute on function public.admin_organizations(), public.admin_set_org_status(uuid, text),
  public.admin_reports(text), public.resolve_report(uuid) to authenticated, service_role;
grant execute on function app.require_super_admin() to authenticated, service_role;

-- Fix: owners deleting their own pictures/videos must be able to queue the
-- "delete the files" event (the trigger ran with the owner's rights before).
alter function app.media_event() security definer;
alter function app.media_event() set search_path = public;
alter function app.booking_event() security definer;
alter function app.booking_event() set search_path = public;
