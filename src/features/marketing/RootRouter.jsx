// Decides what to render at "/" based on auth state:
//   • Logged-out  → MarketingHome (web) / the welcome screen (native app)
//   • Logged-in owner (or has both roles) → Navigate to /dashboard
//   • Logged-in client-only → Navigate to /me
//
// The role check is the shared fetchMe() (see lib/landing.js), and the last
// confirmed answer is remembered on the device: a returning user is sent on
// the moment the session resolves, and the fresh /me only confirms it from
// inside RoleRouter. No second round trip, no second "Loading…".
import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.jsx';
import { isNative } from '../../lib/platform.js';
import { fetchMe, decideLanding, rememberLanding, rememberedLanding } from '../../lib/landing.js';
import LaunchFrame from '../../components/LaunchFrame.jsx';
import MarketingHome from './site/SiteHome.jsx';

export default function RootRouter() {
  const { user, loading: authLoading } = useAuth();
  const [decision, setDecision] = useState(null); // 'onboarding' | 'business' | 'client' | null
  const [remembered] = useState(rememberedLanding);

  useEffect(() => {
    if (!user) { setDecision(null); return; }
    let live = true;
    fetchMe()
      .then((r) => {
        const d = decideLanding(r, user);
        rememberLanding(d);
        if (live) setDecision(d);
      })
      .catch(() => live && setDecision('business'));
    return () => { live = false; };
  }, [user]);

  let hasSessionHint = false;
  try { hasSessionHint = localStorage.getItem('ivy_signed_in') === '1'; } catch { /* private mode */ }

  // Native app (Capacitor): there is no "website" to land on. A logged-out
  // user goes straight to the welcome screen - immediately when the device
  // has no session hint, otherwise once the session check says so - and
  // while a likely-signed-in user's session resolves we hold the branded
  // launch frame. Everything below this block is the web behaviour.
  const native = isNative();
  if (native && !user && (!authLoading || !hasSessionHint)) {
    return <Navigate to="/welcome" replace/>;
  }

  // Logged-out → always the marketing home. The controlled-launch waitlist
  // does NOT take over "/"; it only gates the auth entry points (/signin,
  // /signup via EarlyAccessGate), so a visitor sees the normal marketing
  // site and only meets the waitlist when they click "Start free trial" /
  // "Sign up". Keeps the home page public and skips a status round-trip here.
  if (!native && !authLoading && !user) {
    return <MarketingHome/>;
  }

  // While the initial /auth/me is still in flight: cold visitors (no local
  // session hint) get the marketing home painted IMMEDIATELY - a paid-
  // traffic phone visitor used to stare at a blank "Loading…" for a full
  // network round-trip before the hero appeared. If they turn out to be
  // signed in after all, the redirect below kicks in a moment later.
  if (!native && authLoading && !user && !hasSessionHint) {
    return <MarketingHome/>;
  }

  // Logged-in: bounce to the right surface. A remembered landing sends the
  // user on right away; RoleRouter re-verifies with the same cached /me.
  const landing = decision || ((user || (native && hasSessionHint)) ? remembered : null);
  if (landing === 'onboarding') return <Navigate to={{ pathname: '/onboarding', search: window.location.search }} replace/>;
  if (landing === 'client')     return <Navigate to={{ pathname: '/me', search: window.location.search }} replace/>;
  if (landing === 'business')   return <Navigate to={{ pathname: '/dashboard', search: window.location.search }} replace/>;

  // Likely-signed-in (hint present) → keep a neutral frame until we know
  // where to land, because flashing marketing at an active user would feel
  // like a sign-out bug.
  if (native) return <LaunchFrame/>;
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--muted)', fontSize: 13, background: 'var(--page)',
    }}>
      Loading…
    </div>
  );
}
