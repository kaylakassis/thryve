// Ivy - full-page AI assistant.
// Three-column layout: left (history + new chat), center (chat / welcome),
// right (workspace context + upload placeholder).
import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Icons } from '../../components/Icons.jsx';
import EmptyNote from '../../components/EmptyNote.jsx';
import { useTweaks } from '../../lib/tweaks.js';
import { useViewport } from '../../lib/viewport.js';
import { useIvy } from './state.jsx';
import { greetingLine, hasBriefing } from './briefing.js';
import { MiniMarkdown } from '../../lib/miniMarkdown.jsx';
import PendingActionCard from './PendingActionCard.jsx';

export default function IvyPro() {
  const [tweaks] = useTweaks();
  const direction = tweaks.direction;
  const { isMobile, isTablet } = useViewport();
  const {
    sessions, activeId, messages, context, briefing,
    loading, thinking, error, mode, modeError, model, usage,
    openSession, newChat, send, removeSession,
    approvePending, dismissPending,
  } = useIvy();

  const [draft, setDraft] = useState('');
  // Mobile: 'chat' | 'history' | 'data' tab. Default to chat.
  const [mobileTab, setMobileTab] = useState('chat');
  // Today's insight can be closed; it stays closed for the rest of the day.
  const todayKey = new Date().toISOString().slice(0, 10);
  const [insightHidden, setInsightHidden] = useState(() => {
    try { return localStorage.getItem('ivy_insight_hidden') === todayKey; } catch { return false; }
  });
  const hideInsight = () => {
    setInsightHidden(true);
    try { localStorage.setItem('ivy_insight_hidden', todayKey); } catch { /* private mode */ }
  };

  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, thinking]);

  // ?prompt=… deep-link consumed by push notifications and similar
  // hand-offs. Drops the text into the composer (or auto-sends if also
  // ?send=1) so the user can review before firing it off. Strips the
  // params after consumption so a refresh doesn't re-prefill.
  const location = useLocation();
  const navigate = useNavigate();
  const consumedRef = useRef(false);
  useEffect(() => {
    if (loading || consumedRef.current) return;
    const params = new URLSearchParams(location.search);
    const prompt = params.get('prompt');
    if (!prompt) return;
    consumedRef.current = true;
    const autoSend = params.get('send') === '1';
    params.delete('prompt');
    params.delete('send');
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
    if (autoSend) {
      send(prompt);
    } else {
      setDraft(prompt);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, location.search]);

  const submit = (text) => {
    const t = (text ?? draft).trim();
    if (!t || thinking) return;
    setDraft('');
    send(t);
  };

  if (loading) {
    return <div style={{ padding: 48, color: 'var(--muted)', fontSize: 13 }}>Loading Ivy…</div>;
  }

  // On mobile we stack as tabs; on tablet drop the right rail (data context)
  // since the chat itself is the primary surface and the right rail can be
  // recovered via tweaking "What Ivy sees" inline below the chat. On desktop:
  // the original 3-column layout.
  const cols = isMobile ? '1fr' : isTablet ? '240px 1fr' : '260px 1fr 320px';
  const showHistory = !isMobile || mobileTab === 'history';
  const showChat    = !isMobile || mobileTab === 'chat';
  const showData    = (!isMobile && !isTablet) || (isMobile && mobileTab === 'data');

  return (
    <div style={{
      // Mobile: the visible height is the viewport minus the status bar, the
      // 56px header, and the tab bar with the home-indicator inset - so the
      // composer sits at the bottom of the screen without scrolling.
      height: isMobile
        ? 'calc(100dvh - env(safe-area-inset-top, 0px) - 56px - 72px - env(safe-area-inset-bottom, 0px))'
        : 'calc(100vh - 60px)',
      display: 'grid',
      gridTemplateColumns: cols,
      gridTemplateRows: isMobile ? 'auto minmax(0, 1fr)' : 'minmax(0, 1fr)',
      overflow: 'hidden',
    }}>
      {/* Mobile: Chat / History / Data switcher, always visible. */}
      {isMobile && <MobileTabBar value={mobileTab} onChange={setMobileTab}/>}

      {/* LEFT: history */}
      {showHistory && <div style={{
        borderRight: isMobile ? 'none' : '1px solid var(--border)',
        background: 'var(--surface)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ padding: isMobile ? '12px 12px 10px' : '20px 18px 14px' }}>
          {/* The brand row repeats the phone's header, so it is desktop-only. */}
          {!isMobile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <SparkBadge direction={direction} size={32}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="page-title" style={{ fontSize: 17, margin: 0 }}>Ivy</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>AI assistant</div>
              </div>
            </div>
          )}
          {mode && <ModeChip mode={mode} modeError={modeError} model={model}/>}
          {mode === 'live' && usage && <UsageMeter usage={usage}/>}
          <button className="btn btn-primary" onClick={newChat}
            style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}>
            <Icons.Plus size={13} sw={2.2}/> New chat
          </button>
        </div>
        <div style={{
          padding: '4px 12px', fontSize: 10, color: 'var(--muted)', fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>
          Recent
        </div>
        <div className="scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 8px 16px' }}>
          {sessions.length === 0 ? (
            <div style={{ padding: 16, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
              No conversations yet.
            </div>
          ) : sessions.map((s) => (
            <SessionRow key={s.id} session={s}
              active={activeId === s.id}
              onOpen={() => { openSession(s.id); if (isMobile) setMobileTab('chat'); }}
              onRemove={() => removeSession(s.id)}/>
          ))}
        </div>
      </div>}

      {/* CENTER */}
      {showChat && <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, background: 'var(--surface-2)' }}>
        <div ref={scrollRef} className="scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: isMobile ? '10px 12px 8px' : 24 }}>
          {/* The insight lives INSIDE the scroll area (it scrolls away rather
              than covering content) and can be closed for the day. */}
          {!insightHidden && (
            <div style={{ maxWidth: 720, margin: isMobile ? '0 0 12px' : '0 auto 16px' }}>
              <InsightBanner context={context} direction={direction} compact={isMobile}
                onClose={hideInsight}
                onAct={(t) => { submit(t); if (isMobile) setMobileTab('chat'); }}/>
            </div>
          )}
          {error && (
            <div style={{
              maxWidth: 720, margin: '0 auto 12px',
              padding: '10px 14px', borderRadius: 10,
              background: 'color-mix(in srgb, var(--danger) 12%, transparent)',
              border: '1px solid var(--danger)', color: 'var(--danger)', fontSize: 12.5,
            }}>
              {error.message || 'Something went wrong.'}
            </div>
          )}
          {!activeId && messages.length === 0 ? (
            <WelcomePanel onPrompt={submit} direction={direction} briefing={briefing} compact={isMobile}/>
          ) : (
            <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {messages.map((m) => (
                <div key={m.id}>
                  <ChatBubble msg={m}/>
                  {m.pendingActions && m.pendingActions.length > 0 && (
                    <PendingActionCard actions={m.pendingActions} busy={thinking}
                      onApprove={() => approvePending(m.id)} onDismiss={() => dismissPending(m.id)}/>
                  )}
                </div>
              ))}
              {thinking && <ThinkingBubble/>}
            </div>
          )}
        </div>

        {/* Composer */}
        <div style={{ padding: isMobile ? '6px 12px 10px' : '16px 24px 24px', background: 'var(--surface-2)' }}>
          <div style={{ maxWidth: 720, margin: '0 auto' }}>
            <div style={{
              display: 'flex', alignItems: 'flex-end', gap: 8,
              padding: 10, borderRadius: 16,
              background: 'var(--surface)', border: '1px solid var(--border-strong)',
              boxShadow: '0 4px 14px -4px rgba(10,12,8,0.08)',
            }}>
              <textarea value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
                placeholder={isMobile ? 'Ask Ivy anything…' : 'Ask Ivy about revenue, retention, pricing, content…'}
                rows={1}
                style={{
                  flex: 1, border: 0, outline: 0, resize: 'none',
                  background: 'transparent', fontFamily: 'inherit', fontSize: 14,
                  lineHeight: 1.5, color: 'var(--fg)', maxHeight: 140, padding: '6px 8px',
                }}/>
              <button className="btn btn-primary" onClick={() => submit()}
                disabled={!draft.trim() || thinking}
                style={{ padding: '8px 12px' }}>
                <Icons.Arrow size={13} sw={2.4}/>
              </button>
            </div>
            {!isMobile && (
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>
                Ivy reads your real Ivy data - clients, finance, calendar - and stays inside this workspace.
              </div>
            )}
          </div>
        </div>
      </div>}

      {/* RIGHT: context panel */}
      {showData && <div style={{
        borderLeft: isMobile ? 'none' : '1px solid var(--border)',
        background: 'var(--surface)',
        padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18,
      }}>
        <UploadAnalyzer
          busy={thinking}
          onAnalyze={(file) => send('', file)}/>
        <DataContext context={context}/>
      </div>}
    </div>
  );
}

// Turns 'claude-opus-4-8' into 'opus 4.8' for display. Resilient to
// future model bumps - IVY_MODEL on the server is the single source
// of truth; this just formats whatever it sends.
function shortModelLabel(modelId) {
  if (!modelId) return 'live';
  const m = String(modelId).match(/^claude-([a-z]+)-(\d+)-(\d+)/i);
  if (!m) return modelId;
  return `${m[1]} ${m[2]}.${m[3]}`;
}

function ModeChip({ mode, modeError, model }) {
  const live = mode === 'live';
  const tooltip = live
    ? 'Connected to Anthropic - replies are generated by Claude.'
    : `Mock mode - set ANTHROPIC_API_KEY in Vercel and redeploy. ${modeError ? '(' + modeError + ')' : ''}`;
  return (
    <div title={tooltip} style={{
      marginTop: 10, padding: '5px 9px', borderRadius: 8, fontSize: 11,
      background: live ? 'color-mix(in srgb, var(--ok) 14%, transparent)' : 'color-mix(in srgb, var(--warn) 14%, transparent)',
      color: live ? 'var(--ok)' : 'var(--warn)',
      border: '1px solid ' + (live ? 'var(--ok)' : 'var(--warn)'),
      display: 'flex', alignItems: 'center', gap: 6,
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: 99,
        background: live ? 'var(--ok)' : 'var(--warn)',
      }}/>
      <span style={{ fontWeight: 600 }}>{live ? 'Claude live' : 'Mock mode'}</span>
      <span style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.8 }}>
        {live ? shortModelLabel(model) : 'no API key'}
      </span>
    </div>
  );
}

