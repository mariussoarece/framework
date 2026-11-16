# Running the server on your VPS

Tested target: Ubuntu 22.04 or 24.04, 2 CPU, 4 GB RAM, enough disk for your videos.

## 1. Prepare the VPS (once)

```bash
# Docker
curl -fsSL https://get.docker.com | sh

# Code
git clone -b framework https://github.com/mariussoarece/framework.git /opt/framework
cd /opt/framework

# Folders for media and backups
mkdir -p /srv/media/uploads /srv/media/published /srv/backups
chown -R 1000:1000 /srv/media      # the Node server runs as uid 1000

# Firewall: only SSH, HTTP, HTTPS from outside
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
```

Point your domain (e.g. `api.yourdomain.com`) to the VPS IP with a DNS A record.

## 2. Configure

```bash
cp infra/.env.example infra/.env
nano infra/.env                                # DOMAIN, SITE_URL, SMTP, ...
node infra/scripts/gen-keys.mjs >> infra/.env  # passwords and keys
```

(If Node isn't installed on the VPS: `docker run --rm -v "$PWD":/w -w /w node:22 node infra/scripts/gen-keys.mjs >> infra/.env`.)

`ANON_KEY` goes into the mobile app. `SERVICE_ROLE_KEY` stays on the server; it bypasses all security rules.

## 3. HTTPS certificate (once, then auto-renew)

```bash
apt install -y certbot
certbot certonly --standalone -d api.yourdomain.com      # before nginx is running
# renewal: certbot renews by itself; reload nginx afterwards
echo 'deploy-hook = docker exec framework-nginx-1 nginx -s reload' >> /etc/letsencrypt/cli.ini
```

## 4. Start

```bash
cd /opt/framework/infra
docker compose --env-file .env up -d
cd .. && ./infra/scripts/migrate.sh        # creates tables, security rules, YogaByTheSofa
```

Check:
- `curl https://api.yourdomain.com/auth/v1/health` answers with the login service's version.
- `curl https://api.yourdomain.com/api/health` answers `{"ok":true}`.

After changing server code: `docker compose --env-file .env up -d --build api`.

Run `./infra/scripts/migrate.sh` again after every `git pull`; it only applies new files.

## 5. Stripe, push and email

**Stripe** (start with test keys):
1. In the Stripe dashboard turn on **Connect** (Express accounts).
2. Developers → API keys → put the secret and publishable keys in `.env`.
3. Developers → Webhooks → add endpoint `https://api.yourdomain.com/api/stripe/webhook` with the events
   `payment_intent.amount_capturable_updated`, `payment_intent.succeeded`, `payment_intent.canceled`, `charge.refunded`.
   Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.

**Apple push:** Apple Developer → Keys → create a key with *Apple Push Notifications service*. Save the `.p8` file as
`infra/secrets/AuthKey.p8`, fill `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID` (the app's bundle id).
Set `APNS_PRODUCTION=true` for App Store / TestFlight builds.

**Android push:** Firebase console → project settings → Service accounts → generate a private key. Save it as
`infra/secrets/firebase-service-account.json`. (Firebase is used only to deliver notifications.)

**Email:** any SMTP provider; the same settings are used for login emails and for "organization closed" emails.

Restart after changes: `docker compose --env-file .env up -d`.

## 6. Backups

```bash
crontab -e
# add:
15 3 * * * /opt/framework/infra/scripts/backup.sh >> /var/log/framework-backup.log 2>&1
```

Set `BACKUP_REMOTE` in `.env` to a second machine or storage box, otherwise backups stay on the same VPS that might fail.

Restore a dump:
```bash
docker compose --env-file .env exec -T db pg_restore -U postgres -d app --clean < /srv/backups/db/app_<date>.dump
```

## 7. pgAdmin

pgAdmin listens only on the VPS itself. From your computer:

```bash
ssh -L 5050:127.0.0.1:5050 root@your-vps
```

Then open http://localhost:5050, log in with `PGADMIN_EMAIL` / `PGADMIN_PASSWORD`, and add a server: host `db`, user `postgres`, password `POSTGRES_PASSWORD`.

## 8. Make yourself super admin and owner of YogaByTheSofa

You use two accounts: one super admin, one owner for YogaByTheSofa.

1. Sign up in the app with both emails (the owner one choosing "Client" for now is fine).
2. In pgAdmin (or `docker compose exec db psql -U postgres -d app`):

```sql
-- super admin
insert into profiles (id, email, role)
select id, email, 'super_admin' from auth.users where email = 'admin@yourmail.com'
on conflict (id) do update set role = 'super_admin', organization_id = null;

-- owner of YogaByTheSofa
update profiles set role = 'owner',
       organization_id = (select id from organizations where is_default)
 where email = 'owner@yourmail.com';
update organizations set owner_id = (select id from profiles where email = 'owner@yourmail.com')
 where is_default;
```

To rename YogaByTheSofa, edit its name in the app as its owner. To make another organization the default, call `set_default_organization` as super admin.
