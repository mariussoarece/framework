-- 001_schema.sql
-- Core tables. Every business table carries organization_id so row-level
-- security (002_security.sql) can keep organizations apart.

create extension if not exists pgcrypto;

create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Organizations
-- ---------------------------------------------------------------------------
create table public.organizations (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (length(trim(name)) between 2 and 60),
  name_key           text generated always as (lower(trim(name))) stored,
  join_code          text not null unique check (join_code ~ '^[a-z0-9]{3,40}$'),
  owner_id           uuid,                       -- auth user id of the owner admin
  is_default         boolean not null default false,
  timezone           text not null default 'Europe/Bucharest',
  plan               text not null default 'commission'
                       check (plan in ('none', 'commission', 'flat')),
  status             text not null default 'trial'
                       check (status in ('trial', 'active', 'paused', 'closed')),
  trial_ends_at      timestamptz not null default now() + interval '30 days',
  commission_percent numeric(4,2) not null default 10.00
                       check (commission_percent between 0 and 50),
  stripe_account_id  text,
  created_at         timestamptz not null default now(),
  closed_at          timestamptz
);

-- Names are unique ignoring case and surrounding spaces.
create unique index organizations_name_key_uq on public.organizations (name_key)
  where status <> 'closed';
-- Exactly one default organization (YogaByTheSofa).
create unique index organizations_one_default_uq on public.organizations (is_default)
  where is_default;

-- ---------------------------------------------------------------------------
-- Profiles (one per auth user; the auth user itself lives in auth.users,
-- managed by the login service)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id              uuid primary key,              -- = auth.users.id
  email           text,
  display_name    text check (display_name is null or length(display_name) <= 80),
  language        text not null default 'en' check (language in ('en', 'ro')),
  role            text not null check (role in ('super_admin', 'owner', 'client')),
  organization_id uuid references public.organizations (id) on delete set null,
  video_quality   text not null default 'auto' check (video_quality in ('auto', '720', '1080')),
  created_at      timestamptz not null default now()
);
create index profiles_org_idx on public.profiles (organization_id);

alter table public.organizations
  add constraint organizations_owner_fk foreign key (owner_id)
  references public.profiles (id) on delete set null deferrable initially deferred;

-- ---------------------------------------------------------------------------
-- Media (pictures and videos). Clients only ever see status = 'published'.
--   pending   -> uploaded, waiting for the super admin
--   approved  -> approved, waiting for the FFmpeg worker
--   published -> converted and visible
--   rejected  -> refused, reason sent to the owner
-- ---------------------------------------------------------------------------
create table public.media (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind            text not null check (kind in ('image', 'video')),
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'published', 'rejected')),
  original_path   text not null,                 -- path on the VPS upload area
  file_720        text,                          -- published video, 720p
  file_1080       text,                          -- published video, 1080p
  image_path      text,                          -- published image
  width           int,
  height          int,
  duration_seconds numeric(8,2),
  reject_reason   text,
  uploaded_by     uuid references public.profiles (id) on delete set null,
  reviewed_by     uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  reviewed_at     timestamptz,
  unique (id, organization_id)
);
create index media_org_status_idx on public.media (organization_id, status);
create index media_pending_idx on public.media (created_at) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Home page
-- ---------------------------------------------------------------------------
create table public.home_settings (
  organization_id     uuid primary key references public.organizations (id) on delete cascade,
  theme_key           text not null default 'calm',
  background_media_id uuid,
  foreground_media_id uuid,
  description         jsonb,                     -- TipTap JSON
  updated_at          timestamptz not null default now(),
  foreign key (background_media_id, organization_id)
    references public.media (id, organization_id) on delete set null (background_media_id),
  foreign key (foreground_media_id, organization_id)
    references public.media (id, organization_id) on delete set null (foreground_media_id)
);

create table public.home_buttons (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  type            text not null check (type in ('scheduling', 'workouts')),
  label           text not null check (length(trim(label)) between 1 and 40),
  icon            text not null default 'star',
  color           text not null default '#4F7D6B' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  position        int not null default 0,
  unique (organization_id, type)                 -- one of each per organization
);

-- ---------------------------------------------------------------------------
-- Workouts: Main -> Section -> Workout (three levels, no nesting)
-- ---------------------------------------------------------------------------
create table public.sections (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null check (length(trim(name)) between 1 and 60),
  cover_media_id  uuid,
  position        int not null default 0,
  created_at      timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (cover_media_id, organization_id)
    references public.media (id, organization_id) on delete set null (cover_media_id)
);
create index sections_org_pos_idx on public.sections (organization_id, position);

