// Thin Stripe REST client. We only use a handful of endpoints
// (verify the account, create a checkout session, parse a webhook event), so
// pulling in the official SDK isn't worth it.
//
// All calls take an explicit `secretKey` - we never read it from env. This
// keeps the door open for per-workspace keys without surprises.
//
// `platformStripeSecret()` and `platformWebhookSecret()` resolve the
// "Ivy's own Stripe account" credentials with a fallback chain so a
// single Vercel-injected STRIPE_SECRET_KEY (from the Vercel Stripe
// integration) covers every legacy variable name we used to read.
import crypto from 'node:crypto';
import { fetchWithTimeout } from './fetchTimeout.js';

const STRIPE_BASE = 'https://api.stripe.com/v1';

// Preference order: the Vercel Stripe integration auto-injects
// STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / STRIPE_PUBLISHABLE_KEY
// when you connect Stripe in Vercel → Storage. The legacy
// IVY_STRIPE_* and STRIPE_PLATFORM_SECRET names from earlier setups
// remain as fallbacks so existing deployments don't have to migrate.
//
// We warn (once per cold start) when BOTH the Vercel-injected name
// AND a legacy name are set - that's an ambiguity flag, the operator
// should remove the legacy var to avoid drift.
let _legacyWarned = false;
function warnIfLegacyShadowed() {
  if (_legacyWarned) return;
  _legacyWarned = true;
  const dupes = [];
  if (process.env.STRIPE_SECRET_KEY && (process.env.IVY_STRIPE_SECRET || process.env.STRIPE_PLATFORM_SECRET)) {
    dupes.push('STRIPE_SECRET_KEY (Vercel) is set alongside legacy IVY_STRIPE_SECRET/STRIPE_PLATFORM_SECRET - delete the legacy ones.');
  }
  if (process.env.STRIPE_WEBHOOK_SECRET && process.env.IVY_STRIPE_WEBHOOK_SECRET) {
    dupes.push('STRIPE_WEBHOOK_SECRET (Vercel) is set alongside legacy IVY_STRIPE_WEBHOOK_SECRET - delete the legacy one.');
  }
  if (dupes.length) {
    // eslint-disable-next-line no-console
    console.warn('[stripe] env-var migration:\n  • ' + dupes.join('\n  • '));
  }
}

export function platformStripeSecret() {
  warnIfLegacyShadowed();
  return process.env.STRIPE_SECRET_KEY
    || process.env.IVY_STRIPE_SECRET
    || process.env.STRIPE_PLATFORM_SECRET
    || null;
}
export function platformWebhookSecret() {
  warnIfLegacyShadowed();
  return process.env.STRIPE_WEBHOOK_SECRET
    || process.env.IVY_STRIPE_WEBHOOK_SECRET
    || null;
}
// Ivy's own subscription webhook (/api/webhooks/billing) lives at a
// different Stripe endpoint URL than the Connect platform webhook
// (/api/webhooks/stripe-platform). Stripe issues a separate signing
// secret per endpoint, so the two cannot share STRIPE_WEBHOOK_SECRET.
// In PRODUCTION this must be the dedicated billing secret — falling back to
// the platform secret would cross-wire verification (validly-signed platform
// events would pass the billing handler). Only allow the fallback in
// non-production (single-endpoint dev setups); fail closed in prod.
export function billingWebhookSecret() {
  if (process.env.IVY_BILLING_WEBHOOK_SECRET) return process.env.IVY_BILLING_WEBHOOK_SECRET;
  if (process.env.VERCEL_ENV === 'production') return null;
  return platformWebhookSecret();
}
export function platformPublishableKey() {
  return process.env.STRIPE_PUBLISHABLE_KEY
    || process.env.IVY_STRIPE_PUBLISHABLE_KEY
    || null;
}

