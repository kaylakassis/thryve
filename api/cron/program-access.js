// /api/cron/program-access - daily: close one-time program access whose
// window (access_days) has run out. Subscriptions are closed by the Stripe
// webhook; this only handles expires_at. Auth: Vercel cron bearer, or a
// signed-in super-admin poking it by hand.
import { isSuperAdminBySession } from '../_lib/admin.js';
import { expireProgramAccess } from '../_lib/programs.js';
import { ok, serverError, unauthorized } from '../_lib/json.js';

export default async function handler(req, res) {
  const cronAuth = !!process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  const adminAuth = !cronAuth && await isSuperAdminBySession(req).catch(() => false);
  if (!cronAuth && !adminAuth) return unauthorized(res);
  try {
    const expired = await expireProgramAccess();
    return ok(res, { expired });
  } catch (err) { return serverError(res, err); }
}
