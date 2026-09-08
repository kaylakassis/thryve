// Shared building blocks for programs: the content list (PDF / post /
// video renderers) and the community feed. Used by the owner's builder
// and by the client portal, so members see exactly what the coach sees.
import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Icons } from '../../components/Icons.jsx';
import EmptyNote from '../../components/EmptyNote.jsx';
import { MiniMarkdown } from '../../lib/miniMarkdown.jsx';

export const fmtPrice = (cents, currency = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: cents % 100 ? 2 : 0 }).format((cents || 0) / 100);
export const billingLabel = (b) => b === 'month' ? '/ month' : b === 'year' ? '/ year' : 'one-time';
export const TYPE_META = {
  pdf:   { icon: 'Doc',      label: 'PDF' },
  post:  { icon: 'Chat',     label: 'Lesson' },
  video: { icon: 'Globe',    label: 'Video' },
};

// One content item, expanded inline. Videos play inside the app via the
// privacy-enhanced YouTube embed (never a new tab); PDFs render in an
// inline viewer with an "open" fallback.
export function ContentItem({ item, open, onToggle, actions }) {
  const meta = TYPE_META[item.type] || TYPE_META.post;
  const Icon = Icons[meta.icon] || Icons.Doc;
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <button type="button" onClick={onToggle} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', textAlign: 'left' }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon size={16} sw={1.8}/></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 14.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{meta.label}{item.type === 'pdf' && item.fileName ? ` · ${item.fileName}` : ''}</span>
        </span>
        {actions}
        <Icons.Arrow size={14} stroke="var(--muted)" style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}/>
      </button>
      {open && (
        <div style={{ borderTop: '1px solid var(--border)', padding: 16 }}>
          {item.type === 'video' && item.youtubeId && (
            <div style={{ position: 'relative', paddingTop: '56.25%', borderRadius: 12, overflow: 'hidden', background: '#000' }}>
              <iframe title={item.title} src={`https://www.youtube-nocookie.com/embed/${item.youtubeId}?rel=0&modestbranding=1&playsinline=1`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}/>
            </div>
          )}
          {item.type === 'pdf' && item.fileUrl && (
            <div>
              <iframe title={item.title} src={item.fileUrl} style={{ width: '100%', height: '70vh', border: '1px solid var(--border)', borderRadius: 12, background: 'white' }}/>
              <a href={item.fileUrl} target="_blank" rel="noreferrer" className="btn btn-outline" style={{ marginTop: 10 }}><Icons.Doc size={13}/> Open PDF</a>
            </div>
          )}
          {item.type === 'post' && (
            <div style={{ fontSize: 15, lineHeight: 1.65, color: 'var(--fg)' }}><MiniMarkdown text={item.body || ''}/></div>
          )}
          {item.body && item.type !== 'post' && (
            <div style={{ marginTop: 12, fontSize: 14, lineHeight: 1.6, color: 'var(--fg-2)' }}><MiniMarkdown text={item.body}/></div>
          )}
        </div>
      )}
    </div>
  );
}

export function ContentList({ items, renderActions }) {
  const [openId, setOpenId] = useState(null);
  if (!items.length) return <EmptyNote icon="Doc" title="No content yet" hint="Lessons, PDFs and videos will appear here."/>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((it) => (
        <ContentItem key={it.id} item={it} open={openId === it.id} onToggle={() => setOpenId(openId === it.id ? null : it.id)}
          actions={renderActions ? renderActions(it) : null}/>
      ))}
    </div>
  );
}

const KIND_META = { win: { label: 'Win', color: 'var(--ok)' }, question: { label: 'Question', color: 'var(--warn)' }, post: { label: 'Post', color: 'var(--muted)' } };
const ago = (iso) => { const d = (Date.now() - new Date(iso).getTime()) / 1000; if (d < 60) return 'just now'; if (d < 3600) return `${Math.floor(d / 60)}m ago`; if (d < 86400) return `${Math.floor(d / 3600)}h ago`; return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };

