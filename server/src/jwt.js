// Small JWT helpers on node:crypto (no packages).
import { createHmac, sign as cryptoSign, timingSafeEqual } from 'node:crypto';

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

export function signHs256(payload, secret) {
  const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}`;
  return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`;
}

// Verifies a login token issued by the auth service. Returns the payload or throws.
export function verifyHs256(token, secret, now = Date.now()) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('malformed_token');
  const [head, body, sig] = parts;
  const header = JSON.parse(Buffer.from(head, 'base64url').toString());
  if (header.alg !== 'HS256') throw new Error('unsupported_alg');
  const expected = createHmac('sha256', secret).update(`${head}.${body}`).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new Error('bad_signature');
  }
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (payload.exp && payload.exp * 1000 < now) throw new Error('token_expired');
  return payload;
}

// ES256 (Apple push) and RS256 (Google push) signing from a PEM private key.
export function signAsymmetric(alg, header, payload, privateKeyPem) {
  const data = `${b64({ alg, typ: 'JWT', ...header })}.${b64(payload)}`;
  const signature = alg === 'ES256'
    ? cryptoSign('sha256', Buffer.from(data), { key: privateKeyPem, dsaEncoding: 'ieee-p1363' })
    : cryptoSign('sha256', Buffer.from(data), privateKeyPem);
  return `${data}.${signature.toString('base64url')}`;
}
