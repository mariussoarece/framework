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

const TAB_FOR = {
  booking_request: 'requests',            // owner: Approve
  booking_cancelled_by_client: 'upcoming', // owner: Bookings
  booking_accepted: 'mine',               // client: My bookings
  booking_declined: 'mine',
  booking_cancelled_by_owner: 'mine',
  booking_reminder: 'mine',
};

function bookingMessage(key, { b, org, client }, extra = {}) {
  return (language) => ({
    ...t(language, key, {
      org: org.name,
      client: client?.display_name || client?.email || '',
      title: b.title || t(language, 'session'),
      time: formatTime(b.starts_at, language, org.timezone),
    }),
    // which tab of Scheduling opens when the notification is tapped
    data: { type: 'booking', booking_id: b.id, tab: TAB_FOR[key] || '', ...extra },
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

  // An owner's message to all the clients of the organization (send_announcement()).
  async 'announcement.created'(ctx, p) {
    const db = ctx.db.service;
    const a = await db.one('announcements', `id=${eq(p.announcement_id)}&select=organization_id,title,body`);
    if (!a) return;
    const org = await db.one('organizations', `id=${eq(a.organization_id)}&select=name`);
    const clients = await db.select('profiles', `organization_id=${eq(a.organization_id)}&role=eq.client&select=id`);
    for (const c of clients || []) {
      await ctx.push.toUser(ctx.db, c.id, () => ({
        title: `${org?.name ? `${org.name}: ` : ''}${a.title}`.slice(0, 120),
        body: a.body,
        data: { type: 'announcement', announcement_id: p.announcement_id },
      }));
    }
  },

  // 1 hour before a confirmed session (queued by queue_reminders()).
  async 'booking.reminder'(ctx, p) {
    const bc = await bookingContext(ctx, p.booking_id);
    if (!bc || bc.b.status !== 'accepted') return;
    await ctx.push.toUser(ctx.db, bc.b.client_id, bookingMessage('booking_reminder', bc));
  },

  // An owner uploaded pictures/videos (grouped over 2 minutes): tell every super admin.
  async 'media.uploaded'(ctx, p) {
    const db = ctx.db.service;
    const org = await db.one('organizations', `id=${eq(p.organization_id)}&select=name`);
    const waiting = await db.select('media', `organization_id=${eq(p.organization_id)}&status=eq.pending&select=id`);
    const count = waiting?.length || 0;
    if (!org || count === 0) return;   // already handled meanwhile
    const admins = await db.select('profiles', 'role=eq.super_admin&select=id');
    for (const a of admins || []) {
      await ctx.push.toUser(ctx.db, a.id, (l) => ({
        ...t(l, count === 1 ? 'media_waiting_one' : 'media_waiting_many', { org: org.name, count }),
        data: { type: 'review' },
      }));
    }
  },

  // The owner added workouts (grouped over 10 minutes): tell the organization's clients.
  async 'workout.created'(ctx, p) {
    const db = ctx.db.service;
    const org = await db.one('organizations', `id=${eq(p.organization_id)}&select=name,status`);
    if (!org || org.status === 'paused' || org.status === 'closed') return;
    const added = await db.select('workouts',
      `organization_id=${eq(p.organization_id)}&created_at=gte.${encodeURIComponent(p.since)}&select=id,name`);
    const count = added?.length || 0;
    if (count === 0) return;   // deleted meanwhile
    const clients = await db.select('profiles', `organization_id=${eq(p.organization_id)}&role=eq.client&select=id`);
    for (const c of clients || []) {
      await ctx.push.toUser(ctx.db, c.id, (l) => ({
        ...t(l, count === 1 ? 'workout_new_one' : 'workout_new_many', { org: org.name, name: added[0].name, count }),
        data: count === 1 ? { type: 'workout', workout_id: added[0].id } : { type: 'workouts' },
      }));
    }
  },

  // A client reported content: tell every super admin.
  async 'report.created'(ctx, p) {
    const db = ctx.db.service;
    const r = await db.one('content_reports', `id=${eq(p.report_id)}`);
    if (!r) return;
    const org = await db.one('organizations', `id=${eq(r.organization_id)}&select=name`);
    const w = r.workout_id ? await db.one('workouts', `id=${eq(r.workout_id)}&select=name`) : null;
    const admins = await db.select('profiles', 'role=eq.super_admin&select=id');
    for (const a of admins || []) {
      await ctx.push.toUser(ctx.db, a.id, (l) => ({
        ...t(l, 'report_new', { org: org?.name ?? '', what: w?.name ?? r.reason.slice(0, 60) }),
        data: { type: 'report', report_id: r.id },
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
