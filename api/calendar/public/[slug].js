// /api/calendar/public/:slug
//   GET  → public calendar state (settings + services + blocks + bookings,
//          client identities redacted on bookings)
//   POST → create a booking via the public link. Body:
//          { serviceId, date, startMin, endMin, clientName, clientEmail, notes? }

import { sql, warmupDbOnce } from '../../_lib/db.js';
import { readBody } from '../../_lib/body.js';
import { enforce, getClientIp } from '../../_lib/rate-limit.js';
import { requireSameOrigin } from '../../_lib/security.js';
import { ensureSchemaApplied } from '../../_lib/ensureSchema.js';
import {
  serializeSettings, serializeService, serializeBlock, serializeBooking,
  hasConflict, losesBookingRace, withinAvailability, depositFor, mintVideoRoomUrl,
  slotEpochMs,
} from '../../_lib/calendar.js';
import { findActiveByCode, redeemAtomic } from '../../_lib/giftCards.js';
import { validEmail } from '../../_lib/auth.js';
import { normalizePhone } from '../../_lib/sms.js';
import { notifyNewBooking } from '../../_lib/bookingNotify.js';
import { syncOnBookingCreated } from '../../_lib/googleSync.js';
import { attachIntakeForms } from '../../_lib/intake.js';
import { getProvider } from '../../_lib/payments/index.js';
import { appUrl } from '../../_lib/tokens.js';
import { sendClientInvite } from '../../_lib/clientNotify.js';
import {
  badRequest, created, methodNotAllowed, notFound, ok, serverError,
} from '../../_lib/json.js';

export default async function handler(req, res) {
  if (!requireSameOrigin(req, res)) return;
  // Public endpoint never goes through requireUser (which warms the DB
  // on login). A viral booking link is often the FIRST hit on a
  // cold-started / Neon-autosuspended instance — wake the connection
  // before the schema probe + queries so we don't hard-500 the visitor.
  // Memoized per instance, so warm instances pay ~nothing.
  await warmupDbOnce();
  // Public endpoint never goes through requireUser, so bootstrap the
  // schema here on cold-start to self-heal columns/tables added in
  // recent deploys (e.g. services.visibility).
  await ensureSchemaApplied();
  if (req.method === 'GET')  return getCalendar(req, res);
  if (req.method === 'POST') return createBooking(req, res);
  return methodNotAllowed(res, ['GET', 'POST']);
}