function formEncode(params, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === 'object') {
          out.push(formEncode(item, `${key}[${i}]`));
        } else {
          out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(item)}`);
        }
      });
    } else if (v && typeof v === 'object') {
      out.push(formEncode(v, key));
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
    }
  }
  return out.filter(Boolean).join('&');
}

export async function stripeFetch(path, { method = 'GET', secretKey, stripeAccount, body, idempotencyKey }) {
  if (!secretKey || typeof secretKey !== 'string') {
    throw new Error('Stripe secret key is required');
  }
  const headers = {
    Authorization: `Bearer ${secretKey}`,
    Accept: 'application/json',
  };
  // Stripe-Account header lets us act on behalf of a connected account
  // using the platform secret key - the auth pattern Account Links
  // (Express) uses instead of OAuth-issued per-account secret keys.
  if (stripeAccount) headers['Stripe-Account'] = stripeAccount;
  // Stripe-native idempotency: if our function retries (or crashes after
  // Stripe charged but before we recorded it), passing the same key makes
  // Stripe return the ORIGINAL result instead of charging again.
  if (idempotencyKey) headers['Idempotency-Key'] = String(idempotencyKey);
  let payload;
  if (body) {
    payload = formEncode(body);
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const res = await fetchWithTimeout(`${STRIPE_BASE}${path}`, { method, headers, body: payload }, 8000);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || `Stripe ${method} ${path} failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.stripeCode = json?.error?.code;
    throw err;
  }
  return json;
}

// Returns { id, label, livemode, chargesEnabled, detailsSubmitted } so
// the UI can confirm the right account is connected and onboarding is
// complete. We prefer business_profile.name, then email, then the
// account id.
//
// Two call shapes:
//   • fetchAccountSummary(secretKey)                       - legacy
//   • fetchAccountSummary({ secretKey, stripeAccount })    - Account Links
// In the Account Links shape, secretKey is the platform secret and
// stripeAccount is the acct_xxx we're inspecting.
export async function fetchAccountSummary(arg) {
  const opts = typeof arg === 'string'
    ? { secretKey: arg }
    : { secretKey: arg.secretKey, stripeAccount: arg.stripeAccount };
  const acct = await stripeFetch('/account', opts);
  const label =
    acct.business_profile?.name ||
    acct.settings?.dashboard?.display_name ||
    acct.email ||
    acct.id;
  return {
    id: acct.id,
    label,
    // Stripe returns acct.livemode directly - true for live-mode keys,
    // false for test-mode keys. The previous heuristic (`!startsWith
    // 'acct_test_'`) was wrong: real Stripe IDs always start with
    // `acct_` regardless of mode.
    livemode: !!acct.livemode,
    chargesEnabled: !!acct.charges_enabled,
    detailsSubmitted: !!acct.details_submitted,
    payoutsEnabled: !!acct.payouts_enabled,
  };
}

// ─── Account Links (modern Connect onboarding) ───────────────────────
// Used by stripe-oauth-init to create an Express account on demand and
// hand the owner a Stripe-hosted onboarding link. Returns { id }.
export async function createConnectedAccount({
  secretKey, email, country, businessName,
}) {
  if (!secretKey) throw new Error('Platform secret required to create connected account');
  const body = {
    type: 'express',
    country: (country || 'US').toUpperCase(),
    email: email || undefined,
    'capabilities[card_payments][requested]': 'true',
    'capabilities[transfers][requested]': 'true',
  };
  if (businessName) body['business_profile[name]'] = businessName;
  const acct = await stripeFetch('/accounts', { method: 'POST', secretKey, body });
  return { id: acct.id };
}

// Mints a one-time Account Link the owner uses to complete (or refresh)
// Stripe Express onboarding. Returns { url, expiresAt }.
export async function createAccountLink({
  secretKey, accountId, refreshUrl, returnUrl, type = 'account_onboarding',
}) {
  if (!secretKey) throw new Error('Platform secret required to create account link');
  if (!accountId) throw new Error('accountId required');
  const link = await stripeFetch('/account_links', {
    method: 'POST', secretKey,
    body: {
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type,
    },
  });
  return { url: link.url, expiresAt: link.expires_at };
}

// Express dashboard login link for an already-onboarded account. Used
// when the owner clicks "Open Stripe dashboard" from /finance.
export async function createLoginLink({ secretKey, accountId }) {
  if (!secretKey) throw new Error('Platform secret required');
  if (!accountId) throw new Error('accountId required');
  const link = await stripeFetch(
    `/accounts/${encodeURIComponent(accountId)}/login_links`,
    { method: 'POST', secretKey },
  );
  return { url: link.url };
}

