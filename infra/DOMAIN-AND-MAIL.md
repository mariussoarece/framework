# myritmio.com: the app's server address and its email

After these steps:
- the app talks to **https://api.myritmio.com** (the old https://api.purebalanceyoga.ro keeps
  working too, for builds that still use it);
- the app's emails come from **no-reply@myritmio.com**, sent by the Postfix on this VPS,
  signed with DKIM; the websites keep sending from purebalanceyoga.ro, also signed (each domain
  with its own key).

Server IP: `45.10.163.167`. Run the VPS commands as `yogaadmin` (they need sudo),
except where it says `frame`.

---

## 1. DNS for myritmio.com (at the registrar's DNS panel)

| Type | Name | Value |
|---|---|---|
| A | `api` | `45.10.163.167` |
| A | `mail` | `45.10.163.167` |
| MX | `@` | `mail.myritmio.com` (priority 10) |
| TXT | `@` | `v=spf1 ip4:45.10.163.167 -all` |
| TXT | `_dmarc` | `v=DMARC1; p=none; adkim=r; aspf=r` |
| TXT | `mail._domainkey` | (from step 5) |

For the websites' emails, also on **purebalanceyoga.ro**:

| Type | Name | Value |
|---|---|---|
| TXT | `@` | `v=spf1 ip4:45.10.163.167 ~all` |
| TXT | `_dmarc` | `v=DMARC1; p=none; adkim=r; aspf=r` |
| TXT | `mail._domainkey` | (its own value, step 5) |

Contabo panel → the VPS → **Reverse DNS** for `45.10.163.167` → `mail.myritmio.com`.

Wait until the names answer (can take from minutes to a few hours):
```bash
dig +short A api.myritmio.com
dig +short A mail.myritmio.com      # both must print 45.10.163.167
```

## 2. HTTPS for api.myritmio.com and mail.myritmio.com (host nginx + certbot)

```bash
cd /opt/framework
sudo cp infra/nginx/host-site.conf.example /etc/nginx/sites-available/myritmio-api
sudo sed -i 's/server_name api.example.com;/server_name api.myritmio.com mail.myritmio.com;/' \
  /etc/nginx/sites-available/myritmio-api
sudo ln -s /etc/nginx/sites-available/myritmio-api /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.myritmio.com -d mail.myritmio.com
```
One certificate covers both names: `/etc/letsencrypt/live/api.myritmio.com/`.
The site for api.purebalanceyoga.ro stays as it is.

## 3. Postfix

```bash
sudo postconf -e 'myhostname = mail.myritmio.com'
sudo postconf -e 'mydestination = $myhostname, localhost, purebalanceyoga.ro'
sudo postconf -e 'inet_interfaces = all'
sudo postconf -e 'mynetworks = 127.0.0.0/8 [::1]/128 172.16.0.0/12'
sudo postconf -e 'smtpd_tls_cert_file = /etc/letsencrypt/live/api.myritmio.com/fullchain.pem'
sudo postconf -e 'smtpd_tls_key_file = /etc/letsencrypt/live/api.myritmio.com/privkey.pem'
sudo systemctl restart postfix

# reload Postfix when the certificate is renewed
printf '#!/bin/sh\nsystemctl reload postfix\n' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/postfix-reload.sh
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/postfix-reload.sh
```
`/etc/mailname` stays `purebalanceyoga.ro`, so the websites keep sending as before.

## 4. Firewall: only the containers may reach Postfix

```bash
sudo ufw allow from 172.16.0.0/12 to any port 25 proto tcp comment 'docker -> postfix'
```
From the internet port 25 stays closed (`inet_interfaces = all` is safe because of this,
and only `mynetworks` may send through Postfix).

## 5. DKIM (OpenDKIM), a separate key for each domain

