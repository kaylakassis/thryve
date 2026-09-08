// Programs - sell courses, coaching programs and paid communities with
// PDFs, lessons, videos and a members-only feed. Behind a preview
// password while it is being finished; without it, owners see the
// coming-soon page.
import React, { useEffect, useState } from 'react';
import { upload } from '@vercel/blob/client';
import { api } from '../../lib/api.js';
import { Icons } from '../../components/Icons.jsx';
import EmptyNote from '../../components/EmptyNote.jsx';
import { useUserContext } from '../../lib/userContext.jsx';
import { ContentList, Community, fmtPrice, billingLabel } from './ProgramContent.jsx';

const UNLOCK_KEY = 'ivy_programs_unlocked';
const PREVIEW_PASSWORD = 'IVYTOTHEMOON2026';
const isUnlocked = () => { try { return localStorage.getItem(UNLOCK_KEY) === '1'; } catch { return false; } };

export default function ProgramsPage() {
  const [unlocked, setUnlocked] = useState(isUnlocked);
  if (unlocked) return <Builder onLock={() => { try { localStorage.removeItem(UNLOCK_KEY); } catch { /* ignore */ } setUnlocked(false); }}/>;
  return <ComingSoon onUnlock={() => { try { localStorage.setItem(UNLOCK_KEY, '1'); } catch { /* ignore */ } setUnlocked(true); }}/>;
}

const FEATURES = [
  { icon: 'Dollar', title: 'Sell it your way',           body: 'One-time purchase or a monthly subscription, paid straight to your Stripe. No transaction fees from Ivy.' },
  { icon: 'Doc',    title: 'PDFs and written lessons',   body: 'Upload workout plans, meal guides, workbooks and templates. Write lessons right inside Ivy.' },
  { icon: 'Globe',  title: 'Video lessons',              body: 'Drop in an unlisted YouTube link and it plays inside the app and the client portal, never in a separate tab.' },
  { icon: 'Users',  title: 'A private community',        body: 'A members-only feed where clients share wins, ask questions and cheer each other on.' },
  { icon: 'Check',  title: 'Edit without breaking anything', body: 'Add, reorder or remove content any time. Access and subscriptions are never affected.' },
  { icon: 'Spark',  title: 'Members in your CRM',        body: 'Every buyer becomes a client in Ivy with their program, payments and messages in one place.' },
];

function ComingSoon({ onUnlock }) {
  const [pw, setPw] = useState(''); const [err, setErr] = useState(false); const [show, setShow] = useState(false);
  const submit = (e) => { e.preventDefault(); if (pw.trim() === PREVIEW_PASSWORD) onUnlock(); else { setErr(true); setPw(''); } };
  return (
    <div className="page-pad" style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 820 }}>
      <div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 12px', borderRadius: 999, background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}><Icons.Spark size={13} sw={2}/> Coming soon</div>
        <h2 className="page-title" style={{ margin: '14px 0 0', fontSize: 32 }}>Programs</h2>
        <p style={{ margin: '8px 0 0', fontSize: 15, color: 'var(--fg-2)', maxWidth: 560, lineHeight: 1.55 }}>Package what you know into a program your clients can buy: coaching curricula, training plans, courses and paid communities. Built for fitness coaches, business coaches and every expert whose clients want more than a session.</p>
      </div>
      <div className="grid-auto" style={{ gap: 12 }}>
        {FEATURES.map((f) => { const Icon = Icons[f.icon] || Icons.Spark; return (
          <div key={f.title} className="card" style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon size={16} sw={1.8}/></span>
            <div><div style={{ fontSize: 14, fontWeight: 600 }}>{f.title}</div><div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3, lineHeight: 1.45 }}>{f.body}</div></div>
          </div>); })}
      </div>
      <form onSubmit={submit} className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 420 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Have a preview password?</div>
        <div style={{ position: 'relative' }}>
          <input className="input" type={show ? 'text' : 'password'} value={pw} autoComplete="off" onChange={(e) => { setPw(e.target.value); setErr(false); }} placeholder="Preview password" style={{ paddingRight: 40 }}/>
          <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', padding: 6, color: 'var(--muted)', display: 'inline-flex' }}>{show ? <Icons.EyeOff size={16}/> : <Icons.Eye size={16}/>}</button>
        </div>
        {err && <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>That password isn't right.</div>}
        <button type="submit" className="btn btn-primary" style={{ justifyContent: 'center' }} disabled={!pw.trim()}>Open the preview</button>
      </form>
    </div>
  );
}

