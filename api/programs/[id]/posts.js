// Community feed of a program. Owner and enrolled members can read, post
// and reply; a post can be removed by its author or the owner.
//   GET                          → posts (newest first) with replies
//   POST { kind, body, parentId? }
//   DELETE ?postId=
import { sql } from '../../_lib/db.js';
import { requireUser } from '../../_lib/auth.js';
import { readBody } from '../../_lib/body.js';
import { requireSameOrigin } from '../../_lib/security.js';
import { programAccess, serializePost, POST_KINDS } from '../../_lib/programs.js';
import { badRequest, created, forbidden, methodNotAllowed, notFound, ok, serverError } from '../../_lib/json.js';

async function ownerWorkspace(user) {
  const r = await sql`SELECT id FROM workspaces WHERE owner_id = ${user.id} LIMIT 1`;
  return r.rows[0]?.id || null;
}

export default async function handler(req, res) {
  if (!requireSameOrigin(req, res)) return;
  try {
    const user = await requireUser(req, res); if (!user) return;
    const programId = String(req.query.id || '');
    const access = await programAccess(user, programId, await ownerWorkspace(user));
    if (!access.program) return notFound(res, 'Program not found');
    if (!access.role) return forbidden(res, 'You are not a member of this program.');
    if (!access.program.community_enabled && access.role !== 'owner') return forbidden(res, 'The community is switched off for this program.');
    const isOwner = access.role === 'owner';

    if (req.method === 'GET') {
      const { rows } = await sql`
        SELECT p.*, (p.author_user_id = ${user.id} OR (p.author_client_id IS NOT NULL AND p.author_client_id = ${access.clientId})) AS mine
          FROM program_posts p WHERE p.program_id = ${programId} AND p.deleted_at IS NULL
         ORDER BY p.created_at DESC LIMIT 300`;
      return ok(res, { posts: rows.map(serializePost), role: access.role });
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      const kind = POST_KINDS.has(String(body.kind)) ? String(body.kind) : 'post';
      const text = String(body.body || '').trim().slice(0, 4000);
      if (!text) return badRequest(res, 'Write something first.');
      const parentId = body.parentId ? String(body.parentId) : null;
      if (parentId) {
        const parent = (await sql`SELECT id FROM program_posts WHERE id = ${parentId} AND program_id = ${programId} AND deleted_at IS NULL`).rows[0];
        if (!parent) return notFound(res, 'That post is gone.');
      }
      const authorName = isOwner ? (user.name || 'Coach') : ((await sql`SELECT name FROM clients WHERE id = ${access.clientId}`).rows[0]?.name || user.name || 'Member');
      const { rows } = await sql`
        INSERT INTO program_posts (program_id, workspace_id, parent_id, author_user_id, author_client_id, author_name, is_owner, kind, body)
        VALUES (${programId}, ${access.program.workspace_id}, ${parentId}, ${user.id}, ${access.clientId}, ${authorName}, ${isOwner}, ${parentId ? 'post' : kind}, ${text})
        RETURNING *, TRUE AS mine`;
      return created(res, { post: serializePost(rows[0]) });
    }
    if (req.method === 'DELETE') {
      const postId = String(req.query.postId || '');
      const post = (await sql`SELECT * FROM program_posts WHERE id = ${postId} AND program_id = ${programId}`).rows[0];
      if (!post) return notFound(res, 'Post not found');
      const mine = post.author_user_id === user.id || (post.author_client_id && post.author_client_id === access.clientId);
      if (!isOwner && !mine) return forbidden(res, 'You can only remove your own posts.');
      await sql`UPDATE program_posts SET deleted_at = NOW() WHERE id = ${postId} OR parent_id = ${postId}`;
      return ok(res, { deleted: true });
    }
    return methodNotAllowed(res, ['GET', 'POST', 'DELETE']);
  } catch (err) { return serverError(res, err); }
}
