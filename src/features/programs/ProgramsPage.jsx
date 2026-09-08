// Programs - sell courses, coaching programs and memberships with PDFs,
// posts, videos and a private community. Gated behind a preview password
// while the feature is being built; owners who don't have it see the
// coming-soon page. Once inside, the full builder loads.
import React, { useState } from 'react';
import { Icons } from '../../components/Icons.jsx';

const UNLOCK_KEY = 'ivy_programs_unlocked';
const PREVIEW_PASSWORD = 'IVYTOTHEMOON2026';

function isUnlocked() {
  try { return localStorage.getItem(UNLOCK_KEY) === '1'; } catch { return false; }
}

export default function ProgramsPage() {
  const [unlocked, setUnlocked] = useState(isUnlocked);
  if (unlocked) return <ProgramsBuilder onLock={() => { try { localStorage.removeItem(UNLOCK_KEY); } catch { /* ignore */ } setUnlocked(false); }}/>;
  return <ComingSoon onUnlock={() => { try { localStorage.setItem(UNLOCK_KEY, '1'); } catch { /* ignore */ } setUnlocked(true); }}/>;
}

const FEATURES = [
  { icon: 'Dollar',   title: 'Sell it your way',        body: 'One-time purchase or a monthly subscription, paid straight to your Stripe. No transaction fees from Ivy.' },
  { icon: 'Doc',      title: 'PDFs and written lessons', body: 'Upload workout plans, meal guides, workbooks and templates. Write lessons and articles right inside Ivy.' },
  { icon: 'Globe',    title: 'Video lessons',            body: 'Drop in an unlisted YouTube link and it plays inside the app and the client portal, never in a separate tab.' },
  { icon: 'Users',    title: 'A private community',      body: 'Turn on a members-only feed where clients share wins, ask questions and cheer each other on.' },
  { icon: 'Check',    title: 'Edit without breaking anything', body: 'Add, reorder or remove content any time. Subscriptions and access are never affected by content changes.' },
  { icon: 'Spark',    title: 'Members in your CRM',      body: 'Every buyer becomes a client in Ivy with their program, payments and messages in one place.' },
];

function ComingSoon({ onUnlock }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const submit = (e) => {
    e.preventDefault();
    if (pw.trim() === PREVIEW_PASSWORD) onUnlock();
    else { setErr(true); setPw(''); }
  };
  return (
    <div className="page-pad" style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 820 }}>
      <div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 12px', borderRadius: 999, background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}>
          <Icons.Spark size={13} sw={2}/> Coming soon
        </div>
        <h2 className="page-title" style={{ margin: '14px 0 0', fontSize: 32 }}>Programs</h2>
        <p style={{ margin: '8px 0 0', fontSize: 15, color: 'var(--fg-2)', maxWidth: 560, lineHeight: 1.55 }}>
          Package what you know into a program your clients can buy: coaching curricula, training plans, courses and paid communities. Built for fitness coaches, business coaches and every expert whose clients want more than a session.
        </p>
      </div>

      <div className="grid-auto" style={{ gap: 12 }}>
        {FEATURES.map((f) => {
          const Icon = Icons[f.icon] || Icons.Spark;
          return (
            <div key={f.title} className="card" style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={16} sw={1.8}/>
              </span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{f.title}</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3, lineHeight: 1.45 }}>{f.body}</div>
              </div>
            </div>
          );
        })}
      </div>

      <form onSubmit={submit} className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 420 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Have a preview password?</div>
        <div style={{ position: 'relative' }}>
          <input className="input" type={showPw ? 'text' : 'password'} value={pw} autoComplete="off"
            onChange={(e) => { setPw(e.target.value); setErr(false); }} placeholder="Preview password"
            style={{ paddingRight: 40 }}/>
          <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Hide password' : 'Show password'}
            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', padding: 6, color: 'var(--muted)', display: 'inline-flex' }}>
            {showPw ? <Icons.EyeOff size={16}/> : <Icons.Eye size={16}/>}
          </button>
        </div>
        {err && <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>That password isn't right.</div>}
        <button type="submit" className="btn btn-primary" style={{ justifyContent: 'center' }} disabled={!pw.trim()}>Open the preview</button>
      </form>
    </div>
  );
}

// The builder proper. Replaced slice by slice as the feature lands; until
// then it shows the same preview note so an unlocked tab is never blank.
function ProgramsBuilder({ onLock }) {
  return (
    <div className="page-pad" style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 820 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h2 className="page-title" style={{ margin: 0, fontSize: 32 }}>Programs</h2>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>Preview unlocked. The builder is on its way.</div>
        </div>
        <button className="btn btn-outline" onClick={onLock}>Lock preview</button>
      </div>
      <div className="card" style={{ padding: 20, color: 'var(--muted)', fontSize: 14, lineHeight: 1.55 }}>
        Nothing to build with yet. The next update adds creating a program, pricing it, and adding PDFs, lessons and videos.
      </div>
    </div>
  );
}
