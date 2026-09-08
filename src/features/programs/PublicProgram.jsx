// /p/:id - the public sales page for a published program. Shows the
// outline (titles only), the price, and a name + email form that sends
// the buyer to Stripe Checkout on the coach's account. Access is granted
// by the webhook after payment; the buyer then signs in to the client
// portal with the same email.
import React, { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useTweaks } from '../../lib/tweaks.js';
import { Icons } from '../../components/Icons.jsx';
import { fmtPrice, billingLabel, TYPE_META } from './ProgramContent.jsx';

export default function PublicProgram() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const [tweaks] = useTweaks();
  const [data, setData] = useState(null); const [err, setErr] = useState(null);
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [busy, setBusy] = useState(false); const [formErr, setFormErr] = useState(null);
  useEffect(() => { api.get(`/programs/public/${id}`).then(setData).catch((e) => setErr(e.message)); }, [id]);
  const purchased = params.get('purchased') === '1';
  const buy = async (e) => {
    e.preventDefault(); setBusy(true); setFormErr(null);
    try { const r = await api.post('/programs/checkout', { programId: id, name, email }); window.location.assign(r.url); }
    catch (ex) { setFormErr(ex.message); setBusy(false); }
  };
  const shell = (children) => (
    <div className={`app-root dir-${tweaks.direction}`} style={{ minHeight: '100vh', padding: '24px 16px 48px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>{children}</div>
    </div>
  );
  if (err) return shell(<div className="card" style={{ padding: 24, textAlign: 'center' }}><div style={{ fontSize: 18, fontWeight: 600 }}>This program isn't available.</div><div style={{ color: 'var(--muted)', fontSize: 13.5, marginTop: 6 }}>{err}</div></div>);
  if (!data) return shell(<div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>);
  const { program, outline, business, currency } = data;
  const free = !program.priceCents;
  return shell(<>
    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--accent)' }}>{business.name}</div>
    <div>
      <h1 className="page-title" style={{ margin: 0, fontSize: 34 }}>{program.title}</h1>
      {program.description && <p style={{ margin: '10px 0 0', fontSize: 15.5, lineHeight: 1.6, color: 'var(--fg-2)', whiteSpace: 'pre-wrap' }}>{program.description}</p>}
    </div>
    {purchased ? (
      <div className="card" style={{ padding: 20, borderColor: 'var(--ok)' }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>You're in.</div>
        <div style={{ fontSize: 14, color: 'var(--fg-2)', marginTop: 6, lineHeight: 1.55 }}>Your payment went through. Sign in (or create a free client account) with the same email you used at checkout and the program will be waiting under <b>Programs</b>.</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <Link to={`/signup?mode=client&next=${encodeURIComponent('/me/programs')}`} className="btn btn-primary">Create your account</Link>
          <Link to={`/signin?next=${encodeURIComponent('/me/programs')}`} className="btn btn-outline">Sign in</Link>
        </div>
      </div>
    ) : (
      <form onSubmit={buy} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-.02em' }}>{free ? 'Free' : fmtPrice(program.priceCents, currency)}</span>
          {!free && <span style={{ color: 'var(--muted)', fontSize: 14 }}>{billingLabel(program.billing)}</span>}
        </div>
        {free ? (
          <div style={{ fontSize: 14, color: 'var(--fg-2)', lineHeight: 1.5 }}>This program is free. Ask {business.name} to add you and it will appear in your client portal.</div>
        ) : (<>
          <input className="input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name"/>
          <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email"/>
          {formErr && <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>{formErr}</div>}
          <button type="submit" className="btn btn-primary" style={{ justifyContent: 'center', padding: 14, fontSize: 15 }} disabled={busy}>{busy ? 'Opening checkout…' : program.billing === 'one_time' ? 'Buy now' : 'Subscribe'}</button>
          <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>Secure checkout by Stripe. Paid directly to {business.name}.{program.billing !== 'one_time' ? ' Cancel any time.' : ''}</div>
        </>)}
      </form>
    )}
    {outline.length > 0 && (
      <div className="card" style={{ padding: 4 }}>
        <div style={{ padding: '12px 16px 6px', fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>What's inside · {outline.length} item{outline.length === 1 ? '' : 's'}</div>
        {outline.map((o) => { const m = TYPE_META[o.type] || TYPE_META.post; const Icon = Icons[m.icon] || Icons.Doc; return (
          <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
            <span style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon size={14} sw={1.8}/></span>
            <span style={{ flex: 1, fontSize: 14 }}>{o.title}</span>
            <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{m.label}</span>
            <Icons.Lock size={13} stroke="var(--muted-2)"/>
          </div>); })}
      </div>
    )}
    {program.communityEnabled && <div style={{ fontSize: 13, color: 'var(--muted)', display: 'flex', gap: 8, alignItems: 'center' }}><Icons.Users size={14}/> Includes a private members community.</div>}
  </>);
}