```bash
sudo apt-get install -y opendkim opendkim-tools
for d in myritmio.com purebalanceyoga.ro; do
  sudo mkdir -p /etc/opendkim/keys/$d
  sudo opendkim-genkey -b 2048 -d $d -s mail -D /etc/opendkim/keys/$d
done

# which key signs which domain
printf '%s\n' \
  'mail._domainkey.myritmio.com myritmio.com:mail:/etc/opendkim/keys/myritmio.com/mail.private' \
  'mail._domainkey.purebalanceyoga.ro purebalanceyoga.ro:mail:/etc/opendkim/keys/purebalanceyoga.ro/mail.private' \
  | sudo tee /etc/opendkim/key.table
printf '%s\n' \
  '*@myritmio.com mail._domainkey.myritmio.com' \
  '*@purebalanceyoga.ro mail._domainkey.purebalanceyoga.ro' \
  | sudo tee /etc/opendkim/signing.table
# who may have their emails signed: the VPS itself and the Docker containers
printf '%s\n' 127.0.0.1 ::1 localhost 172.16.0.0/12 | sudo tee /etc/opendkim/trusted.hosts

sudo chown -R opendkim:opendkim /etc/opendkim
sudo chmod 600 /etc/opendkim/keys/*/mail.private

sudo sed -i -E 's/^(Socket|Domain|Selector|KeyFile|KeyTable|SigningTable|InternalHosts|ExternalIgnoreList|Mode)\b/#\1/' /etc/opendkim.conf
printf '%s\n' \
  'KeyTable file:/etc/opendkim/key.table' \
  'SigningTable refile:/etc/opendkim/signing.table' \
  'InternalHosts refile:/etc/opendkim/trusted.hosts' \
  'ExternalIgnoreList refile:/etc/opendkim/trusted.hosts' \
  'Socket inet:8891@localhost' 'Mode sv' | sudo tee -a /etc/opendkim.conf
sudo sed -i -E 's|^#?SOCKET=.*|SOCKET=inet:8891@localhost|' /etc/default/opendkim
[ -x /lib/opendkim/opendkim.service.generate ] && sudo /lib/opendkim/opendkim.service.generate
sudo systemctl daemon-reload
sudo systemctl enable --now opendkim
sudo systemctl restart opendkim
sudo ss -tlnp | grep 8891            # must show opendkim

sudo postconf -e 'milter_default_action = accept' 'milter_protocol = 6' \
  'smtpd_milters = inet:localhost:8891' 'non_smtpd_milters = inet:localhost:8891'
sudo systemctl restart postfix

# the value of each TXT record "mail._domainkey" (one line each)
for d in myritmio.com purebalanceyoga.ro; do
  echo "== $d"
  sudo cat /etc/opendkim/keys/$d/mail.txt | tr -d '\n\t' \
    | sed -E 's/.*\( *//; s/ *\).*//; s/" *"//g; s/"//g'; echo
done
```
Put the first value in the `mail._domainkey` TXT record of **myritmio.com**, the second in the
`mail._domainkey` TXT record of **purebalanceyoga.ro**.

Check that each record is published (after a few minutes):
```bash
sudo opendkim-testkey -d myritmio.com -s mail -vvv
sudo opendkim-testkey -d purebalanceyoga.ro -s mail -vvv     # both must end with "key OK"
```
("key not secure" only means the domain has no DNSSEC; it is fine.)

## 6. The app's server (`/opt/framework/infra/.env`, as `frame`)

Change / add:
```
DOMAIN=api.myritmio.com
SITE_URL=https://api.myritmio.com/
APP_REDIRECT_URLS=framework://auth-callback,https://api.myritmio.com/**,https://api.purebalanceyoga.ro/**

SMTP_HOST=mail.myritmio.com
SMTP_LOCAL_NAME=mail.myritmio.com
SMTP_PORT=25
SMTP_USER=
SMTP_PASS=
SMTP_SENDER=no-reply@myritmio.com
SMTP_SENDER_NAME=Myritmio
MAILER_AUTOCONFIRM=false
```
```bash
cd /opt/framework/infra && docker compose up -d --build
curl -s https://api.myritmio.com/api/health; echo
```
Picture and video links are now made with https://api.myritmio.com.

## 7. The app (on the Mac)

- `mobile/.env`: `EXPO_PUBLIC_API_URL=https://api.myritmio.com`, then `npx expo start -c`.
- expo.dev → the project → **Environment variables** → `EXPO_PUBLIC_API_URL` (development)
  → `https://api.myritmio.com`. New builds use it; the builds already installed load the
  code from `npx expo start`, so they use `mobile/.env`.

## 8. Tests

1. https://api.myritmio.com/ in a browser: a small "YogaByTheSofa" card.
2. https://www.mail-tester.com: copy the address it shows, then on the VPS:
   ```bash
   printf 'Subject: Test\nFrom: no-reply@myritmio.com\n\nHello' \
     | sendmail -f no-reply@myritmio.com ADDRESS-FROM-MAIL-TESTER
   ```
   "Then check your score": aim for 9/10 or more.
3. In the app: Sign in → **Forgot password** for an account with a Gmail address:
   the email arrives, the link opens the "New password" page.
4. If nothing arrives: `sudo tail -n 50 /var/log/mail.log` and
   `docker compose logs --tail=50 auth api | grep -i -E "smtp|mail"`.

## 9. The website https://myritmio.com (e.g. /become-owner/)

Cloudflare DNS for myritmio.com (proxy can stay **DNS only**):

| Type | Name | Value |
|---|---|---|
| A | `@` | `45.10.163.167` |
| A | `www` | `45.10.163.167` |

Then on the VPS (as `yogaadmin`):
```bash
sudo cp /opt/framework/infra/nginx/myritmio-site.conf.example /etc/nginx/sites-available/myritmio-site
sudo ln -s /etc/nginx/sites-available/myritmio-site /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d myritmio.com -d www.myritmio.com
```
The pages are the files in `infra/site/`; after a `git pull` they are live at once.
Check: https://myritmio.com/become-owner/
