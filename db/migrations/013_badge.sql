-- The red number on the app icon: what is waiting for this person.
--   owner:       booking requests waiting for an answer
--   super admin: uploads waiting for approval + open reports
--   client:      nothing (0)
create or replace function app.badge_count(p_user uuid)
returns int
language sql stable security definer set search_path = public as $$
  select case p.role
    when 'owner' then (
      select count(*)::int from public.bookings b
       where b.organization_id = p.organization_id and b.status = 'pending' and b.starts_at > now())
    when 'super_admin' then (
      (select count(*)::int from public.media m where m.status = 'pending')
      + (select count(*)::int from public.content_reports r where r.status = 'open'))
    else 0 end
  from public.profiles p where p.id = p_user
$$;

-- for the app (its own number)
create or replace function public.my_badge_count()
returns int
language sql stable security definer set search_path = public as $$
  select coalesce(app.badge_count(app.uid()), 0)
$$;

-- for the server (the number sent with each notification)
create or replace function public.badge_count_for(p_user uuid)
returns int
language sql stable security definer set search_path = public as $$
  select coalesce(app.badge_count(p_user), 0)
$$;

revoke all on function app.badge_count(uuid), public.my_badge_count(), public.badge_count_for(uuid) from public;
grant execute on function public.my_badge_count() to authenticated;
grant execute on function public.badge_count_for(uuid) to service_role;
