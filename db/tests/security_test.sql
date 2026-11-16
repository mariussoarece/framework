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
grant usage on schema test to authenticated;

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

grant execute on all functions in schema test to authenticated;

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
insert into public.availability (organization_id, weekday, start_time, end_time, slot_minutes, capacity, price_cents)
  select app.my_org(), d, '09:00', '12:00', 60, 1, 3000 from generate_series(0, 6) d;

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

reset role; select test.claims(:u1, 'owner.a@example.com'); set role authenticated;
select test.ok((select status from public.decide_booking((select id from public.bookings limit 1), true)) = 'accepted',
               'owner accepts the booking');
select test.ok((select count(*) from public.profiles) = 3, 'owner sees own profile and both clients');

reset role; select test.claims(:u2, 'owner.b@example.com'); set role authenticated;
select test.ok((select count(*) from public.bookings) = 0, 'owner B sees none of A''s bookings');

-- ---------------------------------------------------------------- closing an organization
reset role;
select test.ok((select count(*) from app.close_organization(current_setting('test.org_a')::uuid)) = 2,
               'closing A returns its two clients to email');
select test.ok((select organization_id from public.profiles where id = :u3) is null,
               'clients of a closed organization are released');
select test.ok((select count(*) from public.workouts where organization_id = current_setting('test.org_a')::uuid) = 0,
               'closed organization''s workouts are deleted');
select test.ok((select status from public.bookings limit 1) = 'cancelled', 'future bookings are cancelled');
select test.fails($$select * from app.close_organization((select id from public.organizations where is_default))$$,
                  'cannot_close_default', 'YogaByTheSofa cannot be closed');

select test.claims(:u8, 'new.owner@example.com'); set role authenticated;
select test.ok((select join_code from public.create_organization('Yoga With Marius')) = 'yogawithmarius2',
               'a closed organization''s name can be reused (new join code)');

reset role;
\echo 'All tests passed.'
