// Account deletion and closing organizations.
import { HttpError } from './http.js';
import { eq } from './db.js';
import { t } from './i18n.js';
import { deleteOrganizationFiles } from './media.js';
import { settlePayment } from './payments.js';

async function defaultOrgName(db) {
  return (await db.service.one('organizations', 'is_default=is.true&select=name'))?.name || 'YogaByTheSofa';
}

// Removes the login itself from the auth service.
async function deleteAuthUser(ctx, userId) {
  const res = await (ctx.fetchImpl || fetch)(`${ctx.cfg.authUrl}/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${ctx.cfg.serviceKey}`, apikey: ctx.cfg.serviceKey },
  });
  if (!res.ok && res.status !== 404) throw new Error(`auth delete failed: ${res.status} ${await res.text()}`);
}

// Cancels upcoming bookings and releases or refunds their payments right away.
async function cancelUpcoming(ctx, filter, by) {
  const db = ctx.db.service;
  const rows = await db.update('bookings',
    `${filter}&status=in.(pending,accepted)&starts_at=gt.${encodeURIComponent(new Date().toISOString())}`,
    { status: 'cancelled', cancelled_by: by });
  for (const b of rows || []) await settlePayment(ctx, b);
  return rows || [];
}

// Closes an organization: refunds, emails its clients, deletes its content and files.
// notifyOwner: false when the owner is deleting their own account (they get another email).
export async function closeOrganization(ctx, orgId, { notifyOwner = true } = {}) {
  const db = ctx.db.service;
  const org = await db.one('organizations', `id=${eq(orgId)}`);
  if (!org) throw new HttpError(404, 'organization_not_found');
  if (org.is_default) throw new HttpError(409, 'cannot_close_default');
  if (org.status === 'closed') return { clients: 0 };

  const owner = org.owner_id ? await db.one('profiles', `id=${eq(org.owner_id)}&select=email,language`) : null;
  await cancelUpcoming(ctx, `organization_id=${eq(orgId)}`, 'system');
  const clients = await db.rpc('service_close_organization', { p_org: orgId });
  const defaultName = await defaultOrgName(ctx.db);

  for (const c of clients || []) {
    if (!c.email) continue;
    try {
      await ctx.mail.send({
        to: c.email,
        subject: t(c.language, 'org_closed_subject', { org: org.name }),
        text: t(c.language, 'org_closed_body', { org: org.name, default: defaultName }),
      });
    } catch (err) {
      ctx.log.error({ to: c.email, err: err.message }, 'closing email failed');
    }
  }

  const ownerEmail = owner?.email || org.owner_email;
  if (notifyOwner && ownerEmail) {
    await ctx.mail.send({
      to: ownerEmail,
      subject: t(owner?.language, 'owner_closed_subject', { org: org.name }),
      text: t(owner?.language, 'owner_closed_body', { org: org.name, default: defaultName }),
    }).catch((err) => ctx.log.error({ to: ownerEmail, err: err.message }, 'closing email failed'));
  }

  await deleteOrganizationFiles(ctx, orgId);
  await db.remove('media', `organization_id=${eq(orgId)}`);
  return { clients: clients?.length || 0 };
}

// DELETE /api/account  -> deletes the caller's account (Apple/Google requirement)
export async function deleteMyAccount(ctx, user) {
  const db = ctx.db.service;
  const p = user.profile;

  if (p?.role === 'super_admin') throw new HttpError(409, 'super_admin_cannot_self_delete');

  if (p?.role === 'owner' && p.organization_id) {
    const org = await db.one('organizations', `id=${eq(p.organization_id)}`);
    if (org?.is_default) throw new HttpError(409, 'default_owner_cannot_self_delete');
    await closeOrganization(ctx, p.organization_id, { notifyOwner: false });
  } else if (p) {
    await cancelUpcoming(ctx, `client_id=${eq(user.userId)}`, 'client');
  }

  if (p) await db.remove('profiles', `id=${eq(user.userId)}`);
  await deleteAuthUser(ctx, user.userId);

  if (p?.email) {
    const defaultName = await defaultOrgName(ctx.db);
    await ctx.mail.send({
      to: p.email,
      subject: t(p.language, 'account_deleted_subject'),
      text: t(p.language, 'account_deleted_body', { default: defaultName }),
    }).catch((err) => ctx.log.error({ err: err.message }, 'deletion email failed'));
  }
  return { deleted: true };
}
