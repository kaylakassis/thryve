// /api/ivy
//   GET  → list sessions + workspace context (the "what Ivy sees" panel)
//   POST → send a message. If body.sessionId is missing, a new session is
//          created from the first message's title. Server generates the reply
//          (mock now, real Anthropic later) and persists both turns.

import { sql } from '../_lib/db.js';
import { requireUser, ensureWorkspace } from '../_lib/auth.js';
import { readBody } from '../_lib/body.js';
import { requireSameOrigin } from '../_lib/security.js';
import {
  serializeSession, serializeMessage, workspaceContext, buildBriefing,
  generateReply, fetchOwnedSession, getDailyUsage, sanitizeUserText,
  stripInlineMarkdown, currentIvyModel,
} from '../_lib/ivy.js';
import { badRequest, methodNotAllowed, ok, serverError } from '../_lib/json.js';
import { IVY_DEFAULT_MODEL } from '../_lib/ivyModel.js';
import { enforce, getClientIp } from '../_lib/rate-limit.js';

const MAX_MESSAGE_CHARS = 4000;
// Vercel serverless caps the request body around 4.5 MB. We allow up to
// ~3.5 MB of raw file bytes (≈4.7 MB of base64) and add a server-side
// belt-and-braces check so a malformed client can't OOM us.
const MAX_ATTACHMENT_BYTES = 3.5 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'text/csv', 'text/plain', 'text/tab-separated-values',
  'text/markdown',
  'application/csv', 'application/json',
]);

