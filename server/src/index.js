// Starts the HTTP API and the background workers.
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { createMailer } from './mail.js';
import { createPush } from './push.js';
import { createStripe } from './stripe.js';
import { createApp } from './app.js';
import { runEventsOnce } from './events.js';

const log = {
  info: (o, m) => console.log(JSON.stringify({ level: 'info', time: new Date().toISOString(), msg: m, ...o })),
  warn: (o, m) => console.warn(JSON.stringify({ level: 'warn', time: new Date().toISOString(), msg: m, ...o })),
  error: (o, m) => console.error(JSON.stringify({ level: 'error', time: new Date().toISOString(), msg: m, ...o })),
};

const cfg = loadConfig();
const ctx = {
  cfg,
  log,
  db: createDb({ restUrl: cfg.restUrl, serviceKey: cfg.serviceKey }),
  mail: createMailer(cfg.smtp, { log }),
  push: createPush(cfg, { log }),
  stripe: createStripe(cfg.stripe),
};

const server = createApp(ctx);
server.requestTimeout = 0;          // large uploads
server.listen(cfg.port, () => log.info({ port: cfg.port }, 'api listening'));

let stopping = false;

async function eventLoop() {
  while (!stopping) {
    let n = 0;
    try {
      n = await runEventsOnce(ctx);
    } catch (err) {
      log.error({ err: err.message }, 'event loop error');
    }
    if (n === 0) await new Promise((r) => setTimeout(r, cfg.eventPollMs));
  }
}

const jobs = setInterval(async () => {
  try {
    const n = await ctx.db.service.rpc('expire_bookings');
    if (n) log.info({ expired: n }, 'expired bookings');
  } catch (err) {
    log.error({ err: err.message }, 'job error');
  }
}, cfg.jobIntervalMs);

eventLoop();

function shutdown() {
  stopping = true;
  clearInterval(jobs);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
