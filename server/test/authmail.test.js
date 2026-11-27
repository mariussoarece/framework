// Sign-up / forgot password emails (fake sign-in service, fake mail).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthMail, deviceText } from '../src/authmail.js';

function setup(answers) {
  const sent = [];
  const calls = [];
  const ctx = {
    cfg: { authUrl: 'http://auth', serviceKey: 'svc', publicUrl: 'https://api.test', siteUrl: 'https://api.test' },
    log: { error() {}, warn() {}, info() {} },
    mail: { send: async (m) => { sent.push(m); return true; } },
    db: { service: { one: async (table) => (table === 'profiles' ? { language: 'ro', organization_id: null } : null) } },
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, body });
      const a = answers[body.type];
      return { ok: a.status < 300, status: a.status, json: async () => a.json };
    },
  };
  return { auth: createAuthMail(ctx), sent, calls };
}
const req = { headers: { 'x-forwarded-for': '1.2.3.4' } };
const device = { model: 'iPhone', os: 'iOS', osVersion: '18.1', appVersion: '0.1.0' };

test('device text is short and clean', () => {
  assert.equal(deviceText(device), 'iPhone · iOS 18.1 · app 0.1.0');
  assert.equal(deviceText({ model: '<script>x</script>' }), 'scriptx/script');   // no < > left
  assert.equal(deviceText(null), '');
});

test('new email: account created, our confirmation email with a /auth/v1 link', async () => {
  const { auth, sent, calls } = setup({ signup: { status: 200, json: { hashed_token: 'abc', verification_type: 'signup' } } });
  const r = await auth.signup(req, { email: 'New@Example.com', password: 'secret123', language: 'en', device });
  assert.deepEqual(r, { status: 'check_email' });
  assert.equal(calls[0].url, 'http://auth/admin/generate_link');
  assert.equal(calls[0].body.email, 'new@example.com');
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /https:\/\/api\.test\/auth\/v1\/verify\?token=abc&type=signup/);
  assert.match(sent[0].text, /iPhone · iOS 18\.1/);
});

test('email with an account: same answer, owner told once an hour, in their language', async () => {
  const { auth, sent } = setup({ signup: { status: 422, json: { error_code: 'email_exists' } } });
  const body = { email: 'owner@example.com', password: 'secret123', language: 'en', device };
  assert.deepEqual(await auth.signup(req, body), { status: 'check_email' });
  assert.deepEqual(await auth.signup(req, body), { status: 'check_email' });
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /Cineva a încercat/);      // profile language: ro
  assert.match(sent[0].text, /iPhone/);
});

test('forgot password: reset link with the device; unknown email gives the same answer', async () => {
  const ok = setup({ recovery: { status: 200, json: { hashed_token: 'r1', verification_type: 'recovery' } } });
  assert.deepEqual(await ok.auth.recover(req, { email: 'a@example.com', device }), { status: 'sent' });
  assert.match(ok.sent[0].text, /auth\/v1\/verify\?token=r1&type=recovery/);
  assert.match(ok.sent[0].text, /iPhone/);

  const none = setup({ recovery: { status: 404, json: { msg: 'User not found' } } });
  assert.deepEqual(await none.auth.recover(req, { email: 'nobody@example.com' }), { status: 'sent' });
  assert.equal(none.sent.length, 0);
});

test('bad input is refused', async () => {
  const { auth } = setup({});
  await assert.rejects(auth.signup(req, { email: 'x', password: 'secret123' }), /invalid_email/);
  await assert.rejects(auth.signup(req, { email: 'a@b.co', password: 'short' }), /weak_password/);
});
