// /book/:slug - public booking page. Reads sanitized state from /api/calendar/public/:slug,
// posts to /api/calendar/public/:slug/book to confirm.
//
// Also rendered as /embed/book/:slug with embedded=true. In embed mode
// we shrink chrome (no marketing header, no reviews block, no
// memberships banner), use transparent background, and post our
// rendered height to the parent window for iframe auto-sizing.
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Icons } from '../../components/Icons.jsx';
import EmptyNote from '../../components/EmptyNote.jsx';
import { api } from '../../lib/api.js';
import { useTweaks } from '../../lib/tweaks.js';
import { useEmbedResize } from '../../lib/embedResize.js';
import { tzDisplay } from '../../lib/timezones.js';
import { haptic } from '../../lib/celebrate.js';
import {
  addDays, fmtDateISO, minToHM, parseISO, slotsForDate, startOfToday, WEEKDAYS_SHORT,
} from './utils.js';

export default function PublicBooking({ embedded = false }) {
  const { slug } = useParams();
  const [tweaks] = useTweaks();
  // Auto-resize the iframe when running inside the embed route. No-op
  // when the page is loaded standalone (the hook checks window.parent).
  useEmbedResize(slug);
  const [cal, setCal] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [loading, setLoading] = useState(true);

  const [serviceId, setServiceId] = useState(null);
  // Anchor the day strip on TODAY (never a past day). Past days are
  // omitted entirely; the strip rolls forward from today up to the
  // owner's booking horizon.
  const [weekAnchor, setWeekAnchor] = useState(() => startOfToday());
  const [slot, setSlot] = useState(null);
  const [step, setStep] = useState('pick');     // 'pick' | 'details' | 'confirmed' | 'waitlisted'
  // True when the user picked a fully-booked day card. Switches the
  // details step's primary button from "Confirm booking" to "Join the
  // waitlist" so we skip the failed-book → error → waitlist double tap.
  const [waitlistMode, setWaitlistMode] = useState(false);
  const [name, setName]   = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [smsOptIn, setSmsOptIn] = useState(false);
  // Selected add-ons (set of add-on ids) and custom-field answers
  // (id → value). Reset whenever the chosen service changes so a
  // visitor doesn't carry stale picks across services.
  const [selectedAddOns, setSelectedAddOns] = useState(new Set());
  const [customAnswers, setCustomAnswers]   = useState({});
  const [busy, setBusy]   = useState(false);
  const [bookErr, setBookErr] = useState(null);
  // Video room URL returned from the confirmed booking response. Shown
  // on the success screen for virtual services.
  const [confirmedVideoUrl, setConfirmedVideoUrl] = useState(null);
  // After a deposit checkout redirect (?deposit=paid|cancelled) we land back
  // here on a FRESH page load with no slot/email in memory. Show a standalone
  // thank-you (paid) or a reassuring note (cancelled) instead of dumping the
  // visitor back on the empty booking form - the old dead-end.
  const [depositNotice, setDepositNotice] = useState(null); // 'paid' | 'cancelled' | null
  // Same pattern for the OTHER checkout returns that land back on this
  // page. Without these, someone who just paid $50-$500 got the plain
  // booking form with zero acknowledgment.
  const [paymentNotice, setPaymentNotice] = useState(null); // 'giftcard' | 'package' | 'membership' | null
  // Deposit was required but no checkout could be minted (provider not
  // connected / mint failed server-side). The confirmed screen must say
  // the deposit is still owed instead of a clean "You're booked."
  const [depositPending, setDepositPending] = useState(0);
  // Days the visitor expanded to see every available time (default shows the
  // first 8 so a busy day doesn't run the column off-screen). Keyed by ISO date.
  const [expandedDays, setExpandedDays] = useState(() => new Set());

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const d = params.get('deposit');
    let dirty = false;
    if (d === 'paid' || d === 'cancelled') {
      setDepositNotice(d);
      if (d === 'paid') setStep('deposit-paid');
      params.delete('deposit');
      dirty = true;
    }
    // Checkout returns from the non-booking purchases sold on this page.
    if (params.get('giftcard') === 'ok')          { setPaymentNotice('giftcard');   params.delete('giftcard');   dirty = true; }
    if (params.get('package') === 'purchased')    { setPaymentNotice('package');    params.delete('package');    dirty = true; }
    if (params.get('membership') === 'joined')    { setPaymentNotice('membership'); params.delete('membership'); dirty = true; }
    if (!dirty) return;
    // Strip the params so a refresh doesn't re-trigger the notice.
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }, []);

  // "Have a question?" prospect-message modal state. Lets a visitor
  // talk to the business before committing to a slot.
  const [contactOpen, setContactOpen] = useState(false);
  // Membership subscribe modal - separate from the booking flow.
  const [joiningMembership, setJoiningMembership] = useState(null);
  const [buyingPackage, setBuyingPackage] = useState(null);
  const [buyingProgram, setBuyingProgram] = useState(null);
  // Gift card buy modal.
  const [giftCardOpen, setGiftCardOpen] = useState(false);
  // Gift card application at checkout.
  const [giftCardCode, setGiftCardCode] = useState('');
  const [giftCardChecked, setGiftCardChecked] = useState(null);
  const [giftCardErr, setGiftCardErr] = useState(null);

  useEffect(() => {
    let live = true;
    api.get('/calendar/public/' + encodeURIComponent(slug))
      .then((r) => {
        if (!live) return;
        setCal(r.calendar);
        setServiceId(r.calendar.services[0]?.id || null);
        document.title = (r.calendar.settings.bizName || slug) + ' · Book';
      })
      .catch((e) => live && setLoadErr(e))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [slug]);

  // SEO: structured data + Open Graph / Twitter card meta. Injected
  // dynamically because we're a SPA - Vite ships a single index.html.
  // Crawlers that execute JS (Google, Bing, Twitterbot, Slackbot,
  // Facebook's link previewer) all see these tags and use the
  // aggregateRating + reviews block to render rich snippets in the SERP.
  useEffect(() => {
    if (!cal) return;
    const cleanups = [];

    const upsertMeta = (attr, key, value) => {
      let el = document.querySelector(`meta[${attr}="${key}"]`);
      const created = !el;
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      const prev = el.getAttribute('content');
      el.setAttribute('content', value);
      cleanups.push(() => {
        if (created) el.remove();
        else if (prev != null) el.setAttribute('content', prev);
      });
    };

    const biz = cal.settings.bizName || slug;
    const tagline = cal.settings.tagline || `Book a session with ${biz} on Ivy.`;
    const url = window.location.href;
    upsertMeta('name', 'description', tagline);
    upsertMeta('property', 'og:title', biz);
    upsertMeta('property', 'og:description', tagline);
    upsertMeta('property', 'og:type', 'website');
    upsertMeta('property', 'og:url', url);
    upsertMeta('name', 'twitter:card', 'summary');
    upsertMeta('name', 'twitter:title', biz);
    upsertMeta('name', 'twitter:description', tagline);

    // JSON-LD: LocalBusiness + aggregateRating + recent Review nodes.
    // Schema.org-compliant; Google uses this to render stars + count
    // beside the SERP listing once the domain has search history.
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name: biz,
      url,
      description: tagline,
    };
    if (cal.reviews?.count > 0 && cal.reviews?.avg) {
      jsonLd.aggregateRating = {
        '@type': 'AggregateRating',
        ratingValue: cal.reviews.avg,
        reviewCount: cal.reviews.count,
        bestRating: 5,
        worstRating: 1,
      };
    }
    if (cal.reviews?.recent?.length) {
      jsonLd.review = cal.reviews.recent.slice(0, 5).map((r) => ({
        '@type': 'Review',
        reviewRating: { '@type': 'Rating', ratingValue: r.rating, bestRating: 5 },
        author: { '@type': 'Person', name: r.reviewerName },
        datePublished: r.createdAt,
        ...(r.text ? { reviewBody: r.text } : {}),
      }));
    }
    if (cal.services?.length) {
      jsonLd.makesOffer = cal.services.slice(0, 20).map((s) => ({
        '@type': 'Offer',
        name: s.name,
        ...(typeof s.price === 'number' && s.price > 0
          ? { price: s.price, priceCurrency: 'USD' } : {}),
      }));
    }
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(jsonLd);
    document.head.appendChild(script);
    cleanups.push(() => script.remove());

    return () => { cleanups.forEach((fn) => fn()); };
  }, [cal, slug]);

  if (loading) {
    return (
      <PageWrap tweaks={tweaks}>
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
      </PageWrap>
    );
  }

  if (loadErr || !cal) {
    const status = loadErr?.status;
    const title  = status === 404
      ? "Booking page not found"
      : status >= 500
        ? "Booking page is having trouble"
        : "Couldn't load this booking page";
    const hint = status === 404
      ? `No public calendar for "${slug}". The owner may not have published their handle yet.`
      : (loadErr?.message || `Status ${status || 'unknown'}.`);
    return (
      <PageWrap tweaks={tweaks}>
        <div className="card" style={{ padding: 36 }}>
          <EmptyNote icon="Calendar" title={title} hint={hint}/>
          {status >= 500 && loadErr?.message && (
            <div style={{
              marginTop: 14, padding: 10, borderRadius: 8,
              background: 'var(--surface-2)', border: '1px solid var(--border)',
              fontSize: 11, color: 'var(--muted)', fontFamily: 'ui-monospace, monospace',
            }}>
              {loadErr.message}
            </div>
          )}
        </div>
      </PageWrap>
    );
  }

  const svc = cal.services.find((s) => s.id === serviceId);
  // Day strip: 7-day pages that start at TODAY and never include past days.
  // The owner's booking horizon (maxAdvanceDays; 0 = no limit) caps how far
  // forward a visitor can page, and trims the final page so no out-of-range
  // day is offered.
  const today = startOfToday();
  const maxAdvanceDays = Math.max(0, Number(cal.settings?.maxAdvanceDays ?? 60));
  const horizon = maxAdvanceDays > 0 ? addDays(today, maxAdvanceDays) : null;
  const anchor = weekAnchor < today ? today : weekAnchor;
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(anchor, i))
    .filter((d) => d >= today && (!horizon || d <= horizon));
  const canGoBack = anchor > today;
  const canGoForward = horizon ? addDays(anchor, 7) <= horizon : true;
  const firstShown = weekDays[0] || today;
  const lastShown = weekDays[weekDays.length - 1] || today;

  const book = async (joinWaitlist = false) => {
    if (!slot || !svc) return;
    setBusy(true);
    setBookErr(null);
    try {
      // Same URL as the GET; method is POST. Avoids a sibling [slug]/ dir
      // that would conflict with [slug].js in Vercel's function bundling.
      // Compute the slot's effective end-time given selected add-ons
      // (each adds its durationMinutes). Server re-checks; this is for
      // the request payload + slot conflict math.
      const addOnDurDelta = (svc?.addOns || [])
        .filter((a) => selectedAddOns.has(a.id))
        .reduce((s, a) => s + Number(a.durationMinutes || 0), 0);
      const effectiveEnd = slot.start + (svc?.durationMinutes || 0) + addOnDurDelta;

      const r = await api.post('/calendar/public/' + encodeURIComponent(slug), {
        serviceId: svc.id,
        date: slot.dateISO,
        startMin: slot.start,
        endMin: effectiveEnd,
        clientName: name,
        clientEmail: email,
        clientPhone: phone.trim() || null,
        // Mobile services need an address - only forwarded when the
        // service is mobile so the server can validate it's there.
        locationAddress: svc?.locationType === 'mobile' ? address.trim() : null,
        addOnIds: Array.from(selectedAddOns),
        customFieldValues: customAnswers,
        // Optional gift card application at booking time.
        giftCardCode: giftCardChecked ? giftCardCode : null,
        smsConsent: !!(smsOptIn && phone.trim()),
        joinWaitlist,
      });
      // If the service requires a deposit AND the workspace has Stripe
      // connected, the server returned a Checkout URL - redirect there.
      // The slot is already held by the booking, so a cancelled deposit
      // payment doesn't release it (owner can still chase the deposit).
      if (r.depositCheckoutUrl) {
        window.location.href = r.depositCheckoutUrl;
        return;
      }
      if (Number(r.booking?.depositRequired) > 0) {
        setDepositPending(Number(r.booking.depositRequired));
      }
      if (r.booking?.videoRoomUrl) setConfirmedVideoUrl(r.booking.videoRoomUrl);
      setStep(joinWaitlist ? 'waitlisted' : 'confirmed');
      haptic(); // a little "done!" tap on the client's phone
    } catch (e) {
      setBookErr(e.message || 'Could not confirm - try another slot.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageWrap tweaks={tweaks} embedded={embedded} accentColor={cal.settings.brandAccentColor}>
      {!embedded && (
        <Header bizName={cal.settings.bizName} tagline={cal.settings.tagline} logoUrl={cal.settings.brandLogoUrl}/>
      )}

      {/* Deposit checkout was cancelled - reassure the visitor their slot
          is still held so they don't think they lost it, and let them try
          the deposit again from the booking flow. */}
      {depositNotice === 'cancelled' && step === 'pick' && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 10,
          padding: '11px 14px', borderRadius: 10, marginBottom: 14,
          background: 'var(--surface-2)', border: '1px solid var(--border)',
          fontSize: 13, color: 'var(--fg-2)', lineHeight: 1.5,
        }}>
          <Icons.Clock size={15} stroke="var(--accent)"/>
          <span style={{ flex: 1, minWidth: 0 }}>
            Your deposit payment was cancelled, but your spot is still reserved.
            {' '}{cal.settings.bizName || 'The business'} will follow up about the deposit.
          </span>
          <button type="button" onClick={() => setDepositNotice(null)}
            aria-label="Dismiss" className="btn btn-ghost" style={{ padding: 2, color: 'var(--muted)' }}>
            <Icons.X size={13}/>
          </button>
        </div>
      )}

      {/* Post-payment acknowledgment for the page's other purchases
          (gift card / package / membership) - the buyer just handed over
          real money and must see it registered. */}
      {paymentNotice && step === 'pick' && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 10,
          padding: '11px 14px', borderRadius: 10, marginBottom: 14,
          background: 'color-mix(in srgb, var(--ok) 10%, var(--surface))',
          border: '1px solid color-mix(in srgb, var(--ok) 40%, var(--border))',
          fontSize: 13, color: 'var(--fg-2)', lineHeight: 1.5,
        }}>
          <Icons.Check size={15} stroke="var(--ok)"/>
          <span style={{ flex: 1, minWidth: 0 }}>
            {paymentNotice === 'giftcard' && <>Payment received - the gift card is on its way to the recipient's inbox (check spam if it doesn't arrive in a few minutes).</>}
            {paymentNotice === 'package' && <>Payment received - your package credits are ready. Book below, or sign in to your client portal to use them.</>}
            {paymentNotice === 'membership' && <>You're in! Your membership is active - a confirmation email is on its way.</>}
          </span>
          <button type="button" onClick={() => setPaymentNotice(null)}
            aria-label="Dismiss" className="btn btn-ghost" style={{ padding: 2, color: 'var(--muted)' }}>
            <Icons.X size={13}/>
          </button>
        </div>
      )}

      {/* "Have a question?" CTA - pinned just under the header on the
          slot picker step. We hide it on the success/confirmed/details
          steps to avoid distracting from the active booking flow.
          Also hidden in embed mode - the embed is meant for one job
          (booking); the contact form has its own embed. */}
      {step === 'pick' && !embedded && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          padding: '10px 14px', borderRadius: 10, marginBottom: 14,
          background: 'var(--surface-2)', border: '1px solid var(--border)',
          fontSize: 13, color: 'var(--fg-2)',
        }}>
          <Icons.Chat size={14} stroke="var(--accent)"/>
          <span style={{ flex: 1, minWidth: 200 }}>
            Have a question before booking? Send {cal.settings.bizName || 'them'} a message.
          </span>
          <button onClick={() => setContactOpen(true)}
            className="btn btn-outline" style={{ fontSize: 12.5, padding: '6px 12px' }}>
            Message us
          </button>
        </div>
      )}

      {contactOpen && (
        <ContactModal
          slug={slug}
          bizName={cal.settings.bizName}
          onClose={() => setContactOpen(false)}
        />
      )}

      {/* Memberships card - only when the business has at least one
          active tier with a Stripe price. Visitors click a tier to
          open the join modal. Hidden in embed mode to keep the widget
          focused on the booking flow. */}
      {step === 'pick' && cal.memberships?.length > 0 && !embedded && (
        <MembershipsBlock
          memberships={cal.memberships}
          bizName={cal.settings.bizName}
          onJoin={(m) => setJoiningMembership(m)}
        />
      )}

      {/* Packages card - bundles of sessions sold up-front. Same
          gating as memberships (hidden in embed). Clicking a card
          opens the purchase modal which POSTs to /api/packages/checkout. */}
      {step === 'pick' && cal.packages?.length > 0 && !embedded && (
        <PackagesBlock
          packages={cal.packages}
          services={cal.services}
          bizName={cal.settings.bizName}
          onBuy={(p) => setBuyingPackage(p)}
        />
      )}

      {/* Programs - courses, plans and paid communities. Checkout is
          /api/programs/checkout; access is granted by the Stripe webhook. */}
      {step === 'pick' && cal.programs?.length > 0 && !embedded && (
        <ProgramsBlock programs={cal.programs} bizName={cal.settings.bizName} onBuy={(p) => setBuyingProgram(p)}/>
      )}

      {/* Gift card CTA - same step as the slot picker so it doesn't
          get in the way of someone who's actively trying to book. */}
      {step === 'pick' && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          padding: '10px 14px', borderRadius: 10, marginTop: 14,
          background: 'var(--surface-2)', border: '1px solid var(--border)',
          fontSize: 13, color: 'var(--fg-2)',
        }}>
          <Icons.Gift size={14} stroke="var(--accent)"/>
          <span style={{ flex: 1, minWidth: 200 }}>
            Send a gift card to a friend - they'll get it in their inbox right away.
          </span>
          <button onClick={() => setGiftCardOpen(true)}
            className="btn btn-outline" style={{ fontSize: 12.5, padding: '6px 12px' }}>
            Buy a gift card
          </button>
        </div>
      )}

      {giftCardOpen && (
        <BuyGiftCardModal
          slug={slug}
          bizName={cal.settings.bizName}
          onClose={() => setGiftCardOpen(false)}
        />
      )}

      {buyingProgram && (
        <ProgramBuyModal program={buyingProgram} bizName={cal.settings.bizName} onClose={() => setBuyingProgram(null)}/>
      )}
      {buyingPackage && (
        <BuyPackageModal
          slug={slug}
          pkg={buyingPackage}
          bizName={cal.settings.bizName}
          onClose={() => setBuyingPackage(null)}
        />
      )}

      {joiningMembership && (
        <JoinMembershipModal
          slug={slug}
          membership={joiningMembership}
          bizName={cal.settings.bizName}
          onClose={() => setJoiningMembership(null)}
        />
      )}

      {step === 'waitlisted' ? (
        <div className="card" style={{ padding: 36 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: 56, height: 56, borderRadius: 99, background: 'var(--accent)', color: 'var(--accent-ink)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
            }}><Icons.Clock size={26} sw={2.4}/></div>
            <h2 className="page-title" style={{ fontSize: 24, margin: '0 0 8px' }}>You're on the list.</h2>
            <p style={{ color: 'var(--muted)', fontSize: 14, margin: 0, lineHeight: 1.5 }}>
              We'll email <b style={{ color: 'var(--fg-2)' }}>{email}</b>
              {' '}the moment a spot opens up for{' '}
              <b style={{ color: 'var(--fg-2)' }}>
                {parseISO(slot.dateISO).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </b>{' '}at <b style={{ color: 'var(--fg-2)' }}>{minToHM(slot.start)}</b>.
              You'll be auto-booked - no action needed on your end.
            </p>
          </div>
        </div>
      ) : step === 'confirmed' ? (
        <div className="card" style={{ padding: 36 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: 56, height: 56, borderRadius: 99, background: 'var(--ok)', color: '#fff',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
            }}><Icons.Check size={26} sw={2.4}/></div>
            <h2 className="page-title" style={{ fontSize: 24, margin: '0 0 8px' }}>You're booked.</h2>
            <p style={{ color: 'var(--muted)', fontSize: 14, margin: 0, lineHeight: 1.5 }}>
              A confirmation is on its way to <b style={{ color: 'var(--fg-2)' }}>{email}</b>. See you on{' '}
              <b style={{ color: 'var(--fg-2)' }}>
                {parseISO(slot.dateISO).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </b>{' '}at <b style={{ color: 'var(--fg-2)' }}>{minToHM(slot.start)}</b>.
            </p>
            {depositPending > 0 && (
              <p style={{
                marginTop: 14, padding: '10px 14px', borderRadius: 10, fontSize: 13,
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                color: 'var(--fg-2)', lineHeight: 1.55, textAlign: 'left',
              }}>
                One more thing: a <b>${depositPending.toFixed(2)} deposit</b> is due for this
                booking. Online payment isn't set up yet, so {cal.settings.bizName || 'the business'} will
                follow up with you about it directly.
              </p>
            )}
          </div>
          {confirmedVideoUrl && (
            <div style={{
              marginTop: 24, padding: 18,
              background: 'color-mix(in srgb, var(--accent-soft) 60%, var(--surface))',
              border: '1px solid var(--accent)', borderRadius: 12,
            }}>
              <div className="metric-label" style={{ marginBottom: 6, color: 'var(--accent)' }}>
                Your meeting link
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--fg-2)', marginBottom: 10, lineHeight: 1.5 }}>
                Save this - it's also in the confirmation email. Open it at the start of your session.
              </div>
              <a href={confirmedVideoUrl} target="_blank" rel="noopener noreferrer"
                className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Icons.Globe size={13}/> Join meeting
              </a>
              <div style={{
                marginTop: 10, padding: '8px 10px', borderRadius: 8,
                background: 'var(--surface)', border: '1px solid var(--border)',
                fontSize: 11.5, color: 'var(--muted)', wordBreak: 'break-all',
              }}>{confirmedVideoUrl}</div>
            </div>
          )}
          {svc?.prepInstructions && (
            <div style={{
              marginTop: 28, padding: 18,
              background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 12,
            }}>
              <div className="metric-label" style={{ marginBottom: 8 }}>Before your appointment</div>
              <div style={{ fontSize: 13, color: 'var(--fg-2)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {svc.prepInstructions}
              </div>
            </div>
          )}
        </div>
      ) : step === 'deposit-paid' ? (
        <div className="card" style={{ padding: 36 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: 56, height: 56, borderRadius: 99, background: 'var(--ok)', color: '#fff',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
            }}><Icons.Check size={26} sw={2.4}/></div>
            <h2 className="page-title" style={{ fontSize: 24, margin: '0 0 8px' }}>Deposit received - you're all set.</h2>
            <p style={{ color: 'var(--muted)', fontSize: 14, margin: 0, lineHeight: 1.5 }}>
              Thank you! Your spot with <b style={{ color: 'var(--fg-2)' }}>{cal?.settings?.bizName || 'us'}</b> is
              confirmed and your deposit is paid. A confirmation email with all the details is on its way.
            </p>
          </div>
        </div>
      ) : step === 'details' ? (
        <div className="card" style={{ padding: 28 }}>
          <div className="metric-label" style={{ marginBottom: 4 }}>
            {waitlistMode ? 'Join waitlist' : 'Confirm'}
          </div>
          <div style={{ fontSize: 17, fontWeight: 600, marginBottom: waitlistMode ? 8 : 18 }}>
            {svc?.name} · {parseISO(slot.dateISO).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            {!waitlistMode && <> · {minToHM(slot.start)}</>}
          </div>
          {waitlistMode && (
            <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--fg-2)', lineHeight: 1.55 }}>
              Every slot for this day is booked. Drop your details and we'll
              auto-book you the moment a spot opens up - no action needed
              on your end.
            </p>
          )}
          <Field label="Your name">
            <input value={name} onChange={(e) => setName(e.target.value)} style={inputSty} placeholder="Ana Beltrán"/>
          </Field>
          <Field label="Email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputSty} placeholder="you@email.com"/>
          </Field>
          <Field label="Mobile" hint="Optional - needed if you'd like text reminders.">
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              style={inputSty} placeholder="(555) 123-4567" autoComplete="tel"/>
          </Field>
          {/* Mobile-service address. Only required when the chosen
              service is delivered at the client's location. */}
          {svc?.locationType === 'mobile' && (
            <Field label="Where should we come?" hint="Street address, city, ZIP. Apartment / suite + parking notes if relevant.">
              <textarea value={address} onChange={(e) => setAddress(e.target.value)}
                rows={2}
                placeholder="123 Main St, Apt 4B, Brooklyn NY 11201"
                style={{ ...inputSty, fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.45 }}
                autoComplete="street-address"/>
            </Field>
          )}

          {/* Add-ons. Listed as checkboxes; each shows price + any
              extra duration so the visitor sees what they're agreeing
              to. Total updates inline. */}
          {svc?.addOns?.length > 0 && (
            <Field label="Add anything?" hint="Optional extras, charged with the service.">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {svc.addOns.map((a) => {
                  const checked = selectedAddOns.has(a.id);
                  return (
                    <label key={a.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                      borderRadius: 10, cursor: 'pointer',
                      background: checked ? 'var(--accent-soft)' : 'var(--surface-2)',
                      border: `1px solid ${checked ? 'var(--accent)' : 'var(--border)'}`,
                    }}>
                      <input type="checkbox" checked={checked}
                        onChange={(e) => {
                          setSelectedAddOns((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(a.id); else next.delete(a.id);
                            return next;
                          });
                        }}/>
                      <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{a.name}</span>
                      <span style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>
                        +${Number(a.price).toFixed(2)}
                        {Number(a.durationMinutes) > 0 && ` · +${a.durationMinutes}min`}
                      </span>
                    </label>
                  );
                })}
              </div>
            </Field>
          )}

          {/* Gift card apply: visitors paste a code, we ping the
              public check endpoint to confirm balance. The applied
              card is forwarded with the booking POST and atomically
              redeemed server-side so concurrent uses can't overspend. */}
          <Field label="Gift card (optional)"
            hint={giftCardChecked
              ? `Balance available: $${(giftCardChecked.balanceCents / 100).toFixed(2)}. We'll redeem up to your booking total from this card the moment you book.`
              : 'Paste a gift card code to apply credit.'}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={giftCardCode}
                onChange={(e) => { setGiftCardCode(e.target.value); setGiftCardChecked(null); setGiftCardErr(null); }}
                placeholder="ABCD-1234-EFGH"
                disabled={!!giftCardChecked}
                style={{
                  ...inputSty,
                  fontFamily: 'ui-monospace, monospace',
                  textTransform: 'uppercase',
                  opacity: giftCardChecked ? 0.6 : 1,
                }}/>
              {giftCardChecked ? (
                <button type="button" className="btn btn-outline"
                  onClick={() => { setGiftCardChecked(null); setGiftCardCode(''); }}
                  style={{ fontSize: 12 }}>
                  Remove
                </button>
              ) : (
                <button type="button" className="btn btn-outline"
                  disabled={!giftCardCode.trim()}
                  style={{ fontSize: 12 }}
                  onClick={async () => {
                    setGiftCardErr(null);
                    try {
                      const res = await fetch('/api/gift-cards/check', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ slug, code: giftCardCode.trim() }),
                      });
                      const j = await res.json().catch(() => ({}));
                      if (!res.ok) throw new Error(j.error || 'Invalid code');
                      setGiftCardChecked(j.card);
                    } catch (ex) {
                      setGiftCardErr(ex.message || 'Could not check that code');
                    }
                  }}>
                  Apply
                </button>
              )}
            </div>
            {giftCardErr && (
              <div style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 6 }}>{giftCardErr}</div>
            )}
          </Field>

          {/* Custom intake fields. Required ones block submit; types
              determine the input shape. */}
          {svc?.customFields?.length > 0 && (
            <>
              {svc.customFields.map((f) => (
                <Field key={f.id} label={f.label + (f.required ? ' *' : '')}>
                  {f.type === 'textarea' ? (
                    <textarea value={customAnswers[f.id] || ''}
                      onChange={(e) => setCustomAnswers((m) => ({ ...m, [f.id]: e.target.value }))}
                      rows={3} required={f.required}
                      style={{ ...inputSty, fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.45 }}/>
                  ) : f.type === 'number' ? (
                    <input type="number" value={customAnswers[f.id] || ''}
                      onChange={(e) => setCustomAnswers((m) => ({ ...m, [f.id]: e.target.value }))}
                      required={f.required} style={inputSty}/>
                  ) : f.type === 'select' ? (
                    <select value={customAnswers[f.id] || ''}
                      onChange={(e) => setCustomAnswers((m) => ({ ...m, [f.id]: e.target.value }))}
                      required={f.required} style={inputSty}>
                      <option value="">- Choose -</option>
                      {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : f.type === 'checkbox' ? (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--fg-2)' }}>
                      <input type="checkbox" checked={!!customAnswers[f.id]}
                        onChange={(e) => setCustomAnswers((m) => ({ ...m, [f.id]: e.target.checked }))}/>
                      Yes
                    </label>
                  ) : (
                    <input value={customAnswers[f.id] || ''}
                      onChange={(e) => setCustomAnswers((m) => ({ ...m, [f.id]: e.target.value }))}
                      required={f.required} style={inputSty}/>
                  )}
                </Field>
              ))}
            </>
          )}
          <div style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
            Already have a package or membership with {cal.settings.bizName || 'this business'}?{' '}
            <a href="/signin?next=/me" style={{ color: 'var(--accent)', fontWeight: 600 }}>Sign in</a>{' '}
            to book with your credits instead.
          </div>
          {phone.trim() && (
            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14,
              fontSize: 12.5, color: 'var(--fg-2)', lineHeight: 1.5, cursor: 'pointer',
            }}>
              <input type="checkbox" checked={smsOptIn}
                onChange={(e) => setSmsOptIn(e.target.checked)}
                style={{ marginTop: 3 }}/>
              <span>
                Text me reminders about this booking. Standard messaging rates may apply;
                reply STOP at any time to opt out.
              </span>
            </label>
          )}
          {/* Money summary BEFORE the commit button - nobody should tap
              "Confirm booking" without seeing the total, what their gift
              card covers, and exactly what happens next payment-wise. */}
          {!waitlistMode && (() => {
            const addOnTotal = (svc?.addOns || [])
              .filter((a) => selectedAddOns.has(a.id))
              .reduce((sum, a) => sum + Number(a.price || 0), 0);
            const total = Number(svc?.price || 0) + addOnTotal;
            if (total <= 0) return null;
            const giftApplied = giftCardChecked
              ? Math.min(Number(giftCardChecked.balanceCents || 0) / 100, total) : 0;
            let deposit = 0;
            if (svc?.depositType === 'percent') deposit = total * Number(svc.depositAmount || 0) / 100;
            else if (svc?.depositType === 'fixed') deposit = Math.min(Number(svc.depositAmount || 0), total);
            const depositDue = Math.max(0, Math.round((deposit - giftApplied) * 100) / 100);
            const row = { display: 'flex', justifyContent: 'space-between', gap: 12 };
            return (
              <div style={{
                marginBottom: 14, padding: '12px 14px', borderRadius: 10,
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                fontSize: 13, lineHeight: 1.7,
              }}>
                <div style={row}><span>{svc.name}{addOnTotal > 0 ? ' + add-ons' : ''}</span><b>${total.toFixed(2)}</b></div>
                {giftApplied > 0 && (
                  <div style={{ ...row, color: 'var(--ok)' }}>
                    <span>Gift card (applied when you book)</span><b>-${giftApplied.toFixed(2)}</b>
                  </div>
                )}
                <div style={{ ...row, borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 4 }}>
                  <span>Due now</span>
                  <b>{depositDue > 0 ? `$${depositDue.toFixed(2)} deposit` : '$0.00'}</b>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                  {depositDue > 0
                    ? "You'll be taken to a secure payment page after confirming. The rest is due at your appointment."
                    : giftApplied >= total
                      ? 'Fully covered by your gift card - nothing due at your appointment.'
                      : 'Nothing due now - pay at your appointment.'}
                </div>
              </div>
            );
          })()}
          {bookErr && (
            <div style={{
              padding: '8px 12px', borderRadius: 8,
              background: 'rgba(155,44,44,0.08)', border: '1px solid rgba(155,44,44,0.25)',
              color: 'var(--danger)', fontSize: 12.5, marginBottom: 14,
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            }}>
              <span style={{ flex: 1 }}>{bookErr}</span>
              {/* If the failure was a full / taken slot, offer to queue
                  instead of forcing the client to pick another time. */}
              {/full|taken|just/i.test(bookErr) && (
                <button onClick={() => book(true)} disabled={busy}
                  className="btn btn-outline" style={{ fontSize: 12 }}>
                  {busy ? '…' : 'Join the waitlist'}
                </button>
              )}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-outline" style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => { setWaitlistMode(false); setStep('pick'); }}>
              ← Back
            </button>
            <button className="btn btn-primary" style={{ flex: 2, justifyContent: 'center', opacity: busy ? 0.6 : 1 }}
              disabled={!name.trim() || !email.trim() || busy} onClick={() => book(waitlistMode)}>
              {busy
                ? (waitlistMode ? 'Joining…' : 'Confirming…')
                : (waitlistMode ? 'Join the waitlist' : 'Confirm booking')}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Service picker */}
          <div className="card" style={{ padding: 18, marginBottom: 18 }}>
            <div className="metric-label" style={{ marginBottom: 12 }}>Choose a service</div>
            {cal.services.length === 0 ? (
              cal.businessType === 'product' ? (
                <div style={{ padding: 16, textAlign: 'center' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                    This business doesn't take appointments.
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.55 }}>
                    They sell products - visit their shop to see what's in stock.
                  </div>
                  {cal.websiteHandle && (
                    <a className="btn btn-primary" href={`/site/${encodeURIComponent(cal.websiteHandle)}`}
                      style={{ display: 'inline-block', padding: '10px 18px' }}>
                      Visit shop →
                    </a>
                  )}
                </div>
              ) : (
                <div style={{ color: 'var(--muted)', fontSize: 13, padding: 12 }}>
                  This business hasn't published any services yet.
                  {cal.websiteHandle && (
                    <> <a href={`/site/${encodeURIComponent(cal.websiteHandle)}`} style={{ color: 'var(--accent)' }}>
                      Visit their site →
                    </a></>
                  )}
                </div>
              )
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))', gap: 10 }}>
                {cal.services.map((s) => {
                  const selected = serviceId === s.id;
                  return (
                    <button key={s.id} onClick={() => {
                      setServiceId(s.id);
                      // Reset per-service state - picks shouldn't carry
                      // across services.
                      setSelectedAddOns(new Set());
                      setCustomAnswers({});
                    }} style={{
                      padding: 0, borderRadius: 12, textAlign: 'left', cursor: 'pointer',
                      background: selected ? 'var(--accent-soft)' : 'var(--surface-2)',
                      border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                      overflow: 'hidden',
                      display: 'flex', flexDirection: 'column',
                    }}>
                      {s.photoUrl ? (
                        <div style={{
                          height: 90, background: `url(${s.photoUrl}) center/cover`,
                          borderBottom: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                        }}/>
                      ) : null}
                      <div style={{ padding: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontWeight: 600, fontSize: 13, color: selected ? 'var(--accent)' : 'var(--fg)', flex: 1 }}>{s.name}</span>
                          {s.capacity > 1 && (
                            <span style={{
                              padding: '1px 7px', borderRadius: 99,
                              fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                              background: 'var(--accent-soft)', color: 'var(--accent)',
                            }}>Group · {s.capacity}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                          {s.durationMinutes} min · ${Number(s.price).toLocaleString()}
                        </div>
                        {/* Location-type chip: tells visitors up-front whether
                            this service comes to them, happens at the owner's
                            place, or runs over video. */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                          {s.locationType && s.locationType !== 'in_person' && (
                            <div style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              padding: '2px 7px', borderRadius: 99,
                              fontSize: 10, fontWeight: 600,
                              background: 'var(--accent-soft)', color: 'var(--accent)',
                            }}>
                              {s.locationType === 'mobile' ? 'Comes to you' : 'Online'}
                            </div>
                          )}
                          {s.depositType && s.depositType !== 'none' && Number(s.depositAmount) > 0 && (
                            <div style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              padding: '2px 7px', borderRadius: 99,
                              fontSize: 10, fontWeight: 600,
                              background: 'var(--surface)',
                              color: 'var(--fg-2)', border: '1px solid var(--border-strong)',
                            }}>
                              <Icons.Lock size={9} sw={1.8}/>
                              Deposit: {s.depositType === 'percent'
                                ? `${Number(s.depositAmount)}%`
                                : `$${Number(s.depositAmount).toFixed(2)}`}
                            </div>
                          )}
                        </div>
                        {s.description && (
                          <p style={{
                            margin: '8px 0 0', fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.45,
                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                          }}>{s.description}</p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Week navigation */}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, gap: 8 }}>
            <button className="btn btn-ghost" style={{ padding: 6, opacity: canGoBack ? 1 : 0.3, cursor: canGoBack ? 'pointer' : 'default' }}
              disabled={!canGoBack}
              onClick={() => { if (!canGoBack) return; const prev = addDays(anchor, -7); setWeekAnchor(prev < today ? today : prev); }}>
              <Icons.Arrow size={14} style={{ transform: 'rotate(180deg)' }}/>
            </button>
            <div style={{ flex: 1, textAlign: 'center', fontWeight: 500, fontSize: 14, color: 'var(--fg-2)' }}>
              {firstShown.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} – {lastShown.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </div>
            <button className="btn btn-ghost" style={{ padding: 6, opacity: canGoForward ? 1 : 0.3, cursor: canGoForward ? 'pointer' : 'default' }}
              disabled={!canGoForward}
              onClick={() => { if (canGoForward) setWeekAnchor(addDays(anchor, 7)); }}>
              <Icons.Arrow size={14}/>
            </button>
          </div>

          {/* Day cards. On phones the 7-column grid collapses to a
              horizontally-scrollable row of fixed-min-width cards so
              each day stays readable instead of getting crushed to
              ~28px-wide. Desktop keeps the equal-width grid. */}
          <div className="public-booking-days" style={{
            display: 'grid', gridTemplateColumns: `repeat(${Math.max(weekDays.length, 1)}, 1fr)`, gap: 10,
          }}>
            {weekDays.map((d, i) => {
              const allSlots = svc ? slotsForDate(cal, d, svc) : [];
              const slots = allSlots.filter((s) => s.available);
              // Past days are never rendered (the strip starts at today), so
              // each visible day is either open, closed, or fully booked.
              // "Closed" = no windows produced any slots; "fully booked" =
              // windows existed but every slot is taken (gets a waitlist CTA).
              const isClosed     = allSlots.length === 0;
              const isFullyBooked = allSlots.length > 0 && slots.length === 0;
              // Show the first 8 times by default; let the visitor expand a
              // busy day to see the rest (previously the extras were simply
              // dropped - hidden availability).
              const dateISO = fmtDateISO(d);
              const dayExpanded = expandedDays.has(dateISO);
              const shownSlots = dayExpanded ? slots : slots.slice(0, 8);
              const toggleDay = () => setExpandedDays((prev) => {
                const next = new Set(prev);
                if (next.has(dateISO)) next.delete(dateISO); else next.add(dateISO);
                return next;
              });
              return (
                <div key={i} className="card" style={{
                  padding: 10, display: 'flex', flexDirection: 'column', gap: 6,
                }}>
                  <div style={{ textAlign: 'center', paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
                    <div className="metric-label" style={{ fontSize: 10 }}>{WEEKDAYS_SHORT[d.getDay()]}</div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 500 }}>{d.getDate()}</div>
                  </div>
                  {isClosed ? (
                    <div style={{ fontSize: 10, color: 'var(--muted-2)', textAlign: 'center', padding: '8px 0' }}>Closed</div>
                  ) : isFullyBooked ? (
                    /* Hot day - every slot taken. Surface waitlist as
                       the obvious next step instead of letting the user
                       wander away. */
                    <button onClick={() => {
                      // Drop into the details step in waitlist mode -
                      // the primary button becomes "Join the waitlist"
                      // and the submit goes straight to the queue.
                      // Seed the waitlist with the first slot that could
                      // actually open up — i.e. a future, fully-booked slot —
                      // NOT a past / too-soon / too-far slot (allSlots[0] is
                      // the first GENERATED slot, which may be in the past).
                      const first = allSlots.find((s) => s.reason !== 'Past' && s.reason !== 'Too soon' && s.reason !== 'Too far')
                        || allSlots[0];
                      if (!first) return;
                      setSlot({ dateISO: fmtDateISO(d), start: first.start, end: first.end });
                      setWaitlistMode(true);
                      setStep('details');
                    }} style={{
                      padding: '8px 4px', borderRadius: 6,
                      fontSize: 10.5, fontWeight: 600, lineHeight: 1.35,
                      background: 'color-mix(in srgb, var(--warn) 14%, transparent)',
                      border: '1px solid var(--warn)',
                      color: 'var(--warn)', cursor: 'pointer',
                      textAlign: 'center',
                    }}>
                      Fully booked<br/><span style={{ fontWeight: 500 }}>Join waitlist →</span>
                    </button>
                  ) : shownSlots.map((s, si) => (
                    /* min-height 40 + real padding: these are THE primary
                       action on the page and were ~26px tall - fiddly for
                       a client booking from their phone. */
                    <button key={si} onClick={() => {
                      setSlot({ dateISO: fmtDateISO(d), start: s.start, end: s.end });
                      setStep('details');
                    }} style={{
                      padding: '9px 4px', minHeight: 40,
                      borderRadius: 6, fontSize: 12.5, fontWeight: 550,
                      background: 'var(--surface-2)', border: '1px solid var(--border)',
                      color: 'var(--fg)', cursor: 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center',
                      justifyContent: 'center', gap: 1,
                    }}>
                      <span>{minToHM(s.start)}</span>
                      {s.seatsLeft != null && (
                        <span style={{
                          fontSize: 9.5, fontWeight: 600,
                          color: s.seatsLeft <= 2 ? 'var(--warn)' : 'var(--accent)',
                        }}>
                          {s.seatsLeft} left
                        </span>
                      )}
                    </button>
                  ))}
                  {slots.length > 8 && (
                    <button type="button" onClick={toggleDay} style={{
                      fontSize: 11, fontWeight: 600, color: 'var(--accent)',
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      padding: '10px 0', minHeight: 36, textAlign: 'center',
                    }}>
                      {dayExpanded ? 'Show less' : `+${slots.length - 8} more`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', marginTop: 20 }}>
            {cal.settings.timezone
              ? `Times shown in ${tzDisplay(cal.settings.timezone)}`
              : 'Times in the business’s local timezone'} · Instant confirmation
          </div>
        </>
      )}

      {/* Reviews block. Hidden on the confirmed/waitlisted screens so
          the focus stays on the success state, but visible during the
          pick + details steps for social proof while the visitor is
          still deciding. */}
      {step !== 'confirmed' && step !== 'waitlisted' && cal.reviews?.count > 0 && !embedded && (
        <ReviewsBlock summary={cal.reviews}/>
      )}
    </PageWrap>
  );
}

function ReviewsBlock({ summary }) {
  const avg = summary.avg ? Number(summary.avg).toFixed(1) : null;
  return (
    <div className="card" style={{ padding: 22, marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div className="metric-label">Reviews</div>
        {avg && (
          <>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 22, letterSpacing: '-0.01em' }}>
              {avg}
            </span>
            <Stars rating={Number(avg)} size={14}/>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              {summary.count} review{summary.count === 1 ? '' : 's'}
            </span>
          </>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: 12 }}>
        {summary.recent.slice(0, 6).map((r) => (
          <div key={r.id} style={{
            padding: 14, borderRadius: 10,
            background: 'var(--surface-2)', border: '1px solid var(--border)',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Stars rating={r.rating} size={11}/>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                {new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
              </span>
            </div>
            {r.text && (
              <div style={{ fontSize: 13.5, color: 'var(--fg)', lineHeight: 1.5 }}>
                "{r.text}"
              </div>
            )}
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
              - {r.reviewerName}
            </div>
            {r.ownerResponse && (
              <div style={{
                marginTop: 6, paddingTop: 8, borderTop: '1px dashed var(--border)',
                fontSize: 12.5, color: 'var(--fg-2)', lineHeight: 1.5,
              }}>
                <span style={{ fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Owner replied
                </span>
                <div style={{ marginTop: 3 }}>{r.ownerResponse}</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Stars({ rating, size = 12 }) {
  const full = Math.round(rating);
  return (
    <span aria-label={`${rating} out of 5`} style={{ display: 'inline-flex', gap: 1.5, color: 'var(--accent)' }}>
      {[1,2,3,4,5].map((i) => (
        <span key={i} style={{
          fontSize: size, lineHeight: 1,
          color: i <= full ? 'var(--accent)' : 'var(--border-strong)',
        }}>★</span>
      ))}
    </span>
  );
}

// Only accept a plain 3/6/8-digit hex so an owner's stored value can never
// inject arbitrary CSS. Returns null when it doesn't match.
function safeHex(c) {
  return typeof c === 'string' && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3}([0-9a-fA-F]{2})?)?$/.test(c.trim())
    ? c.trim() : null;
}
// Readable ink (text) color on top of a given accent, by luminance.
function inkFor(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#111111' : '#ffffff';
}

function PageWrap({ tweaks, embedded, accentColor, children }) {
  // Embed mode: transparent background + tight padding so the host
  // site's container styling shows through. Non-embed: full-page bg,
  // generous padding, owns the whole viewport.
  //
  // Owner branding: when a valid accent color is set we override the theme
  // --accent (and a readable --accent-ink) for the whole booking page, so the
  // buttons/highlights match the owner's brand.
  const accent = safeHex(accentColor);
  const brandVars = accent ? { '--accent': accent, '--accent-ink': inkFor(accent) } : null;
  return (
    <div className={`app-root dir-${tweaks.direction}`} style={{
      minHeight: embedded ? 'auto' : '100vh',
      padding: embedded ? '14px 16px 18px' : '40px 24px 80px',
      background: embedded ? 'transparent' : 'var(--page)',
      ...brandVars,
    }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>{children}</div>
    </div>
  );
}

function Header({ bizName, tagline, logoUrl }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 }}>
      {logoUrl ? (
        <img src={logoUrl} alt={bizName || 'Logo'} style={{
          width: 52, height: 52, borderRadius: 14, objectFit: 'cover', flexShrink: 0,
          border: '1px solid var(--border)', background: 'var(--surface)',
        }}/>
      ) : (
        <div style={{
          width: 52, height: 52, borderRadius: 14, background: 'var(--accent)', color: 'var(--accent-ink)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, flexShrink: 0,
        }}>{(bizName || 'T')[0].toUpperCase()}</div>
      )}
      <div style={{ minWidth: 0 }}>
        <div className="metric-label">Book an appointment</div>
        <h1 className="page-title" style={{ margin: '4px 0 0', fontSize: 28 }}>{bizName || 'Your business'}</h1>
        {tagline && (
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>
            {tagline}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

const inputSty = {
  width: '100%', padding: '10px 12px', borderRadius: 10,
  background: 'var(--surface)', border: '1px solid var(--border-strong)',
  color: 'var(--fg)', fontSize: 14, outline: 'none',
};

// Memberships block - listed as cards below the slot picker. Each
// card opens the join modal; the modal POSTs to /api/memberships/checkout
// and redirects to Stripe Checkout.
function MembershipsBlock({ memberships, bizName, onJoin }) {
  return (
    <div className="card" style={{ padding: 18, marginTop: 18 }}>
      <div className="metric-label" style={{ marginBottom: 10 }}>
        Memberships {bizName ? `at ${bizName}` : ''}
      </div>
      <div style={{
        display: 'grid', gap: 10,
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))',
      }}>
        {memberships.map((m) => (
          <button key={m.id} type="button" onClick={() => onJoin(m)}
            style={{
              padding: 16, borderRadius: 12, textAlign: 'left', cursor: 'pointer',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              display: 'flex', flexDirection: 'column', gap: 6,
              transition: 'border-color .1s, background .1s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent)';
              e.currentTarget.style.background = 'var(--accent-soft)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.background = 'var(--surface-2)';
            }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{m.name}</div>
            <div style={{ fontSize: 18, fontWeight: 600, fontFamily: 'var(--font-display)' }}>
              ${(Number(m.priceCents) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
              <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500, fontFamily: 'inherit', marginLeft: 4 }}>
                / {m.interval === 'quarter' ? '3 mo' : m.interval}
              </span>
            </div>
            {m.description && (
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
                {m.description}
              </div>
            )}
            {Array.isArray(m.perks) && m.perks.length > 0 && (
              <ul style={{ margin: '4px 0 0', padding: '0 0 0 14px', fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.5 }}>
                {m.perks.slice(0, 6).map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            )}
            <div style={{
              marginTop: 8, padding: '6px 12px', borderRadius: 8,
              background: 'var(--accent)', color: 'var(--accent-ink)',
              fontSize: 12, fontWeight: 600, textAlign: 'center',
            }}>Join - secure checkout</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function JoinMembershipModal({ slug, membership, bizName, onClose }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      setErr('Both fields are required'); return;
    }
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/memberships/checkout', {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          membershipId: membership.id,
          name: name.trim(),
          email: email.trim(),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      window.location.href = j.url;
    } catch (ex) {
      setErr(ex.message || 'Could not start checkout');
      setBusy(false);
    }
  };

  return (
    <div onClick={busy ? null : onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="card"
        style={{ width: '100%', maxWidth: 460, padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: 'var(--accent-soft)', color: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><Icons.Heart size={16} sw={1.8}/></div>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Join {membership.name}</h3>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              ${(Number(membership.priceCents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / {membership.interval === 'quarter' ? '3 mo' : membership.interval}
              {bizName ? ` · ${bizName}` : ''}
            </div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose} style={{ padding: 6 }}>
            <Icons.X size={15}/>
          </button>
        </div>

        <Field label="Your name">
          <input value={name} onChange={(e) => setName(e.target.value)}
            required autoFocus style={inputSty}/>
        </Field>
        <Field label="Email" hint="Renewal receipts go here.">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            required style={inputSty} autoComplete="email"/>
        </Field>

        {err && (
          <div style={{
            padding: '8px 12px', borderRadius: 8, marginBottom: 14,
            background: 'rgba(155,44,44,0.08)', border: '1px solid rgba(155,44,44,0.25)',
            color: 'var(--danger)', fontSize: 12.5,
          }}>{err}</div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button type="button" className="btn btn-outline"
            onClick={onClose} disabled={busy}
            style={{ flex: 1, justifyContent: 'center' }}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}
            style={{ flex: 2, justifyContent: 'center' }}>
            {busy ? 'Opening checkout…' : 'Continue to checkout'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 12, textAlign: 'center' }}>
          Card details are entered on Stripe's secure checkout - never on this page.
        </div>
      </form>
    </div>
  );
}

// Packages block - bundles of sessions sold up-front. Each card opens
// the purchase modal which POSTs to /api/packages/checkout. Visitors
// pay via Stripe; the webhook provisions a client_packages row tied to
// their email so they can redeem credits on future bookings.
function PackagesBlock({ packages, services, bizName, onBuy }) {
  // Map service ids → names so a package scoped to specific services
  // shows what it's good for instead of a raw UUID list.
  const nameById = new Map((services || []).map((s) => [s.id, s.name]));
  return (
    <div className="card" style={{ padding: 18, marginTop: 18 }}>
      <div className="metric-label" style={{ marginBottom: 10 }}>
        Packages {bizName ? `at ${bizName}` : ''}
      </div>
      <div style={{
        display: 'grid', gap: 10,
        gridTemplateColumns: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))',
      }}>
        {packages.map((p) => {
          // Empty service_ids = good for any service in the workspace.
          const scoped = (p.serviceIds || []).map((id) => nameById.get(id)).filter(Boolean);
          const scopeLabel = scoped.length === 0
            ? 'Any service'
            : scoped.length <= 2 ? scoped.join(' or ') : `${scoped.slice(0, 2).join(', ')} +${scoped.length - 2} more`;
          const perSession = p.price > 0 && p.sessionCount > 0
            ? p.price / p.sessionCount
            : null;
          return (
            <button key={p.id} type="button" onClick={() => onBuy(p)}
              style={{
                padding: 16, borderRadius: 12, textAlign: 'left', cursor: 'pointer',
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                display: 'flex', flexDirection: 'column', gap: 6,
                transition: 'border-color .1s, background .1s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--accent)';
                e.currentTarget.style.background = 'var(--accent-soft)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.background = 'var(--surface-2)';
              }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</div>
              <div style={{ fontSize: 18, fontWeight: 600, fontFamily: 'var(--font-display)' }}>
                ${Number(p.price).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500, fontFamily: 'inherit', marginLeft: 4 }}>
                  · {p.sessionCount} session{p.sessionCount === 1 ? '' : 's'}
                </span>
              </div>
              {perSession != null && p.sessionCount > 1 && (
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  ${perSession.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} / session
                </div>
              )}
              {p.description && (
                <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
                  {p.description}
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--fg-2)' }}>
                Good for: {scopeLabel}
                {p.expiryDays ? ` · Expires in ${p.expiryDays} day${p.expiryDays === 1 ? '' : 's'}` : ''}
              </div>
              <div style={{
                marginTop: 8, padding: '6px 12px', borderRadius: 8,
                background: 'var(--accent)', color: 'var(--accent-ink)',
                fontSize: 12, fontWeight: 600, textAlign: 'center',
              }}>Buy - secure checkout</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BuyPackageModal({ slug, pkg, bizName, onClose }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      setErr('Both fields are required'); return;
    }
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/packages/checkout', {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          packageId: pkg.id,
          name: name.trim(),
          email: email.trim(),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      window.location.href = j.url;
    } catch (ex) {
      setErr(ex.message || 'Could not start checkout');
      setBusy(false);
    }
  };

  return (
    <div onClick={busy ? null : onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="card"
        style={{ width: '100%', maxWidth: 460, padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: 'var(--accent-soft)', color: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><Icons.Gift size={16} sw={1.8}/></div>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Buy {pkg.name}</h3>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              ${Number(pkg.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              {' · '}{pkg.sessionCount} session{pkg.sessionCount === 1 ? '' : 's'}
              {bizName ? ` · ${bizName}` : ''}
            </div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose} style={{ padding: 6 }}>
            <Icons.X size={15}/>
          </button>
        </div>

        <Field label="Your name">
          <input value={name} onChange={(e) => setName(e.target.value)}
            required autoFocus style={inputSty}/>
        </Field>
        <Field label="Email" hint="Your package + receipt are sent here.">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            required style={inputSty} autoComplete="email"/>
        </Field>

        {err && (
          <div style={{
            padding: '8px 12px', borderRadius: 8, marginBottom: 14,
            background: 'rgba(155,44,44,0.08)', border: '1px solid rgba(155,44,44,0.25)',
            color: 'var(--danger)', fontSize: 12.5,
          }}>{err}</div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button type="button" className="btn btn-outline"
            onClick={onClose} disabled={busy}
            style={{ flex: 1, justifyContent: 'center' }}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}
            style={{ flex: 2, justifyContent: 'center' }}>
            {busy ? 'Opening checkout…' : 'Continue to checkout'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 12, textAlign: 'center' }}>
          Card details are entered on Stripe's secure checkout - never on this page.
        </div>
      </form>
    </div>
  );
}

// Buy-a-gift-card modal. Locked to a fixed amount ladder for safety;
// builds a Stripe Checkout session via /api/gift-cards/checkout.
function BuyGiftCardModal({ slug, bizName, onClose }) {
  const [amount, setAmount] = useState(5000);
  const [senderName, setSenderName] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!senderName.trim() || !senderEmail.trim() || !recipientName.trim() || !recipientEmail.trim()) {
      setErr('All fields except message are required');
      return;
    }
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/gift-cards/checkout', {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          amountCents: amount,
          senderName: senderName.trim(),
          senderEmail: senderEmail.trim(),
          recipientName: recipientName.trim(),
          recipientEmail: recipientEmail.trim(),
          message: message.trim() || null,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      window.location.href = j.url;
    } catch (ex) {
      setErr(ex.message || 'Could not start checkout');
      setBusy(false);
    }
  };

  return (
    <div onClick={busy ? null : onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="card scroll"
        style={{ width: '100%', maxWidth: 480, padding: 24, maxHeight: 'calc(100vh - 40px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: 'var(--accent-soft)', color: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><Icons.Gift size={16} sw={1.8}/></div>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Send a gift card</h3>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {bizName ? `For use at ${bizName}.` : 'Redeemable on this booking page.'}
            </div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose} style={{ padding: 6 }}>
            <Icons.X size={15}/>
          </button>
        </div>

        <Field label="Amount">
          <div style={{
            display: 'grid',
            // 4 cols on tablet+, 2 cols on phones so each amount
            // button has a sane touch target without needing to
            // shrink the font.
            gridTemplateColumns: 'repeat(auto-fit, minmax(72px, 1fr))',
            gap: 6,
          }}>
            {[2500, 5000, 7500, 10000, 15000, 20000, 25000, 50000].map((cents) => (
              <button key={cents} type="button" onClick={() => setAmount(cents)}
                style={{
                  padding: '12px 8px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  minHeight: 44,
                  border: `1px solid ${amount === cents ? 'var(--accent)' : 'var(--border-strong)'}`,
                  background: amount === cents ? 'var(--accent)' : 'var(--surface-2)',
                  color: amount === cents ? 'var(--accent-ink)' : 'var(--fg-2)',
                  cursor: 'pointer',
                }}>${(cents / 100).toFixed(0)}</button>
            ))}
          </div>
        </Field>

        <div className="form-2col" style={{ marginTop: 12 }}>
          <Field label="From (your name)">
            <input value={senderName} onChange={(e) => setSenderName(e.target.value)} required
              style={inputSty}/>
          </Field>
          <Field label="Your email">
            <input type="email" value={senderEmail} onChange={(e) => setSenderEmail(e.target.value)}
              required style={inputSty} autoComplete="email"/>
          </Field>
          <Field label="Recipient name">
            <input value={recipientName} onChange={(e) => setRecipientName(e.target.value)}
              required style={inputSty}/>
          </Field>
          <Field label="Recipient email">
            <input type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)}
              required style={inputSty}/>
          </Field>
        </div>

        <Field label="Message (optional)">
          <textarea value={message} onChange={(e) => setMessage(e.target.value.slice(0, 1000))}
            rows={3}
            placeholder={`Happy birthday! Treat yourself.`}
            style={{ ...inputSty, fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5 }}/>
        </Field>

        {err && (
          <div style={{
            padding: '8px 12px', borderRadius: 8, marginBottom: 14,
            background: 'rgba(155,44,44,0.08)', border: '1px solid rgba(155,44,44,0.25)',
            color: 'var(--danger)', fontSize: 12.5,
          }}>{err}</div>
        )}

        <button type="submit" className="btn btn-primary"
          disabled={busy}
          style={{ width: '100%', justifyContent: 'center', padding: '12px' }}>
          {busy ? 'Opening checkout…' : `Continue - $${(amount / 100).toFixed(2)}`}
        </button>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, textAlign: 'center' }}>
          Recipient gets the code by email immediately after payment.
        </div>
      </form>
    </div>
  );
}

// Pre-booking message modal. Hits the public contact endpoint, which
// auto-creates a "lead" client + thread on the owner's side. The
// owner gets push + email; replies email the prospect back through
// the existing /api/messages/:id reply path (now branding-aware).
function ContactModal({ slug, bizName, onClose }) {
  const [name, setName]       = useState('');
  const [email, setEmail]     = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState(null);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !message.trim()) {
      setErr('Please fill in all fields'); return;
    }
    setBusy(true); setErr(null);
    try {
      const res = await fetch(
        '/api/calendar/public/contact?slug=' + encodeURIComponent(slug),
        {
          method: 'POST',
          credentials: 'omit',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            email: email.trim(),
            message: message.trim(),
          }),
        }
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setDone(true);
    } catch (ex) {
      setErr(ex.message || 'Could not send');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div onClick={busy ? null : onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} className="card"
        style={{ width: '100%', maxWidth: 480, padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: 'var(--accent-soft)', color: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><Icons.Chat size={16} sw={1.8}/></div>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>
              {done ? 'Message sent' : `Message ${bizName || 'us'}`}
            </h3>
            {!done && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                We'll reply by email - usually within a day.
              </div>
            )}
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose} style={{ padding: 6 }}>
            <Icons.X size={15}/>
          </button>
        </div>

        {done ? (
          <>
            <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--fg-2)', lineHeight: 1.55 }}>
              Got it - your message is on its way to <b>{bizName || 'them'}</b>.
              Keep an eye on <b>{email}</b> for their reply, usually within a day.
              You can come back here any time to book once you've heard back.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={onClose}>Close</button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <Field label="Your name">
              <input value={name} onChange={(e) => setName(e.target.value)}
                required autoFocus style={inputSty}/>
            </Field>
            <Field label="Email" hint="We'll reply here.">
              <input type="email" value={email}
                onChange={(e) => setEmail(e.target.value)}
                required style={inputSty}/>
            </Field>
            <Field label="What's your question?">
              <textarea value={message} onChange={(e) => setMessage(e.target.value)}
                rows={5} maxLength={4000} required
                placeholder="Hi! I'm wondering about…"
                style={{ ...inputSty, fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5 }}/>
            </Field>
            {err && (
              <div style={{
                padding: '8px 12px', borderRadius: 8, marginBottom: 14,
                background: 'rgba(155,44,44,0.08)', border: '1px solid rgba(155,44,44,0.25)',
                color: 'var(--danger)', fontSize: 12.5,
              }}>{err}</div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button type="button" className="btn btn-outline"
                onClick={onClose} disabled={busy}
                style={{ flex: 1, justifyContent: 'center' }}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary"
                disabled={busy}
                style={{ flex: 2, justifyContent: 'center', opacity: busy ? 0.6 : 1 }}>
                {busy ? 'Sending…' : 'Send message'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}


// ── Programs (courses, plans, communities) sold from the booking page ──
const fmtProgramPrice = (cents) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 ? 2 : 0 }).format((cents || 0) / 100);
const programBilling = (b) => b === 'month' ? '/ month' : b === 'year' ? '/ year' : 'one-time';

function ProgramsBlock({ programs, bizName, onBuy }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>Programs from {bizName}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
        {programs.map((p) => (
          <div key={p.id} className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{p.title}</div>
            {p.description && <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.description}</div>}
            <div style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>{p.items} item{p.items === 1 ? '' : 's'}{p.communityEnabled ? ' · private community' : ''}{p.billing === 'one_time' && p.accessDays ? ` · ${p.accessDays} days of access` : ''}</div>
            <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span><b style={{ fontSize: 16 }}>{p.priceCents ? fmtProgramPrice(p.priceCents) : 'Free'}</b> {p.priceCents ? <span style={{ fontSize: 12, color: 'var(--muted)' }}>{programBilling(p.billing)}</span> : null}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <a href={`/p/${p.id}`} className="btn btn-ghost" style={{ fontSize: 12.5, padding: '6px 10px' }}>Details</a>
                {p.priceCents > 0 && <button className="btn btn-primary" style={{ fontSize: 12.5, padding: '6px 12px' }} onClick={() => onBuy(p)}>{p.billing === 'one_time' ? 'Buy' : 'Subscribe'}</button>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProgramBuyModal({ program, bizName, onClose }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) { setErr('Both fields are required'); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/programs/checkout', {
        method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ programId: program.id, name: name.trim(), email: email.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      window.location.href = j.url;
    } catch (ex) { setErr(ex.message); setBusy(false); }
  };
  return (
    <div role="dialog" aria-modal="true" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="card" style={{ width: '100%', maxWidth: 420, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 17, fontWeight: 600 }}>{program.title}</div>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>{fmtProgramPrice(program.priceCents)} {programBilling(program.billing)} · paid to {bizName} through Stripe</div>
        <input className="input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus/>
        <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"/>
        {err && <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Opening checkout…' : program.billing === 'one_time' ? 'Continue to payment' : 'Subscribe'}</button>
        </div>
      </form>
    </div>
  );
}
