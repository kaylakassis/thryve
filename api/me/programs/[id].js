// GET /api/me/programs/:id → full content for an enrolled client.
import { sql } from '../../_lib/db.js';
import { requireUser } from '../../_lib/auth.js';
import { programAccess, serializeProgram, serializeItem } from '../../_lib/programs.js';
import { forbidden, methodNotAllowed, notFound, ok, serverError } from '../../_lib/json.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const user = await requireUser(req, res); if (!user) return;
    const id = String(req.query.id || '');
    const owner = (await sql`SELECT id FROM workspaces WHERE owner_id = ${user.id} LIMIT 1`).rows[0]?.id || null;
    const access = await programAccess(user, id, owner);
    if (!access.program) return notFound(res, 'Program not found');
    if (!access.role) return forbidden(res, 'You do not have access to this program.');
    const items = (await sql`SELECT * FROM program_items WHERE program_id = ${id} AND deleted_at IS NULL ORDER BY position ASC, created_at ASC`).rows;
    const biz = (await sql`SELECT cs.biz_name, w.name FROM workspaces w LEFT JOIN calendar_settings cs ON cs.workspace_id = w.id WHERE w.id = ${access.program.workspace_id}`).rows[0];
    return ok(res, { program: serializeProgram(access.program, { businessName: biz?.biz_name || biz?.name || 'Business' }), items: items.map(serializeItem), role: access.role });
  } catch (err) { return serverError(res, err); }
}
