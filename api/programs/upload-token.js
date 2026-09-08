// POST /api/programs/upload-token → Vercel Blob client-upload token for
// program files (PDFs, images) - same two-request dance as
// /api/clients/upload-token (see the comment there). 25 MB cap.
import { handleUpload } from '@vercel/blob/client';
import { requireUser } from '../_lib/auth.js';
import { ensureActiveWorkspace } from '../_lib/workspaceGate.js';
import { readBody } from '../_lib/body.js';
import { requireSameOrigin } from '../_lib/security.js';
import { badRequest, methodNotAllowed, ok, serverError } from '../_lib/json.js';

const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 25 * 1024 * 1024;

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) return badRequest(res, "Uploads aren't available right now - please try again later or contact support");
    const body = await readBody(req);
    if (body?.type === 'blob.upload-completed') {
      const done = await handleUpload({ body, request: req,
        onBeforeGenerateToken: async () => ({ allowedContentTypes: ALLOWED, maximumSizeInBytes: MAX_BYTES }),
        onUploadCompleted: async () => {} });
      return ok(res, done);
    }
    if (!requireSameOrigin(req, res)) return;
    const user = await requireUser(req, res); if (!user) return;
    const workspaceId = await ensureActiveWorkspace(user, req, res); if (!workspaceId) return;
    const result = await handleUpload({ body, request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(`programs/${workspaceId}/`)) throw new Error('Invalid upload path');
        return { allowedContentTypes: ALLOWED, maximumSizeInBytes: MAX_BYTES, addRandomSuffix: true, tokenPayload: JSON.stringify({ workspaceId }) };
      },
      onUploadCompleted: async () => {} });
    return ok(res, result);
  } catch (err) { return serverError(res, err); }
}
