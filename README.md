# Framework

A white-label app platform for physical therapy, yoga, fitness, martial arts and similar businesses.
Each business is an **organization** with its own branded home page, booking timetable and workout library.
Clients without a code join the default organization, **YogaByTheSofa**.

Full specification: *YogaByTheSofa Platform — App Specification* (Claude doc).

## Repository layout

| Folder | What's in it | Status |
| --- | --- | --- |
| `db/migrations` | PostgreSQL tables, row-level security, API functions, seed | Done |
| `db/tests` | Tests proving organizations can't see each other's data | Done |
| `infra` | Docker Compose for the VPS: PostgreSQL, Supabase Auth, PostgREST, Nginx, pgAdmin, backups | Done |
| `server` | Node.js: Stripe Connect, push notifications, emails, FFmpeg media worker, account deletion | Next |
| `app` | React Native (Expo) app for iOS and Android, English and Romanian | Next |

## How the pieces fit

- The app calls `https://<your domain>/auth/v1` to log in and `/rest/v1` for data.
- Every request carries the user's login token; PostgreSQL row-level security only returns rows of the user's own organization.
- Actions with rules (creating an organization, joining, booking, accepting, approving media) are database functions called as `/rest/v1/rpc/<name>`:

| Function | Who | What |
| --- | --- | --- |
| `create_organization(p_name, p_plan)` | new owner | Creates the organization (unique name, generated join code) with two default buttons |
| `find_organization(p_code)` | anyone logged in | Shows an organization's name from its code; no code = YogaByTheSofa |
| `join_organization(p_code)` | client | Joins by code; no code = YogaByTheSofa |
| `available_slots(p_from, p_days)` | member | Free slots in the organization's timetable |
| `request_booking(p_starts_at)` | client | Creates a pending booking |
| `decide_booking(p_booking, p_accept)` | owner | Accepts or declines |
| `cancel_booking(p_booking)` | client or owner | Cancels |
| `review_media(p_media, p_approve, p_reason)` | super admin | Approves or rejects an upload |
| `set_default_organization(p_org)` | super admin | Moves the default flag |

## Run the database tests locally

```bash
createdb app_test
DB_URL=postgresql://localhost/app_test ./infra/scripts/migrate.sh
psql postgresql://localhost/app_test -v ON_ERROR_STOP=1 -f db/tests/security_test.sql
# ends with: All tests passed.
```

## Deploy

See [infra/README.md](infra/README.md).
