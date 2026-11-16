-- 005_server_events_payments.sql
-- What the Node server needs: an event queue, booking payment states,
-- plan-based commission, and functions only the server may call.

-- ---------------------------------------------------------------------------
-- Commission follows the plan unless set explicitly
-- ---------------------------------------------------------------------------
create function app.plan_commission() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.plan is distinct from old.plan then
    new.commission_percent := case new.plan when 'commission' then 10 else 0 end;
  end if;
  return new;
end $$;

create trigger organizations_plan_commission before insert or update of plan on public.organizations
  for each row execute function app.plan_commission();

update public.organizations set commission_percent = 0 where plan <> 'commission';

-- ---------------------------------------------------------------------------
-- Booking payment state
--   not_required      free, or the organization doesn't take online payment
--   requires_payment  client must still authorize the card (30 minutes)
--   authorized        card authorized; charged when the owner accepts
--   captured          charged
--   canceled          authorization released (declined / cancelled before charge)
--   refunded          charged, then refunded
-- ---------------------------------------------------------------------------
alter table public.bookings
  add column payment_status text not null default 'not_required'
    check (payment_status in ('not_required', 'requires_payment', 'authorized',
                              'captured', 'canceled', 'refunded'));
create unique index bookings_payment_intent_uq on public.bookings (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create or replace function public.request_booking(p_starts_at timestamptz)
returns public.bookings
language plpgsql security definer set search_path = public, app as $$
declare
  u    uuid := app.require_login();
  p    public.profiles;
  org  public.organizations;
  slot record;
  b    public.bookings;
  price int;
begin
  select * into p from public.profiles where id = u;
  if p.role is distinct from 'client' or p.organization_id is null then
    raise exception 'only_clients_can_book' using errcode = 'P0001';
  end if;
  select * into org from public.organizations where id = p.organization_id;
  if org.status not in ('trial', 'active') then
    raise exception 'organization_unavailable' using errcode = 'P0001';
  end if;

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

  price := case when org.plan = 'none' then 0 else slot.price_cents end;

  insert into public.bookings (organization_id, client_id, starts_at, ends_at,
                               price_cents, currency, payment_status)
  values (org.id, u, slot.starts_at, slot.ends_at, price, slot.currency,
          case when price > 0 then 'requires_payment' else 'not_required' end)
  returning * into b;
  return b;
end $$;

create or replace function public.decide_booking(p_booking uuid, p_accept boolean)
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
  if p_accept and b.payment_status = 'requires_payment' then
    raise exception 'payment_pending' using errcode = 'P0001';
  end if;
  update public.bookings
     set status = case when p_accept then 'accepted' else 'declined' end,
         decided_at = now()
   where id = p_booking
  returning * into b;
  return b;
end $$;

-- ---------------------------------------------------------------------------
-- Event queue (outbox). Triggers add rows; the server claims and handles them.
-- Replaces the pg_notify triggers from 003.
-- ---------------------------------------------------------------------------
drop trigger if exists bookings_notify on public.bookings;
drop trigger if exists media_notify on public.media;
drop function if exists app.notify_booking();
drop function if exists app.notify_media();

create table public.events (
  id         bigserial primary key,
  type       text not null,
  payload    jsonb not null,
  attempts   int not null default 0,
  run_after  timestamptz not null default now(),
  done_at    timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index events_todo_idx on public.events (run_after) where done_at is null;
alter table public.events enable row level security;   -- no policies: app users see nothing
grant all on public.events to service_role;
grant usage on sequence public.events_id_seq to service_role;

create function app.booking_event() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into public.events (type, payload)
    values ('booking.created', jsonb_build_object('booking_id', new.id));
  else
    if new.status is distinct from old.status then
      insert into public.events (type, payload)
      values ('booking.status', jsonb_build_object('booking_id', new.id,
              'status', new.status, 'old_status', old.status, 'cancelled_by', new.cancelled_by));
    end if;
    if new.payment_status is distinct from old.payment_status then
      insert into public.events (type, payload)
      values ('booking.payment', jsonb_build_object('booking_id', new.id,
              'payment_status', new.payment_status, 'old_payment_status', old.payment_status));
    end if;
  end if;
  return new;
end $$;

create trigger bookings_events after insert or update of status, payment_status on public.bookings
  for each row execute function app.booking_event();

create function app.media_event() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    insert into public.events (type, payload)
    values ('media.deleted', jsonb_build_object('media_id', old.id,
            'paths', jsonb_build_array(old.original_path, old.file_720, old.file_1080, old.image_path)));
    return old;
  end if;
  if new.status is distinct from old.status and new.status in ('approved', 'rejected', 'published') then
    insert into public.events (type, payload)
    values ('media.' || new.status, jsonb_build_object('media_id', new.id));
  end if;
  return new;
end $$;

create trigger media_events after update of status or delete on public.media
  for each row execute function app.media_event();

-- Claim up to p_limit events; each claim leases the event for 30 minutes.
create function public.claim_events(p_limit int default 10)
returns setof public.events
language sql security definer set search_path = public as $$
  update public.events e
     set attempts = e.attempts + 1, run_after = now() + interval '30 minutes'
   where e.id in (select id from public.events
                  where done_at is null and run_after <= now() and attempts < 8
                  order by id limit p_limit
                  for update skip locked)
  returning e.*
$$;

-- Mark done, or schedule a retry with growing delay.
create function public.finish_event(p_id bigint, p_error text default null)
returns void
language sql security definer set search_path = public as $$
  update public.events
     set done_at    = case when p_error is null then now() end,
         last_error = p_error,
         run_after  = case when p_error is null then run_after
                           else now() + make_interval(mins => attempts * attempts) end
   where id = p_id
$$;

-- Unpaid bookings free their slot after 30 minutes; authorizations not decided
-- within 6 days are declined (card authorizations expire after 7).
create function public.expire_bookings()
returns int
language plpgsql security definer set search_path = public as $$
declare n int; m int;
begin
  update public.bookings set status = 'cancelled', cancelled_by = 'system'
   where status = 'pending' and payment_status = 'requires_payment'
     and created_at < now() - interval '30 minutes';
  get diagnostics n = row_count;
  update public.bookings set status = 'declined', decided_at = now()
   where status = 'pending' and payment_status = 'authorized'
     and created_at < now() - interval '6 days';
  get diagnostics m = row_count;
  delete from public.events where done_at < now() - interval '30 days';
  return n + m;
end $$;

create function public.service_close_organization(p_org uuid)
returns table (client_id uuid, email text, language text)
language sql security definer set search_path = public, app as $$
  select * from app.close_organization(p_org)
$$;

revoke all on function public.claim_events(int), public.finish_event(bigint, text),
  public.expire_bookings(), public.service_close_organization(uuid) from public, authenticated;
grant execute on function public.claim_events(int), public.finish_event(bigint, text),
  public.expire_bookings(), public.service_close_organization(uuid) to service_role;
grant execute on all functions in schema public to service_role;
grant execute on all functions in schema app to service_role;
