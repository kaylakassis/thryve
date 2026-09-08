// GET /api/programs/public/:id → what a buyer sees before purchase.
// Published programs only. Content bodies and files are NOT included -
// only titles and types, so the outline can be shown without leaking it.
import { sql } from '../../_lib/db.js';
import { enforce, getClientIp } from '../../_lib/rate-limit.js';
import { serializeProgram } from '../../_lib/programs.js';
import { methodNotAllowed, notFound, ok, serverError } from '../../_lib/json.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const blocked = await enforce(req, res, [{ key: `program:pub:${getClientIp(req)}`, max: 120, windowSeconds: 60 * 10 }]);
    if (blocked) return;
    const id = String(req.query.id || '');
    const p = (await sql`
      SELECT p.*, cs.slug, cs.biz_name, w.name AS workspace_name
        FROM programs p JOIN workspaces w ON w.id = p.workspace_id
        LEFT JOIN calendar_settings cs ON cs.workspace_id = p.workspace_id
       WHERE p.id = ${id} AND p.status = 'published'`).rows[0];
    if (!p) return notFound(res, 'This program is not available.');
    const items = (await sql`SELECT id, type, title FROM program_items WHERE program_id = ${id} AND deleted_at IS NULL ORDER BY position ASC, created_at ASC`).rows;
    const fin = (await sql`SELECT currency FROM finance_settings WHERE workspace_id = ${p.workspace_id}`.catch(() => ({ rows: [] }))).rows[0];
    return ok(res, {
      program: serializeProgram(p, { items: items.length }),
      outline: items.map((i) => ({ id: i.id, type: i.type, title: i.title })),
      business: { name: p.biz_name || p.workspace_name || 'Business', slug: p.slug || null },
      currency: (fin?.currency || 'USD').toUpperCase(),
    });
  } catch (err) { return serverError(res, err); }
}
