// Where a signed-in user lands, and the ONE /api/me call that decides it.
//
// Three components used to ask the server the same question on every
// launch - RootRouter at "/", RoleRouter around the business shell, and
// UserContextProvider inside it - each with its own round trip, one after
// another. On the phone, where every route is a separate serverless
// function that may be cold, that chain was most of the wait before the
// dashboard appeared. Now:
//   • fetchMe() shares a single in-flight/recent request between them;
//   • the last decision is remembered on the device, so the next launch
//     navigates immediately and the fresh /me only has to confirm it.
import { api } from './api.js';
import { writeCache } from './deviceCache.js';

const TTL_MS = 15_000;
const LANDING_KEY = 'ivy_landing';

let cache = null; // { promise, at }

// Shared /api/me. Repeated calls within TTL_MS (or while one is in flight)
// return the same promise. A failure evicts itself so the next caller retries.
export function fetchMe({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache && now - cache.at < TTL_MS) return cache.promise;
  const promise = api.get('/me')
    .then((r) => { writeCache('me', r); return r; })
    .catch((e) => {
      if (cache?.promise === promise) cache = null;
      throw e;
    });
  cache = { promise, at: now };
  return promise;
}

export function clearMeCache() { cache = null; }

// 'onboarding' | 'business' | 'client' from a /api/me payload. Shared by
// RootRouter and RoleRouter so they can never disagree.
export function decideLanding(r, user) {
  // Owner who hasn't finished onboarding → wizard, UNLESS they used the
  // "Save & exit" escape hatch (ivy_skip_onboarding_until, self-expiring).
  let skipUntil = 0;
  try { skipUntil = Number(localStorage.getItem('ivy_skip_onboarding_until')) || 0; } catch { /* private mode */ }
  const skipping = skipUntil > Date.now();
  if (r?.isOwner && !r.onboardedAt && !skipping) return 'onboarding';
  // Super-admins always land in the business shell so /admin is reachable.
  const isSuperAdmin = !!(user?.isSuperAdmin || r?.isSuperAdmin);
  if (r?.isOwner || isSuperAdmin) return 'business';
  if (r?.isClient) return 'client';
  return 'business'; // workspace got auto-created on signup; empty shell is harmless
}

// Device memory of the last confirmed landing. Only the two stable answers
// are kept - 'onboarding' is transient and must always be re-checked.
export function rememberLanding(d) {
  try {
    if (d === 'business' || d === 'client') localStorage.setItem(LANDING_KEY, d);
    else localStorage.removeItem(LANDING_KEY);
  } catch { /* private mode */ }
}

export function rememberedLanding() {
  try {
    const v = localStorage.getItem(LANDING_KEY);
    return v === 'business' || v === 'client' ? v : null;
  } catch { return null; }
}

export function forgetLanding() {
  try { localStorage.removeItem(LANDING_KEY); } catch { /* private mode */ }
}
