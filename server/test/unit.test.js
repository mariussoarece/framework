import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createHash, createHmac, generateKeyPairSync, verify } from 'node:crypto';
import { signHs256, verifyHs256, signAsymmetric } from '../src/jwt.js';
import { signMediaUrl, mediaPath } from '../src/media.js';
import { formEncode, verifyWebhook } from '../src/stripe.js';
import { platformFee } from '../src/payments.js';
import { t, formatTime } from '../src/i18n.js';
import { createMailer } from '../src/mail.js';
import { createRouter } from '../src/http.js';

test('login tokens: valid, tampered, expired', () => {
  const tok = signHs256({ sub: 'u1', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 60 }, 's3cret');
  assert.equal(verifyHs256(tok, 's3cret').sub, 'u1');
  assert.throws(() => verifyHs256(tok, 'other'), /bad_signature/);
  const [h, , s] = tok.split('.');
  const forged = `${h}.${Buffer.from(JSON.stringify({ sub: 'admin', role: 'authenticated' })).toString('base64url')}.${s}`;
  assert.throws(() => verifyHs256(forged, 's3cret'), /bad_signature/);
  const old = signHs256({ sub: 'u1', exp: 1 }, 's3cret');
  assert.throws(() => verifyHs256(old, 's3cret'), /token_expired/);
});

test('ES256 tokens for Apple push verify with the public key', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwt = signAsymmetric('ES256', { kid: 'K1' }, { iss: 'TEAM', iat: 1 }, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const [h, p, s] = jwt.split('.');
  assert.equal(JSON.parse(Buffer.from(h, 'base64url')).kid, 'K1');
  assert.ok(verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
});

test('signed media links match the nginx secure_link formula', () => {
  const cfg = { publicUrl: 'https://api.example.com', mediaLinkSecret: 'abc', mediaLinkTtl: 3600 };
  const { url, expires } = signMediaUrl(cfg, 'org1/vid_720.mp4', 1_700_000_000_000);
  assert.equal(expires, 1_700_003_600);
  // nginx: secure_link_md5 "$secure_link_expires$uri abc"
  const expected = createHash('md5').update(`1700003600/media/org1/vid_720.mp4 abc`).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(url, `https://api.example.com/media/org1/vid_720.mp4?md5=${expected}&expires=1700003600`);
});

test('media paths cannot escape the media folder', () => {
  assert.equal(mediaPath('/srv/media', 'published', 'a/b.mp4'), '/srv/media/published/a/b.mp4');
  assert.throws(() => mediaPath('/srv/media', 'published', '../../etc/passwd'));
  assert.throws(() => mediaPath('/srv/media', 'published', '/etc/passwd'));
});

test('Stripe form encoding and webhook signatures', () => {
  assert.equal(formEncode({ amount: 3000, transfer_data: { destination: 'acct_1' }, x: undefined }).toString(),
    'amount=3000&transfer_data%5Bdestination%5D=acct_1');
  const body = Buffer.from(JSON.stringify({ type: 'payment_intent.succeeded' }));
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', 'whsec_x').update(`${ts}.${body}`).digest('hex');
  assert.equal(verifyWebhook(body, `t=${ts},v1=${sig}`, 'whsec_x').type, 'payment_intent.succeeded');
  assert.throws(() => verifyWebhook(body, `t=${ts},v1=${sig}`, 'whsec_other'), /bad_signature/);
  assert.throws(() => verifyWebhook(body, `t=${ts - 1000},v1=${sig}`, 'whsec_x'), /too_old/);
});

test('platform fee', () => {
  assert.equal(platformFee(3000, 10), 300);
  assert.equal(platformFee(3333, 10), 333);
  assert.equal(platformFee(3000, 0), 0);
});

test('texts in English and Romanian', () => {
  assert.equal(t('ro', 'booking_accepted', { org: 'Dojo', time: 'X' }).title, 'Programare confirmată');
  assert.equal(t('fr', 'booking_accepted', { org: 'Dojo', time: 'X' }).title, 'Booking confirmed');
  assert.match(formatTime('2026-12-01T08:00:00Z', 'ro', 'Europe/Bucharest'), /10:00/);
  assert.match(t('en', 'org_closed_body', { org: 'A', default: 'YogaByTheSofa' }), /Continue with YogaByTheSofa/);
});

test('router extracts parameters', () => {
  const r = createRouter();
  r.add('GET', '/api/media/:id/url', () => 1);
  assert.deepEqual(r.match('GET', '/api/media/abc/url').params, { id: 'abc' });
  assert.equal(r.match('POST', '/api/media/abc/url'), null);
});

test('SMTP client delivers a UTF-8 mail with login', async () => {
  const received = { commands: [], data: '' };
  const server = net.createServer((sock) => {
    let inData = false;
    let buf = '';
    sock.write('220 fake ESMTP\r\n');
    sock.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') { inData = false; sock.write('250 queued\r\n'); } else received.data += `${line}\n`;
          continue;
        }
        received.commands.push(line);
        if (line.startsWith('EHLO')) sock.write('250-fake\r\n250 AUTH LOGIN\r\n');
        else if (line === 'AUTH LOGIN') sock.write('334 VXNlcm5hbWU6\r\n');
        else if (received.commands.length === 3) sock.write('334 UGFzc3dvcmQ6\r\n');
        else if (received.commands.length === 4) sock.write('235 ok\r\n');
        else if (line === 'DATA') { inData = true; sock.write('354 go\r\n'); } else if (line === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); } else sock.write('250 ok\r\n');
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const mailer = createMailer({
    host: '127.0.0.1', port: server.address().port, user: 'u', pass: 'p',
    from: 'no-reply@example.com', fromName: 'YogaByTheSofa',
  });
  await mailer.send({ to: 'client@example.com', subject: 'Programare confirmată', text: 'Bună ziua, ședința e confirmată.' });
  server.close();
  assert.ok(received.commands.includes('RCPT TO:<client@example.com>'));
  assert.equal(Buffer.from(received.commands[2], 'base64').toString(), 'u');
  assert.ok(received.data.includes(`Subject: =?UTF-8?B?${Buffer.from('Programare confirmată').toString('base64')}?=`));
  const body = received.data.split('\n\n')[1].replace(/\n/g, '');
  assert.equal(Buffer.from(body, 'base64').toString(), 'Bună ziua, ședința e confirmată.');
});
