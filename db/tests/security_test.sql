-- Security and behaviour tests. Run on a throwaway database after the migrations:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f db/tests/security_test.sql
-- Any failed check stops the script with an error.

\set QUIET on
\set u1 '''11111111-1111-1111-1111-111111111111'''
\set u2 '''22222222-2222-2222-2222-222222222222'''
\set u3 '''33333333-3333-3333-3333-333333333333'''
\set u4 '''44444444-4444-4444-4444-444444444444'''
\set u5 '''55555555-5555-5555-5555-555555555555'''
\set u6 '''66666666-6666-6666-6666-666666666666'''
\set u7 '''77777777-7777-7777-7777-777777777777'''
\set u8 '''88888888-8888-8888-8888-888888888888'''

create schema test;
grant usage on schema test to authenticated, service_role;

create function test.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAILED: %', msg; end if;
  raise notice 'ok - %', msg;
end $$;

-- Runs sql as the current role and checks that it fails with a message containing expected.
create function test.fails(sql text, expected text, msg text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if position(expected in sqlerrm) > 0 then
      raise notice 'ok - %', msg;
      return;
    end if;
    raise exception 'FAILED: % (got "%")', msg, sqlerrm;
  end;
  raise exception 'FAILED: % (no error)', msg;
end $$;

grant execute on all functions in schema test to authenticated, service_role;

-- log in as a user: role authenticated + token claims
create function test.claims(u uuid, email text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'email', email)::text, false)
$$;
grant execute on function test.claims(uuid, text) to authenticated;

-- ---------------------------------------------------------------- owners
reset role; select test.claims(:u1, 'owner.a@example.com'); set role authenticated;
select test.ok((select join_code from public.create_organization('Yoga With Mărius', 'commission')) = 'yogawithmarius',
               'owner A creates "Yoga With Mărius", join code yogawithmarius');
select test.ok((select count(*) from public.home_buttons) = 2, 'new organization gets two default buttons');

reset role; select test.claims(:u2, 'owner.b@example.com'); set role authenticated;
select test.fails($$select public.create_organization('  YOGA with mărius ')$$, 'name_taken',
                  'same name with different case is refused');
select test.ok((select join_code from public.create_organization('Karate Dojo', 'none')) = 'karatedojo',
               'owner B creates Karate Dojo');
select test.fails($$select public.create_organization('Second Org')$$, 'already_owner',
                  'an owner cannot create a second organization');

-- ---------------------------------------------------------------- workouts (owner A)
reset role; select test.claims(:u1, 'owner.a@example.com'); set role authenticated;
insert into public.sections (organization_id, name) select app.my_org(), 'Shoulders';
insert into public.workouts (organization_id, name, sets, reps, rest_seconds, warning, avoid)
  select app.my_org(), 'Cobra Pose', 3, 10, 30, 'Stop if your back hurts', 'Do not lock the elbows';
insert into public.section_workouts (section_id, workout_id, organization_id)
  select s.id, w.id, s.organization_id from public.sections s, public.workouts w;
select test.ok((select count(*) from public.section_workouts) = 1, 'owner links workout to section');
select test.fails($$insert into public.workouts (organization_id, name, sets, reps, duration_seconds)
                    select app.my_org(), 'Both', 3, 10, 60$$, 'workouts_reps_xor_time',
                  'repetitions and time together are refused');
select test.fails($$insert into public.workouts (organization_id, name, sets)
                    select app.my_org(), 'Neither', 3$$, 'workouts_reps_xor_time',
                  'neither repetitions nor time is refused');
select test.fails($$update public.home_buttons set type = 'workouts' where type = 'scheduling'$$,
                  'permission denied', 'owner cannot change what a button does');
update public.home_buttons set label = 'Book a session', color = '#AA3355' where type = 'scheduling';
select test.ok((select label from public.home_buttons where type = 'scheduling') = 'Book a session',
               'owner renames a button');
select count(*) from public.save_availability(null, array[0,1,2,3,4,5,6], 'open', null, null,
  '09:00', '12:00', 60, 1, 3000, current_date, null);
select test.fails($$insert into public.availability (organization_id, weekday, start_time, end_time)
                    select app.my_org(), 1, '13:00', '14:00'$$, 'permission denied',
                  'timetable changes only through save_availability (with checks)');

