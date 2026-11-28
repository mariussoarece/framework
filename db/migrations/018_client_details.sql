-- 018: a client's name and phone (filled in by the client in Settings), and the owner's
-- list of clients with how many classes each one booked.

alter table public.profiles add column if not exists phone text
  check (phone is null or (length(phone) between 3 and 30 and phone ~ '^[0-9+() .\-]+$'));
grant update (phone) on public.profiles to authenticated;

-- The owner's clients: name, email, phone, when they joined, and their bookings.
--   booked    = confirmed sessions (past and upcoming)
--   upcoming  = confirmed sessions still to come
--   pending   = requests waiting for the owner's answer
create or replace function public.my_clients()
returns table (id uuid, display_name text, email text, phone text, joined_at timestamptz,
               booked int, upcoming int, pending int)
language plpgsql stable security definer set search_path = public, app as $$
declare org uuid := app.my_org();
begin
  if app.my_role() <> 'owner' or org is null then
    raise exception 'owner_only' using errcode = 'P0001';
  end if;
  return query
    select p.id, p.display_name, p.email, p.phone, p.created_at,
           count(b.id) filter (where b.status = 'accepted')::int,
           count(b.id) filter (where b.status = 'accepted' and b.starts_at > now())::int,
           count(b.id) filter (where b.status = 'pending' and b.starts_at > now())::int
      from public.profiles p
      left join public.bookings b on b.client_id = p.id and b.organization_id = org
     where p.organization_id = org and p.role = 'client'
     group by p.id
     order by lower(coalesce(nullif(p.display_name, ''), p.email));
end $$;

revoke all on function public.my_clients() from public;
grant execute on function public.my_clients() to authenticated;
