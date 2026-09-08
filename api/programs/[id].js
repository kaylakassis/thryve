// GET    /api/programs/:id  → program + content + members (owner)
// PATCH  /api/programs/:id  → edit fields / publish / unpublish
// DELETE /api/programs/:id  → archive: no new sales, members keep access
import { sql } from '../_lib/db.js';
import { requireUser } from '../_lib/auth.js';
import { ensureActiveWorkspace } from '../_lib/workspaceGate.js';
import { readBody } from '../_lib/body.js';
import { requireSameOrigin } from '../_lib/security.js';
import { serializeProgram, serializeItem, serializeEnrollment, cleanProgramInput } from '../_lib/programs.js';
import { badRequest, methodNotAllowed, notFound, ok, serverError } from '../_lib/json.js';

export default async function handler(req, res) {
  if (!requireSameOrigin(req, res)) return;
  try {
    const user = await requireUser(req, res); if (!user) return;
    const workspaceId = await ensureActiveWorkspace(user, req, res); if (!workspaceId) return;
    const id = String(req.query.id || '');
    const p = (await sql`SELECT * FROM programs WHERE id = ${id} AND workspace_id = ${workspaceId}`).rows[0];
    if (!p) return notFound(res, 'Program not found');

    if (req.method === 'GET') {
      const items = (await sql`SELECT * FROM program_items WHERE program_id = ${id} AND deleted_at IS NULL ORDER BY position ASC, created_at ASC`).rows;
      const members = (await sql`
        SELECT e.*, c.name AS client_name, c.email AS client_email FROM program_enrollments e
        JOIN clients c ON c.id = e.client_id WHERE e.program_id = ${id} ORDER BY e.granted_at DESC`).rows;
      return ok(res, {
        program: serializeProgram(p, { members: members.filter((m) => m.status !== 'cancelled').length, items: items.length }),
        items: items.map(serializeItem), members: members.map(serializeEnrollment),
      });
    }
    if (req.method === 'PATCH') {
      const body = await readBody(req);
      const v = cleanProgramInput(body, true);
      if (!v.ok) return badRequest(res, v.errors[0]);
      if (v.value.status === 'published' && p.status === 'archived') return badRequest(res, 'This program is archived.');
      const f = { ...p, ...v.value };
      const { rows } = await sql`
        UPDATE programs SET title = ${f.title}, description = ${f.description}, cover_url = ${f.cover_url}, price_cents = ${f.price_cents},
          billing = ${f.billing}, community_enabled = ${f.community_enabled}, access_days = ${f.access_days}, status = ${f.status}, updated_at = NOW()
        WHERE id = ${id} AND workspace_id = ${workspaceId} RETURNING *`;
      return ok(res, { program: serializeProgram(rows[0]) });
    }
    if (req.method === 'DELETE') {
      await sql`UPDATE programs SET status = 'archived', updated_at = NOW() WHERE id = ${id} AND workspace_id = ${workspaceId}`;
      return ok(res, { archived: true });
    }
    return methodNotAllowed(res, ['GET', 'PATCH', 'DELETE']);
  } catch (err) { return serverError(res, err); }
}
