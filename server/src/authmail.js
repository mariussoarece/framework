// Creating an account and "Forgot password" go through here instead of straight to the
// sign-in service, so that the emails are ours: in the person's language, and with the
// device the request came from.
//
//  - new email           -> the account is created, a "confirm your email" email is sent
//  - email with account  -> nothing is created; the owner gets "someone tried to create an
//                           account with your email" (at most once an hour per address)
//  - forgot password     -> the owner gets the reset link, with the device that asked
//
// The answer to the app is the same in every case, so nobody can find out from it whether
// an email is registered.
import { HttpError } from './http.js';
import { eq } from './db.js';
import { t } from './i18n.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOUR = 3600_000;

// small in-memory limits (one server process)
function limiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const list = (hits.get(key) || []).filter((at) => now - at < windowMs);
    if (list.length >= max) { hits.set(key, list); return false; }
    list.push(now);
    hits.set(key, list);
    if (hits.size > 10_000) for (const [k, v] of hits) if (!v.some((at) => now - at < windowMs)) hits.delete(k);
    return true;
  };
}

// Device description sent by the app, cleaned: "iPhone · iOS 18.1 · app 0.1.0"
export function deviceText(device) {
  if (!device || typeof device !== 'object') return '';
  const clean = (v) => String(v ?? '').replace(/[^\p{L}\p{N} ._\-()/+]/gu, '').trim().slice(0, 40);
  const parts = [
    clean(device.model),
    [clean(device.os), clean(device.osVersion)].filter(Boolean).join(' '),
    device.appVersion ? `app ${clean(device.appVersion)}` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

function language(value) {
  return value === 'ro' ? 'ro' : 'en';
}

export function createAuthMail(ctx) {
  const perIp = limiter(20, HOUR);            // sign-ups + resets per address per hour
  const ownerNotice = limiter(1, HOUR);       // "someone tried…" per email per hour
  const resetPerEmail = limiter(3, HOUR);     // reset emails per email per hour
  const siteUrl = () => `${ctx.cfg.siteUrl || ctx.cfg.publicUrl}/`;
  const fetchImpl = () => ctx.fetchImpl || fetch;

  // the sign-in service's own admin call: makes the link without sending any email
  async function generateLink(body) {
    const res = await fetchImpl()(`${ctx.cfg.authUrl}/admin/generate_link`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.cfg.serviceKey}`,
        apikey: ctx.cfg.serviceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...body, redirect_to: siteUrl() }),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  }

  // the link goes through nginx under /auth/v1 (see GOTRUE_MAILER_URLPATHS_*)
  function verifyLink(json) {
    const token = json.hashed_token || json.properties?.hashed_token;
    const type = json.verification_type || json.properties?.verification_type;
    if (!token || !type) {
      const direct = json.action_link || json.properties?.action_link;
      if (direct) return direct;
      throw new Error('generate_link: no token in answer');
    }
    return `${ctx.cfg.publicUrl}/auth/v1/verify?token=${encodeURIComponent(token)}`
      + `&type=${encodeURIComponent(type)}&redirect_to=${encodeURIComponent(siteUrl())}`;
  }

  // the account's own language and organization time zone, when it has them
  async function owner(email) {
    const p = await ctx.db.service.one('profiles', `email=${eq(email)}&select=language,organization_id`);
    let timezone = 'UTC';
    if (p?.organization_id) {
      const org = await ctx.db.service.one('organizations', `id=${eq(p.organization_id)}&select=timezone`);
      if (org?.timezone) timezone = org.timezone;
    }
    return { language: p?.language, timezone };
  }

  function when(lang, timezone) {
    try {
      return new Intl.DateTimeFormat(lang === 'ro' ? 'ro-RO' : 'en-GB', {
        dateStyle: 'long', timeStyle: 'short', timeZone: timezone, timeZoneName: 'short',
      }).format(new Date());
    } catch {
      return new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    }
  }

  async function send(to, lang, key, vars) {
    await ctx.mail.send({ to, subject: t(lang, `${key}_subject`, vars), text: t(lang, `${key}_body`, vars) });
  }

  function parse(body) {
    const email = String(body?.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, 'invalid_email');
    return { email, lang: language(body?.language), device: deviceText(body?.device) };
  }

  function clientIp(req) {
    return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.headers['x-real-ip'] || req.socket?.remoteAddress || '';
  }

  async function signup(req, body) {
    const { email, lang, device } = parse(body);
    const password = String(body?.password || '');
    if (password.length < 8) throw new HttpError(400, 'weak_password');
    if (!perIp(clientIp(req))) throw new HttpError(429, 'too_many_requests');

    const r = await generateLink({ type: 'signup', email, password, data: { language: lang } });
    if (r.ok) {
      await send(email, lang, 'confirm', { link: verifyLink(r.json), device: device || '-' });
      return { status: 'check_email' };
    }
    const code = String(r.json?.error_code || r.json?.code || r.json?.msg || r.json?.message || '');
    if (r.status === 422 && /exist|registered/i.test(code)) {
      // the email already has an account: tell its owner, create nothing
      if (ownerNotice(email)) {
        const o = await owner(email);
        const l = language(o.language || lang);
        await send(email, l, 'signup_existing', {
          when: when(l, o.timezone), device: device || t(l, 'device_unknown'),
        }).catch((err) => ctx.log.error({ err: err.message }, 'notice email failed'));
      }
      return { status: 'check_email' };
    }
    if (r.status === 422 && /password/i.test(code)) throw new HttpError(400, 'weak_password');
    ctx.log.error({ status: r.status, body: r.json }, 'signup failed');
    throw new HttpError(502, 'signup_failed');
  }

  async function recover(req, body) {
    const { email, lang, device } = parse(body);
    if (!perIp(clientIp(req))) throw new HttpError(429, 'too_many_requests');
    if (!resetPerEmail(email)) return { status: 'sent' };   // quietly: the earlier email is still valid

    const r = await generateLink({ type: 'recovery', email });
    if (r.ok) {
      const o = await owner(email);
      const l = language(o.language || lang);
      await send(email, l, 'recover', {
        link: verifyLink(r.json), when: when(l, o.timezone), device: device || t(l, 'device_unknown'),
      });
    } else if (r.status !== 404 && r.status !== 422) {
      ctx.log.error({ status: r.status, body: r.json }, 'recovery link failed');
    }
    return { status: 'sent' };                                // same answer, account or not
  }

  return { signup, recover };
}
