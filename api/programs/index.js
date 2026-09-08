// GET  /api/programs        → the workspace's programs with member counts
// POST /api/programs        → create (starts as a draft)
import { sql } from '../_lib/db.js';
import { requireUser } from '../_lib/auth.js';
import { ensureActiveWorkspace } from '../_lib/workspaceGate.js';
import { readBody } from '../_lib/body.js';
import { requireSameOrigin } from '../_lib/security.js';
import { serializeProgram, cleanProgramInput } from '../_lib/programs.js';
import { badRequest, created, methodNotAllowed, ok, serverError } from '../_lib/json.js';

export default async function handler(req, res) {
  if (!requireSameOrigin(req, res)) return;
  try {
    const user = await requireUser(req, res); if (!user) return;
    const workspaceId = await ensureActiveWorkspace(user, req, res); if (!workspaceId) return;
    if (req.method === 'GET') {
      const { rows } = await sql`
        SELECT p.*,
          (SELECT COUNT(*)::int FROM program_enrollments e WHERE e.program_id = p.id AND e.status IN ('active','past_due')) AS members,
          (SELECT COUNT(*)::int FROM program_items i WHERE i.program_id = p.id AND i.deleted_at IS NULL) AS items
        FROM programs p WHERE p.workspace_id = ${workspaceId} AND p.status <> 'archived'
        ORDER BY p.created_at DESC`;
      return ok(res, { programs: rows.map((r) => serializeProgram(r, { members: r.members, items: r.items })) });
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      const v = cleanProgramInput(body);
      if (!v.ok) return badRequest(res, v.errors[0]);
      const { rows } = await sql`
        INSERT INTO programs (workspace_id, title, description, cover_url, price_cents, billing, community_enabled, access_days)
        VALUES (${workspaceId}, ${v.value.title}, ${v.value.description}, ${v.value.cover_url}, ${v.value.price_cents}, ${v.value.billing}, ${v.value.community_enabled}, ${v.value.access_days})
        RETURNING *`;
      return created(res, { program: serializeProgram(rows[0], { members: 0, items: 0 }) });
    }
    return methodNotAllowed(res, ['GET', 'POST']);
  } catch (err) { return serverError(res, err); }
}
