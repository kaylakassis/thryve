// Which Claude model Ivy runs on - resolved live, not hard-coded.
//
// Order of precedence:
//   1. IVY_MODEL env var, when set: an explicit pin (e.g. to hold a version
//      while testing). Nothing else runs.
//   2. The newest Opus-family model the account can see, from the Models
//      API (GET /v1/models, sorted by created_at). Cached in memory for six
//      hours per serverless instance, so the lookup costs nothing per chat.
//   3. IVY_DEFAULT_MODEL, if the lookup fails or there is no client.
//
// Opus is the tier Ivy is tuned for; the Fable/Mythos tier is deliberately
// excluded (different API behaviour and pricing) - opt in with IVY_MODEL.
export const IVY_DEFAULT_MODEL = 'claude-opus-5';

const TTL_MS = 6 * 60 * 60 * 1000;
let cached = null; // { id, at }
let inflight = null;

const OPUS = /^claude-opus-\d/;

export async function resolveIvyModel(client) {
  const pinned = (process.env.IVY_MODEL || '').trim();
  if (pinned) return pinned;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.id;
  if (!client) return cached?.id || IVY_DEFAULT_MODEL;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      let best = null;
      for await (const m of client.models.list({ limit: 100 })) {
        if (!OPUS.test(m.id)) continue;
        if (!best || new Date(m.created_at) > new Date(best.created_at)) best = m;
      }
      const id = best?.id || IVY_DEFAULT_MODEL;
      cached = { id, at: Date.now() };
      return id;
    } catch (err) {
      console.error('[ivy] model lookup failed, using default:', err?.message || err);
      cached = { id: IVY_DEFAULT_MODEL, at: Date.now() };
      return IVY_DEFAULT_MODEL;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// For tests / ops: forget the cached answer.
export function resetIvyModelCache() { cached = null; inflight = null; }