// Creates a Stripe Checkout session for a single invoice. The invoice's
// id+workspace are baked into metadata so the webhook can look it up.
//
// stripeAccount (optional): when present, the call runs against the
// connected acct via Stripe-Account header (Account Links / Express
// flow). When absent, secretKey is the connected account's own secret
// (legacy Standard OAuth).
export async function createCheckoutSession({
  secretKey, stripeAccount, invoice, currency, totalCents,
  successUrl, cancelUrl, customerEmail,
  // Stripe Tax: opt-in per workspace. When true, Stripe computes
  // VAT/sales tax from the buyer's address against the connected
  // account's tax-registration matrix. taxBehavior optional
  // ('exclusive' default, 'inclusive' for EU-style tax-included
  // pricing). Stripe requires line-item tax_behavior when
  // automatic_tax is enabled and tax_behavior is unset on the
  // account's default - we set 'exclusive' as the safe default.
  automaticTax = false,
  taxBehavior = null,
}) {
  const body = {
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: customerEmail || undefined,
    'line_items[0][price_data][currency]': currency.toLowerCase(),
    'line_items[0][price_data][unit_amount]': totalCents,
    'line_items[0][price_data][product_data][name]': `Invoice ${invoice.number}`,
    'line_items[0][quantity]': 1,
    'metadata[invoice_id]': invoice.id,
    'metadata[workspace_id]': invoice.workspace_id,
    payment_intent_data: { metadata: { invoice_id: invoice.id, workspace_id: invoice.workspace_id } },
  };
  if (automaticTax) {
    body['automatic_tax[enabled]'] = 'true';
    // tax_behavior must be set per-line when automatic_tax is on.
    body['line_items[0][price_data][tax_behavior]'] = taxBehavior || 'exclusive';
    // Collect buyer's address so Stripe can look up the right rate.
    body['customer_update[address]'] = 'auto';
    body['billing_address_collection'] = 'required';
    body['tax_id_collection[enabled]'] = 'true';
  }
  const session = await stripeFetch('/checkout/sessions', {
    method: 'POST', secretKey, stripeAccount, body,
  });
  return { id: session.id, url: session.url };
}

// Verifies a Stripe webhook signature header per Stripe's spec:
//   Stripe-Signature: t=<timestamp>,v1=<sig>,v1=<sig>...
// Throws on mismatch / replay. Returns the parsed event on success.
//
// `tolerance` is in seconds - Stripe's recommended default is 300.
export function verifyWebhookSignature({ payload, header, secret, tolerance = 300 }) {
  if (!header) throw new Error('Missing Stripe-Signature header');
  if (!secret) throw new Error('Webhook secret is not configured');
  const parts = String(header).split(',').reduce((acc, kv) => {
    const [k, v] = kv.split('=');
    if (!acc[k]) acc[k] = [];
    acc[k].push(v);
    return acc;
  }, {});
  const timestamp = parseInt(parts.t?.[0], 10);
  const sigs = parts.v1 || [];
  if (!timestamp || sigs.length === 0) throw new Error('Malformed Stripe-Signature header');

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - timestamp) > tolerance) {
    throw new Error('Webhook timestamp is outside tolerance');
  }

  const signed = `${timestamp}.${payload}`;
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  const match = sigs.some((s) => {
    try {
      const sBuf = Buffer.from(s, 'hex');
      return sBuf.length === expectedBuf.length && crypto.timingSafeEqual(sBuf, expectedBuf);
    } catch { return false; }
  });
  if (!match) throw new Error('Webhook signature mismatch');

  try {
    return JSON.parse(payload);
  } catch {
    throw new Error('Webhook payload is not valid JSON');
  }
}

// ─── Subscription billing (Ivy itself charging workspace owners) ──
// These talk to *our* Stripe account, not the per-workspace one. Pass the
// platform secret (process.env.IVY_STRIPE_SECRET).