-- ---------------------------------------------------------------- owner B cannot touch A
reset role; select test.claims(:u2, 'owner.b@example.com'); set role authenticated;
select test.ok((select count(*) from public.sections) = 0, 'owner B sees none of A''s sections');
select test.ok((select count(*) from public.workouts) = 0, 'owner B sees none of A''s workouts');
select test.ok((select count(*) from public.organizations) = 1, 'owner B sees only its own organization');
reset role;
select set_config('test.org_a', (select id::text from public.organizations where join_code = 'yogawithmarius'), false);
select test.claims(:u2, 'owner.b@example.com'); set role authenticated;
select test.fails($$insert into public.sections (organization_id, name)
                    values (current_setting('test.org_a')::uuid, 'Hacked')$$,
                  'row-level security', 'owner B cannot add a section to A');
update public.workouts set name = 'Hacked';
reset role;
select test.ok((select name from public.workouts) = 'Cobra Pose', 'owner B''s update of A''s workout changes nothing');

-- ---------------------------------------------------------------- clients
select test.claims(:u3, 'client.a@example.com'); set role authenticated;
select test.ok((select name from public.find_organization('YogaWithMarius')) = 'Yoga With Mărius',
               'client looks up the code case-insensitively');
select public.join_organization('yogawithmarius');
select test.ok((select count(*) from public.workouts) = 1, 'client of A sees A''s workout');
select test.fails($$insert into public.sections (organization_id, name) select app.my_org(), 'Nope'$$,
                  'row-level security', 'client cannot add sections');
update public.workouts set name = 'Changed';
select test.ok((select name from public.workouts) = 'Cobra Pose', 'client cannot edit workouts');
update public.home_buttons set label = 'Mine';
select test.ok((select count(*) from public.home_buttons where label = 'Mine') = 0, 'client cannot edit buttons');

reset role; select test.claims(:u4, 'client.b@example.com'); set role authenticated;
select public.join_organization('karatedojo');
select test.ok((select count(*) from public.workouts) = 0, 'client of B sees none of A''s workouts');

reset role; select test.claims(:u6, 'nocode@example.com'); set role authenticated;
select test.ok((select name from public.join_organization(null)) = 'YogaByTheSofa',
               'client without a code joins YogaByTheSofa');

reset role; select test.claims(:u7, 'client.a2@example.com'); set role authenticated;
select public.join_organization('yogawithmarius');

-- ---------------------------------------------------------------- media approval
reset role;
insert into public.profiles (id, email, role) values (:u5, 'admin@example.com', 'super_admin');
select test.claims(:u1, 'owner.a@example.com'); set role authenticated;
insert into public.media (organization_id, kind, original_path, uploaded_by)
  select app.my_org(), 'video', 'uploads/cobra.mp4', app.uid();
select test.fails($$insert into public.media (organization_id, kind, original_path, uploaded_by, status)
                    select app.my_org(), 'video', 'x.mp4', app.uid(), 'published'$$,
                  'permission denied', 'owner cannot upload as already published');
select test.fails($$select public.review_media((select id from public.media limit 1), true)$$,
                  'forbidden', 'owner cannot approve media');

reset role; select test.claims(:u3, 'client.a@example.com'); set role authenticated;
select test.ok((select count(*) from public.media) = 0, 'client does not see pending media');

reset role; select test.claims(:u5, 'admin@example.com'); set role authenticated;
select test.ok((select status from public.review_media((select id from public.media limit 1), true)) = 'approved',
               'super admin approves media');
reset role;
update public.media set status = 'published', file_720 = 'a_720.mp4', file_1080 = 'a_1080.mp4';  -- the worker
select test.claims(:u3, 'client.a@example.com'); set role authenticated;
select test.ok((select count(*) from public.media) = 1, 'client sees media once published');

-- ---------------------------------------------------------------- bookings
select set_config('test.slot', (select starts_at::text from public.available_slots() limit 1), false);
select test.ok(current_setting('test.slot') <> '', 'client sees free slots');
select test.ok((select status from public.request_booking(current_setting('test.slot')::timestamptz)) = 'pending',
               'client requests a booking, status pending');
select test.fails($$select public.request_booking(current_setting('test.slot')::timestamptz)$$,
                  'already_booked', 'same client cannot book the same slot twice');
select test.fails($$select public.decide_booking((select id from public.bookings limit 1), true)$$,
                  'booking_not_found', 'client cannot accept their own booking');

reset role; select test.claims(:u7, 'client.a2@example.com'); set role authenticated;
select test.fails($$select public.request_booking(current_setting('test.slot')::timestamptz)$$,
                  'slot_unavailable', 'a full slot (capacity 1) is refused');
