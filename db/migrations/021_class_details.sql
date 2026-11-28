-- 021: classes get a picture and a description (rich text, like a workout's).

alter table public.availability
  add column if not exists description    jsonb,
  add column if not exists image_media_id uuid references public.media (id) on delete set null;

drop function if exists public.save_availability(uuid, int[], text, text, text, time, time, int, int, int, date, date);

create function public.save_availability(
  p_id uuid, p_weekdays int[], p_kind text, p_title text, p_instructor text,
  p_start time, p_end time, p_slot_minutes int, p_capacity int, p_price_cents int,
  p_valid_from date, p_valid_until date,
  p_description jsonb default null, p_image_media_id uuid default null)
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
  -- the class picture must be a picture of this organization
  if p_image_media_id is not null and not exists (
       select 1 from public.media m where m.id = p_image_media_id and m.organization_id = o and m.kind = 'image') then
    raise exception 'media_not_found' using errcode = 'P0001';
  end if;
  if p_description is not null and length(p_description::text) > 50000 then
    raise exception 'description_too_long' using errcode = 'P0001';
  end if;

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
        description = p_description, image_media_id = p_image_media_id,
        valid_from = coalesce(p_valid_from, old.valid_from), valid_until = p_valid_until
      where id = p_id
      returning *;
    return;
  end if;

  foreach wd in array p_weekdays loop
    return query
      insert into public.availability (organization_id, weekday, kind, title, instructor, start_time, end_time,
                                       slot_minutes, capacity, price_cents, valid_from, valid_until,
                                       description, image_media_id)
      values (o, wd, p_kind, nullif(trim(p_title), ''), nullif(trim(p_instructor), ''), p_start, e_end,
              p_slot_minutes, p_capacity, p_price_cents, coalesce(p_valid_from, current_date), p_valid_until,
              p_description, p_image_media_id)
      returning *;
  end loop;
end $$;


revoke all on function public.save_availability(uuid, int[], text, text, text, time, time, int, int, int, date, date, jsonb, uuid) from public;
grant execute on function public.save_availability(uuid, int[], text, text, text, time, time, int, int, int, date, date, jsonb, uuid) to authenticated, service_role;
