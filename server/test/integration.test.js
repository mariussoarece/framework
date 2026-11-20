// End-to-end: the real HTTP server + real PostgreSQL schema + real FFmpeg,
// with Stripe, push delivery, email and the auth service replaced by recorders.
// Needs an empty, migrated database:  TEST_DB_URL=postgresql://... node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { createPush } from '../src/push.js';
import { verifyWebhook } from '../src/stripe.js';
import { signHs256 } from '../src/jwt.js';
import { runEventsOnce } from '../src/events.js';
import { createPsqlDb } from './helpers/psql-db.js';

const DB = process.env.TEST_DB_URL;

test('server end to end', { skip: !DB && 'set TEST_DB_URL to run' }, async () => {
  const secret = 'test-jwt-secret';
  const id = {
    owner: 'a0000000-0000-4000-8000-000000000001',
    client: 'a0000000-0000-4000-8000-000000000002',
    client2: 'a0000000-0000-4000-8000-000000000003',
    admin: 'a0000000-0000-4000-8000-000000000004',
  };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const T = Object.fromEntries(Object.entries(id).map(([k, v]) =>
    [k, signHs256({ sub: v, role: 'authenticated', email: `${k}@example.com`, exp }, secret)]));

  const mediaRoot = mkdtempSync(join(tmpdir(), 'media-'));
  const cfg = {
    publicUrl: 'https://api.example.com', siteUrl: 'https://example.com', authUrl: 'http://auth:9999',
    jwtSecret: secret, serviceKey: 'service-key', mediaRoot, mediaLinkSecret: 'link-secret', mediaLinkTtl: 3600,
    maxVideoMb: 50, maxImageMb: 5, ffmpeg: 'ffmpeg', ffprobe: 'ffprobe',
    stripe: { publishableKey: 'pk_test_1', defaultCountry: 'RO' },
    apns: {}, fcm: {}, smtp: {},
  };

  const pushes = [];
  const mails = [];
  const stripeCalls = [];
  const authCalls = [];
  let piCount = 0;
  const db = createPsqlDb(DB);
  const ctx = {
    cfg,
    log: { info() {}, warn() {}, error: (o, m) => console.error(m, o) },
    db,
    push: createPush(cfg, { transport: async (device, msg) => { pushes.push({ token: device.push_token, ...msg }); return { ok: true }; } }),
    mail: { configured: true, send: async (m) => { mails.push(m); return true; } },
    stripe: {
      configured: true,
      createAccount: async (p) => { stripeCalls.push(['account', p]); return { id: 'acct_test' }; },
      createAccountLink: async (p) => { stripeCalls.push(['link', p]); return { url: 'https://connect.stripe.com/setup/x' }; },
      createPaymentIntent: async (p, key) => {
        piCount += 1;
        stripeCalls.push(['pi', p, key]);
        return { id: `pi_${piCount}`, client_secret: `pi_${piCount}_secret` };
      },
      getPaymentIntent: async (pid) => ({ id: pid, client_secret: `${pid}_secret` }),
      capture: async (pid) => { stripeCalls.push(['capture', pid]); },
      cancel: async (pid) => { stripeCalls.push(['cancel', pid]); },
      refund: async (pid) => { stripeCalls.push(['refund', pid]); },
      verifyWebhook: (raw, h) => verifyWebhook(raw, h, 'whsec_test'),
    },
    fetchImpl: async (url, opts) => { authCalls.push([opts.method, url]); return new Response(null, { status: 204 }); },
  };

  const server = createApp(ctx).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (method, path, { token, json, body, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: json ? JSON.stringify(json) : body,
    });
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch { /* binary */ }
    return { status: res.status, data, headers: res.headers };
  };
  const drain = async () => { while (await runEventsOnce(ctx)) { /* until the queue is empty */ } };
  const titles = (token) => pushes.filter((p) => p.token === token).map((p) => p.title);

  try {
    // ------------------------------------------------------------ setup
    const org = await db.as(T.owner).rpc('create_organization', { p_name: 'Yoga Test', p_plan: 'commission' });
    assert.equal(org.join_code, 'yogatest');
    await db.as(T.client).rpc('join_organization', { p_code: 'yogatest' });
    await db.as(T.client2).rpc('join_organization', { p_code: 'yogatest' });
    await db.as(T.client2).update('profiles', `id=eq.${id.client2}`, { language: 'ro' });
    await db.service.insert('profiles', { id: id.admin, email: 'admin@example.com', role: 'super_admin' });
    for (const who of ['owner', 'client', 'client2', 'admin']) {
      await db.as(T[who]).insert('devices', { push_token: `tok-${who}`, user_id: id[who], platform: who === 'client2' ? 'android' : 'ios' });
    }

    // ------------------------------------------------------------ media
    const video = join(mediaRoot, 'src.mp4');
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=25:duration=2',
      '-c:v', 'libx264', video]);

    assert.equal((await api('POST', '/api/media?kind=video', { body: readFileSync(video), headers: { 'Content-Type': 'video/mp4' } })).status, 401,
      'upload needs login');
    assert.equal((await api('POST', '/api/media?kind=video', { token: T.client, body: readFileSync(video), headers: { 'Content-Type': 'video/mp4' } })).status, 403,
      'clients cannot upload');
    assert.equal((await api('POST', '/api/media?kind=video', { token: T.owner, body: 'x', headers: { 'Content-Type': 'application/zip' } })).status, 415,
      'unsupported type refused');

    const up = await api('POST', '/api/media?kind=video', { token: T.owner, body: readFileSync(video), headers: { 'Content-Type': 'video/mp4' } });
    assert.equal(up.status, 201);
    assert.equal(up.data.status, 'pending');
    const mediaId = up.data.id;
    assert.ok(existsSync(join(mediaRoot, 'uploads', up.data.original_path)), 'original stored on disk');

    assert.equal((await api('GET', `/api/media/${mediaId}/url`, { token: T.client })).status, 404, 'client cannot see pending media');
    assert.equal((await api('GET', `/api/admin/media/${mediaId}/original`, { token: T.owner })).status, 403, 'owner cannot use admin preview');
    const preview = await api('GET', `/api/admin/media/${mediaId}/original`, { token: T.admin, headers: { Range: 'bytes=0-99' } });
    assert.equal(preview.status, 206, 'admin preview supports seeking');
    assert.equal(preview.headers.get('content-length'), '100');

    await db.as(T.admin).rpc('review_media', { p_media: mediaId, p_approve: true });
    await drain();
    const m = await db.service.one('media', `id=eq.${mediaId}`);
    assert.equal(m.status, 'published', 'converted and published');
    assert.ok(existsSync(join(mediaRoot, 'published', m.file_720)), '720p file exists');
    assert.ok(existsSync(join(mediaRoot, 'published', m.file_1080)), '1080p file exists');
    assert.ok(!existsSync(join(mediaRoot, 'uploads', m.original_path)), 'original removed after publishing');
    assert.deepEqual(titles('tok-owner'), ['Upload approved']);

    const urls = await api('GET', `/api/media/${mediaId}/url`, { token: T.client });
    assert.equal(urls.status, 200);
    assert.match(urls.data.video_720.url, new RegExp(`^https://api.example.com/media/${org.id}/${mediaId}_720\\.mp4\\?md5=[\\w-]+&expires=\\d+$`));
    assert.ok(urls.data.video_1080.url.includes('_1080.mp4'));

    // ------------------------------------------------------------ paid booking: authorize, accept, cancel
    await db.as(T.owner).rpc('save_availability', {
      p_id: null, p_weekdays: [0, 1, 2, 3, 4, 5, 6], p_kind: 'open', p_title: null, p_instructor: null,
      p_start: '08:00', p_end: '20:00', p_slot_minutes: 60, p_capacity: 1, p_price_cents: 3000,
      p_valid_from: new Date().toISOString().slice(0, 10), p_valid_until: null,
    });
    const slots = await db.as(T.client).rpc('available_slots', { p_from: new Date().toISOString().slice(0, 10), p_days: 3 });
    const b1 = await db.as(T.client).rpc('request_booking', { p_starts_at: slots[0].starts_at });
    assert.equal(b1.payment_status, 'requires_payment');

    assert.equal((await api('POST', `/api/bookings/${b1.id}/pay`, { token: T.client })).data.error, 'owner_payments_not_set_up');
    const link = await api('POST', '/api/stripe/connect', { token: T.owner, json: {} });
    assert.equal(link.data.url, 'https://connect.stripe.com/setup/x');
    assert.equal((await api('POST', `/api/bookings/${b1.id}/pay`, { token: T.client2 })).status, 404, 'other client cannot pay it');
    const pay = await api('POST', `/api/bookings/${b1.id}/pay`, { token: T.client });
    assert.equal(pay.data.client_secret, 'pi_1_secret');
    const [, piParams, piKey] = stripeCalls.find((c) => c[0] === 'pi');
    assert.equal(piParams.amount, 3000);
    assert.equal(piParams.application_fee_amount, 300, '10% platform fee');
    assert.equal(piParams.transfer_data.destination, 'acct_test', 'rest goes to the owner');
    assert.equal(piParams.capture_method, 'manual', 'charged only when accepted');
    assert.equal(piKey, `booking-${b1.id}`);

    await drain();
    assert.deepEqual(titles('tok-owner'), ['Upload approved'], 'owner not bothered before the card is authorized');

    const hook = (type, obj) => {
      const raw = JSON.stringify({ type, data: { object: obj } });
      const ts = Math.floor(Date.now() / 1000);
      const sig = createHmac('sha256', 'whsec_test').update(`${ts}.${raw}`).digest('hex');
      return api('POST', '/api/stripe/webhook', { body: raw, headers: { 'Stripe-Signature': `t=${ts},v1=${sig}` } });
    };
    assert.equal((await api('POST', '/api/stripe/webhook', { body: '{}', headers: { 'Stripe-Signature': 't=1,v1=00' } })).status, 400,
      'unsigned webhook refused');
    assert.equal((await hook('payment_intent.amount_capturable_updated', { id: 'pi_1' })).status, 200);
    assert.equal((await db.service.one('bookings', `id=eq.${b1.id}`)).payment_status, 'authorized');
    await drain();
    assert.deepEqual(titles('tok-owner'), ['Upload approved', 'New booking request']);

    await db.as(T.owner).rpc('decide_booking', { p_booking: b1.id, p_accept: true });
    await drain();
    assert.ok(stripeCalls.some((c) => c[0] === 'capture' && c[1] === 'pi_1'), 'charged on accept');
    assert.equal((await db.service.one('bookings', `id=eq.${b1.id}`)).payment_status, 'captured');
    assert.deepEqual(titles('tok-client'), ['Booking confirmed']);

    await db.as(T.client).rpc('cancel_booking', { p_booking: b1.id });
    await drain();
    assert.ok(stripeCalls.some((c) => c[0] === 'refund' && c[1] === 'pi_1'), 'refunded after cancel');
    assert.equal((await db.service.one('bookings', `id=eq.${b1.id}`)).payment_status, 'refunded');
    assert.equal(titles('tok-owner').at(-1), 'Booking cancelled');

    // ------------------------------------------------------------ declined booking, Romanian client
    const b2 = await db.as(T.client2).rpc('request_booking', { p_starts_at: slots[1].starts_at });
    await api('POST', `/api/bookings/${b2.id}/pay`, { token: T.client2 });
    await hook('payment_intent.amount_capturable_updated', { id: 'pi_2' });
    await drain();
    await db.as(T.owner).rpc('decide_booking', { p_booking: b2.id, p_accept: false });
    await drain();
    assert.ok(stripeCalls.some((c) => c[0] === 'cancel' && c[1] === 'pi_2'), 'authorization released on decline');
    assert.deepEqual(titles('tok-client2'), ['Programare refuzată'], 'Romanian notification');

    // ------------------------------------------------------------ a client reports a workout
    const w = await db.as(T.owner).insert('workouts', { organization_id: org.id, name: 'Cobra Pose', sets: 3, reps: 10 });
    await db.as(T.client).insert('content_reports', {
      organization_id: org.id, workout_id: w.id, reporter_id: id.client, reason: 'Inappropriate: test',
    });
    await drain();
    assert.deepEqual(pushes.filter((x) => x.token === 'tok-admin').map((x) => [x.title, x.body]),
      [['New content report', 'Yoga Test: Cobra Pose']], 'super admin is notified of the report');

    // ------------------------------------------------------------ owner deletes their account
    const del = await api('DELETE', '/api/account', { token: T.owner });
    assert.equal(del.status, 200);
    assert.equal((await db.service.one('organizations', `id=eq.${org.id}`)).status, 'closed');
    assert.deepEqual(mails.map((x) => x.subject).sort(),
      ['Yoga Test has closed', 'Yoga Test s-a închis', 'Your account was deleted'].sort());
    assert.ok(mails.find((x) => x.to === 'client2@example.com').text.includes('YogaByTheSofa'));
    assert.ok(!existsSync(join(mediaRoot, 'published', org.id)), 'organization files deleted');
    assert.equal(await db.service.one('profiles', `id=eq.${id.owner}`), null, 'owner profile deleted');
    assert.deepEqual(authCalls[0], ['DELETE', `http://auth:9999/admin/users/${id.owner}`], 'login removed');
    assert.equal((await db.service.one('profiles', `id=eq.${id.client}`)).organization_id, null, 'clients released');
    await drain();

    // ------------------------------------------------------------ client deletes their account
    assert.equal((await api('DELETE', '/api/account', { token: T.client })).status, 200);
    assert.equal(await db.service.one('profiles', `id=eq.${id.client}`), null);
    assert.equal((await api('DELETE', '/api/account', { token: T.admin })).data.error, 'super_admin_cannot_self_delete');
  } finally {
    server.close();
  }
});
