import React, { useEffect, useState, useCallback, useRef } from 'react';
import { readCache, writeCache } from '../../lib/deviceCache.js';
import { Link, useNavigate } from 'react-router-dom';
import { Icons } from '../../components/Icons.jsx';
import EmptyNote from '../../components/EmptyNote.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useUserContext } from '../../lib/userContext.jsx';
import { useIntervalWhenVisible } from '../../lib/useIntervalWhenVisible.js';
import { fireConfetti } from '../../lib/celebrate.js';
import SuccessToast from '../../components/SuccessToast.jsx';
import InviteFriendCard from './InviteFriendCard.jsx';
import SampleDataCard from './SampleDataCard.jsx';
import WorkflowSuggestionCard from './WorkflowSuggestionCard.jsx';
import IvyNoticedCard from './IvyNoticedCard.jsx';
import NotifyPrompt from '../../components/NotifyPrompt.jsx';

// Dashboard tiles per business type. 'both' is the default and shows
// the original service-centric mix so existing workspaces look the
// same; 'service' is identical; 'product' swaps booking-only tiles
// for product-only ones so a candle maker's dashboard isn't visually
// "broken" with zero bookings + zero hours.
const METRICS_SERVICE = [
  { k: 'mrr',     label: 'Revenue this month', kind: 'money', to: '/finance' },
  { k: 'clients', label: 'Active clients',     kind: 'int',   to: '/clients' },
  { k: 'booked',  label: 'Booked this month',  kind: 'int',   to: '/calendar' },
  { k: 'hours',   label: 'Hours this month',   kind: 'hours', to: '/calendar' },
];
const METRICS_PRODUCT = [
  { k: 'mrr',       label: 'Revenue this month', kind: 'money', to: '/finance' },
  { k: 'clients',   label: 'Customers',          kind: 'int',   to: '/clients' },
  { k: 'orders',    label: 'Orders this month',  kind: 'int',   to: '/finance?section=invoices' },
  { k: 'itemsSold', label: 'Items sold',         kind: 'int',   to: '/finance?section=invoices' },
];
function metricsFor(businessType) {
  return businessType === 'product' ? METRICS_PRODUCT : METRICS_SERVICE;
}

function fmtMoney(n, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(n || 0));
  } catch { return `$${Math.round(Number(n || 0))}`; }
}
function fmtTime(min) {
  const h = Math.floor(min / 60), m = min % 60;
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function MetricCard({ label, value, kind, currency, loading, to }) {
  let display = '-';
  if (!loading && value != null) {
    if (kind === 'money') display = fmtMoney(value, currency);
    else if (kind === 'hours') display = `${value}h`;
    else display = String(value);
  }
  // The whole card links to the relevant section. (The old top-right
  // three-dots was a dead affordance - tapping it did nothing - so it's
  // replaced by a real, tappable arrow that takes you to the detail page.)
  return (
    <Link to={to || '/dashboard'} className="card"
      style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14, minHeight: 128, textDecoration: 'none', color: 'inherit' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="metric-label">{label}</span>
        <Icons.Arrow size={14} stroke="var(--muted)" sw={1.8} />
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span className="metric-value" style={{ fontSize: 38, color: (!loading && value != null) ? 'var(--fg)' : 'var(--muted-2)' }}>
          {display}
        </span>
      </div>
      <div style={{ height: 32, borderTop: '1px dashed var(--border)' }} />
    </Link>
  );
}

// Owner setup checklist. Two phases:
//   PHASE 1 (required incomplete): "Finish setting up" - accent banner with
//   the next required action front and center. Recommended items also
//   listed but visually de-emphasized.
//   PHASE 2 (required complete, recommended outstanding): "Get fully ready
//   for business" - softer banner. The required cluster is collapsed and
//   shows a green check-mark. Recommended items are the focus.
// Phase 3 (everything done) hides the card entirely.
//
// Dismissable via "Hide for now" - stamps localStorage with a 7-day TTL
// so the card disappears for that period and the user isn't nagged on
// every page load. Re-shows automatically once the TTL expires OR a new
// item flips back to incomplete.
const DISMISS_KEY = 'ivy.setupChecklist.hideUntil';
const DISMISS_DAYS = 7;

function isDismissed() {
  try {
    const v = localStorage.getItem(DISMISS_KEY);
    if (!v) return false;
    return Date.now() < Number(v);
  } catch { return false; }
}
function dismissForAWeek() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 86400e3));
  } catch { /* ignore */ }
}

