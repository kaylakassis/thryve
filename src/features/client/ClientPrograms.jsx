// Client portal: the programs this person has access to, and the
// program itself (content + community). Same renderers the coach sees.
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Icons } from '../../components/Icons.jsx';
import EmptyNote from '../../components/EmptyNote.jsx';
import { ContentList, Community } from '../programs/ProgramContent.jsx';

export default function ClientPrograms() {
  const [programs, setPrograms] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { api.get('/me/programs').then((r) => setPrograms(r.programs || [])).catch((e) => { setErr(e.message); setPrograms([]); }); }, []);
  return (
    <div className="page-pad" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 className="page-title" style={{ margin: 0, fontSize: 28 }}>Programs</h2>
        <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>Courses, plans and communities you're part of.</div>
      </div>
      {err && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</div>}
      {programs === null ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
        : programs.length === 0 ? <EmptyNote icon="Gift" title="No programs yet" hint="When a business you work with gives you access to a program, it shows up here."/>
        : (
          <div className="grid-auto" style={{ gap: 12 }}>
            {programs.map((p) => (
              <Link key={p.id} to={`/me/programs/${p.id}`} className="card" style={{ padding: 16, textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--accent)' }}>{p.businessName}</div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{p.title}</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.description}</div>
                <div style={{ marginTop: 'auto', fontSize: 12.5, color: 'var(--fg-2)' }}>{p.items} item{p.items === 1 ? '' : 's'}{p.enrollmentStatus === 'past_due' ? ' · payment past due' : ''}</div>
              </Link>
            ))}
          </div>
        )}
    </div>
  );
}

export function ClientProgram() {
  const { id } = useParams();
  const [data, setData] = useState(null); const [err, setErr] = useState(null); const [tab, setTab] = useState('content');
  useEffect(() => { api.get(`/me/programs/${id}`).then(setData).catch((e) => setErr(e.message)); }, [id]);
  if (err) return <div className="page-pad"><EmptyNote icon="Lock" title="No access" hint={err} action={<Link className="btn btn-outline" to="/me/programs">Back to programs</Link>}/></div>;
  if (!data) return <div className="page-pad" style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>;
  const { program, items } = data;
  return (
    <div className="page-pad" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Link to="/me/programs" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--muted)', fontSize: 13, textDecoration: 'none' }}><Icons.Arrow size={13} style={{ transform: 'rotate(180deg)' }}/> Programs</Link>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--accent)' }}>{program.businessName}</div>
        <h2 className="page-title" style={{ margin: '4px 0 0', fontSize: 26 }}>{program.title}</h2>
        {program.description && <div style={{ fontSize: 13.5, color: 'var(--fg-2)', marginTop: 6, lineHeight: 1.5 }}>{program.description}</div>}
      </div>
      {program.communityEnabled && (
        <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, alignSelf: 'flex-start' }}>
          {[['content', `Content (${items.length})`], ['community', 'Community']].map(([t, l]) => (
            <button key={t} type="button" onClick={() => setTab(t)} style={{ padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 550, background: tab === t ? 'var(--surface-2)' : 'transparent', color: tab === t ? 'var(--fg)' : 'var(--muted)' }}>{l}</button>
          ))}
        </div>
      )}
      {tab === 'content' ? <ContentList items={items}/> : <Community programId={id} enabled={program.communityEnabled}/>}
    </div>
  );
}
