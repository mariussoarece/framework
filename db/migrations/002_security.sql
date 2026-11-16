-- 002_security.sql
-- Row-level security: every query from the app runs as role "authenticated"
-- (or "anon" before login), and the user's id comes from the login token.
-- A user only ever sees rows of their own organization.

-- Roles used by PostgREST. infra/db-init creates them with passwords on the VPS;
-- this block only makes the migration safe to run on a fresh database.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Helpers (read the login token; security definer so policies can call them
-- without recursion)
-- ---------------------------------------------------------------------------
create function app.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;

create function app.my_org() returns uuid
language sql stable security definer set search_path = public, app as $$
  select organization_id from public.profiles where id = app.uid()
$$;

create function app.my_role() returns text
language sql stable security definer set search_path = public, app as $$
  select role from public.profiles where id = app.uid()
$$;

create function app.is_super_admin() returns boolean
language sql stable security definer set search_path = public, app as $$
  select coalesce(app.my_role() = 'super_admin', false)
$$;

create function app.is_owner_of(org uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select coalesce(app.my_role() = 'owner' and app.my_org() = org, false)
$$;

create function app.can_manage(org uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select app.is_owner_of(org) or app.is_super_admin()
$$;

create function app.is_member_of(org uuid) returns boolean
language sql stable security definer set search_path = public, app as $$
  select coalesce(app.my_org() = org, false) or app.is_super_admin()
$$;

-- ---------------------------------------------------------------------------
-- Base privileges: nothing for anon, table access for authenticated (then
-- narrowed by policies and column grants below).
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public, app from public;
grant usage on schema public, app to anon, authenticated, service_role;
grant execute on all functions in schema app to authenticated, service_role;
grant all on all tables in schema public to service_role;

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
grant select on public.organizations to authenticated;
grant update (name, timezone) on public.organizations to authenticated;

create policy org_select on public.organizations for select to authenticated
  using (app.is_member_of(id));
create policy org_update on public.organizations for update to authenticated
  using (app.can_manage(id)) with check (app.can_manage(id));

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
grant select on public.profiles to authenticated;
grant update (display_name, language, video_quality) on public.profiles to authenticated;

create policy profiles_select on public.profiles for select to authenticated
  using (id = app.uid()
         or app.is_super_admin()
         or (organization_id is not null and app.is_owner_of(organization_id)));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = app.uid()) with check (id = app.uid());

-- ---------------------------------------------------------------------------
-- Content an organization's members read and its owner writes
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['home_settings', 'home_buttons', 'sections', 'workouts',
                           'section_workouts', 'workout_media',
                           'availability', 'availability_exceptions']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format($p$create policy %1$s_read on public.%1$I for select to authenticated
                      using (app.is_member_of(organization_id))$p$, t);
    execute format($p$create policy %1$s_write on public.%1$I for insert to authenticated
                      with check (app.can_manage(organization_id))$p$, t);
    execute format($p$create policy %1$s_update on public.%1$I for update to authenticated
                      using (app.can_manage(organization_id))
                      with check (app.can_manage(organization_id))$p$, t);
    execute format($p$create policy %1$s_delete on public.%1$I for delete to authenticated
                      using (app.can_manage(organization_id))$p$, t);
  end loop;
end $$;

-- Buttons: owners change how a button looks, never what it does.
revoke insert, update, delete on public.home_buttons from authenticated;
grant update (label, icon, color, position) on public.home_buttons to authenticated;

-- ---------------------------------------------------------------------------
-- media: clients see only published files; owners upload as pending;
-- only the super admin changes status (approve / reject).
-- ---------------------------------------------------------------------------
alter table public.media enable row level security;
grant select, delete on public.media to authenticated;
grant insert (organization_id, kind, original_path, uploaded_by) on public.media to authenticated;

create policy media_select on public.media for select to authenticated
  using (app.is_super_admin()
         or app.is_owner_of(organization_id)
         or (status = 'published' and app.is_member_of(organization_id)));
create policy media_insert on public.media for insert to authenticated
  with check (app.is_owner_of(organization_id) and uploaded_by = app.uid());
create policy media_delete on public.media for delete to authenticated
  using (app.can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- bookings: read here, changed only through the functions in 003
-- ---------------------------------------------------------------------------
alter table public.bookings enable row level security;
grant select on public.bookings to authenticated;

create policy bookings_select on public.bookings for select to authenticated
  using (client_id = app.uid() or app.can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- content_reports: any member reports; owner and super admin read
-- ---------------------------------------------------------------------------
alter table public.content_reports enable row level security;
grant select on public.content_reports to authenticated;
grant insert (organization_id, media_id, workout_id, reporter_id, reason)
  on public.content_reports to authenticated;
grant update (status) on public.content_reports to authenticated;

create policy reports_insert on public.content_reports for insert to authenticated
  with check (reporter_id = app.uid() and app.is_member_of(organization_id));
create policy reports_select on public.content_reports for select to authenticated
  using (app.can_manage(organization_id) or reporter_id = app.uid());
create policy reports_update on public.content_reports for update to authenticated
  using (app.can_manage(organization_id)) with check (app.can_manage(organization_id));

-- ---------------------------------------------------------------------------
-- devices: each user manages their own push tokens
-- ---------------------------------------------------------------------------
alter table public.devices enable row level security;
grant select, insert, update, delete on public.devices to authenticated;

create policy devices_own on public.devices for all to authenticated
  using (user_id = app.uid()) with check (user_id = app.uid());
