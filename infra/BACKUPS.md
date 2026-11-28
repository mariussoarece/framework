# Backups, restoring, and moving to a new server

What has to be kept safe:

| What | Where on the VPS | Size |
|---|---|---|
| The database (accounts, organizations, workouts, bookings, memberships…) | Docker volume of `db` | small (MB) |
| Approved pictures and videos | `/srv/media/published` (`MEDIA_ROOT`) | grows with every upload |
| Settings and keys | `/opt/framework/infra/.env`, `/opt/framework/infra/secrets/` | tiny, **secret** |
| Postfix + DKIM keys, certificates | `/etc/postfix`, `/etc/opendkim`, `/etc/letsencrypt` | tiny; can be re-created |

Run the commands as `yogaadmin` (they need `sudo`).

---

## 1. Nightly backup on the VPS (14 days)

```bash
sudo mkdir -p /srv/backups
sudo /opt/framework/infra/scripts/backup.sh            # by hand once: must end with "done"
ls -lh /srv/backups/db/
echo '15 3 * * * root /opt/framework/infra/scripts/backup.sh >> /var/log/framework-backup.log 2>&1' \
  | sudo tee /etc/cron.d/framework-backup
```
Check later: `sudo tail -n 20 /var/log/framework-backup.log`.

This protects against mistakes (a deleted organization, a bad migration), **not** against losing
the VPS. For that: step 2.

## 2. Copies off the VPS

Choose **one** of these. The nightly script copies the database dumps (kept 60 days off-site) and
the published pictures/videos.

### A. Another server of yours (rsync over SSH)

On the VPS, a key that can log in to the other server without a password:
```bash
sudo ssh-keygen -t ed25519 -f /root/.ssh/backup -N ''
sudo cat /root/.ssh/backup.pub          # add this line to ~/.ssh/authorized_keys of the backup user there
printf 'Host backup-server\n  HostName OTHER.SERVER.IP\n  User backup\n  IdentityFile /root/.ssh/backup\n' \
  | sudo tee -a /root/.ssh/config
sudo ssh backup-server 'mkdir -p /backups/myritmio && echo ok'
```
In `/opt/framework/infra/.env`:
```
BACKUP_REMOTE=backup-server:/backups/myritmio
```

### B. Cloudflare R2 (10 GB free, then about $0.015 per GB a month)

1. Cloudflare dashboard → **R2** → **Create bucket** → name `myritmio-backups` (location: Europe).
2. **R2 → Manage API tokens → Create API token**: permission **Object Read & Write**, only this
   bucket. Write down the **Access Key ID**, the **Secret Access Key** and the **endpoint**
   (`https://<account-id>.r2.cloudflarestorage.com`).
3. On the VPS:
   ```bash
   sudo apt-get install -y rclone
   sudo rclone config create r2 s3 provider Cloudflare \
     access_key_id ACCESS_KEY_ID secret_access_key SECRET_ACCESS_KEY \
     endpoint https://ACCOUNT_ID.r2.cloudflarestorage.com acl private
   sudo rclone lsd r2:myritmio-backups          # no error = it works
   ```
4. In `/opt/framework/infra/.env`:
   ```
   BACKUP_RCLONE=r2:myritmio-backups
   ```

(Backblaze B2 works the same way: `rclone config create b2 b2 account KEY_ID key APP_KEY`,
then `BACKUP_RCLONE=b2:bucket-name`.)

### Then, for A or B
```bash
sudo /opt/framework/infra/scripts/backup.sh    # must show the rsync/rclone lines and "done"
```

### The secret settings (once, and after every change)
`.env` and `secrets/` are not in the nightly copy on purpose (they contain keys). Keep them in a
password manager or on an encrypted USB stick:
```bash
sudo tar czf /root/myritmio-secrets.tgz -C /opt/framework/infra .env secrets
# copy it to your computer, then:
sudo rm /root/myritmio-secrets.tgz
```

## 3. Restoring

The database from a dump (replaces everything in it; it asks for "YES"):
```bash
cd /opt/framework
sudo infra/scripts/restore.sh /srv/backups/db/app_2026-12-01_0315.dump
```
With the pictures/videos too (e.g. copied back from R2 first):
```bash
sudo rclone copy r2:myritmio-backups/media /srv/restore-media
sudo infra/scripts/restore.sh /srv/backups/db/app_2026-12-01_0315.dump /srv/restore-media
```
Try a restore once on a test server, so you know it works before you need it.

## 4. Moving to a new server (e.g. 6 cores, 12 GB RAM)

1. **New server:** Ubuntu 24.04 LTS. Users, firewall, Docker, host nginx and certbot as in
   `infra/README.md`.
2. **Code:** `sudo git clone -b framework https://github.com/mariussoarece/framework.git /opt/framework`
3. **Secrets:** put back `.env` and `secrets/` from your saved copy.
4. **Start:** `cd /opt/framework/infra && docker compose up -d && ./scripts/migrate.sh`
5. **Data:** on the old server run `backup.sh` one last time (with off-site copy), then on the new one
   restore the newest dump and the media (section 3).
6. **Email:** Postfix + OpenDKIM as in `infra/DOMAIN-AND-MAIL.md` (copy `/etc/opendkim/keys` from
   the old server to keep the same DKIM keys, otherwise publish the new ones in DNS).
7. **Switch:** in DNS point `api`, `mail` (and `@`, `www` for the website) to the new IP; change the
   reverse DNS in the new provider's panel; certbot on the new server.
8. **Check:** sign in from the app, open a workout video, book a class, send a test reset email.
   Keep the old server for a week, then cancel it.

Downtime: from the last backup on the old server until DNS points to the new one (TTL), usually
under an hour. Do it at night.
