// Last-known-good payloads kept on the device (native app only) so the
// home screen can paint instantly on launch and refresh in the background,
// instead of waiting on a chain of cold serverless functions.
//
// Scope and safety:
//   • Native only. A phone is one person's device; a shared web browser
//     is not, so the web never reads or writes this.
//   • Cleared on every sign-in, sign-up and sign-out (auth.jsx) and on the
//     lock screen's "use password instead", so one account's data can
//     never be shown to the next.
//   • Advisory only: the fresh response always replaces it, and the
//     server still authorises every request.
import { isNative } from './platform.js';

const PREFIX = 'ivy_cache:';

export function readCache(key) {
  if (!isNative()) return null;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const { v } = JSON.parse(raw);
    return v ?? null;
  } catch { return null; }
}

export function writeCache(key, value) {
  if (!isNative() || value == null) return;
  try { localStorage.setItem(PREFIX + key, JSON.stringify({ v: value, at: Date.now() })); } catch { /* quota / private */ }
}

export function clearDeviceCache() {
  try {
    const dead = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) dead.push(k);
    }
    dead.forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}
