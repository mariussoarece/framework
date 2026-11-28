-- 020: the server (service_role) could not read the messages table, so messages to
-- clients failed with "permission denied for table announcements".
grant all on public.announcements to service_role;

-- every table created from now on is readable and writable by the server too
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
