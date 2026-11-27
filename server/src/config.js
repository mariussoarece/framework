// All settings come from environment variables (infra/.env on the VPS).

function required(env, name) {
  const v = env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export function loadConfig(env = process.env) {
  return {
    port: Number(env.API_PORT || 8080),
    publicUrl: (env.PUBLIC_URL || `https://${env.DOMAIN || 'localhost'}`).replace(/\/$/, ''),
    siteUrl: (env.SITE_URL || '').replace(/\/$/, ''),

    restUrl: env.REST_URL || 'http://rest:3000',
    authUrl: env.AUTH_URL || 'http://auth:9999',
    jwtSecret: required(env, 'JWT_SECRET'),
    serviceKey: required(env, 'SERVICE_ROLE_KEY'),

    mediaRoot: env.MEDIA_ROOT_IN_CONTAINER || env.MEDIA_ROOT || '/srv/media',
    mediaLinkSecret: required(env, 'MEDIA_LINK_SECRET'),
    mediaLinkTtl: Number(env.MEDIA_LINK_TTL_SECONDS || 6 * 3600),
    maxVideoMb: Number(env.MAX_VIDEO_MB || 500),
    maxImageMb: Number(env.MAX_IMAGE_MB || 20),
    ffmpeg: env.FFMPEG_PATH || 'ffmpeg',
    ffprobe: env.FFPROBE_PATH || 'ffprobe',

    stripe: {
      secretKey: env.STRIPE_SECRET_KEY || '',
      publishableKey: env.STRIPE_PUBLISHABLE_KEY || '',
      webhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
      defaultCountry: env.STRIPE_DEFAULT_COUNTRY || 'RO',
    },

    apns: {
      keyFile: env.APNS_KEY_FILE || '',        // AuthKey_XXXX.p8
      keyId: env.APNS_KEY_ID || '',
      teamId: env.APNS_TEAM_ID || '',
      bundleId: env.APNS_BUNDLE_ID || '',
      production: env.APNS_PRODUCTION === 'true',
    },
    fcm: {
      serviceAccountFile: env.FCM_SERVICE_ACCOUNT_FILE || '',
    },

    smtp: {
      host: env.SMTP_HOST || '',
      port: Number(env.SMTP_PORT || 587),
      user: env.SMTP_USER || '',
      pass: env.SMTP_PASS || '',
      from: env.SMTP_SENDER || '',
      fromName: env.SMTP_SENDER_NAME || 'MyRitmio',
    },

    eventPollMs: Number(env.EVENT_POLL_MS || 3000),
    jobIntervalMs: Number(env.JOB_INTERVAL_MS || 60000),
  };
}
