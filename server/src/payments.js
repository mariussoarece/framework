// Booking payments with Stripe Connect.
// The card is authorized when the client books, charged when the owner accepts,
// released when declined/cancelled, refunded if cancelled after the charge.
// Stripe pays the owner's share into their bank account and keeps the platform fee.
import { HttpError } from './http.js';
import { eq } from './db.js';

// POST /api/stripe/connect   (owner) -> onboarding link for Stripe
export async function connectLink(ctx, user, body) {
  const { db, stripe, cfg } = ctx;
  const p = user.profile;
  if (p?.role !== 'owner' || !p.organization_id) throw new HttpError(403, 'owners_only');
  const org = await db.service.one('organizations', `id=${eq(p.organization_id)}`);

  let accountId = org.stripe_account_id;
  if (!accountId) {
    const account = await stripe.createAccount({
      type: 'express',
      country: (body.country || cfg.stripe.defaultCountry).toUpperCase(),
      email: p.email || undefined,
      business_profile: { name: org.name },
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      metadata: { organization_id: org.id },
    });
    accountId = account.id;
    await db.service.update('organizations', `id=${eq(org.id)}`, { stripe_account_id: accountId });
  }
  const link = await stripe.createAccountLink({
    account: accountId,
    refresh_url: `${cfg.siteUrl}/stripe/refresh`,
    return_url: `${cfg.siteUrl}/stripe/done`,
    type: 'account_onboarding',
  });
  return { url: link.url };
}

// GET /api/stripe/status   (owner) -> can this organization take payments?
export async function connectStatus(ctx, user) {
  const p = user.profile;
  if (p?.role !== 'owner') throw new HttpError(403, 'owners_only');
  const org = await ctx.db.service.one('organizations', `id=${eq(p.organization_id)}`);
  if (!org.stripe_account_id) return { connected: false, charges_enabled: false };
  const a = await ctx.stripe.getAccount(org.stripe_account_id);
  return { connected: true, charges_enabled: Boolean(a.charges_enabled), payouts_enabled: Boolean(a.payouts_enabled) };
}

export const platformFee = (amount, percent) => Math.round((amount * Number(percent || 0)) / 100);

// POST /api/bookings/:id/pay   (client) -> client_secret for the in-app payment sheet
export async function bookingPayment(ctx, user, bookingId) {
  const { db, stripe, cfg } = ctx;
  const b = await db.service.one('bookings', `id=${eq(bookingId)}`);
  if (!b || b.client_id !== user.userId) throw new HttpError(404, 'booking_not_found');
  if (b.status !== 'pending' || b.payment_status !== 'requires_payment') {
    throw new HttpError(409, 'payment_not_needed');
  }
  const org = await db.service.one('organizations', `id=${eq(b.organization_id)}`);
  if (!org.stripe_account_id) throw new HttpError(409, 'owner_payments_not_set_up');

  let pi;
  if (b.stripe_payment_intent_id) {
    pi = await stripe.getPaymentIntent(b.stripe_payment_intent_id);
  } else {
    pi = await stripe.createPaymentIntent({
      amount: b.price_cents,
      currency: b.currency.toLowerCase(),
      capture_method: 'manual',
      automatic_payment_methods: { enabled: true },
      application_fee_amount: platformFee(b.price_cents, org.commission_percent),
      transfer_data: { destination: org.stripe_account_id },
      metadata: { booking_id: b.id, organization_id: org.id },
    }, `booking-${b.id}`);
    await db.service.update('bookings', `id=${eq(b.id)}`, { stripe_payment_intent_id: pi.id });
  }
  return { client_secret: pi.client_secret, publishable_key: cfg.stripe.publishableKey };
}

// POST /api/stripe/webhook
const STATUS_FROM_EVENT = {
  'payment_intent.amount_capturable_updated': 'authorized',
  'payment_intent.succeeded': 'captured',
  'payment_intent.canceled': 'canceled',
};

export async function stripeWebhook(ctx, raw, signature) {
  let event;
  try {
    event = ctx.stripe.verifyWebhook(raw, signature);
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  const obj = event.data?.object || {};
  let piId;
  let status = STATUS_FROM_EVENT[event.type];
  if (status) piId = obj.id;
  if (event.type === 'charge.refunded') {
    status = 'refunded';
    piId = obj.payment_intent;
  }
  if (piId && status) {
    // never move backwards (e.g. a late "authorized" after "captured")
    const order = ['requires_payment', 'authorized', 'captured', 'refunded'];
    const b = await ctx.db.service.one('bookings', `stripe_payment_intent_id=${eq(piId)}`);
    if (b) {
      const forward = status === 'canceled' || order.indexOf(status) > order.indexOf(b.payment_status);
      if (forward) await ctx.db.service.update('bookings', `id=${eq(b.id)}`, { payment_status: status });
    }
  }
  return { received: true };
}

// Called by the event worker when a booking is accepted / declined / cancelled.
export async function settlePayment(ctx, booking) {
  const { stripe, db } = ctx;
  const pi = booking.stripe_payment_intent_id;
  if (!pi || !stripe.configured) return;
  if (booking.status === 'accepted' && booking.payment_status === 'authorized') {
    await stripe.capture(pi);
    await db.service.update('bookings', `id=${eq(booking.id)}`, { payment_status: 'captured' });
  } else if (['declined', 'cancelled'].includes(booking.status)) {
    if (['authorized', 'requires_payment'].includes(booking.payment_status)) {
      await stripe.cancel(pi).catch((e) => {
        // already canceled or never confirmed: nothing to release
        if (!/cannot be canceled|status of canceled/i.test(e.message)) throw e;
      });
      await db.service.update('bookings', `id=${eq(booking.id)}`, { payment_status: 'canceled' });
    } else if (booking.payment_status === 'captured') {
      await stripe.refund(pi);
      await db.service.update('bookings', `id=${eq(booking.id)}`, { payment_status: 'refunded' });
    }
  }
}