function MobileTabBar({ value, onChange }) {
  const tabs = [
    { id: 'chat',    label: 'Chat',    icon: 'Spark' },
    { id: 'history', label: 'History', icon: 'Chat' },
    { id: 'data',    label: 'Data',    icon: 'Trending' },
  ];
  return (
    <div style={{
      display: 'flex', gap: 4, padding: 6, margin: '10px 12px 0',
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10,
    }}>
      {tabs.map((t) => {
        const Icon = Icons[t.icon] || Icons.More;
        const on = value === t.id;
        return (
          <button key={t.id} onClick={() => onChange(t.id)} style={{
            flex: 1, padding: '7px 10px', borderRadius: 8,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            background: on ? 'var(--surface-2)' : 'transparent',
            color: on ? 'var(--fg)' : 'var(--muted)',
            fontSize: 12.5, fontWeight: 550,
          }}>
            <Icon size={14} sw={on ? 1.9 : 1.6}/>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function UsageMeter({ usage }) {
  const reqPct = Math.min(100, Math.round((usage.requests / usage.requestCap) * 100)) || 0;
  const tokPct = Math.min(100, Math.round((usage.outputTokens / usage.outputTokenCap) * 100)) || 0;
  const pct = Math.max(reqPct, tokPct);
  const color = pct >= 90 ? 'var(--danger)' : pct >= 70 ? 'var(--warn)' : 'var(--muted)';
  return (
    <div title={`Today's Ivy usage - resets at midnight UTC.\n${usage.requests}/${usage.requestCap} messages\n${usage.outputTokens.toLocaleString()}/${usage.outputTokenCap.toLocaleString()} reply tokens`}
      style={{ marginTop: 6, fontSize: 10, color: 'var(--muted)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span>Today</span>
        <span className="mono-num" style={{ color }}>{usage.requests}/{usage.requestCap} msgs</span>
      </div>
      <div style={{ height: 3, background: 'var(--surface-2)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width .3s' }}/>
      </div>
    </div>
  );
}

function SparkBadge({ direction, size = 32 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.31,
      background: `linear-gradient(135deg, var(--accent), ${direction === 'bold' ? '#8FE0B4' : '#5966B8'})`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--accent-ink)', flexShrink: 0,
    }}>
      <Icons.Spark size={Math.round(size * 0.5)} sw={2}/>
    </div>
  );
}

function SessionRow({ session, active, onOpen, onRemove }) {
  return (
    <div onClick={onOpen}
      style={{
        display: 'flex', width: '100%', padding: '9px 10px', borderRadius: 8,
        cursor: 'pointer',
        background: active ? 'var(--surface-2)' : 'transparent',
        color: 'var(--fg)', alignItems: 'center', gap: 8,
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--surface-2)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
      <Icons.Chat size={13} sw={1.8} stroke="var(--muted)"/>
      <div style={{
        flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 500,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{session.title}</div>
      <button onClick={(e) => { e.stopPropagation(); onRemove(); }}
        style={{ color: 'var(--muted)', opacity: 0.7, padding: 2, display: 'inline-flex' }}
        title="Delete chat">
        <Icons.X size={11}/>
      </button>
    </div>
  );
}

function InsightBanner({ context, direction, onAct, onClose, compact = false }) {
  const ctx = context || {};
  const headline = pickInsight(ctx);
  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      padding: compact ? '12px 40px 12px 14px' : '18px 44px 18px 20px', borderRadius: 14,
      background: `linear-gradient(110deg, ${direction === 'bold' ? 'var(--accent)' : '#E8E4F2'}, ${direction === 'bold' ? '#8FE0B4' : '#D5DBF2'})`,
      color: direction === 'bold' ? 'var(--accent-ink)' : '#2D2847',
      display: 'flex', alignItems: 'center', gap: 16,
    }}>
      {!compact && (
        <div style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          background: 'rgba(255,255,255,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icons.Spark size={20} sw={2}/>
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: compact ? 10 : 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.75 }}>
          Ivy's insight today
        </div>
        <div className="page-title" style={{ fontSize: compact ? 16 : 20, margin: '2px 0 0' }}>{headline.title}</div>
        <div style={{ fontSize: compact ? 12 : 12.5, opacity: 0.8, marginTop: 3 }}>{headline.body}</div>
        {compact && (
          <button onClick={() => onAct(headline.prompt)} style={{
            marginTop: 8, padding: '7px 12px', borderRadius: 9, border: 0, cursor: 'pointer',
            background: 'rgba(10,12,8,0.85)', color: 'white', fontSize: 12.5, fontWeight: 600,
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            Show me how
            <Icons.Arrow size={11} sw={2.4}/>
          </button>
        )}
      </div>
      {!compact && (
        <button onClick={() => onAct(headline.prompt)} style={{
          padding: '8px 14px', borderRadius: 10, border: 0, cursor: 'pointer',
          background: 'rgba(10,12,8,0.85)', color: 'white', fontSize: 12.5, fontWeight: 600,
          display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
        }}>
          Show me how
          <Icons.Arrow size={11} sw={2.4}/>
        </button>
      )}
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Hide today's insight" style={{
          position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: 999,
          border: 0, cursor: 'pointer', background: 'rgba(10,12,8,0.18)', color: 'inherit',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icons.X size={14} sw={2.2}/>
        </button>
      )}
    </div>
  );
}

function pickInsight(ctx) {
  if ((ctx.openInvoices || 0) > 0) {
    return {
      title: 'Money is sitting in unpaid invoices',
      body: `${ctx.openInvoices} invoice${ctx.openInvoices === 1 ? '' : 's'} open right now. A short nudge often unlocks them.`,
      prompt: 'Help me draft a friendly follow-up for my unpaid invoices.',
    };
  }
  if ((ctx.quietClients || 0) > 0) {
    return {
      title: 'A few clients have gone quiet',
      body: `${ctx.quietClients} active client${ctx.quietClients === 1 ? '' : 's'} hasn't heard from you in 3+ weeks.`,
      prompt: 'Help me write a check-in to my quietest clients.',
    };
  }
  if ((ctx.upcomingSessions || 0) > 0) {
    return {
      title: 'Your next 7 days are booked',
      body: `${ctx.upcomingSessions} session${ctx.upcomingSessions === 1 ? '' : 's'} on the calendar. Pre-confirms cut no-shows.`,
      prompt: 'Draft a quick pre-confirm message for upcoming sessions.',
    };
  }
  return {
    title: 'Kickstart client acquisition',
    body: 'Your funnel has room - three small moves could refill it this week.',
    prompt: 'Help me kickstart client acquisition.',
  };
}

function WelcomePanel({ onPrompt, direction, briefing, compact = false }) {
  const showBriefing = hasBriefing(briefing);
  const prompts = [
    { icon: <Icons.Dollar size={16} sw={1.8}/>,   title: 'Revenue analysis',    body: 'Where is my money coming from this month?',  tone: '#0A8A4B' },
    { icon: <Icons.Users size={16} sw={1.8}/>,    title: 'Client retention',    body: 'Which clients are at risk of churning?',     tone: '#4E63C7' },
    { icon: <Icons.Trending size={16} sw={1.8}/>, title: 'Pricing strategy',    body: 'Am I ready to raise my rates?',              tone: '#C97B22' },
    { icon: <Icons.Calendar size={16} sw={1.8}/>, title: 'Content calendar',    body: 'Plan my next 4 weeks of posts.',             tone: '#7A33C7' },
    { icon: <Icons.Check size={16} sw={1.8}/>,    title: 'Weekly plan',         body: 'What are the 3 things I should do this week?', tone: '#B23A48' },
    { icon: <Icons.Chat size={16} sw={1.8}/>,     title: 'Client outreach',     body: 'Draft a check-in message to quiet clients.', tone: '#0D7E8A' },
  ];

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: compact ? '4px 0 0' : '32px 0' }}>
      <div style={compact
        ? { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }
        : { textAlign: 'center', marginBottom: 32 }}>
        <div style={{ display: 'inline-flex', marginBottom: compact ? 0 : 16, flexShrink: 0 }}>
          <SparkBadge direction={direction} size={compact ? 40 : 56}/>
        </div>
        <div style={{ minWidth: 0 }}>
        <h2 className="page-title" style={{ margin: 0, fontSize: compact ? 22 : 32 }}>
          {showBriefing ? greetingLine(briefing.bizName) : 'Welcome to Ivy'}
        </h2>
        <div style={{ fontSize: compact ? 12.5 : 14, color: 'var(--muted)', marginTop: compact ? 2 : 8, lineHeight: 1.4 }}>
          {showBriefing
            ? "Here's where things stand today. Tap an item and I'll take it from there."
            : 'Your AI assistant. Ask anything or start with a prompt below.'}
        </div>
        </div>
      </div>

      {showBriefing && (
        <div style={{ maxWidth: 520, margin: '0 auto 28px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {briefing.items.map((it, i) => {
            const Icon = Icons[it.icon] || Icons.Spark;
            const tappable = !!it.prompt;
            const body = (
              <>
                <span style={{
                  width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                  background: 'var(--accent-soft)', color: 'var(--accent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}><Icon size={15} sw={1.8}/></span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: 'var(--fg)', textAlign: 'left' }}>{it.text}</span>
                {tappable && <Icons.Arrow size={14} color="var(--muted)"/>}
              </>
            );
            const base = {
              display: 'flex', alignItems: 'center', gap: 12, width: '100%',
              padding: '12px 14px', borderRadius: 12,
              background: 'var(--surface)', border: '1px solid var(--border)',
            };
            return tappable ? (
              <button key={i} type="button" onClick={() => onPrompt(it.prompt)}
                style={{ ...base, cursor: 'pointer', transition: 'border-color .12s' }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-strong)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}>
                {body}
              </button>
            ) : (
              <div key={i} style={base}>{body}</div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: compact ? 8 : 12 }}>
        {prompts.map((p, i) => (
          <button key={i} onClick={() => onPrompt(p.body)} style={{
            padding: compact ? '10px 10px' : 16, borderRadius: 12, cursor: 'pointer', textAlign: 'left',
            background: 'var(--surface)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'flex-start', gap: compact ? 8 : 12,
            transition: 'transform .12s, box-shadow .12s, border-color .12s',
          }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.boxShadow = '0 6px 18px -8px rgba(10,12,8,0.1)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none'; }}>
            <div style={{
              width: compact ? 26 : 32, height: compact ? 26 : 32, borderRadius: 8, flexShrink: 0,
              background: `color-mix(in srgb, ${p.tone} 13%, var(--surface-2))`,
              color: p.tone,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{p.icon}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: compact ? 12.5 : 13.5, fontWeight: 600, marginBottom: 2 }}>{p.title}</div>
              <div style={{ fontSize: compact ? 11 : 12, color: 'var(--muted)', lineHeight: 1.35 }}>{p.body}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ChatBubble({ msg }) {
  const isMe = msg.role === 'me';
  return (
    <div style={{
      display: 'flex', gap: 10, flexDirection: isMe ? 'row-reverse' : 'row',
      alignItems: 'flex-start',
    }}>
      {!isMe && (
        <div style={{
          width: 28, height: 28, borderRadius: 8, flexShrink: 0,
          background: 'linear-gradient(135deg, var(--accent), #8FE0B4)',
          color: 'var(--accent-ink)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icons.Spark size={13} sw={2}/>
        </div>
      )}
      <div style={{
        maxWidth: '82%', padding: '11px 15px', borderRadius: 14,
        fontSize: 13.5, lineHeight: 1.55,
        background: isMe ? 'var(--accent)' : 'var(--surface)',
        color: isMe ? 'var(--accent-ink)' : 'var(--fg)',
        border: isMe ? 'none' : '1px solid var(--border)',
        whiteSpace: isMe ? 'pre-wrap' : 'normal',
      }}>{isMe ? msg.text : <MiniMarkdown text={msg.text}/>}</div>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div style={{
        width: 28, height: 28, borderRadius: 8, flexShrink: 0,
        background: 'linear-gradient(135deg, var(--accent), #8FE0B4)',
        color: 'var(--accent-ink)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icons.Spark size={13} sw={2}/>
      </div>
      <div style={{
        padding: '11px 15px', borderRadius: 14,
        background: 'var(--surface)', border: '1px solid var(--border)',
        display: 'flex', gap: 5, alignItems: 'center',
      }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{
            width: 6, height: 6, borderRadius: 99, background: 'var(--muted)',
            animation: `ivyPulse 1.2s ease-in-out ${i * 0.15}s infinite`,
          }}/>
        ))}
      </div>
      <style>{`@keyframes ivyPulse { 0%,60%,100% { opacity: 0.3; transform: scale(0.9); } 30% { opacity: 1; transform: scale(1.1); } }`}</style>
    </div>
  );
}

// Drop a CSV, PDF, or image and Ivy posts a 1-line user turn with the
// attachment + asks Claude to extract takeaways. The actual analysis
// happens server-side; the file bytes never get persisted to the DB.
function UploadAnalyzer({ onAnalyze, busy }) {
  const inputRef = React.useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [err, setErr]   = useState(null);
  const [pickedName, setPickedName] = useState(null);

  const ACCEPT = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.csv,.tsv,.txt,.md,.json,application/pdf,image/png,image/jpeg,image/gif,image/webp,text/csv,text/plain,text/tab-separated-values,text/markdown,application/json';
  const MAX_BYTES = 3.5 * 1024 * 1024;

  const handle = async (file) => {
    if (!file) return;
    setErr(null);
    if (file.size > MAX_BYTES) {
      setErr(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB - cap is 3.5 MB.`);
      return;
    }
    try {
      const base64 = await fileToBase64(file);
      setPickedName(file.name);
      await onAnalyze({
        filename: file.name,
        mediaType: normalizeMime(file),
        base64,
      });
      setPickedName(null);
    } catch (e) {
      setErr(e?.message || 'Could not read that file.');
      setPickedName(null);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) handle(f);
  };

  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
        Upload report for analysis
      </div>
      <button type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        disabled={busy}
        style={{
          width: '100%', cursor: busy ? 'wait' : 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
          padding: 20, borderRadius: 12,
          border: '1.5px dashed ' + (dragOver ? 'var(--accent)' : 'var(--border-strong)'),
          background: dragOver ? 'color-mix(in srgb, var(--accent-soft) 50%, var(--surface-2))' : 'var(--surface-2)',
          textAlign: 'center', color: 'var(--fg)',
          transition: 'background 0.15s, border-color 0.15s',
        }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10, background: 'var(--surface)',
          border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: busy ? 'var(--accent)' : 'var(--muted)',
        }}>
          {busy ? <span style={{ animation: 'ivyPulse 1.2s ease-in-out infinite', fontSize: 18 }}>•</span>
                : <Icons.Plus size={16} sw={2}/>}
        </div>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>
          {busy ? `Analyzing ${pickedName || 'file'}…` : 'Click or drop a file'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.45 }}>
          CSV, PDF, image, JSON, or plain text. Up to 3.5 MB. Ivy will read it and post the takeaways into your chat.
        </div>
      </button>
      <input ref={inputRef} type="file" hidden accept={ACCEPT}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handle(f); }}/>
      {err && (
        <div style={{
          marginTop: 8, padding: '6px 10px', borderRadius: 8, fontSize: 11.5,
          background: 'rgba(155,44,44,0.08)', border: '1px solid rgba(155,44,44,0.25)',
          color: 'var(--danger)',
        }}>{err}</div>
      )}
    </div>
  );
}

// File extension → MIME fallback. Browsers sometimes give a blank
// `type` for CSVs uploaded from Excel; sniff the suffix instead.
function normalizeMime(file) {
  const t = (file.type || '').toLowerCase();
  if (t) return t;
  const ext = ((file?.name || '').split('.').pop() || '').toLowerCase();
  return {
    csv: 'text/csv', tsv: 'text/tab-separated-values',
    txt: 'text/plain', md: 'text/markdown',
    json: 'application/json',
    pdf: 'application/pdf',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp',
  }[ext] || 'application/octet-stream';
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const result = String(r.result || '');
      // FileReader.readAsDataURL → "data:<mime>;base64,<data>". Strip header.
      const i = result.indexOf(',');
      resolve(i >= 0 ? result.slice(i + 1) : result);
    };
    r.onerror = () => reject(new Error('Could not read file'));
    r.readAsDataURL(file);
  });
}

function DataContext({ context }) {
  const ctx = context || {};
  const fmt$ = (n) => '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
        What Ivy sees
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <DataRow label="Revenue this month"   value={fmt$(ctx.revenueThisMonth)}/>
        <DataRow label="Active clients"       value={ctx.activeClients ?? 0}/>
        <DataRow label="Open invoices"        value={ctx.openInvoices ?? 0} tone={ctx.openInvoices > 0 ? 'warn' : 'neutral'}/>
        <DataRow label="Sessions next 7 days" value={ctx.upcomingSessions ?? 0}/>
        <DataRow label="Quiet clients (3w+)"  value={ctx.quietClients ?? 0}     tone={ctx.quietClients > 0 ? 'warn' : 'neutral'}/>
      </div>
      <div style={{
        marginTop: 12, padding: 10, borderRadius: 8,
        background: 'var(--accent-soft)', color: 'var(--accent)',
        fontSize: 11, lineHeight: 1.5, display: 'flex', gap: 6,
      }}>
        <Icons.Spark size={12} sw={2}/>
        <div>Ivy auto-syncs with Ivy. No data leaves your workspace.</div>
      </div>
    </div>
  );
}

function DataRow({ label, value, tone = 'neutral' }) {
  const colors = { warn: 'var(--warn)', neutral: 'var(--fg)' };
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 10px', borderRadius: 8, background: 'var(--surface-2)',
    }}>
      <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{label}</span>
      <span className="mono-num" style={{ fontSize: 13, fontWeight: 600, color: colors[tone] }}>{value}</span>
    </div>
  );
}
