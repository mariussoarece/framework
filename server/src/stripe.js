// Stripe REST API over fetch (no SDK), plus webhook signature checking.
import { createHmac, timingSafeEqual } from 'node:crypto';

// {a: {b: 1}, c: [x]} -> a[b]=1&c[0]=x  (Stripe's form encoding)
export function formEncode(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') formEncode(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export function verifyWebhook(rawBody, header, secret, toleranceSeconds = 300, now = Date.now()) {
  const parts = Object.fromEntries(String(header || '').split(',').map((p) => {
    const i = p.indexOf('=');
    return [p.slice(0, i).trim(), p.slice(i + 1)];
  }).filter(([k]) => k));
  const signatures = String(header || '').split(',')
    .filter((p) => p.trim().startsWith('v1=')).map((p) => p.trim().slice(3));
  const ts = Number(parts.t);
  if (!ts || !signatures.length) throw new Error('bad_signature_header');
  if (Math.abs(now / 1000 - ts) > toleranceSeconds) throw new Error('signature_too_old');
  const expected = createHmac('sha256', secret).update(`${ts}.${rawBody.toString('utf8')}`).digest();
  const ok = signatures.some((s) => {
    const given = Buffer.from(s, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!ok) throw new Error('bad_signature');
  return JSON.parse(rawBody.toString('utf8'));
}

export function createStripe(cfg, { fetchImpl = fetch } = {}) {
  const configured = Boolean(cfg.secretKey);

  async function request(method, path, params, { idempotencyKey } = {}) {
    if (!configured) throw new Error('stripe_not_configured');
    const headers = { Authorization: `Bearer ${cfg.secretKey}` };
    let url = `https://api.stripe.com/v1${path}`;
    let body;
    if (params && method === 'GET') url += `?${formEncode(params)}`;
    else if (params) {
      body = formEncode(params);
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const res = await fetchImpl(url, { method, headers, body });
    const j = await res.json();
    if (!res.ok) {
      const err = new Error(j.error?.message || `stripe ${res.status}`);
      err.stripe = j.error;
      throw err;
    }
    return j;
  }

  return {
    configured,
    request,
    createAccount: (p) => request('POST', '/accounts', p),
    getAccount: (id) => request('GET', `/accounts/${id}`),
    createAccountLink: (p) => request('POST', '/account_links', p),
    createPaymentIntent: (p, key) => request('POST', '/payment_intents', p, { idempotencyKey: key }),
    getPaymentIntent: (id) => request('GET', `/payment_intents/${id}`),
    capture: (id) => request('POST', `/payment_intents/${id}/capture`, {}, { idempotencyKey: `capture-${id}` }),
    cancel: (id) => request('POST', `/payment_intents/${id}/cancel`, {}, { idempotencyKey: `cancel-${id}` }),
    refund: (id) => request('POST', '/refunds', {
      payment_intent: id, reverse_transfer: true, refund_application_fee: true,
    }, { idempotencyKey: `refund-${id}` }),
    verifyWebhook: (raw, header) => verifyWebhook(raw, header, cfg.webhookSecret),
  };
}