// ── Builder ───────────────────────────────────────────────────────────
function Builder({ onLock }) {
  const [programs, setPrograms] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState(null);
  const load = async () => { try { const r = await api.get('/programs'); setPrograms(r.programs || []); } catch (e) { setErr(e.message); setPrograms([]); } };
  useEffect(() => { load(); }, []);
  if (openId) return <ProgramDetail id={openId} onBack={() => { setOpenId(null); load(); }}/>;
  return (
    <div className="page-pad" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h2 className="page-title" style={{ margin: 0, fontSize: 32 }}>Programs</h2>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>Courses, plans and paid communities your clients can buy.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={onLock} title="Hide the preview again">Lock preview</button>
          <button className="btn btn-primary" onClick={() => setCreating(true)}><Icons.Plus size={13} sw={2}/> New program</button>
        </div>
      </div>
      {err && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</div>}
      {programs === null ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
        : programs.length === 0 ? <EmptyNote icon="Gift" title="No programs yet" hint="Create your first program, add lessons, PDFs and videos, then publish it to start selling." action={<button className="btn btn-primary" onClick={() => setCreating(true)}>Create a program</button>}/>
        : (
          <div className="grid-auto" style={{ gap: 12 }}>
            {programs.map((p) => (
              <button key={p.id} type="button" className="card" onClick={() => setOpenId(p.id)} style={{ padding: 16, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: p.status === 'published' ? 'var(--ok)' : 'var(--muted)' }}>{p.status}</span>
                </div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{p.title}</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.description || 'No description yet.'}</div>
                <div style={{ marginTop: 'auto', display: 'flex', gap: 12, fontSize: 12.5, color: 'var(--fg-2)' }}>
                  <span><b>{p.priceCents ? fmtPrice(p.priceCents) : 'Free'}</b> {p.priceCents ? billingLabel(p.billing) : ''}</span>
                  <span>{p.items} item{p.items === 1 ? '' : 's'}</span>
                  <span>{p.members} member{p.members === 1 ? '' : 's'}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      {creating && <ProgramForm onClose={() => setCreating(false)} onSaved={(p) => { setCreating(false); setOpenId(p.id); }}/>}
    </div>
  );
}

function Field({ label, children, hint }) {
  return <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg-2)' }}>{label}</span>{children}{hint && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{hint}</span>}</label>;
}

function Sheet({ title, onClose, children, width = 520 }) {
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 12 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: '100%', maxWidth: width, maxHeight: '92vh', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, fontSize: 18, fontWeight: 600 }}>{title}</div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ padding: 6, color: 'var(--muted)', display: 'inline-flex' }}><Icons.X size={18}/></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ProgramForm({ program, onClose, onSaved }) {
  const [f, setF] = useState({ title: program?.title || '', description: program?.description || '', price: program ? (program.priceCents / 100).toString() : '', billing: program?.billing || 'one_time', accessDays: program?.accessDays ? String(program.accessDays) : '', communityEnabled: program ? program.communityEnabled : true });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    const payload = { title: f.title, description: f.description, priceCents: Math.round(Number(f.price || 0) * 100), billing: f.billing, accessDays: f.billing === 'one_time' && f.accessDays ? Number(f.accessDays) : null, communityEnabled: f.communityEnabled };
    try { const r = program ? await api.patch(`/programs/${program.id}`, payload) : await api.post('/programs', payload); onSaved(r.program); }
    catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  return (
    <Sheet title={program ? 'Edit program' : 'New program'} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Title"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="12-Week Strength Foundations" autoFocus required/></Field>
        <Field label="Description" hint="What's inside and who it's for. Shown on the sales page."><textarea className="input" rows={4} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} style={{ resize: 'vertical' }}/></Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Price" hint="0 = free (add members by hand)"><input className="input" type="number" min="0" step="0.01" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} placeholder="0.00"/></Field>
          <Field label="Billing"><select className="input" value={f.billing} onChange={(e) => setF({ ...f, billing: e.target.value })}><option value="one_time">One-time</option><option value="month">Monthly subscription</option><option value="year">Yearly subscription</option></select></Field>
        </div>
        {f.billing === 'one_time' ? (
          <Field label="Access lasts" hint="Leave blank for lifetime access. Otherwise access ends this many days after purchase (e.g. 56 for an 8-week program).">
            <input className="input" type="number" min="1" max="3650" inputMode="numeric" value={f.accessDays} onChange={(e) => setF({ ...f, accessDays: e.target.value })} placeholder="Forever"/>
          </Field>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>Members keep access while their subscription is active and lose it automatically when it ends or a payment fails.</div>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14 }}><input type="checkbox" checked={f.communityEnabled} onChange={(e) => setF({ ...f, communityEnabled: e.target.checked })}/> Enable the members-only community</label>
        {err && <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy || !f.title.trim()}>{busy ? 'Saving…' : program ? 'Save' : 'Create'}</button></div>
      </form>
    </Sheet>
  );
}