export async function createSubscriptionCheckoutSession({
  secretKey, priceId, customerId, customerEmail,
  workspaceId, successUrl, cancelUrl,
  couponId,  // optional - when set, pre-applies the win-back coupon.
  trialDays, // optional - when set, starts a card-on-file free trial of N days.
}) {
  const body = {
    mode: 'subscription',
    success_url: successUrl,
    cancel_url: cancelUrl,
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': 1,
    'metadata[workspace_id]': workspaceId,
    'subscription_data[metadata][workspace_id]': workspaceId,
  };
  if (trialDays && Number(trialDays) > 0) {
    // Card-backed free trial: collect the card now, charge $0 today, and
    // auto-convert at trial end. payment_method_collection:'always' forces
    // the card field even though the amount due today is $0.
    body['subscription_data[trial_period_days]'] = String(Math.floor(trialDays));
    body.payment_method_collection = 'always';
  }
  if (couponId) {
    // Stripe rejects `discounts` together with `allow_promotion_codes`,
    // so the win-back path turns the input box OFF and pre-applies the
    // single offered coupon instead. The user can't stack additional
    // promo codes on top - by design, win-back is a single-use lever.
    body['discounts[0][coupon]'] = couponId;
  } else {
    body.allow_promotion_codes = true;
  }
  if (customerId) body.customer = customerId;
  else if (customerEmail) body.customer_email = customerEmail;
  const session = await stripeFetch('/checkout/sessions', {
    method: 'POST', secretKey, body,
  });
  return { id: session.id, url: session.url, customer: session.customer };
}

// Create a one-time win-back coupon for a specific workspace. A percent-off
// coupon that REPEATS for `durationMonths` so the discount survives a
// renewal cycle (typical win-back offer: 30% off for 3 months). Returns
// { couponId, promoCode } - the caller persists both on the workspaces row
// so subsequent checkouts can pre-apply the discount.
export async function createWinbackCoupon({
  secretKey, workspaceId, percentOff, durationMonths,
}) {
  const couponBody = {
    duration: 'repeating',
    duration_in_months: String(durationMonths),
    percent_off: String(percentOff),
    name: `Ivy win-back ${percentOff}% / ${durationMonths}mo`,
    'metadata[workspace_id]': workspaceId,
    'metadata[kind]': 'winback',
  };
  const coupon = await stripeFetch('/coupons', {
    method: 'POST', secretKey, body: couponBody,
    idempotencyKey: `winback-coupon-${workspaceId}`,
  });
  // Pair with a single-use promotion code so the offer can be shared
  // (in the email body) and the user can pop it into a generic Stripe
  // Checkout if they didn't click through our pre-applied link.
  const promoBody = {
    coupon: coupon.id,
    'metadata[workspace_id]': workspaceId,
    'metadata[kind]': 'winback',
    max_redemptions: '1',
    active: 'true',
  };
  const promo = await stripeFetch('/promotion_codes', {
    method: 'POST', secretKey, body: promoBody,
    idempotencyKey: `winback-promo-${workspaceId}`,
  });
  return { couponId: coupon.id, promoCode: promo.code };
}

// Waitlist launch discount: ONE shared coupon (20% off, repeating N
// months) reused for every waitlist signup. There's no per-workspace
// promo code - the discount is auto-applied server-side at checkout only
// when the workspace was stamped eligible (its signup email matched the
// waitlist). The coupon id is never sent to the browser, so exclusivity
// lives entirely in that email match. Idempotent: a fixed idempotency
// key means repeated calls return the same coupon; the caller caches the
// id in app_settings so this round-trip happens at most once.
export async function createWaitlistCoupon({ secretKey, percentOff = 20, durationMonths = 12 }) {
  const coupon = await stripeFetch('/coupons', {
    method: 'POST', secretKey,
    body: {
      duration: 'repeating',
      duration_in_months: String(durationMonths),
      percent_off: String(percentOff),
      name: `Ivy waitlist ${percentOff}% / ${durationMonths}mo`,
      'metadata[kind]': 'waitlist',
    },
    idempotencyKey: `waitlist-coupon-${percentOff}x${durationMonths}-v1`,
  });
  return { couponId: coupon.id };
}