select test.ok((select count(*) from public.bookings) = 0, 'a client does not see other clients'' bookings');

reset role; select test.claims(:u4, 'client.b@example.com'); set role authenticated;
select test.fails($$select public.request_booking(current_setting('test.slot')::timestamptz)$$,
                  'slot_unavailable', 'client of B cannot book in A''s timetable');

reset role;
select test.ok((select payment_status from public.bookings limit 1) = 'requires_payment',
               'a paid slot waits for the card');
select test.ok((select commission_percent from public.organizations where join_code = 'yogawithmarius') = 10
               and (select commission_percent from public.organizations where join_code = 'karatedojo') = 0,
               'commission follows the plan (10% commission plan, 0% otherwise)');
select test.claims(:u1, 'owner.a@example.com'); set role authenticated;
select test.fails($$select public.decide_booking((select id from public.bookings limit 1), true)$$,
                  'payment_pending', 'owner cannot accept before the card is authorized');
reset role;
update public.bookings set payment_status = 'authorized';   -- the Stripe webhook
select test.claims(:u1, 'owner.a@example.com'); set role authenticated;
select test.ok((select status from public.decide_booking((select id from public.bookings limit 1), true)) = 'accepted',
               'owner accepts the booking');
select test.fails($$select * from public.events$$, 'permission denied', 'app users cannot read the event queue');
reset role;
select test.ok((select array_agg(type order by id) from public.events where type like 'booking.%')
               = array['booking.created', 'booking.payment', 'booking.status'],
               'booking events are queued for the server');
select test.ok((select count(*) from public.events where type = 'media.approved') = 1, 'media approval is queued');
set role service_role;
select test.ok((select count(*) from public.claim_events(100)) >= 4, 'server claims events');
select public.finish_event((select min(id) from public.events), null);
select test.ok((select count(*) from public.claim_events(100)) = 0, 'claimed events are leased, not handed out twice');
reset role;
select test.ok((select done_at is not null from public.events order by id limit 1), 'finished event is marked done');
select test.claims(:u1, 'owner.a@example.com'); set role authenticated;
select test.fails($$select public.claim_events(1)$$, 'permission denied', 'app users cannot claim events');
select test.ok((select count(*) from public.profiles) = 3, 'owner sees own profile and both clients');

reset role; select test.claims(:u2, 'owner.b@example.com'); set role authenticated;
select test.ok((select count(*) from public.bookings) = 0, 'owner B sees none of A''s bookings');

-- ---------------------------------------------------------------- classes, weeks, blocked times, clashes
reset role; select test.claims(:u2, 'owner.b@example.com'); set role authenticated;
-- class on Mon+Wed+Fri 18:00, 60 min, 2 places, for 3 weeks
select test.ok((select count(*) from public.save_availability(null, array[1,3,5], 'class', 'Low kick', 'Sensei Ana',
  '18:00', null, 60, 2, 0, current_date, current_date + 20)) = 3, 'one class created on three weekdays at once');
select test.ok((select end_time from public.availability where title = 'Low kick' limit 1) = '19:00',
  'class end time follows its length');
select test.fails($$select public.save_availability(null, array[3], 'open', null, null, '18:30', '20:00', 30, 1, 0, current_date, null)$$,
  'schedule_clash|3|18:00|19:00|Low kick', 'overlapping entry on the same weekday is refused, naming the clash');
select test.fails($$select public.save_availability(null, array[2,3], 'open', null, null, '18:30', '20:00', 30, 1, 0, current_date, null)$$,
  'schedule_clash', 'multi-day create is all-or-nothing when one day clashes');
select test.ok((select count(*) from public.availability where weekday = 2) = 0, 'nothing saved for the other day');
select test.ok((select count(*) from public.save_availability(null, array[3], 'open', null, null, '18:30', '20:00', 30, 1, 0,
  current_date + 21, null)) = 1, 'same time is fine after the class period ends');
select test.ok((select count(*) from public.save_availability(null, array[3], 'open', null, null, '07:00', '09:00', 30, 1, 0,
  current_date, null)) = 1, 'open hours next to the class are fine');
select test.ok((select count(*) from public.save_availability(null, array[6], 'open', null, null, '08:00', '18:00', 600, 1, 0,
  current_date, null)) = 1, 'a 10-hour session is allowed');
select test.fails($$select public.save_availability(null, array[2], 'open', null, null, '07:00', '19:00', 660, 1, 0, current_date, null)$$,
  'availability_slot_minutes_check', 'more than 10 hours is refused');
