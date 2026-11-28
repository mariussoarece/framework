-- 019: the daily limit of messages to clients can be changed without a code change.
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
  -- clients should not be flooded: at most N messages a day per organization.
  -- N = the database setting app.announcements_per_day (default 5); for testing:
  --   ALTER DATABASE app SET app.announcements_per_day = '1000';   then restart "rest"
  if (select count(*) from public.announcements
       where organization_id = org and created_at > now() - interval '24 hours')
     >= coalesce(nullif(current_setting('app.announcements_per_day', true), '')::int, 5) then
    raise exception 'too_many_messages' using errcode = 'P0001';
  end if;

  insert into public.announcements (organization_id, created_by, title, body)
  values (org, app.uid(), btrim(p_title), btrim(p_body))
  returning * into a;

  insert into public.events (type, payload)
  values ('announcement.created', jsonb_build_object('announcement_id', a.id));
  return a;
end $$;

