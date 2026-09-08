// Members of a program (owner only).
//   POST   { clientId } | { name, email }  → grant access by hand (free / paid elsewhere)
//   DELETE ?enrollmentId=                  → revoke access (does not cancel a Stripe subscription; do that in Finance)
import { sql } from '../../_lib/db.js';
import { requireUser, validEmail } from '../../_lib/auth.js';
import { ensureActiveWorkspace } from '../../_lib/workspaceGate.js';
import { readBody } from '../../_lib/body.js';
import { requireSameOrigin } from '../../_lib/security.js';
import { grantEnrollment } from '../../_lib/programs.js';
import { badRequest, created, methodNotAllowed, notFound, ok, serverError } from '../../_lib/json.js';

export default async function handler(req, res) {
  if (!requireSameOrigin(req, res)) return;
  try {
    const user = await requireUser(req, res); if (!user) return;
    const workspaceId = await ensureActiveWorkspace(user, req, res); if (!workspaceId) return;
    const programId = String(req.query.id || '');
    const p = (await sql`SELECT * FROM programs WHERE id = ${programId} AND workspace_id = ${workspaceId}`).rows[0];
    if (!p) return notFound(res, 'Program not found');

    if (req.method === 'POST') {
      const body = await readBody(req);
      let clientId = body.clientId ? String(body.clientId) : null;
      if (clientId) {
        const c = (await sql`SELECT id FROM clients WHERE id = ${clientId} AND workspace_id = ${workspaceId}`).rows[0];
        if (!c) return notFound(res, 'Client not found');
      } else {
        const email = String(body.email || '').trim().toLowerCase();
        const name = String(body.name || '').trim().slice(0, 200) || email.split('@')[0];
        if (!validEmail(email)) return badRequest(res, 'A valid email is required.');
        const existing = (await sql`SELECT id FROM clients WHERE workspace_id = ${workspaceId} AND LOWER(email) = ${email} LIMIT 1`).rows[0];
        clientId = existing?.id || (await sql`
          INSERT INTO clients (workspace_id, name, email, stage, source) VALUES (${workspaceId}, ${name}, ${email}, 'active', 'program') RETURNING id`).rows[0].id;
      }
      const id = await grantEnrollment({ programId, workspaceId, clientId, source: 'manual', billing: p.billing, priceCents: 0 });
      return created(res, { enrollmentId: id, clientId });
    }
    if (req.method === 'DELETE') {
      const enrollmentId = String(req.query.enrollmentId || '');
      await sql`UPDATE program_enrollments SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
                WHERE id = ${enrollmentId} AND program_id = ${programId} AND workspace_id = ${workspaceId}`;
      return ok(res, { revoked: true });
    }
    return methodNotAllowed(res, ['POST', 'DELETE']);
  } catch (err) { return serverError(res, err); }
}
