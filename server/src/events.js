// Event worker: claims rows from public.events and handles them.
import { eq } from './db.js';
import { formatTime, reasonText, t } from './i18n.js';
import { processMedia, deleteMediaFiles } from './media.js';
import { settlePayment } from './payments.js';

async function bookingContext(ctx, bookingId) {
  const db = ctx.db.service;
  const b = await db.one('bookings', `id=${eq(bookingId)}`);
  if (!b) return null;
  const org = await db.one('organizations', `id=${eq(b.organization_id)}`);
  const client = await db.one('profiles', `id=${eq(b.client_id)}`);
  return { b, org, client };
}

function bookingMessage(key, { b, org, client }, extra = {}) {
  return (language) => ({
    ...t(language, key, {
      org: org.name,
      client: client?.display_name || client?.email || '',
      time: formatTime(b.starts_at, language, org.timezone),
    }),
    data: { type: 'booking', booking_id: b.id, ...extra },
  });
}

export const handlers = {
  async 'booking.created'(ctx, p) {
    const bc = await bookingContext(ctx, p.booking_id);
    if (!bc) return;
    // paid bookings notify the owner once the card is authorized (booking.payment)
    if (bc.b.payment_status === 'not_required' && bc.b.status === 'pending') {
      await ctx.push.toUser(ctx.db, bc.org.owner_id, bookingMessage('booking_request', bc));
    }
  },

  async 'booking.payment'(ctx, p) {
    if (p.payment_status !== 'authorized') return;
    const bc = await bookingContext(ctx, p.booking_id);
    if (!bc || bc.b.status !== 'pending') return;
    await ctx.push.toUser(ctx.db, bc.org.owner_id, bookingMessage('booking_request', bc));
  },

  async 'booking.status'(ctx, p) {
    const bc = await bookingContext(ctx, p.booking_id);
    if (!bc) return;               // e.g. the client's account was deleted
    await settlePayment(ctx, bc.b);
    const { b, org } = bc;
    if (b.status === 'accepted') {
      await ctx.push.toUser(ctx.db, b.client_id, bookingMessage('booking_accepted', bc));
    } else if (b.status === 'declined') {
      await ctx.push.toUser(ctx.db, b.client_id, bookingMessage('booking_declined', bc));
    } else if (b.status === 'cancelled') {
      if (b.cancelled_by === 'client') {
        // only tell the owner about bookings they had seen
        if (p.old_status === 'accepted' || b.payment_status !== 'requires_payment') {
          await ctx.push.toUser(ctx.db, org.owner_id, bookingMessage('booking_cancelled_by_client', bc));
        }
      } else if (p.old_status === 'accepted' || b.cancelled_by === 'owner') {
        await ctx.push.toUser(ctx.db, b.client_id, bookingMessage('booking_cancelled_by_owner', bc));
      }
    }
  },

  async 'media.approved'(ctx, p) {
    await processMedia(ctx, p.media_id);
  },

  async 'media.published'(ctx, p) {
    const m = await ctx.db.service.one('media', `id=${eq(p.media_id)}`);
    if (m?.uploaded_by) {
      await ctx.push.toUser(ctx.db, m.uploaded_by, (l) => ({
        ...t(l, 'media_published'), data: { type: 'media', media_id: m.id },
      }));
    }
  },

  async 'media.rejected'(ctx, p) {
    const m = await ctx.db.service.one('media', `id=${eq(p.media_id)}`);
    if (!m) return;
    await deleteMediaFiles(ctx, [m.original_path]);
    if (m.uploaded_by) {
      await ctx.push.toUser(ctx.db, m.uploaded_by, (l) => ({
        ...t(l, 'media_rejected', { reason: reasonText(l, m.reject_reason) }),
        data: { type: 'media', media_id: m.id },
      }));
    }
  },

  async 'media.deleted'(ctx, p) {
    await deleteMediaFiles(ctx, p.paths || []);
  },
};

// Claims a batch and handles it. Returns how many events were processed.
export async function runEventsOnce(ctx, limit = 10) {
  const events = await ctx.db.service.rpc('claim_events', { p_limit: limit });
  for (const e of events || []) {
    const handler = handlers[e.type];
    try {
      if (handler) await handler(ctx, e.payload);
      await ctx.db.service.rpc('finish_event', { p_id: e.id, p_error: null });
    } catch (err) {
      ctx.log.error({ event: e.id, type: e.type, err: err.message }, 'event failed');
      await ctx.db.service.rpc('finish_event', { p_id: e.id, p_error: String(err.message).slice(0, 1000) });
    }
  }
  return events?.length || 0;
}
