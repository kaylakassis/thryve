// Programs: shared helpers for the owner API, the client portal and checkout.
import { sql } from './db.js';
import { myClientIds, ids } from './clientPortal.js';

export const BILLING = new Set(['one_time', 'month', 'year']);
export const ITEM_TYPES = new Set(['pdf', 'post', 'video']);
export const POST_KINDS = new Set(['post', 'win', 'question']);

export function serializeProgram(r, extra = {}) {
  return {
    id: r.id, title: r.title, description: r.description || '', coverUrl: r.cover_url || null,
    priceCents: Number(r.price_cents) || 0, billing: r.billing, communityEnabled: !!r.community_enabled,
    status: r.status, createdAt: r.created_at, updatedAt: r.updated_at, ...extra,
  };
}
export function serializeItem(r) {
  return {
    id: r.id, type: r.type, title: r.title, body: r.body || '', fileUrl: r.file_url || null,
    fileName: r.file_name || null, youtubeId: r.youtube_id || null, position: r.position,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
export function serializeEnrollment(r) {
  return {
    id: r.id, programId: r.program_id, clientId: r.client_id, clientName: r.client_name || null,
    clientEmail: r.client_email || null, source: r.source, status: r.status, billing: r.billing,
    priceCents: Number(r.price_cents) || 0, currentPeriodEnd: r.current_period_end, grantedAt: r.granted_at,
    cancelledAt: r.cancelled_at,
  };
}
export function serializePost(r) {
  return {
    id: r.id, parentId: r.parent_id || null, kind: r.kind, body: r.body, authorName: r.author_name,
    isOwner: !!r.is_owner, mine: !!r.mine, createdAt: r.created_at,
  };
}

// Accepts a full YouTube URL (watch, youtu.be, shorts, embed) or a bare id.
export function parseYouTubeId(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (!/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(u.hostname)) return null;
    if (u.hostname === 'youtu.be') return /^[A-Za-z0-9_-]{11}$/.test(u.pathname.slice(1)) ? u.pathname.slice(1) : null;
    const v = u.searchParams.get('v');
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
    const m = u.pathname.match(/\/(embed|shorts|live)\/([A-Za-z0-9_-]{11})/);
    return m ? m[2] : null;
  } catch { return null; }
}

export function cleanProgramInput(body, partial = false) {
  const out = {}; const errors = [];
  if (!partial || body.title !== undefined) {
    const title = String(body.title || '').trim();
    if (!title) errors.push('Give the program a title.');
    if (title.length > 140) errors.push('Title is too long (140 characters max).');
    out.title = title;
  }
  if (!partial || body.description !== undefined) out.description = String(body.description || '').trim().slice(0, 5000);
  if (!partial || body.coverUrl !== undefined) out.cover_url = body.coverUrl ? String(body.coverUrl).slice(0, 1000) : null;
  if (!partial || body.priceCents !== undefined) {
    const cents = Math.round(Number(body.priceCents));
    if (!Number.isFinite(cents) || cents < 0 || cents > 100_000_00) errors.push('Price must be between 0 and 100,000.');
    out.price_cents = cents;
  }
  if (!partial || body.billing !== undefined) {
    const b = String(body.billing || 'one_time');
    if (!BILLING.has(b)) errors.push('Billing must be one-time, monthly or yearly.');
    out.billing = b;
  }
  if (!partial || body.communityEnabled !== undefined) out.community_enabled = body.communityEnabled !== false;
  if (partial && body.status !== undefined) {
    const st = String(body.status);
    if (!['draft', 'published'].includes(st)) errors.push('Status must be draft or published.');
    out.status = st;
  }
  return { ok: errors.length === 0, errors, value: out };
}

// Who is this user to this program? 'owner' (the workspace owner),
// 'member' (a client with an active enrollment) or null.
export async function programAccess(user, programId, ownerWorkspaceId = null) {
  const p = (await sql`SELECT * FROM programs WHERE id = ${programId}`).rows[0];
  if (!p) return { role: null, program: null };
  if (ownerWorkspaceId && p.workspace_id === ownerWorkspaceId) return { role: 'owner', program: p, clientId: null };
  const mine = await myClientIds(user);
  const myIds = ids(mine);
  if (myIds.length) {
    const e = (await sql.query(
      `SELECT client_id FROM program_enrollments
        WHERE program_id = $1 AND client_id = ANY($2) AND status IN ('active','past_due') LIMIT 1`,
      [programId, myIds],
    )).rows[0];
    if (e) return { role: 'member', program: p, clientId: e.client_id };
  }
  return { role: null, program: p, clientId: null };
}

export async function activeMemberCount(programId) {
  const r = await sql`SELECT COUNT(*)::int AS n FROM program_enrollments WHERE program_id = ${programId} AND status IN ('active','past_due')`;
  return r.rows[0]?.n || 0;
}

// Grants or refreshes access for a client. Idempotent on the Stripe ids.
export async function grantEnrollment({ programId, workspaceId, clientId, source, billing, priceCents, stripeSubscriptionId = null, stripeSessionId = null, status = 'active', currentPeriodEnd = null }) {
  const existing = await sql`
    SELECT id FROM program_enrollments
     WHERE program_id = ${programId} AND client_id = ${clientId}
       AND (${stripeSubscriptionId}::text IS NULL OR stripe_subscription_id = ${stripeSubscriptionId} OR stripe_subscription_id IS NULL)
     ORDER BY granted_at DESC LIMIT 1`;
  if (existing.rows[0]) {
    await sql`
      UPDATE program_enrollments SET status = ${status}, source = ${source}, billing = ${billing}, price_cents = ${priceCents},
        stripe_subscription_id = COALESCE(${stripeSubscriptionId}, stripe_subscription_id),
        stripe_session_id = COALESCE(${stripeSessionId}, stripe_session_id),
        current_period_end = ${currentPeriodEnd}, cancelled_at = CASE WHEN ${status} = 'cancelled' THEN NOW() ELSE NULL END, updated_at = NOW()
       WHERE id = ${existing.rows[0].id}`;
    return existing.rows[0].id;
  }
  const ins = await sql`
    INSERT INTO program_enrollments (program_id, workspace_id, client_id, source, billing, price_cents, stripe_subscription_id, stripe_session_id, status, current_period_end)
    VALUES (${programId}, ${workspaceId}, ${clientId}, ${source}, ${billing}, ${priceCents}, ${stripeSubscriptionId}, ${stripeSessionId}, ${status}, ${currentPeriodEnd})
    ON CONFLICT DO NOTHING RETURNING id`;
  return ins.rows[0]?.id || null;
}

// Webhook: a connected-account subscription with metadata.purpose='program'.
export async function applyProgramSubscription({ workspaceId, sub }) {
  const md = sub?.metadata || {};
  if (md.purpose !== 'program' || !md.program_id || !md.client_id) return 'ignored';
  if (md.workspace_id && md.workspace_id !== workspaceId) return 'mismatch';
  const p = (await sql`SELECT id, billing, price_cents FROM programs WHERE id = ${md.program_id} AND workspace_id = ${workspaceId}`).rows[0];
  const c = (await sql`SELECT id FROM clients WHERE id = ${md.client_id} AND workspace_id = ${workspaceId}`).rows[0];
  if (!p || !c) return 'missing';
  const s = sub.status;
  const status = (s === 'active' || s === 'trialing') ? 'active' : (s === 'past_due' || s === 'unpaid') ? 'past_due' : 'cancelled';
  const cpe = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
  await grantEnrollment({ programId: p.id, workspaceId, clientId: c.id, source: 'subscription', billing: p.billing, priceCents: p.price_cents, stripeSubscriptionId: sub.id, status, currentPeriodEnd: cpe });
  return 'applied';
}