function ItemForm({ programId, item, onClose, onSaved }) {
  const [type, setType] = useState(item?.type || 'post');
  const [f, setF] = useState({ title: item?.title || '', body: item?.body || '', youtube: item?.youtubeId ? `https://youtu.be/${item.youtubeId}` : '', fileUrl: item?.fileUrl || null, fileName: item?.fileName || null });
  const [busy, setBusy] = useState(false); const [uploading, setUploading] = useState(false); const [err, setErr] = useState(null);
  const { ctx } = useUserContext();
  const pick = async (file) => {
    if (!file) return; setUploading(true); setErr(null);
    try {
      const blob = await upload(`programs/${ctx?.owns?.id || 'ws'}/${Date.now()}-${file.name}`, file, { access: 'public', handleUploadUrl: '/api/programs/upload-token' });
      setF({ ...f, fileUrl: blob.url, fileName: file.name, title: f.title || file.name.replace(/\.pdf$/i, '') });
    } catch (ex) { setErr(ex.message || 'Upload failed'); } finally { setUploading(false); }
  };
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const payload = { type, title: f.title, body: f.body, youtube: f.youtube, fileUrl: f.fileUrl, fileName: f.fileName };
      const r = item ? await api.patch(`/programs/${programId}/items`, { itemId: item.id, ...payload }) : await api.post(`/programs/${programId}/items`, payload);
      onSaved(r.item);
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  return (
    <Sheet title={item ? 'Edit content' : 'Add content'} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {!item && (
          <div style={{ display: 'flex', gap: 6 }}>
            {[['post', 'Lesson'], ['pdf', 'PDF'], ['video', 'Video']].map(([t, l]) => <button key={t} type="button" onClick={() => setType(t)} className={`btn ${type === t ? 'btn-primary' : 'btn-outline'}`} style={{ flex: 1, justifyContent: 'center' }}>{l}</button>)}
          </div>
        )}
        <Field label="Title"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required autoFocus/></Field>
        {type === 'video' && <Field label="YouTube link" hint="Unlisted videos work. It plays inside Ivy, not on YouTube."><input className="input" value={f.youtube} onChange={(e) => setF({ ...f, youtube: e.target.value })} placeholder="https://youtu.be/…" required/></Field>}
        {type === 'pdf' && (
          <Field label="PDF file" hint="Up to 25 MB.">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <label className="btn btn-outline" style={{ cursor: 'pointer' }}><Icons.Doc size={13}/> {uploading ? 'Uploading…' : f.fileUrl ? 'Replace PDF' : 'Choose PDF'}<input type="file" accept="application/pdf" hidden onChange={(e) => pick(e.target.files?.[0])}/></label>
              {f.fileName && <span style={{ fontSize: 13, color: 'var(--fg-2)' }}>{f.fileName}</span>}
            </div>
          </Field>
        )}
        <Field label={type === 'post' ? 'Lesson' : 'Notes (optional)'} hint="Plain text with **bold**, *italics* and lists."><textarea className="input" rows={type === 'post' ? 10 : 3} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} style={{ resize: 'vertical' }} required={type === 'post'}/></Field>
        {err && <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy || uploading || (type === 'pdf' && !f.fileUrl)}>{busy ? 'Saving…' : 'Save'}</button></div>
      </form>
    </Sheet>
  );
}

