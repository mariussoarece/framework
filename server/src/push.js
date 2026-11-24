// Push notifications sent directly to Apple (APNs) and Google (FCM).
// Both are free; they only carry the alert text. Invalid tokens are removed.
import http2 from 'node:http2';
import { readFileSync } from 'node:fs';
import { signAsymmetric } from './jwt.js';
import { eq } from './db.js';

export function createPush(cfg, { fetchImpl = fetch, log = console, transport } = {}) {
  const apnsReady = Boolean(cfg.apns.keyFile && cfg.apns.keyId && cfg.apns.teamId && cfg.apns.bundleId);
  const fcmReady = Boolean(cfg.fcm.serviceAccountFile);

  // ---- Apple
  let apnsKey;
  let apnsToken = { value: '', at: 0 };
  function apnsJwt(now = Date.now()) {
    if (!apnsKey) apnsKey = readFileSync(cfg.apns.keyFile, 'utf8');
    if (now - apnsToken.at > 50 * 60 * 1000) {          // Apple wants a new token every < 60 min
      apnsToken = {
        value: signAsymmetric('ES256', { kid: cfg.apns.keyId },
          { iss: cfg.apns.teamId, iat: Math.floor(now / 1000) }, apnsKey),
        at: now,
      };
    }
    return apnsToken.value;
  }

  function sendApns(deviceToken, msg) {
    const host = cfg.apns.production ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';
    return new Promise((resolve) => {
      const client = http2.connect(host);
      client.on('error', (e) => resolve({ ok: false, error: e.message }));
      const req = client.request({
        ':method': 'POST',
        ':path': `/3/device/${deviceToken}`,
        authorization: `bearer ${apnsJwt()}`,
        'apns-topic': cfg.apns.bundleId,
        'apns-push-type': 'alert',
        'content-type': 'application/json',
      });
      let status = 0;
      let body = '';
      req.on('response', (h) => { status = h[':status']; });
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        client.close();
        // 410 = token no longer valid; 400 BadDeviceToken too
        const gone = status === 410 || (status === 400 && body.includes('BadDeviceToken'));
        resolve({ ok: status === 200, gone, error: status === 200 ? undefined : `${status} ${body}` });
      });
      req.on('error', (e) => { client.close(); resolve({ ok: false, error: e.message }); });
      req.end(JSON.stringify({
        aps: {
          alert: { title: msg.title, body: msg.body }, sound: 'default',
          ...(Number.isInteger(msg.badge) ? { badge: msg.badge } : {}),
        },
        ...msg.data,
        body: msg.data || {},   // where expo-notifications looks for the data
      }));
    });
  }

  // ---- Google
  let account;
  let fcmToken = { value: '', expires: 0 };
  async function fcmAccessToken(now = Date.now()) {
    if (!account) account = JSON.parse(readFileSync(cfg.fcm.serviceAccountFile, 'utf8'));
    if (fcmToken.expires - 60_000 > now) return fcmToken.value;
    const iat = Math.floor(now / 1000);
    const assertion = signAsymmetric('RS256', {}, {
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: account.token_uri,
      iat,
      exp: iat + 3600,
    }, account.private_key);
    const res = await fetchImpl(account.token_uri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(`FCM auth failed: ${JSON.stringify(j)}`);
    fcmToken = { value: j.access_token, expires: now + j.expires_in * 1000 };
    return fcmToken.value;
  }

  async function sendFcm(deviceToken, msg) {
    const token = await fcmAccessToken();
    const res = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: deviceToken,
          notification: { title: msg.title, body: msg.body },
          data: {
            ...Object.fromEntries(Object.entries(msg.data || {}).map(([k, v]) => [k, String(v)])),
            body: JSON.stringify(msg.data || {}),   // where expo-notifications looks for the data
          },
          android: {
            priority: 'high',
            ...(Number.isInteger(msg.badge) ? { notification: { notification_count: msg.badge } } : {}),
          },
        },
      }),
    });
    const text = await res.text();
    const gone = res.status === 404 || text.includes('UNREGISTERED');
    return { ok: res.ok, gone, error: res.ok ? undefined : `${res.status} ${text}` };
  }

  const send = transport || (async (device, msg) => {
    if (device.platform === 'ios') {
      if (!apnsReady) return { ok: false, error: 'apns_not_configured' };
      return sendApns(device.push_token, msg);
    }
    if (!fcmReady) return { ok: false, error: 'fcm_not_configured' };
    return sendFcm(device.push_token, msg);
  });

  // Sends to every device of a user; makeMessage(language) -> {title, body, data}
  async function toUser(db, userId, makeMessage) {
    if (!userId) return 0;
    const profile = await db.service.one('profiles', `id=${eq(userId)}&select=language`);
    const devices = await db.service.select('devices', `user_id=${eq(userId)}`);
    if (!devices?.length) return 0;
    // the red number on the app icon, as it is now
    const badge = await db.service.rpc('badge_count_for', { p_user: userId }).catch(() => null);
    const message = { ...makeMessage(profile?.language), ...(Number.isInteger(badge) ? { badge } : {}) };
    let sent = 0;
    for (const d of devices) {
      const r = await send(d, message);
      if (r.ok) sent += 1;
      else {
        log.warn?.({ user: userId, platform: d.platform, error: r.error }, 'push failed');
        if (r.gone) await db.service.remove('devices', `push_token=${eq(d.push_token)}`);
      }
    }
    return sent;
  }

  return { toUser, sendApns, sendFcm, apnsJwt };
}