// Stripe Customer Portal - self-serve cancel / update card / view invoices.
// Owner clicks "Manage subscription" on the Account page.
export async function createBillingPortalSession({
  secretKey, customerId, returnUrl,
}) {
  if (!customerId) throw new Error('customerId is required');
  const session = await stripeFetch('/billing_portal/sessions', {
    method: 'POST', secretKey,
    body: { customer: customerId, return_url: returnUrl },
  });
  return { id: session.id, url: session.url };
}

export async function fetchCheckoutSession({ secretKey, sessionId, stripeAccount }) {
  if (!sessionId) throw new Error('sessionId is required');
  // stripeAccount: required to read a session that lives on a CONNECTED
  // account (the Account-Links/Express flow charges there). Omitted for the
  // platform's own sessions (subscription billing) + legacy OAuth keys.
  return stripeFetch(`/checkout/sessions/${encodeURIComponent(sessionId)}?expand[0]=subscription`, { secretKey, stripeAccount });
}

export async function fetchSubscription({ secretKey, stripeAccount, subscriptionId }) {
  if (!subscriptionId) throw new Error('subscriptionId is required');
  return stripeFetch(
    `/subscriptions/${encodeURIComponent(subscriptionId)}`,
    { secretKey, stripeAccount },
  );
}

// Apply a credit to a customer's Stripe balance. Stripe automatically
// draws the balance down against the customer's next invoice(s), so a
// one-month credit "waives the next billing cycle." amountCents is the
// POSITIVE credit amount; Stripe stores credits as a NEGATIVE balance
// transaction, so we send -amountCents. Used by the referral program
// (api/_lib/referrals.js) to reward "refer one, get one" months.
export async function applyCustomerCredit({ secretKey, customerId, amountCents, currency = 'usd', description }) {
  if (!customerId) throw new Error('customerId is required');
  const cents = Math.round(Number(amountCents));
  if (!Number.isFinite(cents) || cents <= 0) throw new Error('amountCents must be a positive number');
  return stripeFetch(`/customers/${encodeURIComponent(customerId)}/balance_transactions`, {
    method: 'POST',
    secretKey,
    body: {
      amount: -cents,            // negative = credit toward future invoices
      currency,
      description: description || 'Ivy referral reward',
    },
  });
}

// ─── Per-workspace card-on-file flow ─────────────────────────────────
// These run against the workspace's connected Stripe account
// (stripe_secret_encrypted). They power the client-portal "save a card
// on file" flow and the off-session charging that powers no-show /
// late-cancel fees + post-session tips.

// Find or create a Stripe customer on the connected account for a
// given client email. We only ever look up by email + check metadata
// to confirm it's the right tenant - we never trust a client_id that
// the browser handed us. The returned id is what we save on
// clients.stripe_customer_id.
export async function findOrCreateCustomer({ secretKey, stripeAccount, email, name, workspaceId, clientId }) {
  if (!email) throw new Error('email is required');
  const list = await stripeFetch(
    `/customers?email=${encodeURIComponent(email)}&limit=1`,
    { secretKey, stripeAccount },
  );
  if (Array.isArray(list.data) && list.data.length > 0) {
    return list.data[0];
  }
  return stripeFetch('/customers', {
    method: 'POST', secretKey, stripeAccount,
    body: {
      email,
      name: name || undefined,
      'metadata[workspace_id]': workspaceId,
      'metadata[client_id]': clientId || undefined,
    },
  });
}

// Mint a SetupIntent the browser uses with Stripe Elements / Checkout
// in setup mode to save a card without charging. Webhook handles the
// post-confirm step (storing payment_method_id on the client row).
export async function createSetupIntent({ secretKey, stripeAccount, customerId, workspaceId, clientId }) {
  if (!customerId) throw new Error('customerId is required');
  return stripeFetch('/setup_intents', {
    method: 'POST', secretKey, stripeAccount,
    body: {
      customer: customerId,
      'payment_method_types[0]': 'card',
      usage: 'off_session',
      'metadata[workspace_id]': workspaceId,
      'metadata[client_id]': clientId,
    },
  });
}