async function getCalendar(req, res) {
  try {
    const slug = (req.query.slug || '').toString().toLowerCase();
    if (!slug) return notFound(res);

    // Throttle scraping + slug enumeration. The booking response leaks
    // workspace existence, service catalog with prices, and occupied
    // time-slots (= revenue/occupancy intelligence) so unauthenticated
    // bulk reads need a cap. The numbers are generous enough that a
    // real visitor refreshing the page never hits them.
    const ip = getClientIp(req);
    const blocked = await enforce(req, res, [
      { key: `bookget:ip:${ip}`,     max:  60, windowSeconds: 600 },
      { key: `bookget:slug:${slug}`, max: 240, windowSeconds: 600 },
    ]);
    if (blocked) return;

    const settings = await sql`
      SELECT cs.* FROM calendar_settings cs
        -- Deleted accounts' booking pages go dark (soft-delete leaves
        -- the workspace row behind).
        JOIN workspaces w ON w.id = cs.workspace_id
        JOIN users u ON u.id = w.owner_id AND u.deleted_at IS NULL
      WHERE cs.slug = ${slug}
    `;
    if (settings.rows.length === 0) return notFound(res, 'No booking page for that handle');
    const s = settings.rows[0];

    // Pull the workspace's business_type + website handle so the
    // public booking page can render a "Visit our shop" CTA when the
    // owner doesn't take appointments. Best-effort - defaults keep the
    // booking page working even if the column or website row is absent.
    let businessType = 'both';
    let websiteHandle = null;
    try {
      const ws = await sql`
        SELECT w.business_type, web.handle
          FROM workspaces w
          LEFT JOIN websites web ON web.workspace_id = w.id
         WHERE w.id = ${s.workspace_id} LIMIT 1
      `;
      if (ws.rows[0]) {
        businessType = ws.rows[0].business_type || 'both';
        websiteHandle = ws.rows[0].handle || null;
      }
    } catch { /* column may be pre-migration - fall back to defaults */ }

    // Public booking page hides 'only_me' services entirely (they're
    // drafts the owner doesn't want anyone to see) but keeps 'private'
    // ones - clients with a direct link/share can still book those.
    const services = await sql`
      SELECT * FROM services
      WHERE workspace_id = ${s.workspace_id}
        AND visibility != 'only_me'
      ORDER BY display_order, created_at
    `;
    // Only fetch blocks that ACTUALLY gate bookings. Informational
    // personal events (blocks_bookings = FALSE) are owner-private -
    // they never appear on the public slot picker.
    const blocks = await sql`
      SELECT * FROM calendar_blocks
      WHERE workspace_id = ${s.workspace_id}
        AND blocks_bookings = TRUE
      ORDER BY date, start_min
    `;
    const bookings = await sql`
      SELECT * FROM bookings WHERE workspace_id = ${s.workspace_id} AND cancelled_at IS NULL
      ORDER BY date, start_min
    `;
    // External busy times (e.g. Google Cal personal events) are merged
    // into the blocks list with a label of "Busy" so the slot picker
    // greys them out without leaking the real event title. Server-side
    // hasConflict() already checks external_busy_blocks, so the UI
    // rendering is just for honesty in the slot grid.
    const external = await sql`
      SELECT id, date, start_min, end_min FROM external_busy_blocks
      WHERE workspace_id = ${s.workspace_id} AND date >= CURRENT_DATE
      ORDER BY date, start_min
    `;
    // publicView: redacts the owner-private fields (label/notes/color)
    // and forces every block's display label to "Busy". Even if the
    // owner accidentally named a block "Dentist 3pm", the public
    // widget shows "Busy 3pm-4pm".
    const blocksOut = blocks.rows.map((b) => serializeBlock(b, { publicView: true }));
    for (const b of external.rows) {
      blocksOut.push({
        id: 'ext_' + b.id,
        date: b.date instanceof Date ? b.date.toISOString().slice(0, 10) : b.date,
        startMin: b.start_min,
        endMin: b.end_min,
        label: 'Busy',
      });
    }

    // Reviews block - drives the on-page social proof + the JSON-LD
    // structured data we inject for SEO. Aggregate is computed across
    // every visible review; "recent" caps at 12 so the payload stays
    // small and the page renders quickly.
    const [agg, recent] = await Promise.all([
      sql`SELECT COUNT(*)::int AS n,
                 ROUND(AVG(rating)::numeric, 2)::float AS avg
            FROM reviews
            WHERE workspace_id = ${s.workspace_id} AND status = 'visible'`,
      sql`SELECT id, reviewer_name, rating, text, owner_response, created_at
            FROM reviews
            WHERE workspace_id = ${s.workspace_id} AND status = 'visible'
            ORDER BY created_at DESC LIMIT 12`,
    ]);
    const reviewSummary = {
      count: agg.rows[0]?.n || 0,
      avg:   agg.rows[0]?.avg || null,
      recent: recent.rows.map((r) => ({
        id: r.id,
        reviewerName: r.reviewer_name,
        rating: r.rating,
        text: r.text || '',
        ownerResponse: r.owner_response || null,
        createdAt: r.created_at,
      })),
    };

    // Active membership tiers, surfaced on the public booking page so
    // visitors can join. Only active rows with a Stripe price (i.e.
    // genuinely buyable) - stripe_price_id null tiers are still in
    // the owner's draft state and shouldn't be shown to the public.
    const mships = await sql`
      SELECT id, name, description, price_cents, interval, perks, display_order
        FROM memberships
       WHERE workspace_id = ${s.workspace_id}
         AND active = TRUE
         AND stripe_price_id IS NOT NULL
       ORDER BY display_order ASC, created_at ASC
    `;
    const membershipsOut = mships.rows.map((r) => ({
      id:          r.id,
      name:        r.name,
      description: r.description || '',
      priceCents:  Number(r.price_cents || 0),
      interval:    r.interval,
      perks:       r.perks || [],
    }));

    // Active public packages, surfaced on the public booking page so
    // visitors can buy a bundle of sessions up-front. Only active rows
    // marked visibility='public' show; 'private'/'only_me' are owner-
    // sold flows (assigned client-by-client). Unlike memberships, no
    // pre-provisioned Stripe price is needed - we mint a one-time
    // price inline at checkout, so the gating is just active+public.
    const pkgs = await sql`
      SELECT id, name, description, service_ids, session_count, price, expiry_days
        FROM packages
       WHERE workspace_id = ${s.workspace_id}
         AND active = TRUE
         AND visibility = 'public'
       ORDER BY created_at ASC
    `;
    const packagesOut = pkgs.rows.map((r) => ({
      id:           r.id,
      name:         r.name,
      description:  r.description || '',
      serviceIds:   r.service_ids || [],
      sessionCount: Number(r.session_count || 0),
      price:        Number(r.price || 0),
      expiryDays:   r.expiry_days == null ? null : Number(r.expiry_days),
    }));

    // Published programs (courses, plans, paid communities) - bought from
    // the booking page too; checkout is /api/programs/checkout.
    let programsOut = [];
    try {
      const progs = await sql`
        SELECT id, title, description, price_cents, billing, access_days, community_enabled,
               (SELECT COUNT(*)::int FROM program_items i WHERE i.program_id = p.id AND i.deleted_at IS NULL) AS items
          FROM programs p WHERE workspace_id = ${s.workspace_id} AND status = 'published' ORDER BY created_at ASC`;
      programsOut = progs.rows.map((r) => ({ id: r.id, title: r.title, description: r.description || '', priceCents: Number(r.price_cents) || 0, billing: r.billing, accessDays: r.access_days == null ? null : Number(r.access_days), communityEnabled: !!r.community_enabled, items: r.items }));
    } catch (e) { console.error('[calendar/public] programs skipped:', e.message); }

    return ok(res, {
      calendar: {
        settings: serializeSettings(s),
        services: services.rows.map(serializeService),
        blocks:   blocksOut,
        bookings: bookings.rows.map((r) => serializeBooking(r, { redactClient: true })),
        reviews:  reviewSummary,
        memberships: membershipsOut,
        packages: packagesOut,
        programs: programsOut,
        businessType,
        websiteHandle,
      },
    });
  } catch (err) {
    return serverError(res, err);
  }
}