select test.ok((select count(*) from public.week_overview(current_date, 28) where title = 'Low kick')
  between 8 and 10, 'class repeats only for its three weeks');
select test.ok((select count(distinct kind) from public.week_overview(current_date, 7)) = 2, 'week view lists classes and open hours');

reset role; select test.claims(:u4, 'client.b@example.com'); set role authenticated;
select set_config('test.kick', (select starts_at::text from public.available_slots(current_date, 14)
  where title = 'Low kick' order by starts_at limit 1), false);
select test.ok((select remaining || '/' || capacity || ' ' || instructor from public.available_slots(current_date, 14)
  where starts_at = current_setting('test.kick')::timestamptz) = '2/2 Sensei Ana', 'client sees the class with places and instructor');
select test.ok((select title from public.request_booking(current_setting('test.kick')::timestamptz)) = 'Low kick',
  'booking keeps the class name');
select test.ok((select remaining from public.available_slots(current_date, 14)
  where starts_at = current_setting('test.kick')::timestamptz) = 1, 'places go down after a booking');

reset role; select test.claims(:u2, 'owner.b@example.com'); set role authenticated;
select test.fails($$select public.save_availability((select id from public.availability where title = 'Low kick'
  and weekday = extract(dow from (current_setting('test.kick')::timestamptz at time zone 'Europe/Bucharest'))),
  array[extract(dow from (current_setting('test.kick')::timestamptz at time zone 'Europe/Bucharest'))::int],
  'class', 'Low kick', 'Sensei Ana', '17:00', null, 60, 2, 0, current_date, current_date + 20)$$,
  'rule_has_bookings', 'moving a class with bookings is refused');
select test.fails($$select public.delete_availability((select availability_id from public.bookings
  where title = 'Low kick' limit 1))$$, 'rule_has_bookings', 'deleting a class with bookings is refused');
select test.fails($$select public.block_slot(current_setting('test.kick')::timestamptz, true)$$,
  'slot_has_bookings', 'a booked session cannot be blocked');
select set_config('test.wed', (current_date + ((3 - extract(dow from current_date)::int + 7) % 7) + 7)::text, false);
select set_config('test.open', (select starts_at::text from public.day_slots(current_setting('test.wed')::date)
  where kind = 'open' order by starts_at limit 1), false);
select test.ok((select count(*) from public.day_slots(current_setting('test.wed')::date) where kind = 'open') >= 4,
  'owner sees the sessions of a day');
select public.block_slot(current_setting('test.open')::timestamptz, true);
select test.ok((select blocked from public.day_slots(current_setting('test.wed')::date) where starts_at = current_setting('test.open')::timestamptz),
  'session blocked');
reset role; select test.claims(:u4, 'client.b@example.com'); set role authenticated;
select test.ok(not exists (select 1 from public.available_slots(current_date, 14)
  where starts_at = current_setting('test.open')::timestamptz), 'clients cannot book a blocked session');
reset role; select test.claims(:u2, 'owner.b@example.com'); set role authenticated;
select public.block_slot(current_setting('test.open')::timestamptz, false);
insert into public.availability_exceptions (organization_id, day, closed) select app.my_org(), current_setting('test.wed')::date, true;
select test.fails($$select public.block_slot(current_setting('test.open')::timestamptz, true)$$, 'day_off',
  'blocking on a whole day off says so');
delete from public.availability_exceptions where day = current_setting('test.wed')::date and start_time is null;
select test.fails($$select public.block_slot(now() + interval '3 days 17 minutes', true)$$, 'slot_not_found',
  'blocking a session that does not exist says so');
select test.ok(not (select blocked from public.day_slots(current_setting('test.wed')::date) where starts_at = current_setting('test.open')::timestamptz),
  'session unblocked');
reset role; select test.claims(:u4, 'client.b@example.com'); set role authenticated;
select test.fails($$select public.block_slot(current_setting('test.open')::timestamptz, true)$$, 'forbidden',
  'clients cannot block sessions');
select test.fails($$select public.save_availability(null, array[1], 'open', null, null, '06:00', '07:00', 60, 1, 0, current_date, null)$$,
  'forbidden', 'clients cannot change the timetable');

-- ---------------------------------------------------------------- expiry
reset role;
insert into public.bookings (organization_id, client_id, starts_at, ends_at, price_cents, payment_status, created_at)
select organization_id, id, now() + interval '2 days', now() + interval '2 days 1 hour', 2000,
       'requires_payment', now() - interval '31 minutes'
