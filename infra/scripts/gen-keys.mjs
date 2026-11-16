#!/usr/bin/env node
// Prints fresh secrets for infra/.env (no packages needed):
//   node infra/scripts/gen-keys.mjs >> infra/.env
// ANON_KEY and SERVICE_ROLE_KEY are tokens signed with JWT_SECRET; the app
// uses ANON_KEY, only the Node server may ever see SERVICE_ROLE_KEY.
import { randomBytes, createHmac } from 'node:crypto';

const secret = (bytes = 32) => randomBytes(bytes).toString('base64url');
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

function signJwt(payload, key) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(payload);
  const sig = createHmac('sha256', key).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

const jwtSecret = process.env.JWT_SECRET || secret(48);
const now = Math.floor(Date.now() / 1000);
const tenYears = now + 10 * 365 * 24 * 3600;

const lines = {
  POSTGRES_PASSWORD: secret(),
  AUTHENTICATOR_PASSWORD: secret(),
  AUTH_ADMIN_PASSWORD: secret(),
  JWT_SECRET: jwtSecret,
  ANON_KEY: signJwt({ role: 'anon', iss: 'framework', iat: now, exp: tenYears }, jwtSecret),
  SERVICE_ROLE_KEY: signJwt({ role: 'service_role', iss: 'framework', iat: now, exp: tenYears }, jwtSecret),
  MEDIA_LINK_SECRET: secret(),
  PGADMIN_PASSWORD: secret(18),
};

for (const [k, v] of Object.entries(lines)) console.log(`${k}=${v}`);
