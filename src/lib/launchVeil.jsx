// The launch veil: one full-screen green frame with the mark, shown from
// the first paint of the web view until the app has something real to
// show, then faded out. It is the SAME picture as the iOS launch
// storyboard, so launch reads as one continuous screen: splash → veil →
// (fade) → home. Nothing white, nothing that jumps.
//
// Anyone still deciding what to render (session check, role check) calls
// useLaunchHold(true); the veil stays up while any hold is active, then
// fades. A hard cap guarantees it can never stick.
import React, { useEffect, useState } from 'react';
import { isNative } from './platform.js';

const holds = new Set();
const listeners = new Set();
let seq = 0;
const notify = () => listeners.forEach((fn) => fn());

export function useLaunchHold(active) {
  useEffect(() => {
    if (!active) return undefined;
    const id = ++seq;
    holds.add(id); notify();
    return () => { holds.delete(id); notify(); };
  }, [active]);
}

const MIN_MS = 420;   // never blink: the veil stays at least this long
const MAX_MS = 6000;  // and never sticks: fade no matter what after this
const FADE_MS = 340;

export default function LaunchVeil() {
  const native = isNative();
  const [phase, setPhase] = useState(native ? 'up' : 'gone'); // up | fading | gone
  useEffect(() => {
    if (!native) return undefined;
    const born = Date.now();
    let timer = 0;
    const check = () => {
      if (holds.size && Date.now() - born < MAX_MS) return;
      const wait = Math.max(0, MIN_MS - (Date.now() - born));
      clearTimeout(timer);
      timer = setTimeout(() => setPhase('fading'), wait);
    };
    listeners.add(check);
    check();
    const cap = setTimeout(() => setPhase('fading'), MAX_MS);
    return () => { listeners.delete(check); clearTimeout(timer); clearTimeout(cap); };
  }, [native]);
  useEffect(() => {
    if (phase !== 'fading') return undefined;
    const t = setTimeout(() => setPhase('gone'), FADE_MS);
    return () => clearTimeout(t);
  }, [phase]);
  if (phase === 'gone') return null;
  return (
    <div aria-hidden="true" style={{
      position: 'fixed', inset: 0, zIndex: 900, background: '#042b25',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      opacity: phase === 'fading' ? 0 : 1, transition: `opacity ${FADE_MS}ms ease`,
      pointerEvents: phase === 'fading' ? 'none' : 'auto',
    }}>
      <div style={{
        width: 132, height: 132, borderRadius: 30, overflow: 'hidden', background: '#042b25',
        boxShadow: '0 24px 60px -20px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.08)',
      }}>
        <img src="/icon-512.png" alt="" draggable="false" style={{ width: '100%', height: '100%', display: 'block' }}/>
      </div>
    </div>
  );
}