function SetupChecklist() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [hidden, setHidden] = useState(() => isDismissed());

  // Keyed on email_verified_at so the moment the auth provider detects
  // verification (focus / cross-tab beacon / poll), the checklist
  // re-fetches and the "verify your email" step drops off immediately.
  const emailVerifiedAt = user?.email_verified_at || null;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await api.get('/me/setup-status');
        if (!cancelled) setData(r);
      } catch { /* hide silently if we can't load */ }
    };
    load();
    // Keep it current in real time: re-check completion whenever the owner
    // returns to the dashboard tab/window (e.g. after finishing a step on
    // another page or tab). Navigating away and back already re-mounts +
    // re-fetches; this covers staying on the page and switching tabs.
    const onFocus = () => load();
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [emailVerifiedAt]);

  if (!data || !data.items || data.items.length === 0) return null;
  if (data.fullyComplete) return null;
  if (hidden) return null;

  const required = data.items.filter((i) => i.required);
  const recommended = data.items.filter((i) => !i.required);
  const doneRequired = required.filter((i) => i.done).length;
  const doneRec = recommended.filter((i) => i.done).length;
  const totalRequired = required.length;
  const totalRec = recommended.length;

  const phase = data.complete ? 'recommended' : 'required';
  const nextItem = phase === 'required'
    ? required.find((i) => !i.done)
    : recommended.find((i) => !i.done);

  const headline = phase === 'required'
    ? 'Finish setting up your business'
    : "You're ready to take bookings - keep going";
  const sub = phase === 'required'
    ? 'A few quick steps and your booking page is live.'
    : 'Optional but worth it: card payments, a public website, your first client. Each one moves the needle.';

  // Progress: counts both required + recommended once we hit phase 2.
  const pctRequired = Math.round((doneRequired / Math.max(1, totalRequired)) * 100);
  const pctRec = Math.round((doneRec / Math.max(1, totalRec)) * 100);
  const pct = phase === 'required' ? pctRequired : pctRec;

  const tone = phase === 'required' ? 'var(--accent)' : 'var(--ok)';

  const dismiss = () => { dismissForAWeek(); setHidden(true); };

  return (
    <div className="card" style={{
      padding: 22,
      borderColor: tone,
      background: phase === 'required'
        ? 'color-mix(in srgb, var(--accent-soft) 50%, var(--surface))'
        : 'color-mix(in srgb, var(--ok) 6%, var(--surface))',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10, flexShrink: 0,
          background: tone,
          color: phase === 'required' ? 'var(--accent-ink)' : '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icons.Check size={18} sw={2.4}/>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{headline}</h3>
            <span style={{
              fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
              padding: '2px 8px', borderRadius: 99,
              background: tone,
              color: phase === 'required' ? 'var(--accent-ink)' : '#fff',
            }}>
              {phase === 'required'
                ? `${doneRequired}/${totalRequired}`
                : `${doneRec}/${totalRec}`}
            </span>
          </div>
          <p style={{ margin: '6px 0 12px', fontSize: 13, color: 'var(--fg-2)', lineHeight: 1.55 }}>
            {sub}
            {nextItem && <> Up next - <strong>{(nextItem.label || '').toLowerCase()}</strong>.</>}
          </p>
          {/* Progress bar */}
          <div style={{
            height: 6, borderRadius: 99, background: 'var(--border)',
            overflow: 'hidden', marginBottom: 16,
          }}>
            <div style={{
              height: '100%', width: `${pct}%`,
              background: tone, transition: 'width 0.25s ease',
            }}/>
          </div>

          {!collapsed && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {phase === 'required' && (
                <ChecklistGroup
                  label="Required"
                  items={required}/>
              )}
              <ChecklistGroup
                label="Recommended"
                items={recommended}
                done={doneRec}
                total={totalRec}/>
              {phase === 'recommended' && (
                /* Show the required block in a tucked-away "you've completed
                   these" footnote so they can revisit if needed. */
                <details style={{ fontSize: 12, color: 'var(--muted)' }}>
                  <summary style={{ cursor: 'pointer' }}>
                    Required setup completed ({doneRequired}/{totalRequired})
                  </summary>
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {required.map((item) => <ChecklistRow key={item.id} item={item}/>)}
                  </div>
                </details>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {nextItem && (
              <Link to={nextItem.href} className="btn btn-primary" style={{ padding: '7px 14px', fontSize: 12.5 }}>
                {nextItem.label} <Icons.Arrow size={11} sw={2}/>
              </Link>
            )}
            <button onClick={() => setCollapsed((c) => !c)} className="btn btn-ghost"
              style={{ padding: '7px 12px', fontSize: 12.5, color: 'var(--muted)' }}>
              {collapsed ? 'Show all steps' : 'Hide details'}
            </button>
            <div style={{ flex: 1 }}/>
            <button onClick={dismiss} className="btn btn-ghost"
              style={{ padding: '7px 12px', fontSize: 12.5, color: 'var(--muted)' }}
              title="Hide for 7 days. We'll re-show if anything changes.">
              Hide for now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChecklistGroup({ label, items }) {
  // Completed steps disappear from the to-do list instead of lingering
  // as checked-off rows - the badge/progress bar already tell the
  // "3/5 done" story, so the list only shows what's actually left.
  const remaining = items.filter((i) => !i.done);
  if (remaining.length === 0) return null;
  return (
    <div>
      <div style={{
        fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6,
      }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {remaining.map((item) => <ChecklistRow key={item.id} item={item}/>)}
      </div>
    </div>
  );
}

function ChecklistRow({ item }) {
  return (
    <Link to={item.href} style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '8px 10px', borderRadius: 8,
      background: item.done ? 'transparent' : 'var(--surface)',
      border: '1px solid',
      borderColor: item.done ? 'var(--border)' : 'var(--border-strong)',
      textDecoration: 'none', color: 'inherit',
      opacity: item.done ? 0.65 : 1,
    }}>
      <div style={{
        width: 18, height: 18, borderRadius: 99, flexShrink: 0, marginTop: 1,
        background: item.done ? 'var(--accent)' : 'var(--surface-2)',
        color: item.done ? 'var(--accent-ink)' : 'var(--muted)',
        border: item.done ? 'none' : '1px solid var(--border-strong)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {item.done && <Icons.Check size={11} sw={2.6}/>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 550,
          textDecoration: item.done ? 'line-through' : 'none',
          color: item.done ? 'var(--muted)' : 'var(--fg)',
        }}>
          {item.label}
        </div>
        {!item.done && item.why && (
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2, lineHeight: 1.45 }}>
            {item.why}
          </div>
        )}
      </div>
      {!item.done && <Icons.Arrow size={12} stroke="var(--muted)" sw={1.8} style={{ alignSelf: 'center', flexShrink: 0 }}/>}
    </Link>
  );
}

function HeroBand() {
  const hour = new Date().getHours();
  const nav = useNavigate();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
  return (
    <div className="hero-band" style={{
      display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap',
      padding: '24px 32px',
      background: 'var(--surface)',
      borderBottom: '1px solid var(--border)',
    }}>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6, letterSpacing: '0.04em' }}>{dateStr}</div>
        <h2 className="page-title" style={{ margin: 0, fontSize: 36 }}>{greet}.</h2>
        <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--fg-2)', maxWidth: 560 }}>
          Welcome to Ivy. Add a client or open Ivy - she'll walk you through setup.
        </p>
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button className="btn btn-outline" onClick={() => nav('/calendar')}>
          <Icons.Calendar size={14}/>Open calendar
        </button>
        <button className="btn btn-primary" onClick={() => nav('/clients?add=1')}>
          <Icons.Plus size={14}/>Add client
        </button>
      </div>
    </div>
  );
}

