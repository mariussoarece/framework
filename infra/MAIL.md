# Sending email with Postfix on the same VPS

The app (sign-up confirmation, password reset, organization closed, account deleted) sends
through the Postfix already installed on the VPS. Postfix stays closed to the internet;
only the Docker containers may use it.

Values used below: domain `purebalanceyoga.ro`, server IP `45.10.163.167`, sender
`no-reply@purebalanceyoga.ro`, DKIM selector `mail`.

## 1. DNS (at the domain's DNS panel)

| Type | Name | Value |
|---|---|---|
| A | `mail` | `45.10.163.167` |
| TXT | `@` | `v=spf1 ip4:45.10.163.167 ~all` |
| TXT | `_dmarc` | `v=DMARC1; p=none; adkim=r; aspf=r` |
| TXT | `mail._domainkey` | (from step 4) |

Contabo panel → your VPS → **Reverse DNS** for `45.10.163.167` → `mail.purebalanceyoga.ro`.

## 2. Postfix

```bash
sudo postconf -e 'myhostname = mail.purebalanceyoga.ro'
sudo postconf -e 'mydestination = $myhostname, localhost, purebalanceyoga.ro'
sudo postconf -e 'inet_interfaces = all'
sudo postconf -e 'mynetworks = 127.0.0.0/8 [::1]/128 172.16.0.0/12'
sudo systemctl restart postfix
```
`inet_interfaces = all` is safe because the firewall keeps port 25 closed to the internet
(only the rule in step 3 opens it, for the containers), and only `mynetworks` may relay.

## 3. Firewall: containers → Postfix

```bash
sudo ufw allow from 172.16.0.0/12 to any port 25 proto tcp comment 'docker -> postfix'
```

## 4. DKIM (OpenDKIM)

```bash
sudo apt-get install -y opendkim opendkim-tools
sudo mkdir -p /etc/opendkim/keys/purebalanceyoga.ro
sudo opendkim-genkey -b 2048 -d purebalanceyoga.ro -s mail -D /etc/opendkim/keys/purebalanceyoga.ro
sudo chown -R opendkim:opendkim /etc/opendkim
sudo chmod 600 /etc/opendkim/keys/purebalanceyoga.ro/mail.private

# signing settings
sudo sed -i -E 's/^(Socket|Domain|Selector|KeyFile|Mode)\b/#\1/' /etc/opendkim.conf
printf '%s\n' 'Domain purebalanceyoga.ro' 'Selector mail' \
  'KeyFile /etc/opendkim/keys/purebalanceyoga.ro/mail.private' \
  'Socket inet:8891@localhost' 'Mode sv' | sudo tee -a /etc/opendkim.conf
sudo sed -i -E 's|^#?SOCKET=.*|SOCKET=inet:8891@localhost|' /etc/default/opendkim
[ -x /lib/opendkim/opendkim.service.generate ] && sudo /lib/opendkim/opendkim.service.generate
sudo systemctl daemon-reload
sudo systemctl enable --now opendkim
sudo systemctl restart opendkim
sudo ss -tlnp | grep 8891            # must show opendkim

# Postfix signs through OpenDKIM
sudo postconf -e 'milter_default_action = accept' 'milter_protocol = 6' \
  'smtpd_milters = inet:localhost:8891' 'non_smtpd_milters = inet:localhost:8891'
sudo systemctl restart postfix

# the DKIM DNS value (one line) -> TXT record "mail._domainkey"
sudo cat /etc/opendkim/keys/purebalanceyoga.ro/mail.txt | tr -d '\n\t' \
  | sed -E 's/.*\( *//; s/ *\).*//; s/" *"//g; s/"//g'; echo
```

## 5. The app (`/opt/framework/infra/.env`)

```
SMTP_HOST=purebalanceyoga.ro
SMTP_LOCAL_NAME=purebalanceyoga.ro
SMTP_PORT=25
SMTP_USER=
SMTP_PASS=
SMTP_SENDER=no-reply@purebalanceyoga.ro
SMTP_SENDER_NAME=YogaByTheSofa
SITE_URL=https://api.purebalanceyoga.ro/
APP_REDIRECT_URLS=framework://auth-callback,https://api.purebalanceyoga.ro/**
MAILER_AUTOCONFIRM=false
```
`SMTP_HOST` is `purebalanceyoga.ro` because that is the name on Postfix's TLS certificate;
inside the containers that name points to the VPS itself (`SMTP_LOCAL_NAME`).

```bash
cd /opt/framework/infra && docker compose up -d --build
```

## 6. Test

1. Open https://www.mail-tester.com, copy the address it shows.
2. From the VPS:
   ```bash
   printf 'Subject: Test\nFrom: no-reply@purebalanceyoga.ro\n\nHello' \
     | sendmail -f no-reply@purebalanceyoga.ro ADDRESS-FROM-MAIL-TESTER
   ```
   Then "Then check your score" on mail-tester: aim for 9/10 or more.
3. From the app: Sign in → **Forgot password** with a Gmail address that has an account.
4. If nothing arrives: `sudo tail -n 50 /var/log/mail.log` and
   `docker compose logs --tail=50 auth api | grep -i -E "smtp|mail"`.
