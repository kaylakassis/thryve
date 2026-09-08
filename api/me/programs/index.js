// GET /api/me/programs → programs this signed-in client has access to,
// across every business they are linked to.
import { sql } from '../../_lib/db.js';
import { requireUser } from '../../_lib/auth.js';
import { myClientIds, ids } from '../../_lib/clientPortal.js';
import { serializeProgram } from '../../_lib/programs.js';
import { methodNotAllowed, ok, serverError } from '../../_lib/json.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const user = await requireUser(req, res); if (!user) return;
    const mine = await myClientIds(user);
    const myIds = ids(mine);
    if (!myIds.length) return ok(res, { programs: [] });
    const byClient = new Map(mine.map((m) => [m.clientId, m]));
    const { rows } = await sql.query(
      `SELECT p.*, e.status AS enrollment_status, e.billing AS enrollment_billing, e.current_period_end, e.client_id,
              (SELECT COUNT(*)::int FROM program_items i WHERE i.program_id = p.id AND i.deleted_at IS NULL) AS items
         FROM program_enrollments e JOIN programs p ON p.id = e.program_id
        WHERE e.client_id = ANY($1) AND e.status IN ('active','past_due')
        ORDER BY e.granted_at DESC`, [myIds]);
    return ok(res, {
      programs: rows.map((r) => serializeProgram(r, {
        items: r.items, enrollmentStatus: r.enrollment_status, currentPeriodEnd: r.current_period_end,
        businessName: byClient.get(r.client_id)?.businessName || 'Business',
      })),
    });
  } catch (err) { return serverError(res, err); }
}
