// Full-screen lock shown on top of the app when "Unlock with Face ID" is
// on. Engages on cold start and again when the app comes back after a
// minute in the background. Native only; mounted once at the App root.
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icons } from './Icons.jsx';
import { api } from '../lib/api.js';
import { clearDeviceCache } from '../lib/deviceCache.js';
import { isNative } from '../lib/platform.js';
import { clearNativeAuthToken } from '../lib/nativeAuth.js';
import { biometricUnlock, biometryInfo, isLockEnabled } from '../lib/biometric.js';

const RELOCK_AFTER_MS = 60_000;

function signedIn() {
  try { return localStorage.getItem('ivy_signed_in') === '1'; } catch { return false; }
}

export default function NativeAppLock() {
  const navigate = useNavigate();
  const [locked, setLocked] = useState(() => isNative() && isLockEnabled() && signedIn());
  const [label, setLabel] = useState('Face ID');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const hiddenAt = useRef(0);

  useEffect(() => {
    if (!isNative()) return undefined;
    biometryInfo().then((i) => { if (i.label) setLabel(i.label); });
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { hiddenAt.current = Date.now(); return; }
      if (isLockEnabled() && signedIn() && hiddenAt.current && Date.now() - hiddenAt.current > RELOCK_AFTER_MS) {
        setNote(''); setLocked(true);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const attempt = async () => {
    setBusy(true); setNote('');
    try { await biometricUnlock(); setLocked(false); }
    catch { setNote(`${label} didn't go through. Try again, or use your password.`); }
    finally { setBusy(false); }
  };

  // Prompt the moment the lock engages - the owner should not have to tap.
  useEffect(() => { if (locked) attempt(); }, [locked]); // eslint-disable-line react-hooks/exhaustive-deps

  const usePassword = async () => {
    setBusy(true);
    try { await api.post('/auth/logout', {}); } catch { /* clearing locally is what matters */ }
    try { await clearNativeAuthToken(); } catch { /* ignore */ }
    try { localStorage.removeItem('ivy_signed_in'); } catch { /* ignore */ }
    clearDeviceCache();
    setLocked(false); setBusy(false);
    navigate('/signin', { replace: true });
  };

  if (!locked) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={`Unlock Ivy with ${label}`} style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: '#042b25', color: '#F3F3EE',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 'calc(env(safe-area-inset-top, 0px) + 24px) 28px calc(env(safe-area-inset-bottom, 0px) + 28px)',
      fontFamily: 'var(--font-sans, Inter, -apple-system, sans-serif)', textAlign: 'center',
    }}>
      <div style={{
        width: 132, height: 132, borderRadius: 30, overflow: 'hidden', background: '#042b25',
        boxShadow: '0 24px 60px -20px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.08)',
      }}>
        <img src="/icon-512.png" alt="" draggable="false" style={{ width: '100%', height: '100%', display: 'block' }}/>
      </div>
      <div style={{ marginTop: 26, fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>Ivy is locked</div>
      <div style={{ marginTop: 8, fontSize: 15, color: '#C9CAC3', maxWidth: '30ch' }}>
        {note || `Use ${label} to open your business.`}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 360, marginTop: 36 }}>
        <button type="button" onClick={attempt} disabled={busy} style={{
          background: '#ECF0F1', color: '#012B24', border: 0, borderRadius: 14, padding: 16,
          font: 'inherit', fontSize: 17, fontWeight: 700, opacity: busy ? 0.7 : 1,
        }}>{busy ? 'Checking…' : `Unlock with ${label}`}</button>
        <button type="button" onClick={usePassword} disabled={busy} style={{
          background: 'transparent', color: '#F3F3EE', border: '1.5px solid rgba(255,255,255,.28)', borderRadius: 14, padding: 15,
          font: 'inherit', fontSize: 16, fontWeight: 600,
        }}>Use password instead</button>
      </div>
    </div>
  );
}