// "Today with Ivy" — the deterministic briefing (today's sessions / unpaid
// invoices / quiet clients) that used to live only in the Ivy dock, surfaced on
// the highest-traffic screen. Each row hands the job straight to Ivy via a
// pre-filled, auto-sent prompt (/ivy?prompt=…&send=1), so the dashboard becomes
// a place to ACT, not just read numbers. Hidden when there's nothing to say.
function TodayWithIvyCard({ items }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{
          width: 26, height: 26, borderRadius: 7, flexShrink: 0,
          background: 'var(--accent)', color: 'var(--accent-ink)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icons.Spark size={15} sw={1.9}/>
        </div>
        <div style={{ fontSize: 14.5, fontWeight: 700 }}>Today with Ivy</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((item, i) => {
          const Icon = Icons[item.icon] || Icons.Spark;
          return (
            <Link key={i} to={`/ivy?prompt=${encodeURIComponent(item.prompt)}&send=1`} style={{
              display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px',
              borderRadius: 9, border: '1px solid var(--border)',
              background: 'var(--surface)', textDecoration: 'none', color: 'inherit',
            }}>
              <span style={{
                width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                background: 'var(--accent-soft)', color: 'var(--accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon size={15} sw={1.9}/>
              </span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 550 }}>{item.text}</span>
              <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, flexShrink: 0 }}>Ask Ivy →</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// Goal momentum on the home surface. The highest-intent retention object
// (revenue / clients / sessions goals with live progress) used to live only on
// /goals; a compact "you're 80% there" strip on the dashboard keeps the target
// in front of the owner every day. Hidden when they haven't set any goals.
function GoalsMomentum({ goals, currency }) {
  if (!Array.isArray(goals) || goals.length === 0) return null;
  const fmt = (type, n) => (type === 'revenue'
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(n || 0))
    : Number(n || 0).toLocaleString());
  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="metric-label">Your goals</div>
        <Link to="/goals" style={{ fontSize: 12.5, color: 'var(--muted)', textDecoration: 'none' }}>All goals →</Link>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {goals.map((g) => (
          <Link key={g.id} to="/goals" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 5 }}>
              <span style={{ fontSize: 13, fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.title}</span>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: g.pct >= 100 ? 'var(--ok, var(--accent))' : 'var(--accent)', flexShrink: 0 }}>
                {g.pct >= 100 ? 'Reached 🎉' : `${g.pct}%`}
              </span>
            </div>
            <div style={{ height: 7, borderRadius: 999, background: 'var(--surface-2)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${g.pct}%`, borderRadius: 999, background: 'var(--accent)' }}/>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>
              {fmt(g.type, g.current)} / {fmt(g.type, g.target)}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  // Native: paint yesterday's numbers instantly from the device cache and
  // refresh underneath - the fetch below replaces them within a second.
  const [data, setData] = useState(() => readCache('dashboard'));
  const [loadErr, setLoadErr] = useState(null);
  const [loading, setLoading] = useState(() => !readCache('dashboard'));
  const { ctx } = useUserContext();
  const businessType = ctx?.owns?.businessType || 'both';

  const loadDashboard = useCallback(async () => {
    try { const r = await api.get('/dashboard'); setData(r); setLoadErr(null); writeCache('dashboard', r); }
    catch (e) {
      // A failed fetch must NOT masquerade as an empty business - on
      // flaky mobile connections "No appointments / $0" reads as "my
      // bookings are gone". Only surface the error when we have no
      // previously-loaded data to keep showing.
      setLoadErr(e?.message || 'Could not load');
    }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { loadDashboard(); }, [loadDashboard]);
  // Keep the dashboard LIVE: refresh every 30s while the tab is visible (and on
  // re-focus). A solo owner watching revenue tick up or a new booking land
  // without a manual refresh is a core "the app feels alive" moment.
  useIntervalWhenVisible(loadDashboard, 30000);

  // Celebrate a streak milestone once (the server returns `milestone` only on
  // the first load of the day it's crossed; guard against the 30s re-poll).
  const [streakToast, setStreakToast] = useState(null);
  const celebratedMs = useRef(null);
  useEffect(() => {
    const ms = data?.streak?.milestone;
    if (ms && celebratedMs.current !== ms) {
      celebratedMs.current = ms;
      fireConfetti();
      setStreakToast(`🔥 ${ms}-day streak!`);
    }
  }, [data?.streak?.milestone]);

  const currency = data?.currency || 'USD';
  const today    = data?.today || [];
  const activity = data?.activity || [];
  const tasks    = data?.tasks || [];
  const rve      = data?.revenueVsExpenses;
  // "Empty" workspace: no real clients or bookings yet → offer sample data.
  const empty = !!data && (data.clients || 0) === 0 && (data.booked || 0) === 0;

  // Fetch failed and there's nothing cached to show - render a retry
  // card instead of empty-looking panels.
  if (loadErr && !data && !loading) {
    return (
      <div>
        <HeroBand />
        <div className="page-pad">
          <div className="card" style={{ padding: 28, textAlign: 'center' }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 6 }}>
              Couldn't load your dashboard
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.55 }}>
              Your data is safe - this is usually a connection blip.
            </div>
            <button className="btn btn-primary" style={{ padding: '9px 20px' }}
              onClick={() => { setLoadErr(null); loadDashboard(); }}>
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <HeroBand />
      <div className="page-pad" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {data?.streak?.days >= 2 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '5px 12px', borderRadius: 999, fontSize: 13, fontWeight: 600,
              background: 'var(--accent-soft)', color: 'var(--accent)',
            }} title="Days in a row you've shown up. Keep it going!">
              🔥 {data.streak.days}-day streak
            </span>
            {data.streak.best > data.streak.days && (
              <span style={{ fontSize: 12, color: 'var(--muted)' }}
                title="Your longest streak so far - beat it!">
                Personal best: {data.streak.best} days
              </span>
            )}
          </div>
        )}
        <IvyNoticedCard />
        <TodayWithIvyCard items={data?.briefing?.items}/>
        {data?.workflowSuggestion && (
          <WorkflowSuggestionCard suggestion={data.workflowSuggestion} onChanged={loadDashboard}/>
        )}
        <SetupChecklist/>
        <NotifyPrompt/>
        <SampleDataCard empty={empty} onChanged={loadDashboard}/>
        <InviteFriendCard/>
        <div className="grid-auto">
          {metricsFor(businessType).map((m) => (
            <MetricCard key={m.k} label={m.label} kind={m.kind} to={m.to}
              value={data?.metrics?.[m.k]} currency={currency} loading={loading}/>
          ))}
        </div>
        <GoalsMomentum goals={data?.goals} currency={currency}/>
        <div className="split-2">
          <div className="card" style={{ padding: 24 }}>
            <div className="metric-label" style={{ marginBottom: 14 }}>Revenue vs expenses · this month</div>
            {!rve || (rve.revenue === 0 && rve.expenses === 0) ? (
              <EmptyNote icon="Trending" title="No revenue recorded yet"
                hint="Send an invoice or log an expense and your numbers populate here." />
            ) : (
              <RevenueExpenses revenue={rve.revenue} expenses={rve.expenses} currency={currency}/>
            )}
          </div>
          <div className="card hoist-mobile" style={{ padding: 20 }}>
            <div className="metric-label" style={{ marginBottom: 10 }}>Today</div>
            {today.length === 0 ? (
              <EmptyNote icon="Calendar" title="No appointments" hint="Share a booking link or add one manually." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {today.map((b) => (
                  <Link key={b.id} to={`/calendar?booking=${b.id}`} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                    borderRadius: 8, border: '1px solid var(--border)', textDecoration: 'none', color: 'inherit',
                  }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', minWidth: 64 }}>{fmtTime(b.startMin)}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b.clientName || 'Client'}{b.serviceName ? ` · ${b.serviceName}` : ''}
                    </span>
                    {b.noShow && <span style={{ fontSize: 10.5, color: 'var(--danger)' }}>no-show</span>}
                    {b.completed && <Icons.Check size={13} sw={2.4} stroke="var(--ok)"/>}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="split-2">
          <div className="card" style={{ padding: 20 }}>
            <div className="metric-label" style={{ marginBottom: 10 }}>Activity</div>
            {activity.length === 0 ? (
              <EmptyNote icon="Clock" title="Nothing yet"
                hint="Payments and bookings will appear here." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {activity.map((a, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                    <Icons.More size={6} stroke="var(--accent)" sw={3}/>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.text}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{relTime(a.ts)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="card" style={{ padding: 20 }}>
            <div className="metric-label" style={{ marginBottom: 10 }}>Your list</div>
            {tasks.length === 0 ? (
              <EmptyNote icon="Check" title="No tasks" hint="Add one, or ask Ivy to draft your week." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {tasks.map((t) => (
                  <Link key={t.id} to="/goals" style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                    borderRadius: 8, border: '1px solid var(--border)', textDecoration: 'none', color: 'inherit',
                  }}>
                    <span style={{
                      width: 16, height: 16, borderRadius: 99, flexShrink: 0,
                      border: '1px solid var(--border-strong)',
                      background: t.progress === 100 ? 'var(--accent)' : 'transparent',
                    }}/>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                    {t.progress === 100 && <span style={{ fontSize: 10.5, color: 'var(--accent)' }}>ready</span>}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <SuccessToast text={streakToast} onDone={() => setStreakToast(null)}/>
    </div>
  );
}

function RevenueExpenses({ revenue, expenses, currency }) {
  const max = Math.max(revenue, expenses, 1);
  const Bar = ({ label, value, color }) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 5 }}>
        <span style={{ color: 'var(--fg-2)' }}>{label}</span>
        <strong>{fmtMoney(value, currency)}</strong>
      </div>
      <div style={{ height: 8, borderRadius: 99, background: 'var(--surface-2)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.round((value / max) * 100)}%`, background: color, transition: 'width .25s' }}/>
      </div>
    </div>
  );
  const net = revenue - expenses;
  return (
    <div>
      <Bar label="Revenue" value={revenue} color="var(--ok)"/>
      <Bar label="Expenses" value={expenses} color="var(--danger)"/>
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
        <span style={{ color: 'var(--fg-2)' }}>Net</span>
        <strong style={{ color: net >= 0 ? 'var(--ok)' : 'var(--danger)' }}>{fmtMoney(net, currency)}</strong>
      </div>
    </div>
  );
}

function relTime(ts) {
  const d = Date.now() - new Date(ts).getTime();
  const mins = Math.round(d / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}
