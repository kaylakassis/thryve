// Native (Capacitor) push - the iOS-app sibling of src/lib/push.js.
//
// Uses @capacitor/push-notifications + APNs instead of the web-push
// service worker (which doesn't run inside the iOS WebView). Dynamic
// import throughout so the web bundle never pulls a byte of the
// Capacitor SDK - same convention as lib/iap.js.
//
// Token lifecycle:
//   registerNativePush() → OS permission prompt → APNs registration →
//   'registration' event hands us the device token → POST /push/device.
//   Re-run on every app start (initNativePushOnLaunch) because Apple
//   rotates tokens; the server upserts.
//
// Tap routing: notification payloads carry `url` (same field the web SW
// uses). On tap we navigate the SPA there.
import { isNative } from './platform.js';
import { api } from './api.js';

// Resolves to the MODULE, never the PushNotifications proxy itself. A
// Capacitor plugin proxy turns every property lookup into a native call,
// so resolving a promise with it makes the engine ask for `.then` and
// iOS answers "PushNotifications.then() is not implemented" - the
// unhandled rejection that showed in the Xcode console on every launch.
// Same rule as nativeAuth.prefs(): hand the module through, unwrap after.
let pluginPromise = null;
function plugin() {
  if (!pluginPromise) pluginPromise = import('@capacitor/push-notifications');
  return pluginPromise;
}

export function nativePushSupported() {
  return isNative();
}

// 'default' | 'granted' | 'denied' - normalized to match web
// Notification.permission so the settings UI renders identically.
export async function nativePermissionState() {
  if (!isNative()) return 'unsupported';
  try {
    const { PushNotifications: P } = await plugin();
    const { receive } = await P.checkPermissions();
    if (receive === 'granted') return 'granted';
    if (receive === 'denied') return 'denied';
    return 'default';
  } catch {
    return 'unsupported';
  }
}

let listenersBound = false;
async function bindListeners() {
  if (listenersBound) return;
  listenersBound = true;
  const { PushNotifications: P } = await plugin();

  // Fires after successful APNs registration with the device token.
  await P.addListener('registration', async ({ value }) => {
    try {
      await api.post('/push/device', { token: value, platform: 'ios' });
      // Remember it so an explicit opt-out can delete the server row
      // (Capacitor never exposes the current token again).
      try { localStorage.setItem('ivy_apns_token', value); } catch { /* private mode */ }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[nativePush] token register failed:', err?.message);
    }
  });

  await P.addListener('registrationError', (err) => {
    // eslint-disable-next-line no-console
    console.warn('[nativePush] registration error:', JSON.stringify(err));
  });

  // Tap on a delivered notification → route to its url. Full navigation
  // is fine in the bundled app: the SPA boots straight onto the path.
  await P.addListener('pushNotificationActionPerformed', ({ notification }) => {
    const url = notification?.data?.url;
    if (url && typeof url === 'string' && url.startsWith('/')) {
      window.location.assign(url);
    }
  });
}

// User-gesture entry point (settings toggle / notification prompt).
// Throws on denial so callers surface the same guidance as web push.
export async function registerNativePush() {
  if (!isNative()) throw new Error('Native push is only available in the app');
  const { PushNotifications: P } = await plugin();
  await bindListeners();
  const { receive } = await P.requestPermissions();
  if (receive !== 'granted') throw new Error('Notifications permission was not granted');
  await P.register();
  return true;
}

// Silent re-registration on app launch: only when permission was
// already granted (never prompts) - keeps the server's token fresh
// across Apple's token rotations.
export async function initNativePushOnLaunch() {
  if (!isNative()) return;
  try {
    const { PushNotifications: P } = await plugin();
    const { receive } = await P.checkPermissions();
    if (receive !== 'granted') return;
    await bindListeners();
    await P.register();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[nativePush] launch init failed:', err?.message);
  }
}

export async function unregisterNativePush() {
  if (!isNative()) return;
  try {
    // Remove the server row first (we cached the token at registration;
    // Capacitor never exposes it again), then stop OS-level delivery.
    let token = null;
    try { token = localStorage.getItem('ivy_apns_token'); } catch { /* private mode */ }
    if (token) {
      await api.del('/push/device', { token }).catch(() => {});
      try { localStorage.removeItem('ivy_apns_token'); } catch { /* ignore */ }
    }
    const { PushNotifications: P } = await plugin();
    await P.unregister();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[nativePush] unregister failed:', err?.message);
  }
}