create table public.workouts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (length(trim(name)) between 1 and 80),
  sets             int  check (sets is null or sets between 1 and 100),
  reps             int  check (reps is null or reps between 1 and 1000),
  duration_seconds int  check (duration_seconds is null or duration_seconds between 1 and 7200),
  rest_seconds     int  check (rest_seconds is null or rest_seconds between 0 and 3600),
  description      jsonb,                        -- TipTap JSON
  warning          text check (warning is null or length(warning) <= 1000),
  avoid            text check (avoid is null or length(avoid) <= 1000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, organization_id),
  -- Repetitions OR time, never both, never neither.
  constraint workouts_reps_xor_time check ((reps is null) <> (duration_seconds is null))
);

-- A workout can appear in several sections of the same organization.
create table public.section_workouts (
  section_id      uuid not null,
  workout_id      uuid not null,
  organization_id uuid not null,
  position        int not null default 0,
  primary key (section_id, workout_id),
  foreign key (section_id, organization_id)
    references public.sections (id, organization_id) on delete cascade,
  foreign key (workout_id, organization_id)
    references public.workouts (id, organization_id) on delete cascade
);
create index section_workouts_workout_idx on public.section_workouts (workout_id);

create table public.workout_media (
  workout_id      uuid not null,
  media_id        uuid not null,
  organization_id uuid not null,
  position        int not null default 0,
  primary key (workout_id, media_id),
  foreign key (workout_id, organization_id)
    references public.workouts (id, organization_id) on delete cascade,
  foreign key (media_id, organization_id)
    references public.media (id, organization_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Scheduling
-- ---------------------------------------------------------------------------
create table public.availability (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  weekday         int  not null check (weekday between 0 and 6),   -- 0 = Sunday
  start_time      time not null,
  end_time        time not null,
  slot_minutes    int  not null default 60 check (slot_minutes between 10 and 480),
  capacity        int  not null default 1 check (capacity between 1 and 200),
  price_cents     int  not null default 0 check (price_cents >= 0),
  currency        text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  check (end_time > start_time)
);
create index availability_org_idx on public.availability (organization_id, weekday);

create table public.availability_exceptions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  day             date not null,
  closed          boolean not null default true,  -- true = day off
  start_time      time,                           -- when closed = false: an extra window
  end_time        time,
  slot_minutes    int check (slot_minutes is null or slot_minutes between 10 and 480),
  capacity        int not null default 1 check (capacity between 1 and 200),
  price_cents     int not null default 0 check (price_cents >= 0),
  check (closed or (start_time is not null and end_time is not null
                    and end_time > start_time and slot_minutes is not null))
);
create index availability_exceptions_org_day_idx on public.availability_exceptions (organization_id, day);

create table public.bookings (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references public.organizations (id) on delete cascade,
  client_id                uuid not null references public.profiles (id) on delete cascade,
  starts_at                timestamptz not null,
  ends_at                  timestamptz not null,
  status                   text not null default 'pending'
                             check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  price_cents              int not null default 0,
  currency                 text not null default 'EUR',
  stripe_payment_intent_id text,
  cancelled_by             text check (cancelled_by in ('client', 'owner', 'system')),
  created_at               timestamptz not null default now(),
  decided_at               timestamptz,
  check (ends_at > starts_at)
);
create index bookings_org_start_idx on public.bookings (organization_id, starts_at);
create index bookings_client_idx on public.bookings (client_id, starts_at);

-- ---------------------------------------------------------------------------
-- Reports, devices
-- ---------------------------------------------------------------------------
create table public.content_reports (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  media_id        uuid references public.media (id) on delete cascade,
  workout_id      uuid references public.workouts (id) on delete cascade,
  reporter_id     uuid references public.profiles (id) on delete set null,
  reason          text not null check (length(reason) between 3 and 1000),
  status          text not null default 'open' check (status in ('open', 'resolved')),
  created_at      timestamptz not null default now(),
  check (media_id is not null or workout_id is not null)
);

create table public.devices (
  push_token text primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  platform   text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now()
);
create index devices_user_idx on public.devices (user_id);

-- ---------------------------------------------------------------------------
-- updated_at bookkeeping
-- ---------------------------------------------------------------------------
create function app.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger workouts_touch before update on public.workouts
  for each row execute function app.touch_updated_at();
create trigger home_settings_touch before update on public.home_settings
  for each row execute function app.touch_updated_at();
