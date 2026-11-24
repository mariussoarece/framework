// HTTP routes under /api (nginx forwards https://<domain>/api/* here).
import http from 'node:http';
import { createRouter, HttpError, readBody, readJson, sendJson } from './http.js';
import { verifyHs256 } from './jwt.js';
import { eq } from './db.js';
import { uploadMedia, mediaUrls, sendOriginal } from './media.js';
import { bookingPayment, connectLink, connectStatus, stripeWebhook } from './payments.js';
import { closeOrganization, deleteMyAccount } from './account.js';

async function authenticate(ctx, req) {
  const m = /^Bearer (.+)$/i.exec(req.headers.authorization || '');
  if (!m) throw new HttpError(401, 'login_required');
  let claims;
  try {
    claims = verifyHs256(m[1], ctx.cfg.jwtSecret);
  } catch {
    throw new HttpError(401, 'invalid_token');
  }
  if (claims.role !== 'authenticated' || !claims.sub) throw new HttpError(401, 'invalid_token');
  const profile = await ctx.db.as(m[1]).one('profiles', `id=${eq(claims.sub)}`);
  return { userId: claims.sub, token: m[1], email: claims.email, profile };
}

export function createApp(ctx) {
  const r = createRouter();
  const authed = (fn) => async (req, res, params, url) => fn(req, res, params, url, await authenticate(ctx, req));

  r.add('GET', '/api/health', async () => ({ ok: true }));

  // media
  r.add('POST', '/api/media', authed(async (req, res, _p, url, user) => {
    res.statusCode = 201;
    return uploadMedia(ctx, req, user, url.searchParams);
  }));
  r.add('GET', '/api/media/:id/url', authed(async (_req, _res, p, _u, user) => mediaUrls(ctx, user, p.id)));
  r.add('GET', '/api/admin/media/:id/original', authed(async (req, res, p, _u, user) => {
    await sendOriginal(ctx, req, res, user, p.id);
    return undefined;              // response already streamed
  }));

  // payments
  r.add('POST', '/api/stripe/connect', authed(async (req, _res, _p, _u, user) => connectLink(ctx, user, await readJson(req))));
  r.add('GET', '/api/stripe/status', authed(async (_req, _res, _p, _u, user) => connectStatus(ctx, user)));
  r.add('POST', '/api/bookings/:id/pay', authed(async (_req, _res, p, _u, user) => bookingPayment(ctx, user, p.id)));
  r.add('POST', '/api/stripe/webhook', async (req) =>
    stripeWebhook(ctx, await readBody(req, 1_000_000), req.headers['stripe-signature']));

  // accounts
  // "Send a test notification" in Settings: to every phone of the person asking.
  r.add('POST', '/api/push/test', authed(async (_req, _res, _p, _u, user) => {
    const devices = await ctx.db.service.select('devices', `user_id=${eq(user.userId)}&select=platform`);
    const sent = await ctx.push.toUser(ctx.db, user.userId, (l) => ({
      title: l === 'ro' ? 'Notificare de test' : 'Test notification',
      body: l === 'ro' ? 'Notificările funcționează pe acest telefon.' : 'Notifications work on this phone.',
      data: { type: 'test' },
    }));
    return { devices: devices?.length || 0, sent };
  }));
  r.add('DELETE', '/api/account', authed(async (_req, _res, _p, _u, user) => deleteMyAccount(ctx, user)));
  r.add('POST', '/api/admin/organizations/:id/close', authed(async (_req, _res, p, _u, user) => {
    if (user.profile?.role !== 'super_admin') throw new HttpError(403, 'super_admin_only');
    return closeOrganization(ctx, p.id);
  }));

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    const match = r.match(req.method, url.pathname);
    try {
      if (!match) throw new HttpError(404, 'not_found');
      const result = await match.handler(req, res, match.params, url);
      if (result !== undefined && !res.headersSent) sendJson(res, res.statusCode || 200, result);
    } catch (err) {
      const status = err instanceof HttpError ? err.status
        : err.status && err.status < 500 ? err.status   // database refused (e.g. permission)
          : 500;
      if (status >= 500) ctx.log.error({ err: err.message, path: url.pathname }, 'request failed');
      if (!res.headersSent) {
        sendJson(res, status, { error: status >= 500 ? 'server_error' : (err.code || err.message) });
      } else res.destroy();
      req.resume();
    }
  });
}