export async function createSetupCheckoutSession({
  secretKey, stripeAccount, customerId, workspaceId, clientId, successUrl, cancelUrl,
}) {
  if (!customerId) throw new Error('customerId is required');
  const session = await stripeFetch('/checkout/sessions', {
    method: 'POST', secretKey, stripeAccount,
    body: {
      mode: 'setup',
      customer: customerId,
      success_url: successUrl,
      cancel_url: cancelUrl,
      'payment_method_types[0]': 'card',
      'metadata[workspace_id]': workspaceId,
      'metadata[client_id]': clientId,
      'metadata[purpose]': 'save_card',
      'setup_intent_data[metadata][workspace_id]': workspaceId,
      'setup_intent_data[metadata][client_id]': clientId,
      'setup_intent_data[metadata][purpose]': 'save_card',
    },
  });
  return { id: session.id, url: session.url };
}

export async function fetchPaymentMethod({ secretKey, stripeAccount, paymentMethodId }) {
  return stripeFetch(`/payment_methods/${encodeURIComponent(paymentMethodId)}`, { secretKey, stripeAccount });
}

export async function setDefaultPaymentMethod({ secretKey, stripeAccount, customerId, paymentMethodId }) {
  if (!customerId || !paymentMethodId) throw new Error('customerId + paymentMethodId required');
  return stripeFetch(`/customers/${encodeURIComponent(customerId)}`, {
    method: 'POST', secretKey, stripeAccount,
    body: {
      'invoice_settings[default_payment_method]': paymentMethodId,
    },
  });
}

export async function detachPaymentMethod({ secretKey, stripeAccount, paymentMethodId }) {
  return stripeFetch(`/payment_methods/${encodeURIComponent(paymentMethodId)}/detach`, {
    method: 'POST', secretKey, stripeAccount,
  });
}

// Off-session charge against a saved card. Used for late-cancel
// fees, no-show fees, and post-session tips. Returns the
// PaymentIntent so the caller can persist its id for future refunds.
//
// Stripe will return a 402 if the card requires authentication
// (3DS) - the caller should surface that as "couldn't auto-charge,
// please ask the client to update their card."
export async function chargeOffSession({
  secretKey, stripeAccount, customerId, paymentMethodId,
  amountCents, currency, description, metadata,
  statementDescriptor, idempotencyKey,
}) {
  if (!customerId || !paymentMethodId) {
    throw new Error('customerId + paymentMethodId required');
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('amountCents must be a positive integer');
  }
  const body = {
    amount: amountCents,
    currency: (currency || 'usd').toLowerCase(),
    customer: customerId,
    payment_method: paymentMethodId,
    confirm: 'true',
    off_session: 'true',
    description: description || undefined,
  };
  if (statementDescriptor) {
    body.statement_descriptor = String(statementDescriptor)
      .replace(/[<>"'\\*]/g, '')
      .slice(0, 22);
  }
  if (metadata && typeof metadata === 'object') {
    for (const [k, v] of Object.entries(metadata)) {
      if (v == null) continue;
      body[`metadata[${k}]`] = String(v);
    }
  }
  return stripeFetch('/payment_intents', {
    method: 'POST', secretKey, stripeAccount, body, idempotencyKey,
  });
}

// ─── Memberships (subscription products on the connected account) ────

// Provision a Stripe Product + recurring Price on the connected
// account at the moment a membership tier is saved. We store both
// IDs on the memberships row so the public sign-up flow can reuse
// them. Currency comes from finance_settings.
export async function createMembershipProduct({
  secretKey, stripeAccount, name, description, priceCents, interval, currency,
}) {
  if (!name) throw new Error('name is required');
  if (!Number.isInteger(priceCents) || priceCents < 0) {
    throw new Error('priceCents must be a non-negative integer');
  }
  const product = await stripeFetch('/products', {
    method: 'POST', secretKey, stripeAccount,
    body: { name, description: description || undefined },
  });
  const intervalMap = { week: 'week', month: 'month', quarter: 'month', year: 'year' };
  const intervalCount = interval === 'quarter' ? 3 : 1;
  const price = await stripeFetch('/prices', {
    method: 'POST', secretKey, stripeAccount,
    body: {
      product: product.id,
      unit_amount: priceCents,
      currency: (currency || 'usd').toLowerCase(),
      'recurring[interval]': intervalMap[interval] || 'month',
      'recurring[interval_count]': intervalCount,
    },
  });
  return { productId: product.id, priceId: price.id };
}

export async function createMembershipCheckoutSession({
  secretKey, stripeAccount, priceId, customerId, customerEmail,
  workspaceId, membershipId, clientId,
  successUrl, cancelUrl,
}) {
  const body = {
    mode: 'subscription',
    success_url: successUrl,
    cancel_url: cancelUrl,
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': 1,
    'metadata[workspace_id]': workspaceId,
    'metadata[membership_id]': membershipId,
    'metadata[purpose]': 'membership',
    'subscription_data[metadata][workspace_id]': workspaceId,
    'subscription_data[metadata][membership_id]': membershipId,
    'subscription_data[metadata][purpose]': 'membership',
  };
  if (clientId) {
    body['metadata[client_id]'] = clientId;
    body['subscription_data[metadata][client_id]'] = clientId;
  }
  if (customerId) body.customer = customerId;
  else if (customerEmail) body.customer_email = customerEmail;
  const session = await stripeFetch('/checkout/sessions', {
    method: 'POST', secretKey, stripeAccount, body,
  });
  return { id: session.id, url: session.url, customer: session.customer };
}

export async function cancelSubscription({ secretKey, stripeAccount, subscriptionId, atPeriodEnd = true }) {
  if (atPeriodEnd) {
    return stripeFetch(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: 'POST', secretKey, stripeAccount,
      body: { cancel_at_period_end: 'true' },
    });
  }
  return stripeFetch(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'DELETE', secretKey, stripeAccount,
  });
}

