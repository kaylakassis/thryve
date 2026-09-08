// Content inside a program (owner only).
//   POST   { type, title, body?, fileUrl?, fileName?, youtube? }   → add
//   PATCH  { itemId, ...fields } | { order: [itemId, ...] }         → edit / reorder
//   DELETE ?itemId=                                                  → soft delete (never touches access)
import { sql } from '../../_lib/db.js';
import { requireUser } from '../../_lib/auth.js';
import { ensureActiveWorkspace } from '../../_lib/workspaceGate.js';
import { readBody } from '../../_lib/body.js';
import { requireSameOrigin } from '../../_lib/security.js';
import { serializeItem, ITEM_TYPES, parseYouTubeId } from '../../_lib/programs.js';
import { badRequest, created, methodNotAllowed, notFound, ok, serverError } from '../../_lib/json.js';

function cleanItem(body, type) {
  const title = String(body.title || '').trim().slice(0, 200);
  if (!title) return { error: 'Give it a title.' };
  const out = { title, body: String(body.body || '').slice(0, 100_000), file_url: null, file_name: null, youtube_id: null };
  if (type === 'pdf') {
    const url = String(body.fileUrl || '');
    if (!/^https:\/\/[^ ]+\.(public\.blob\.vercel-storage\.com|blob\.vercel-storage\.com)\//.test(url)) return { error: 'Upload the PDF first.' };
    out.file_url = url; out.file_name = String(body.fileName || 'document.pdf').slice(0, 200);
  }
  if (type === 'video') {
    const yt = parseYouTubeId(body.youtube);
    if (!yt) return { error: 'Paste a YouTube link (unlisted videos work).' };
    out.youtube_id = yt;
  }
  if (type === 'post' && !out.body.trim()) return { error: 'Write something in the post.' };
  return { value: out };
}

export default async function handler(req, res) {
  if (!requireSameOrigin(req, res)) return;
  try {
    const user = await requireUser(req, res); if (!user) return;
    const workspaceId = await ensureActiveWorkspace(user, req, res); if (!workspaceId) return;
    const programId = String(req.query.id || '');
    const p = (await sql`SELECT id FROM programs WHERE id = ${programId} AND workspace_id = ${workspaceId}`).rows[0];
    if (!p) return notFound(res, 'Program not found');

    if (req.method === 'POST') {
      const body = await readBody(req);
      const type = String(body.type || '');
      if (!ITEM_TYPES.has(type)) return badRequest(res, 'Type must be pdf, post or video.');
      const c = cleanItem(body, type); if (c.error) return badRequest(res, c.error);
      const pos = (await sql`SELECT COALESCE(MAX(position), 0) + 1 AS n FROM program_items WHERE program_id = ${programId}`).rows[0].n;
      const { rows } = await sql`
        INSERT INTO program_items (program_id, workspace_id, type, title, body, file_url, file_name, youtube_id, position)
        VALUES (${programId}, ${workspaceId}, ${type}, ${c.value.title}, ${c.value.body}, ${c.value.file_url}, ${c.value.file_name}, ${c.value.youtube_id}, ${pos})
        RETURNING *`;
      return created(res, { item: serializeItem(rows[0]) });
    }
    if (req.method === 'PATCH') {
      const body = await readBody(req);
      if (Array.isArray(body.order)) {
        const order = body.order.map(String).slice(0, 500);
        for (let i = 0; i < order.length; i++) {
          // eslint-disable-next-line no-await-in-loop
          await sql`UPDATE program_items SET position = ${i + 1}, updated_at = NOW() WHERE id = ${order[i]} AND program_id = ${programId}`;
        }
        return ok(res, { reordered: true });
      }
      const itemId = String(body.itemId || '');
      const it = (await sql`SELECT * FROM program_items WHERE id = ${itemId} AND program_id = ${programId} AND deleted_at IS NULL`).rows[0];
      if (!it) return notFound(res, 'Item not found');
      const merged = { title: it.title, body: it.body, fileUrl: it.file_url, fileName: it.file_name, youtube: it.youtube_id, ...body };
      const c = cleanItem(merged, it.type); if (c.error) return badRequest(res, c.error);
      const { rows } = await sql`
        UPDATE program_items SET title = ${c.value.title}, body = ${c.value.body}, file_url = ${c.value.file_url}, file_name = ${c.value.file_name},
          youtube_id = ${c.value.youtube_id}, updated_at = NOW() WHERE id = ${itemId} RETURNING *`;
      return ok(res, { item: serializeItem(rows[0]) });
    }
    if (req.method === 'DELETE') {
      const itemId = String(req.query.itemId || '');
      await sql`UPDATE program_items SET deleted_at = NOW() WHERE id = ${itemId} AND program_id = ${programId}`;
      return ok(res, { deleted: true });
    }
    return methodNotAllowed(res, ['POST', 'PATCH', 'DELETE']);
  } catch (err) { return serverError(res, err); }
}
