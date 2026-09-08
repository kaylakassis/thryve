// POST /api/programs/checkout  body: { programId, name, email }
//
// Public. Mints a Stripe Checkout session on the coach's connected account:
// mode 'payment' for one-time programs, 'subscription' (inline recurring
// price) for monthly / yearly ones. Access is granted by the platform
// webhook (metadata.purpose='program'), never by the redirect.
import { sql } from '../_lib/db.js';
import { readBody } from '../_lib/body.js';
import { enforce, getClientIp } from '../_lib/rate-limit.js';
import { validEmail } from '../_lib/auth.js';
import { loadStripeCreds } from '../_lib/stripeCreds.js';
import { stripeFetch, findOrCreateCustomer } from '../_lib/stripe.js';
import { appUrl } from '../_lib/tokens.js';
import { fetchFinanceSettings } from '../_lib/finance.js';
import { badRequest, methodNotAllowed, notFound, ok, serverError } from '../_lib/json.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const ip = getClientIp(req);
    if (await enforce(req, res, [{ key: `program:co:${ip}`, max: 10, windowSeconds: 60 * 60 }])) return;
    const body = await readBody(req);
    const programId = String(body.programId || '');
    const buyerName = String(body.name || '').trim().slice(0, 200);
    const buyerEmail = String(body.email || '').trim().toLowerCase().slice(0, 200);
    if (!programId) return badRequest(res, 'programId is required');
    if (!buyerName) return badRequest(res, 'Please share your name.');
    if (!validEmail(buyerEmail)) return badRequest(res, 'A valid email is required.');

    const p = (await sql`SELECT * FROM programs WHERE id = ${programId} AND status = 'published'`).rows[0];
    if (!p) return notFound(res, 'This program is not available.');
    if (Number(p.price_cents) <= 0) return badRequest(res, 'This program is free - ask the coach to add you.');
    const workspaceId = p.workspace_id;

    let creds;
    try { creds = await loadStripeCreds(workspaceId); }
    catch (e) { return badRequest(res, e.code === 'no_stripe_connection' ? 'This coach has not connected payments yet.' : e.message); }

    let clientId = null; let stripeCustomerId = null;
    const existing = (await sql`SELECT id, stripe_customer_id FROM clients WHERE workspace_id = ${workspaceId} AND LOWER(email) = ${buyerEmail} LIMIT 1`).rows[0];
    if (existing) { clientId = existing.id; stripeCustomerId = existing.stripe_customer_id; }
    else {
      clientId = (await sql`INSERT INTO clients (workspace_id, name, email, stage, source) VALUES (${workspaceId}, ${buyerName}, ${buyerEmail}, 'lead', 'program') RETURNING id`).rows[0].id;
    }
    if (!stripeCustomerId) {
      const cust = await findOrCreateCustomer({ secretKey: creds.secretKey, stripeAccount: creds.stripeAccount, email: buyerEmail, name: buyerName, workspaceId, clientId });
      stripeCustomerId = cust.id;
      await sql`UPDATE clients SET stripe_customer_id = ${stripeCustomerId} WHERE id = ${clientId} AND workspace_id = ${workspaceId}`;
    }

    const fin = await fetchFinanceSettings(workspaceId).catch(() => null);
    const currency = (fin?.currency || 'USD').toLowerCase();
    const base = appUrl();
    const recurring = p.billing !== 'one_time';
    const bodyParams = {
      mode: recurring ? 'subscription' : 'payment',
      success_url: `${base}/p/${p.id}?purchased=1`,
      cancel_url: `${base}/p/${p.id}?cancelled=1`,
      customer: stripeCustomerId,
      'line_items[0][price_data][currency]': currency,
      'line_items[0][price_data][unit_amount]': Number(p.price_cents),
      'line_items[0][price_data][product_data][name]': p.title,
      'line_items[0][quantity]': 1,
      'metadata[workspace_id]': workspaceId,
      'metadata[program_id]': p.id,
      'metadata[client_id]': clientId,
      'metadata[purpose]': 'program',
    };
    if (recurring) {
      bodyParams['line_items[0][price_data][recurring][interval]'] = p.billing;
      bodyParams['subscription_data[metadata][workspace_id]'] = workspaceId;
      bodyParams['subscription_data[metadata][program_id]'] = p.id;
      bodyParams['subscription_data[metadata][client_id]'] = clientId;
      bodyParams['subscription_data[metadata][purpose]'] = 'program';
    } else {
      bodyParams['payment_intent_data[metadata][workspace_id]'] = workspaceId;
      bodyParams['payment_intent_data[metadata][program_id]'] = p.id;
      bodyParams['payment_intent_data[metadata][client_id]'] = clientId;
      bodyParams['payment_intent_data[metadata][purpose]'] = 'program';
    }
    const session = await stripeFetch('/checkout/sessions', { method: 'POST', secretKey: creds.secretKey, stripeAccount: creds.stripeAccount, body: bodyParams });
    return ok(res, { url: session.url });
  } catch (err) { return serverError(res, err); }
}
