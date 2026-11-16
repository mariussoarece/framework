-- 004_seed.sql
-- The default organization. Clients without a code join it.
-- Its owner is assigned later (see README: "Make yourself the owner of YogaByTheSofa").

insert into public.organizations (name, join_code, is_default, plan, status, trial_ends_at, commission_percent)
values ('YogaByTheSofa', 'yogabythesofa', true, 'none', 'active', 'infinity', 0)
on conflict do nothing;

insert into public.home_settings (organization_id)
select id from public.organizations where join_code = 'yogabythesofa'
on conflict do nothing;

insert into public.home_buttons (organization_id, type, label, icon, position)
select id, 'scheduling', 'Scheduling', 'calendar', 0 from public.organizations where join_code = 'yogabythesofa'
union all
select id, 'workouts', 'Workout Maintenance', 'dumbbell', 1 from public.organizations where join_code = 'yogabythesofa'
on conflict do nothing;