export default async function handler(req, res) {
  if (!requireSameOrigin(req, res)) return;
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    // Ivy is intentionally NOT paywalled - every signed-in owner gets up
    // to DAILY_REQUEST_CAP (200) messages/day from the moment they sign
    // up, including while still on the paywall. The cap inside
    // generateReply is the real throttle; gating with the subscription
    // check would 402 the chat bubble for brand-new owners who haven't
    // started their trial yet (the exact moment Ivy can be most
    // persuasive about converting them).
    const workspaceId = await ensureWorkspace(user.id);

    if (req.method === 'GET') {
      const safe = async (p, fallback) => { try { return await p; } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[ivy GET] sub-query failed:', e.message);
        return fallback;
      } };
      const sessions = await safe(sql`
        SELECT * FROM ivy_sessions WHERE workspace_id = ${workspaceId}
        ORDER BY last_message_at DESC NULLS LAST, created_at DESC
        LIMIT 100
      `, { rows: [] });
      const context = await safe(workspaceContext(workspaceId), {});
      // Proactive "here's your day" the UI greets the owner with. Best-effort:
      // a briefing failure must never break loading the chat.
      const briefing = await safe(buildBriefing(workspaceId), null);
      // Cheap env-var probe so the UI can show a "mock mode" warning even
      // before the user has sent their first message. Doesn't actually
      // call Anthropic - that happens on POST.
      const hasKey = !!process.env.ANTHROPIC_API_KEY;
      // Fallback must match getDailyUsage's real shape - the usage meter
      // reads usage.outputTokens.toLocaleString() and would TypeError on
      // the old { used, limit } placeholder.
      const usage = await safe(getDailyUsage(workspaceId), { requests: 0, outputTokens: 0, requestCap: 0, outputTokenCap: 0 });
      return ok(res, {
        sessions: sessions.rows.map((r) => serializeSession(r)),
        context,
        briefing,
        mode: hasKey ? 'live' : 'mock',
        modeError: hasKey ? null : 'no-api-key',
        model: await safe(currentIvyModel(), IVY_DEFAULT_MODEL),
        usage,
      });
    }

    if (req.method === 'POST') {
      // Per-minute throttle on the expensive path (each POST can fan out
      // to several DB reads + up to 8 Anthropic calls). The daily token cap
      // inside generateReply is the budget ceiling; this stops a tight loop
      // from hammering the endpoint. Super-admins bypass (see enforce()).
      if (await enforce(req, res, [
        { key: `ivy:ws:${workspaceId}`, max: 20, windowSeconds: 60 },
        { key: `ivy:ip:${getClientIp(req)}`, max: 40, windowSeconds: 60 },
      ])) return;

      const body = await readBody(req);
      // Sanitize before any further processing: strips NUL, control
      // chars, zero-width chars, and bidi overrides that prompt-
      // injection attempts use to hide instructions in plain sight.
      const text = sanitizeUserText((body.text || '').toString()).trim();
      // Validate + normalize attachment if present. Allow an empty text
      // when an attachment is attached - "analyze this" is implicit.
      const attachment = parseAttachment(body.attachment);
      if (attachment instanceof Error) return badRequest(res, attachment.message);
      if (!text && !attachment) return badRequest(res, 'Message is required');
      if (text.length > MAX_MESSAGE_CHARS) return badRequest(res, 'Message too long');

      let session;
      if (body.sessionId) {
        session = await fetchOwnedSession({ id: body.sessionId, workspaceId });
        if (!session) return badRequest(res, 'Unknown session');
      } else {
        const title = text.slice(0, 60).replace(/\s+/g, ' ');
        const ins = await sql`
          INSERT INTO ivy_sessions (workspace_id, title)
          VALUES (${workspaceId}, ${title})
          RETURNING *
        `;
        session = ins.rows[0];
      }

      // Fetch prior turns BEFORE inserting the new user message so the
      // history we pass to Claude doesn't include the message we're about
      // to respond to (we pass it as `text` separately).
      const priorMsgs = await sql`
        SELECT role, text FROM ivy_messages
        WHERE session_id = ${session.id}
        ORDER BY created_at ASC
        LIMIT 40
      `;
      const history = priorMsgs.rows.map((r) => ({ role: r.role, text: r.text }));

      // The persisted user message includes a one-line note about the
      // attachment so it shows up in chat history. The actual file
      // bytes are NOT stored - they only live in the API call.
      const persistedText = attachment
        ? (text ? `${text}\n\n📎 ${attachment.filename || 'file'}` : `📎 ${attachment.filename || 'file'}`)
        : text;
      const userMsg = await sql`
        INSERT INTO ivy_messages (session_id, role, text)
        VALUES (${session.id}, 'me', ${persistedText})
        RETURNING *
      `;

      const ctx = await workspaceContext(workspaceId);
      const reply = await generateReply(text, ctx, history, workspaceId, attachment);
      const replyText = reply.text;

      const ivyMsg = await sql`
        INSERT INTO ivy_messages (session_id, role, text)
        VALUES (${session.id}, 'ivy', ${replyText})
        RETURNING *
      `;

      const preview = stripInlineMarkdown(replyText).slice(0, 120);
      const upd = await sql`
        UPDATE ivy_sessions
        SET last_message_at = NOW(), last_message_preview = ${preview}, updated_at = NOW()
        WHERE id = ${session.id}
        RETURNING *
      `;

      const usage = await getDailyUsage(workspaceId);
      // Surface any confirm-gated action Ivy proposed this turn on the Ivy
      // message, so the client can render one-tap Approve/Dismiss buttons.
      // Ephemeral to the live turn (not persisted) - reopening the session
      // won't re-show a stale card.
      const ivyMessage = serializeMessage(ivyMsg.rows[0]);
      if (reply.pendingActions && reply.pendingActions.length) {
        ivyMessage.pendingActions = reply.pendingActions;
      }
      return ok(res, {
        session: serializeSession(upd.rows[0]),
        messages: [serializeMessage(userMsg.rows[0]), ivyMessage],
        context: ctx,
        mode: reply.mode,
        modeError: reply.error || null,
        usage,
      });
    }

    return methodNotAllowed(res, ['GET', 'POST']);
  } catch (err) {
    return serverError(res, err);
  }
}

// Returns a normalized { filename, mediaType, base64 } on success, null
// when no attachment is present, or an Error with a user-readable
// message when the payload is invalid.
function parseAttachment(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'object') return new Error('Attachment must be an object');
  const filename = (raw.filename || raw.name || '').toString().slice(0, 200) || null;
  const mediaType = (raw.mediaType || raw.type || '').toString().toLowerCase();
  const base64 = (raw.base64 || raw.data || '').toString();
  if (!mediaType) return new Error('Attachment missing mediaType');
  if (!ALLOWED_MIME.has(mediaType)) {
    return new Error(`Unsupported file type: ${mediaType}. Allowed: PDF, PNG/JPEG/GIF/WEBP image, CSV, JSON, plain text.`);
  }
  if (!base64) return new Error('Attachment missing data');
  // base64-decoded byte length ≈ ceil(len * 3 / 4) − padding, close enough.
  const approxBytes = Math.floor(base64.length * 0.75);
  if (approxBytes > MAX_ATTACHMENT_BYTES) {
    const mb = (MAX_ATTACHMENT_BYTES / 1024 / 1024).toFixed(1);
    return new Error(`File is too large. Cap is ${mb} MB.`);
  }
  return { filename, mediaType, base64 };
}