// The members-only feed. Posts are wins, questions or plain posts; replies
// thread underneath. Authors (and the coach) can remove posts.
export function Community({ programId, enabled = true }) {
  const [posts, setPosts] = useState(null);
  const [role, setRole] = useState(null);
  const [kind, setKind] = useState('win');
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const load = async () => {
    try { const r = await api.get(`/programs/${programId}/posts`); setPosts(r.posts || []); setRole(r.role); if (r.role === 'owner') setKind('post'); }
    catch (e) { setErr(e.message); setPosts([]); }
  };
  useEffect(() => { if (enabled) load(); }, [programId, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true); setErr(null);
    try { await api.post(`/programs/${programId}/posts`, { kind, body: body.trim(), parentId: replyTo?.id || null }); setBody(''); setReplyTo(null); await load(); }
    catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };
  const remove = async (id) => { try { await api.del(`/programs/${programId}/posts?postId=${id}`); await load(); } catch (ex) { setErr(ex.message); } };
  if (!enabled) return <EmptyNote icon="Users" title="Community is off" hint="Turn it on in the program settings to let members talk to each other."/>;
  const top = (posts || []).filter((p) => !p.parentId);
  const replies = (id) => (posts || []).filter((p) => p.parentId === id).slice().reverse();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <form onSubmit={submit} className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {replyTo ? (
          <div style={{ fontSize: 12.5, color: 'var(--muted)', display: 'flex', gap: 8, alignItems: 'center' }}>
            Replying to <b style={{ color: 'var(--fg)' }}>{replyTo.authorName}</b>
            <button type="button" onClick={() => setReplyTo(null)} style={{ color: 'var(--accent)', fontSize: 12.5 }}>cancel</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 6 }}>
            {['win', 'question', 'post'].map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)} className={`btn ${kind === k ? 'btn-primary' : 'btn-outline'}`} style={{ padding: '6px 12px', fontSize: 12.5, minHeight: 34 }}>
                {k === 'win' ? '🏆 Share a win' : k === 'question' ? '❓ Ask a question' : '💬 Post'}
              </button>
            ))}
          </div>
        )}
        <textarea className="input" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={replyTo ? 'Write a reply…' : kind === 'win' ? 'What did you accomplish?' : kind === 'question' ? 'What do you want to know?' : 'Share something with the group…'} style={{ resize: 'vertical' }}/>
        {err && <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" className="btn btn-primary" disabled={busy || !body.trim()}>{busy ? 'Posting…' : replyTo ? 'Reply' : 'Post'}</button>
        </div>
      </form>
      {posts === null ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
        : top.length === 0 ? <EmptyNote icon="Users" title="Quiet so far" hint="Be the first to share a win or ask a question."/>
        : top.map((p) => (
          <div key={p.id} className="card" style={{ padding: 14 }}>
            <PostRow post={p} role={role} onReply={() => setReplyTo(p)} onRemove={() => remove(p.id)}/>
            {replies(p.id).map((r) => (
              <div key={r.id} style={{ marginTop: 10, marginLeft: 22, paddingLeft: 12, borderLeft: '2px solid var(--border)' }}>
                <PostRow post={r} role={role} onRemove={() => remove(r.id)}/>
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}

function PostRow({ post, role, onReply, onRemove }) {
  const k = KIND_META[post.kind] || KIND_META.post;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--muted)', flexWrap: 'wrap' }}>
        <b style={{ color: 'var(--fg)' }}>{post.authorName}</b>
        {post.isOwner && <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--accent)' }}>Coach</span>}
        {!post.parentId && post.kind !== 'post' && <span style={{ fontSize: 11, fontWeight: 600, color: k.color }}>{k.label}</span>}
        <span>· {ago(post.createdAt)}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          {onReply && <button type="button" onClick={onReply} style={{ color: 'var(--accent)', fontSize: 12.5 }}>Reply</button>}
          {(post.mine || role === 'owner') && <button type="button" onClick={onRemove} style={{ color: 'var(--muted)', fontSize: 12.5 }}>Remove</button>}
        </span>
      </div>
      <div style={{ marginTop: 6, fontSize: 14.5, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{post.body}</div>
    </div>
  );
}
