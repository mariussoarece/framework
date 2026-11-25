-- 014: history of organizations, codes freed when an organization closes,
-- the owner's email kept with each organization.

-- 1. The owner's email is stored on the organization itself, so the history still
--    shows it after the owner's account is deleted.
alter table public.organizations add column if not exists owner_email text;
update public.organizations o set owner_email = p.email
  from public.profiles p where p.id = o.owner_id and o.owner_email is null;

-- 2. Join codes only have to be unique among organizations that are not closed:
--    "marius" can be used again after the old "marius" closed.
alter table public.organizations drop constraint if exists organizations_join_code_key;
create unique index if not exists organizations_join_code_open_uq
  on public.organizations (join_code) where status <> 'closed';

create or replace function app.make_join_code(p_name text) returns text
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
  while exists (select 1 from public.organizations where join_code = code and status <> 'closed') loop
    n := n + 1;
    code := base || n;
  end loop;
  return code;
end $$;

-- the email is filled in when an organization is created
create or replace function app.org_owner_email() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  if new.owner_email is null then
    new.owner_email := coalesce((select email from public.profiles where id = new.owner_id), app.jwt_email());
  end if;
  return new;
end $$;

drop trigger if exists organizations_owner_email on public.organizations;
create trigger organizations_owner_email before insert on public.organizations
  for each row execute function app.org_owner_email();

-- 3. History for the super admin: every organization, open or closed, newest first.
--    "active" is true only for organizations that are not closed.
create or replace function public.admin_organization_history()
returns table (id uuid, name text, join_code text, owner_email text, status text,
               active boolean, created_at timestamptz, closed_at timestamptz)
language plpgsql stable security definer set search_path = public, app as $$
begin
  perform app.require_super_admin();
  return query
    select o.id, o.name, o.join_code, o.owner_email, o.status, o.status <> 'closed',
           o.created_at, o.closed_at
    from public.organizations o
    order by o.created_at desc;
end $$;

revoke all on function public.admin_organization_history() from public;
grant execute on function public.admin_organization_history() to authenticated;