from public.profiles where id = :u4;
set role service_role;
select test.ok(public.expire_bookings() = 1, 'unpaid booking expires after 30 minutes');
reset role;
select test.ok((select status || '/' || cancelled_by from public.bookings where client_id = :u4 and price_cents = 2000) = 'cancelled/system',
               'expired booking is cancelled by the system');

-- ---------------------------------------------------------------- owner deletes media
reset role; select test.claims(:u1, 'owner.a@example.com'); set role authenticated;
insert into public.media (organization_id, kind, original_path, uploaded_by)
  select app.my_org(), 'image', 'uploads/old-background.jpg', app.uid();
delete from public.media where original_path = 'uploads/old-background.jpg';
reset role;
select test.ok((select count(*) from public.events where type = 'media.deleted') = 1,
  'owner can delete own media; the server is told to remove the files');

-- ---------------------------------------------------------------- reports and admin tools
reset role; select test.claims(:u3, 'client.a@example.com'); set role authenticated;
insert into public.content_reports (organization_id, workout_id, reporter_id, reason)
  select organization_id, id, app.uid(), 'Inappropriate: test' from public.workouts limit 1;
select test.fails($$insert into public.content_reports (organization_id, workout_id, reporter_id, reason)
  select organization_id, id, app.uid(), 'again' from public.workouts limit 1$$,
  'content_reports_one_open_uq', 'the same person cannot report the same workout twice while open');
reset role; select test.claims(:u4, 'client.b@example.com'); set role authenticated;
select test.fails($$insert into public.content_reports (organization_id, workout_id, reporter_id, reason)
  values (current_setting('test.org_a')::uuid, null, app.uid(), 'x x x')$$,
  'row-level security', 'a client cannot report another organization''s content');
reset role;
select test.ok((select count(*) from public.events where type = 'report.created') = 1, 'a report notifies the admin (event)');
select test.claims(:u1, 'owner.a@example.com'); set role authenticated;
select test.fails($$select * from public.admin_organizations()$$, 'forbidden', 'owners cannot use admin tools');
reset role; select test.claims(:u5, 'admin@example.com'); set role authenticated;
select test.ok((select clients || '/' || open_reports || ' ' || owner_email from public.admin_organizations()
  where join_code = 'yogawithmarius') = '2/1 owner.a@example.com', 'admin sees clients, open reports and owner per organization');
select test.ok((select workout_name || ' / ' || reporter_email from public.admin_reports())
  = 'Cobra Pose / client.a@example.com', 'admin sees the report with workout and reporter');
select public.admin_set_org_status(current_setting('test.org_a')::uuid, 'paused');
reset role; select test.claims(:u3, 'client.a@example.com'); set role authenticated;
select test.fails($$select public.request_booking((select starts_at from public.available_slots() limit 1))$$,
  'organization_unavailable', 'clients of a paused organization cannot book');
reset role; select test.claims(:u5, 'admin@example.com'); set role authenticated;
select public.admin_set_org_status(current_setting('test.org_a')::uuid, 'active');
select public.resolve_report((select id from public.admin_reports() limit 1));
select test.ok((select count(*) from public.admin_reports()) = 0, 'resolved report leaves the open list');
select test.fails($$select public.admin_set_org_status(current_setting('test.org_a')::uuid, 'closed')$$,
  'invalid_status', 'closing only through the server (refunds, emails)');

-- ---------------------------------------------------------------- closing an organization
reset role;
select test.ok((select count(*) from app.close_organization(current_setting('test.org_a')::uuid)) = 2,
               'closing A returns its two clients to email');
select test.ok((select organization_id from public.profiles where id = :u3) is null,
               'clients of a closed organization are released');
select test.ok((select count(*) from public.workouts where organization_id = current_setting('test.org_a')::uuid) = 0,
               'closed organization''s workouts are deleted');
select test.ok((select status from public.bookings where organization_id = current_setting('test.org_a')::uuid limit 1) = 'cancelled', 'future bookings are cancelled');
select test.fails($$select * from app.close_organization((select id from public.organizations where is_default))$$,
                  'cannot_close_default', 'YogaByTheSofa cannot be closed');

select test.claims(:u8, 'new.owner@example.com'); set role authenticated;
select test.ok((select join_code from public.create_organization('Yoga With Marius')) = 'yogawithmarius2',
               'a closed organization''s name can be reused (new join code)');

reset role;
\echo 'All tests passed.'