function ProgramDetail({ id, onBack }) {
  const [data, setData] = useState(null); const [tab, setTab] = useState('content');
  const [editing, setEditing] = useState(false); const [adding, setAdding] = useState(false); const [editItem, setEditItem] = useState(null);
  const [addMember, setAddMember] = useState(false); const [err, setErr] = useState(null); const [copied, setCopied] = useState(false);
  const load = async () => { try { setData(await api.get(`/programs/${id}`)); } catch (e) { setErr(e.message); } };
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <div className="page-pad" style={{ color: 'var(--danger)' }}>{err}</div>;
  if (!data) return <div className="page-pad" style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>;
  const { program, items, members } = data;
  const publicUrl = `${window.location.origin}/p/${program.id}`;
  const toggle = async () => { try { await api.patch(`/programs/${id}`, { status: program.status === 'published' ? 'draft' : 'published' }); load(); } catch (e) { setErr(e.message); } };
  const archive = async () => { if (!window.confirm('Archive this program? It stops being sold. Current members keep their access.')) return; try { await api.del(`/programs/${id}`); onBack(); } catch (e) { setErr(e.message); } };
  const removeItem = async (it) => { if (!window.confirm(`Remove "${it.title}"? Members keep their access; only this content goes away.`)) return; try { await api.del(`/programs/${id}/items?itemId=${it.id}`); load(); } catch (e) { setErr(e.message); } };
  const move = async (it, dir) => { const order = items.map((x) => x.id); const i = order.indexOf(it.id); const j = i + dir; if (j < 0 || j >= order.length) return; [order[i], order[j]] = [order[j], order[i]]; try { await api.patch(`/programs/${id}/items`, { order }); load(); } catch (e) { setErr(e.message); } };
  const revoke = async (m) => { if (!window.confirm(`Remove ${m.clientName || m.clientEmail}'s access?`)) return; try { await api.del(`/programs/${id}/members?enrollmentId=${m.id}`); load(); } catch (e) { setErr(e.message); } };
  const copy = async () => { try { await navigator.clipboard.writeText(publicUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { window.prompt('Copy this link', publicUrl); } };
  const activeMembers = members.filter((m) => m.status !== 'cancelled');
  return (
    <div className="page-pad" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <button type="button" onClick={onBack} style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--muted)', fontSize: 13 }}><Icons.Arrow size={13} style={{ transform: 'rotate(180deg)' }}/> All programs</button>
      <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: program.status === 'published' ? 'var(--ok)' : 'var(--muted)' }}>{program.status}</div>
            <h2 className="page-title" style={{ margin: '4px 0 0', fontSize: 26 }}>{program.title}</h2>
            <div style={{ fontSize: 13.5, color: 'var(--fg-2)', marginTop: 6, lineHeight: 1.5 }}>{program.description || 'No description yet.'}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8 }}><b style={{ color: 'var(--fg)' }}>{program.priceCents ? fmtPrice(program.priceCents) : 'Free'}</b> {program.priceCents ? billingLabel(program.billing) : ''}{program.billing === 'one_time' ? ` · access ${program.accessDays ? `${program.accessDays} days` : 'forever'}` : ''} · {activeMembers.length} member{activeMembers.length === 1 ? '' : 's'} · community {program.communityEnabled ? 'on' : 'off'}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-outline" onClick={() => setEditing(true)}>Edit</button>
            <button className="btn btn-primary" onClick={toggle}>{program.status === 'published' ? 'Unpublish' : 'Publish'}</button>
          </div>
        </div>
        {program.status === 'published' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13 }}>
            <span style={{ color: 'var(--muted)' }}>Sales page:</span>
            <a href={publicUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', wordBreak: 'break-all' }}>{publicUrl}</a>
            <button className="btn btn-ghost" style={{ padding: '4px 10px', minHeight: 30, fontSize: 12.5 }} onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
          </div>
        )}
      </div>
      <div className="scroll-x" style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, alignSelf: 'flex-start', maxWidth: '100%' }}>
        {[['content', `Content (${items.length})`], ['members', `Members (${activeMembers.length})`], ['community', 'Community']].map(([t, l]) => (
          <button key={t} type="button" onClick={() => setTab(t)} style={{ padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 550, whiteSpace: 'nowrap', background: tab === t ? 'var(--surface-2)' : 'transparent', color: tab === t ? 'var(--fg)' : 'var(--muted)' }}>{l}</button>
        ))}
      </div>
      {tab === 'content' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" onClick={() => setAdding(true)}><Icons.Plus size={13} sw={2}/> Add content</button></div>
          <ContentList items={items} renderActions={(it) => (
            <span style={{ display: 'inline-flex', gap: 2 }} onClick={(e) => e.stopPropagation()}>
              <button type="button" aria-label="Move up" onClick={() => move(it, -1)} style={{ padding: 6, color: 'var(--muted)' }}>↑</button>
              <button type="button" aria-label="Move down" onClick={() => move(it, 1)} style={{ padding: 6, color: 'var(--muted)' }}>↓</button>
              <button type="button" onClick={() => setEditItem(it)} style={{ padding: 6, color: 'var(--muted)', fontSize: 12.5 }}>Edit</button>
              <button type="button" onClick={() => removeItem(it)} style={{ padding: 6, color: 'var(--muted)', fontSize: 12.5 }}>Remove</button>
            </span>
          )}/>
        </div>
      )}
      {tab === 'members' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" onClick={() => setAddMember(true)}><Icons.Plus size={13} sw={2}/> Add member</button></div>
          {members.length === 0 ? <EmptyNote icon="Users" title="No members yet" hint="Share the sales page, or add someone by hand."/> : (
            <div className="card">
              {members.map((m) => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border)', opacity: m.status === 'cancelled' ? .55 : 1 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.clientName || m.clientEmail}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{m.clientEmail} · {m.source === 'manual' ? 'added by you' : m.source === 'subscription' ? `subscription${m.currentPeriodEnd ? ` · renews ${new Date(m.currentPeriodEnd).toLocaleDateString()}` : ''}` : 'purchased'}{m.expiresAt ? ` · ends ${new Date(m.expiresAt).toLocaleDateString()}` : ''} · {m.status}</div>
                  </div>
                  {m.status !== 'cancelled' && <button type="button" onClick={() => revoke(m)} className="btn btn-ghost" style={{ fontSize: 12.5, padding: '6px 10px', minHeight: 32 }}>Remove access</button>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {tab === 'community' && <Community programId={id} enabled={program.communityEnabled}/>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button type="button" onClick={archive} style={{ fontSize: 12.5, color: 'var(--muted)' }}>Archive program</button></div>
      {editing && <ProgramForm program={program} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }}/>}
      {adding && <ItemForm programId={id} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }}/>}
      {editItem && <ItemForm programId={id} item={editItem} onClose={() => setEditItem(null)} onSaved={() => { setEditItem(null); load(); }}/>}
      {addMember && <AddMember programId={id} onClose={() => setAddMember(false)} onSaved={() => { setAddMember(false); load(); }}/>}
    </div>
  );
}

function AddMember({ programId, onClose, onSaved }) {
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const submit = async (e) => { e.preventDefault(); setBusy(true); setErr(null); try { await api.post(`/programs/${programId}/members`, { name, email }); onSaved(); } catch (ex) { setErr(ex.message); } finally { setBusy(false); } };
  return (
    <Sheet title="Add a member" onClose={onClose} width={440}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>Gives access without a purchase (for clients who paid elsewhere, or for free). They'll see it in their client portal under Programs once they sign in with this email.</div>
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus/></Field>
        <Field label="Email"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required/></Field>
        {err && <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy || !email}>{busy ? 'Adding…' : 'Add member'}</button></div>
      </form>
    </Sheet>
  );
}