async function createBooking(req, res) {
  try {
    const slug = (req.query.slug || '').toString().toLowerCase();
    const body = await readBody(req);

    // Light rate limit: anyone can hit this without auth.
    const ip = getClientIp(req);
    const blocked = await enforce(req, res, [
      { key: `book:ip:${ip}`,    max: 10, windowSeconds: 60 * 60 },
      { key: `book:slug:${slug}`, max: 30, windowSeconds: 60 * 60 },
    ]);
    if (blocked) return;

    // Resolve workspace by slug.
    const settingsRows = await sql`
      SELECT cs.workspace_id, cs.availability, cs.slot_minutes, cs.min_notice_hours, cs.slot_fit_service, cs.buffer_minutes, cs.max_advance_days, cs.timezone
      FROM calendar_settings cs
        JOIN workspaces w ON w.id = cs.workspace_id
        JOIN users u ON u.id = w.owner_id AND u.deleted_at IS NULL
      WHERE cs.slug = ${slug}
    `;
    if (settingsRows.rows.length === 0) return notFound(res, 'Booking page not found');
    const { workspace_id: workspaceId, availability, slot_minutes: slotMinutes } = settingsRows.rows[0];
    const minNoticeHours = Math.max(0, Number(settingsRows.rows[0].min_notice_hours ?? 24));
    const slotFitService = !!settingsRows.rows[0].slot_fit_service;
    const bufferMinutes = Math.max(0, Number(settingsRows.rows[0].buffer_minutes || 0));
    const maxAdvanceDays = Math.max(0, Number(settingsRows.rows[0].max_advance_days ?? 60));
    const workspaceTz = settingsRows.rows[0].timezone || null;

    // Validate inputs.
    const date = (body.date || '').toString();
    const start = Number(body.startMin);
    const end = Number(body.endMin);
    const serviceId = (body.serviceId || '').toString();
    const clientName = (body.clientName || '').toString().trim().slice(0, 120);
    const clientEmail = (body.clientEmail || '').toString().trim().toLowerCase();
    const notes = body.notes ? String(body.notes).slice(0, 1000) : null;
    // Phone is optional - only normalized if the field was non-empty so
    // bookings without phones still succeed.
    let clientPhone = null;
    if (body.clientPhone) {
      clientPhone = normalizePhone(body.clientPhone);
      if (!clientPhone) return badRequest(res, 'Phone number is not a valid format');
    }
    const smsConsent = !!body.smsConsent && !!clientPhone;
    // Waitlist branch: client wants to queue for this slot instead of
    // (or after) failing a booking attempt against a full slot.
    const joinWaitlist = !!body.joinWaitlist;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return badRequest(res, 'date must be YYYY-MM-DD');
    if (!Number.isInteger(start) || start < 0 || start >= 24 * 60) return badRequest(res, 'invalid startMin');
    if (!Number.isInteger(end) || end <= start || end > 24 * 60) return badRequest(res, 'invalid endMin');
    // The START must sit on the booking grid. (The DURATION is validated
    // separately against service + add-ons below - it does NOT have to be a
    // multiple of the slot size, e.g. a 45-min consult on a 30-min grid.)
    // In fixed-grid mode the start aligns to slot_minutes (so e.g. a
    // top-of-the-hour rule is enforced); in fit-to-service mode starts are
    // duration-stepped, so we only guard against off-grid garbage (5-min floor).
    const alignTo = slotFitService ? 5 : slotMinutes;
    if (alignTo > 0 && start % alignTo !== 0) {
      return badRequest(res, `Start time must align to ${alignTo}-minute increments`);
    }
    if (!clientName) return badRequest(res, 'Your name is required');
    if (!validEmail(clientEmail)) return badRequest(res, 'A valid email is required');
    if (!serviceId) return badRequest(res, 'Pick a service');

    // Verify service belongs to this workspace and duration matches.
    // Reject bookings on 'only_me' services (drafts the owner shouldn't
    // be receiving bookings for); 'private' is bookable by direct link.
    const svcRows = await sql`
      SELECT id, duration_minutes, capacity, price, deposit_type, deposit_amount,
             location_type, travel_buffer_minutes,
             custom_fields, add_ons, visibility, availability
        FROM services
       WHERE id = ${serviceId} AND workspace_id = ${workspaceId}
    `;
    if (svcRows.rows.length === 0) return badRequest(res, 'Unknown service');
    if (svcRows.rows[0].visibility === 'only_me') {
      return badRequest(res, 'This service is not available to book.');
    }
    const svc = svcRows.rows[0];
    const serviceCapacity = Math.max(1, Number(svc.capacity) || 1);
    const locationType  = svc.location_type || 'in_person';
    const travelBuffer  = Number(svc.travel_buffer_minutes || 0);

    // Add-ons: validate every requested add-on belongs to this
    // service and pull its price + duration delta. Selected add-ons
    // extend the slot duration, so the requested (end - start) must
    // equal service.duration + sum(add-on durations).
    const requestedAddOnIds = Array.isArray(body.addOnIds) ? body.addOnIds.map(String) : [];
    const availableAddOns = Array.isArray(svc.add_ons) ? svc.add_ons : [];
    const selectedAddOns = [];
    for (const id of requestedAddOnIds) {
      const found = availableAddOns.find((a) => a.id === id);
      if (!found) return badRequest(res, `Unknown add-on: ${id}`);
      selectedAddOns.push(found);
    }
    const addOnDuration = selectedAddOns.reduce((s, a) => s + Number(a.durationMinutes || 0), 0);
    const expectedDuration = svc.duration_minutes + addOnDuration;
    if ((end - start) !== expectedDuration) {
      return badRequest(res, 'Slot duration does not match service + add-ons');
    }
    const addOnTotal = selectedAddOns.reduce((s, a) => s + Number(a.price || 0), 0);
    const bookingTotal = Number(svc.price || 0) + addOnTotal;

    // Custom intake fields: validate required fields present, types ok.
    const customFields = Array.isArray(svc.custom_fields) ? svc.custom_fields : [];
    const customValues = (body.customFieldValues && typeof body.customFieldValues === 'object')
      ? body.customFieldValues : {};
    const cleanedCustomValues = {};
    for (const f of customFields) {
      const raw = customValues[f.id];
      const isEmpty = raw == null || raw === '' || (Array.isArray(raw) && raw.length === 0);
      if (f.required && isEmpty) {
        return badRequest(res, `"${f.label || f.id}" is required`);
      }
      if (isEmpty) continue;
      let val = raw;
      if (f.type === 'number') {
        const n = Number(raw);
        if (!Number.isFinite(n)) return badRequest(res, `"${f.label || f.id}" must be a number`);
        val = n;
      } else if (f.type === 'select') {
        const opts = Array.isArray(f.options) ? f.options : [];
        if (opts.length > 0 && !opts.includes(String(raw))) {
          return badRequest(res, `"${f.label || f.id}" must be one of: ${opts.join(', ')}`);
        }
        val = String(raw);
      } else if (f.type === 'checkbox') {
        val = !!raw;
      } else {
        val = String(raw).slice(0, 4000);
      }
      cleanedCustomValues[f.id] = val;
    }

    // Recompute deposit using the booking total (service + add-ons),
    // not just service.price - owners expect a 25% deposit on a $200
    // service+add-on combo to be $50, not $50 of just the service.
    let depositRequired = depositFor(svc, bookingTotal);

    // Optional gift card application. Resolved up-front (before insert)
    // so we know how much credit to apply + how much deposit remains
    // after the credit. If the credit covers the whole deposit, we
    // skip the Stripe Checkout entirely.
    const giftCardCode = body.giftCardCode ? String(body.giftCardCode) : null;
    let giftCardRow = null;
    let giftCardCreditCents = 0;
    if (giftCardCode) {
      giftCardRow = await findActiveByCode(workspaceId, giftCardCode);
      if (!giftCardRow) return badRequest(res, "That gift card code isn't valid (or has been used up).");
      // Apply the lesser of (gift card balance, booking total) - owners
      // collect the rest from the client either at the chair (no deposit
      // required) or via a reduced deposit + balance-due-at-session.
      const totalCents = Math.round(Number(bookingTotal) * 100);
      giftCardCreditCents = Math.min(Number(giftCardRow.balance_cents), totalCents);
    }
    // Reduce the deposit by the gift card credit (never below zero).
    if (giftCardCreditCents > 0) {
      const depositCents = Math.round(Number(depositRequired) * 100);
      const reducedCents = Math.max(0, depositCents - giftCardCreditCents);
      depositRequired = reducedCents / 100;
    }

    // Mobile-service address capture. Required at booking time so the
    // owner knows where to go. Saved on the client row so subsequent
    // bookings pre-fill it.
    let locationAddress = null;
    if (locationType === 'mobile') {
      locationAddress = (body.locationAddress || '').toString().trim().slice(0, 500);
      if (!locationAddress) return badRequest(res, "Please share where we should come for this service.");
    }

    // Don't allow booking in the past, and honor the workspace's minimum
    // advance-notice window (default 24h; 0 = same-day allowed). The past
    // floor applies even when notice is 0.
    //
    // `(date, start)` is in the WORKSPACE'S wall-clock time, not UTC.
    // Before this change we built slotStart as new Date(date + 'T00:00:00Z')
    // which interpreted both as UTC - fine for UTC owners, broken for
    // anyone else (PST owner setting "3pm tomorrow" got compared as if
    // the slot were 3pm UTC, only ~6h away instead of ~18h away).
    const now = new Date();
    const slotStartMs = slotEpochMs(date, start, workspaceTz);
    if (slotStartMs < now.getTime() - 60 * 1000) {
      return badRequest(res, 'That time has passed');
    }
    if (minNoticeHours > 0 && slotStartMs < now.getTime() + minNoticeHours * 3600 * 1000) {
      const noticeLabel = minNoticeHours % 24 === 0
        ? `${minNoticeHours / 24} day${minNoticeHours === 24 ? '' : 's'}`
        : `${minNoticeHours} hour${minNoticeHours === 1 ? '' : 's'}`;
      return badRequest(res, `This business requires booking at least ${noticeLabel} in advance.`);
    }
    // Booking horizon: clients can't book further out than the owner allows
    // (0 = no limit). One extra day of grace absorbs viewer/server timezone
    // skew at the edge.
    if (maxAdvanceDays > 0 && slotStartMs > now.getTime() + (maxAdvanceDays + 1) * 86400 * 1000) {
      const horizonLabel = maxAdvanceDays % 7 === 0
        ? `${maxAdvanceDays / 7} week${maxAdvanceDays === 7 ? '' : 's'}`
        : `${maxAdvanceDays} day${maxAdvanceDays === 1 ? '' : 's'}`;
      return badRequest(res, `This business only takes bookings up to ${horizonLabel} in advance.`);
    }

    // Availability + conflict check. Per-service availability narrows the
    // bookable hours (e.g. "Strength training 5–8pm only") on top of the
    // workspace general availability.
    const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
    if (!withinAvailability(availability, weekday, start, end, svc.availability || null)) {
      return badRequest(res, 'That slot is outside booking hours');
    }

    if (joinWaitlist) {
      // Insert a waitlist entry instead of a booking. Allowed even when
      // the slot is currently free - the client may want to be notified
      // if the time changes; just no-op if there's already an entry
      // from this email for the exact slot.
      const existing = await sql`
        SELECT id FROM waitlist_entries
        WHERE workspace_id = ${workspaceId}
          AND service_id = ${serviceId}
          AND date = ${date} AND start_min = ${start} AND end_min = ${end}
          AND client_email = ${clientEmail}
          AND status = 'waiting'
        LIMIT 1
      `;
      if (existing.rows.length > 0) {
        return created(res, { waitlist: { id: existing.rows[0].id, alreadyJoined: true } });
      }
      const w = await sql`
        INSERT INTO waitlist_entries (
          workspace_id, service_id, client_id,
          client_name, client_email, client_phone,
          date, start_min, end_min, notes
        ) VALUES (
          ${workspaceId}, ${serviceId}, NULL,
          ${clientName}, ${clientEmail}, ${clientPhone},
          ${date}, ${start}, ${end}, ${notes}
        )
        RETURNING id
      `;
      return created(res, { waitlist: { id: w.rows[0].id, alreadyJoined: false } });
    }

    if (await hasConflict({
      workspaceId, dateISO: date, start, end, serviceId,
      capacity: serviceCapacity, travelBufferMin: travelBuffer, bufferMin: bufferMinutes,
    })) {
      return badRequest(res, serviceCapacity > 1
        ? 'That class just filled up - please pick another time'
        : 'That slot was just taken - please pick another time');
    }

    // Attach to an existing client by email; create a lead if missing.
    // When the form provided a phone, store / refresh it on the client
    // row so future bookings + reminders pick it up by default. Same
    // for SMS consent - never silently flip to TRUE; only stamp the
    // timestamp if the form explicitly opted in.
    let clientId = null;
    const existing = await sql`
      SELECT id, phone, sms_consent_at FROM clients
      WHERE workspace_id = ${workspaceId} AND email = ${clientEmail} LIMIT 1
    `;
    if (existing.rows.length > 0) {
      const ec = existing.rows[0];
      clientId = ec.id;
      const newPhone   = clientPhone || ec.phone;
      const newConsent = smsConsent ? (ec.sms_consent_at || new Date().toISOString()) : ec.sms_consent_at;
      // Persist the address from a mobile booking onto the client row so
      // the next time they book, the field pre-fills. Falls back to the
      // existing saved address if the form didn't supply one.
      const newAddress = locationAddress || null;
      await sql`
        UPDATE clients SET
          last_seen_at   = NOW(),
          phone          = ${newPhone},
          sms_consent_at = ${newConsent},
          address        = COALESCE(${newAddress}, address)
        WHERE id = ${clientId}
      `;
    } else {
      const newClient = await sql`
        INSERT INTO clients (workspace_id, name, email, phone, sms_consent_at, address, stage, source, last_seen_at)
        VALUES (${workspaceId}, ${clientName}, ${clientEmail},
                ${clientPhone}, ${smsConsent ? new Date().toISOString() : null},
                ${locationAddress},
                'lead', 'Booking', NOW())
        RETURNING id
      `;
      clientId = newClient.rows[0].id;
      // First-time booker - email a "claim your account" invite alongside
      // the booking confirmation that notifyNewBooking sends.
      sendClientInvite({ workspaceId, clientId })
        .catch((e) => console.error('[booking] sendClientInvite failed:', e?.message));
    }

    // Mint a video room when the service is virtual. Per-booking
    // unique URL so a leaked link can't be reused for a future
    // session with a different client.
    const videoRoomUrl = locationType === 'virtual' ? mintVideoRoomUrl() : null;

    const insert = await sql`
      INSERT INTO bookings (
        workspace_id, service_id, client_id, client_name, client_email, client_phone,
        date, start_min, end_min, notes, deposit_required, location_address,
        video_room_url, custom_field_values, add_on_ids, booking_total,
        gift_card_credit_cents
      )
      VALUES (
        ${workspaceId}, ${serviceId}, ${clientId}, ${clientName}, ${clientEmail}, ${clientPhone},
        ${date}, ${start}, ${end}, ${notes}, ${depositRequired}, ${locationAddress},
        ${videoRoomUrl},
        ${JSON.stringify(cleanedCustomValues)}::jsonb,
        ${JSON.stringify(requestedAddOnIds)}::jsonb,
        ${bookingTotal},
        ${giftCardCreditCents}
      )
      RETURNING *
    `;
    const newBookingRow = insert.rows[0];

    // Optimistic double-booking resolution (see losesBookingRace). The
    // public page is the hottest self-booking path, so two visitors can
    // pass the pre-insert hasConflict() for the same slot at once. Now
    // that our row is committed, yield if enough conflicting bookings
    // rank before us. Done BEFORE the gift-card debit so a loser doesn't
    // need to be refunded - just deleted.
    if (await losesBookingRace({
      workspaceId, dateISO: date, start, end, serviceId,
      capacity: serviceCapacity, travelBufferMin: travelBuffer, bufferMin: bufferMinutes,
      bookingId: newBookingRow.id, createdAt: newBookingRow.created_at,
    }).catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[public booking] race recheck failed; keeping booking:', e.message);
      return false;
    })) {
      await sql`DELETE FROM bookings WHERE id = ${newBookingRow.id}`.catch(() => {});
      return badRequest(res, serviceCapacity > 1
        ? 'That class just filled up - please pick another time'
        : 'That slot was just taken - please pick another time');
    }

    // Atomically debit the gift card after the booking row exists. If
    // the redemption fails (race against another concurrent redemption),
    // we MUST delete the booking row - leaving it half-committed creates
    // two bad outcomes:
    //   (a) deposit_required was already reduced by giftCardCreditCents
    //       at line ~ above, so the customer would pay a lower deposit
    //       for a booking they didn't actually fund with the card;
    //   (b) the slot stays held against a client who hasn't really
    //       paid, blocking other prospects from booking it.
    // Better: tear down the booking + release the slot + tell the
    // customer to try a different code.
    if (giftCardRow && giftCardCreditCents > 0) {
      try {
        await redeemAtomic({
          giftCardId: giftCardRow.id,
          workspaceId,
          amountCents: giftCardCreditCents,
          appliedToKind: 'booking',
          appliedToId: newBookingRow.id,
          clientId,
        });
      } catch (err) {
        // Roll back the booking entirely. Best-effort - if the DELETE
        // also fails the row will be picked up by /api/cron/db-prune
        // eventually, but the slot stays held until then.
        await sql`DELETE FROM bookings WHERE id = ${newBookingRow.id}`.catch(() => {});
        return badRequest(res, 'Gift card was just used by another transaction - please try a different code.');
      }
    }
    const b = newBookingRow;

    // If a deposit is required AND the workspace has its chosen payment
    // provider connected (Stripe / Square / PayPal), mint a checkout
    // session for the deposit and return its URL so the public booker
    // can redirect the client to pay. Failures here don't block the
    // booking - the slot is held; owner can collect manually later.
    //
    // Was hardcoded to Stripe before, which silently no-op'd deposit
    // collection for Square/PayPal workspaces - clients were "confirmed"
    // without ever being asked to pay. Now routes through the provider
    // registry so all three work. The webhook handlers match the
    // returned sessionId back to the booking via bookings.deposit_
    // payment_intent (post-payment the webhook overwrites with the
    // real PI / payment id).
    let depositCheckoutUrl = null;
    if (depositRequired > 0) {
      try {
        const { adapter, name, settings } = await getProvider(workspaceId);
        // adapter.createCheckoutSession throws if the provider isn't
        // connected - swallow so the booking still completes. Owner can
        // collect the deposit manually after the fact.
        const base = appUrl();
        const depositCents = Math.round(depositRequired * 100);
        const session = await adapter.createCheckoutSession({
          workspaceId,
          settings,
          amountCents: depositCents,
          currency: (settings?.currency || 'usd').toUpperCase(),
          description: `Deposit · ${b.id.slice(0, 8)}`,
          // invoice_id sentinel `bookdep_<bookingId>` is recognized by
          // the webhook apply paths (stripe + square + paypal) to flip
          // bookings.deposit_paid instead of marking an invoice paid.
          metadata: { invoice_id: `bookdep_${b.id}`, booking_id: b.id, workspace_id: workspaceId },
          successUrl: `${base}/book/${encodeURIComponent(slug)}?deposit=paid`,
          cancelUrl:  `${base}/book/${encodeURIComponent(slug)}?deposit=cancelled`,
          customerEmail: clientEmail,
        });
        depositCheckoutUrl = session.url;
        await sql`
          UPDATE bookings SET deposit_payment_intent = ${session.sessionId}
          WHERE id = ${b.id}
        `;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[deposit] checkout session failed (provider connected?):`, err.message);
      }
    }
    // Side effects (thread + emails). Don't await - the public booker
    // should see "confirmed!" without waiting on Resend round-trips. Each is
    // .catch'd: an unhandled rejection here can crash the serverless function
    // (the response is already sent) and take down concurrent requests.
    notifyNewBooking({ workspaceId, bookingId: b.id, source: 'public' })
      .catch((e) => console.error('[booking] notifyNewBooking failed:', e?.message));
    syncOnBookingCreated({ workspaceId: b.workspace_id, bookingId: b.id })
      .catch((e) => console.error('[booking] syncOnBookingCreated failed:', e?.message));
    attachIntakeForms({ workspaceId, bookingId: b.id })
      .catch((e) => console.error('[booking] attachIntakeForms failed:', e?.message));
    return created(res, {
      booking: {
        id: b.id,
        date: b.date instanceof Date ? b.date.toISOString().slice(0, 10) : b.date,
        startMin: b.start_min,
        endMin: b.end_min,
        videoRoomUrl: b.video_room_url || null,
        bookingTotal: Number(b.booking_total || 0),
        locationType,
        depositRequired,
      },
      depositCheckoutUrl,
    });
  } catch (err) {
    return serverError(res, err);
  }
}
