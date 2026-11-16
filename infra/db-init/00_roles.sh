#!/bin/bash
# Runs once, the first time the database container starts with an empty volume.
# Creates the roles the login service (GoTrue) and the API (PostgREST) use.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username postgres --dbname "$POSTGRES_DB" \
  -v authenticator_password="$AUTHENTICATOR_PASSWORD" \
  -v auth_admin_password="$AUTH_ADMIN_PASSWORD" <<'SQL'
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- API roles
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit password :'authenticator_password';
grant anon, authenticated, service_role to authenticator;

-- Login service: owns the "auth" schema and creates its own tables in it
create role supabase_auth_admin login noinherit createrole password :'auth_admin_password';
create schema auth authorization supabase_auth_admin;
alter role supabase_auth_admin set search_path = auth;
grant usage on schema auth to anon, authenticated, service_role;

-- referenced by some GoTrue migrations
create role dashboard_user nologin;
grant usage on schema auth to dashboard_user;
SQL
