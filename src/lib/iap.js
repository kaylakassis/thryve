// In-App Purchase wrapper (iOS).
//
// We use RevenueCat (https://www.revenuecat.com) as the SDK + the
// server-side source of truth for subscription state. It handles all
// the StoreKit minutiae (Apple receipt validation, renewals, refunds,
// grace periods, family sharing, the App Store Server Notifications V2
// firehose) and forwards a clean event to our /api/billing/revenuecat-webhook.
//
// Free up to $2.5K MRR (then 1%). The SDK is dynamically imported so
// the web bundle never pulls a single byte of it.
//
// Conventions:
//   • Our workspace_id is the RevenueCat `appUserId`. That's what we
//     identify with after sign-in, so RC's customer = our workspace.
//   • RC product identifiers must match what we register in App Store
//     Connect. See docs/IOS_SUBMISSION.md for the exact strings. Weekly IS a
//     native StoreKit duration, so iOS matches the web plan exactly:
//       ivyos_weekly   → $8.99 / week   (recurring plan; RC packageType WEEKLY)
//       ivyos_yearly   → $375 / year
//   • Both products live in the "Ivy" subscription group so users
//     can upgrade/downgrade between them and Apple proration applies.
import { isIos } from './platform.js';

const PUBLIC_KEY = import.meta.env.VITE_REVENUECAT_PUBLIC_KEY_IOS || '';
let initialized = false;
let purchasesPromise = null;

async function purchases() {
  if (!isIos()) throw new Error('IAP is iOS-only');
  if (!purchasesPromise) {
    purchasesPromise = import('@revenuecat/purchases-capacitor'); // the MODULE - never resolve with the Purchases proxy (its `.then` lookup becomes a native call)
  }
  return purchasesPromise;
}

export async function initIAP() {
  if (initialized || !isIos() || !PUBLIC_KEY) return;
  initialized = true;
  try {
    const { Purchases: P } = await purchases();
    await P.configure({ apiKey: PUBLIC_KEY });
  } catch (err) {
    initialized = false;
    // eslint-disable-next-line no-console
    console.error('[iap] configure failed:', err?.message || err);
  }
}

// Tie the RevenueCat customer to OUR workspace id. Call this after the
// user is authenticated and we know which workspace they own.
export async function identifyIapUser(workspaceId) {
  if (!isIos() || !workspaceId) return;
  await initIAP();
  try {
    const { Purchases: P } = await purchases();
    await P.logIn({ appUserID: String(workspaceId) });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[iap] logIn failed:', err?.message || err);
  }
}

// Fetch the current offering's packages (monthly + yearly). Returns an
// array of normalized objects the UI can render. Empty array on any
// failure - the paywall falls back to its disabled state.
export async function getIapOfferings() {
  if (!isIos()) return [];
  await initIAP();
  try {
    const { Purchases: P } = await purchases();
    const result = await P.getOfferings();
    const cur = result?.current;
    if (!cur?.availablePackages?.length) return [];
    return cur.availablePackages.map((pkg) => ({
      identifier: pkg.identifier,
      // RC normalizes Apple's price strings into a localized
      // priceString (e.g. "$8.99") so we don't have to format it.
      priceString: pkg.product?.priceString || '',
      title: pkg.product?.title || '',
      // Period: 'MONTHLY' | 'ANNUAL' | … - RC exposes this on the
      // package, simpler than parsing the Apple subscriptionPeriod.
      period: pkg.packageType || '',
      raw: pkg,
    }));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[iap] getOfferings failed:', err?.message || err);
    return [];
  }
}

// Trigger the StoreKit purchase sheet for one package. Resolves to:
//   { ok: true, transactionId, productId } on success
//   { ok: false, userCancelled: true }     when the user dismisses the sheet
//   { ok: false, error: '…' }              on any other failure
//
// On success RevenueCat fires its INITIAL_PURCHASE webhook to our
// /api/billing/revenuecat-webhook endpoint, which is the moment the
// workspace's subscription_status flips to 'active'. The UI polls
// /api/me after a short delay (mirroring the Stripe post-checkout flow).
export async function purchaseIapPackage(pkg) {
  if (!isIos()) return { ok: false, error: 'iOS only' };
  if (!pkg?.raw) return { ok: false, error: 'Invalid package' };
  try {
    const { Purchases: P } = await purchases();
    const r = await P.purchasePackage({ aPackage: pkg.raw });
    return {
      ok: true,
      transactionId: r?.transaction?.transactionIdentifier || null,
      productId: r?.productIdentifier || null,
    };
  } catch (err) {
    // RC throws an Error with `userCancelled` true when the user dismisses
    // the Apple sheet - that's the most common "failure" and we don't
    // want to show it as an error.
    if (err?.userCancelled) return { ok: false, userCancelled: true };
    return { ok: false, error: err?.message || 'Purchase failed' };
  }
}

// "Restore purchases" - Apple requires every IAP-using app to expose this.
// Re-syncs the customer's entitlements from Apple → RevenueCat → our
// webhook. Used when a user reinstalls the app on a new device.
export async function restoreIapPurchases() {
  if (!isIos()) return { ok: false, error: 'iOS only' };
  try {
    const { Purchases: P } = await purchases();
    const info = await P.restorePurchases();
    const hasActive = !!info?.entitlements?.active && Object.keys(info.entitlements.active).length > 0;
    return { ok: true, hasActive };
  } catch (err) {
    return { ok: false, error: err?.message || 'Restore failed' };
  }
}
