-- 024: a client can have only one membership at a time: no new request while one is
-- waiting for approval or still active (not expired, classes left).
create or replace function public.request_membership(p_plan uuid)
returns public.memberships
language plpgsql security definer set search_path = public, app as $$
declare
  u  uuid := app.require_login();
  pr public.profiles;
  pl public.membership_plans;
  tz text;
  m  public.memberships;
begin
  select * into pr from public.profiles where id = u;
  select * into pl from public.membership_plans where id = p_plan;
  if pl.id is null or not pl.active or pr.role is distinct from 'client'
     or pr.organization_id is distinct from pl.organization_id then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select timezone into tz from public.organizations where id = pl.organization_id;
  if exists (select 1 from public.memberships x
              where x.client_id = u and x.organization_id = pl.organization_id
                and (x.status = 'pending'
                     or (x.status = 'active' and x.ends_on >= (now() at time zone tz)::date
                         and (x.classes is null or app.membership_used(x.id) < x.classes)))) then
    raise exception 'membership_exists' using errcode = 'P0001';
  end if;
  insert into public.memberships (organization_id, plan_id, client_id, name, classes, valid_days, price_cents, currency)
  values (pl.organization_id, pl.id, u, pl.name, pl.classes, pl.valid_days, pl.price_cents, pl.currency)
  returning * into m;
  insert into public.events (type, payload) values ('membership.requested', jsonb_build_object('membership_id', m.id));
  return m;
end $$;