// Fetches a customer by id. Used by applySubscriptionState's reconcile
// path to auto-provision a clients row when a Dashboard-originated
// subscription arrives before the client has been seen in Ivy.
export async function fetchStripeCustomer({ secretKey, stripeAccount, customerId }) {
  if (!customerId) throw new Error('customerId is required');
  return stripeFetch(`/customers/${encodeURIComponent(customerId)}`, { secretKey, stripeAccount });
}

// Lists subscriptions on a connected account. Used by the reconcile
// cron - paginates via starting_after cursor. status=all so we pick
// up trialing/past_due/cancelled too (their state may have drifted
// since the last webhook).
export async function listStripeSubscriptions({ secretKey, stripeAccount, startingAfter, limit = 100 }) {
  const params = new URLSearchParams({ limit: String(limit), status: 'all' });
  if (startingAfter) params.set('starting_after', startingAfter);
  return stripeFetch(`/subscriptions?${params.toString()}`, { secretKey, stripeAccount });
}

// Switches a subscription's price (plan change). Stripe handles
// proration automatically when proration_behavior=create_prorations
// (default) - the next invoice carries the credit/charge for the
// remainder of the current period. The customer.subscription.updated
// webhook then carries the new items[] and applySubscriptionState
// resyncs the local tier snapshot.
export async function updateSubscriptionPrice({
  secretKey, stripeAccount, subscriptionId, itemId, newPriceId,
  prorationBehavior = 'create_prorations',
}) {
  if (!subscriptionId) throw new Error('subscriptionId is required');
  if (!itemId)         throw new Error('itemId is required');
  if (!newPriceId)     throw new Error('newPriceId is required');
  return stripeFetch(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'POST', secretKey, stripeAccount,
    body: {
      'items[0][id]':    itemId,
      'items[0][price]': newPriceId,
      proration_behavior: prorationBehavior,
    },
  });
}

export async function createRefund({ secretKey, stripeAccount, paymentIntent, amountCents, reason, idempotencyKey }) {
  if (!paymentIntent) throw new Error('paymentIntent is required');
  const body = { payment_intent: paymentIntent };
  if (amountCents != null) body.amount = amountCents;
  if (reason) body.reason = reason;
  // Idempotency-Key backstops double-click / function-retry double refunds:
  // Stripe returns the original refund instead of issuing a second one.
  const refund = await stripeFetch('/refunds', { method: 'POST', secretKey, stripeAccount, body, idempotencyKey });
  return {
    id:     refund.id,
    amount: refund.amount,
    status: refund.status,
    reason: refund.reason,
  };
}
