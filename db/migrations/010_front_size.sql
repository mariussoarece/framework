-- Owners choose how big the front image is on the home page.
alter table public.home_settings
  add column if not exists front_size text not null default 'large'
    check (front_size in ('small', 'medium', 'large'));
