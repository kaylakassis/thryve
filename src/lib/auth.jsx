// Auth context - holds the logged-in user and exposes sign-in / sign-up / sign-out.
import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { api } from './api.js';
import { isNative } from './platform.js';
import { setNativeAuthToken, clearNativeAuthToken } from './nativeAuth.js';
import { clearMeCache, forgetLanding } from './landing.js';
import { clearDeviceCache } from './deviceCache.js';
import { CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION } from './legal.js';

const Ctx = createContext(null);

// Local hint that a session probably exists on this browser. RootRouter
// reads it to decide whether a cold "/" load should optimistically paint
// the marketing home (no hint → almost certainly signed out) instead of a
// blank "Loading…" while /auth/me round-trips. UX only - the server
// session cookie remains the sole source of truth for auth.
function stampSessionHint(signedIn) {
  try {
    if (signedIn) localStorage.setItem('ivy_signed_in', '1');
    else localStorage.removeItem('ivy_signed_in');
  } catch { /* private mode */ }
}

export function AuthProvider({ children }) {
  const [user, setUser]                 = useState(null);
  const [impersonating, setImpersonating] = useState(null);
  const [terms, setTerms]               = useState(null);
  const [loading, setLoading]           = useState(true);

  useEffect(() => {
    let live = true;
    api.get('/auth/me')
      .then((r) => {
        if (!live) return;
        setUser(r.user);
        setImpersonating(r.impersonating || null);
        setTerms(r.terms || null);
        stampSessionHint(!!r.user);
      })
      .catch(() => { if (live) { setUser(null); stampSessionHint(false); } })
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, []);

  // Holds the native-only mfa token between /auth/login and the challenge.
  // (Web carries it in an httpOnly cookie the server sets on login.)
  const mfaTokenRef = useRef(null);

  const signIn = useCallback(async (email, password) => {
    const r = await api.post('/auth/login', { email, password });
    // Native shell: cookies do not survive the cross-origin hop, so the
    // server also returns the session token. Keep it on the device.
    if (isNative() && r?.token) await setNativeAuthToken(r.token);
    if (r.mfaRequired) {
      // Password OK but this account has 2FA on — hold here; the caller shows a
      // code screen and calls mfaChallenge().
      mfaTokenRef.current = r.mfaToken || null;
      return { mfaRequired: true };
    }
    clearMeCache(); clearDeviceCache();
    setUser(r.user);
    stampSessionHint(true);
    return r.user;
  }, []);

  // Second factor: exchange a 6-digit TOTP or a backup code for a real session.
  const mfaChallenge = useCallback(async (code) => {
    const r = await api.post('/auth/totp/challenge', {
      code,
      ...(mfaTokenRef.current ? { mfaToken: mfaTokenRef.current } : {}),
    });
    if (isNative() && r?.token) await setNativeAuthToken(r.token);
    mfaTokenRef.current = null;
    clearMeCache(); clearDeviceCache();
    setUser(r.user);
    stampSessionHint(true);
    return r.user;
  }, []);

  // mode: 'owner' (default - creates a workspace) or 'client' (no workspace,
  // claims existing client records by email match).
  // ref: optional affiliate code preserved from ?ref=CODE on the signup URL.
  // The Terms version is pinned at compile time on the client and
  // re-validated server-side; passing it explicitly creates an audit
  // trail tying the bytes the user actually saw to the row we
  // record.
  const signUp = useCallback(async (email, password, name, mode = 'owner', ref = null) => {
    const r = await api.post('/auth/signup', {
      email, password, name, mode, ref,
      // The AuthPage checkbox says "I agree to the Terms and Privacy
      // Policy" - one click covers both. Send both versions so the
      // server can record an immutable acceptance row per document.
      acceptedTermsVersion: CURRENT_TERMS_VERSION,
      acceptedPrivacyVersion: CURRENT_PRIVACY_VERSION,
    });
    // Native shell: cookies do not survive the cross-origin hop, so the
    // server also returns the session token. Keep it on the device.
    if (isNative() && r?.token) await setNativeAuthToken(r.token);
    // A brand-new account must ALWAYS be eligible for onboarding. The
    // onboarding-skip flag is per-browser, not per-account, so a stale one
    // left by a PREVIOUS account on this device (owner deleted + re-signed
    // up, or a shared device) would make RoleRouter wrongly bypass the
    // wizard. Clear it at account creation so a fresh owner always onboards.
    try { localStorage.removeItem('ivy_skip_onboarding_until'); } catch { /* private mode */ }
    clearMeCache(); clearDeviceCache();
    setUser(r.user);
    stampSessionHint(true);
    return r;
  }, []);

  const signOut = useCallback(async () => {
    // Always clear local auth state even if the network call fails, so the
    // user is never stuck "logged in" with no feedback when offline / on a 5xx.
    try { await api.post('/auth/logout'); }
    finally {
      // Native: forget the token stored on the device, network or not.
      if (isNative()) await clearNativeAuthToken().catch(() => {});
      setUser(null); setImpersonating(null); setTerms(null);
      stampSessionHint(false);
      // Forget this account's role answer and remembered landing so the next
      // sign-in on this device starts from a clean slate.
      clearMeCache(); forgetLanding(); clearDeviceCache();
      // Don't let a per-browser onboarding-skip flag leak into whoever signs
      // in next on this device (e.g. after an account deletion).
      try { localStorage.removeItem('ivy_skip_onboarding_until'); } catch { /* private mode */ }
    }
  }, []);

  // Refresh the user (e.g. after email verification) so UI flips immediately.
  const refresh = useCallback(async () => {
    try {
      const r = await api.get('/auth/me');
      setUser(r.user);
      setImpersonating(r.impersonating || null);
      setTerms(r.terms || null);
      // Local session hint: lets RootRouter render the marketing home
      // instantly for cold signed-out visitors (no hint) instead of a
      // blank "Loading…" while /auth/me round-trips. Purely a UX hint -
      // never trusted for auth decisions.
      try {
        if (r.user) localStorage.setItem('ivy_signed_in', '1');
        else localStorage.removeItem('ivy_signed_in');
      } catch { /* private mode */ }
      return r.user;
    } catch {
      setUser(null);
      setImpersonating(null);
      setTerms(null);
      return null;
    }
  }, []);

  // Auto-detect email verification that happens OUTSIDE this tab - the
  // verify link usually opens in a new tab (or gets clicked on the
  // user's phone), so this tab's user snapshot goes stale and the
  // "Confirm your email" banner never leaves. While the signed-in user
  // is unverified: re-check on focus/visibility, listen for the
  // cross-tab localStorage beacon the verify page writes, and poll
  // gently as a cross-device fallback. Tears down as soon as the user
  // is verified (or signed out).
  useEffect(() => {
    if (!user || user.email_verified_at) return undefined;
    const check = () => { refresh(); };
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    const onStorage = (e) => { if (e.key === 'ivy_email_verified_beacon') check(); };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('storage', onStorage);
    const iv = setInterval(check, 45000);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('storage', onStorage);
      clearInterval(iv);
    };
  }, [user?.id, user?.email_verified_at, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  // Records the user's acceptance of the current Terms version.
  // Server gates by version, then writes both an immutable
  // legal_acceptances row and the denormalized users.terms_version
  // snapshot. After it returns, refresh /api/auth/me so the
  // mustAcceptTerms flag flips off.
  const acceptCurrentTerms = useCallback(async () => {
    await api.post('/me/accept-terms', { version: CURRENT_TERMS_VERSION });
    await refresh();
  }, [refresh]);

  return (
    <Ctx.Provider value={{
      user, loading, signIn, mfaChallenge, signUp, signOut, refresh, impersonating,
      terms,
      mustAcceptTerms: !!(user && terms?.needsAcceptance),
      acceptCurrentTerms,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
