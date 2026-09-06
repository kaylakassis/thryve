// Shared user-context provider for routes outside the client portal
// (AppShell, onboarding, account pages). Single fetch of /api/me, exposed
// via the useUserContext() hook so the floating ViewToggle, Paywall, and
// any other consumer share one round-trip.
//
// The /me/* portal already has its own ClientPortalProvider; both expose
// the same `ctx` shape (user, isOwner, isClient, subscription, memberships)
// so a component like ViewToggle can take ctx as a prop and not care which
// provider supplied it.
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { fetchMe } from './landing.js';
import { readCache } from './deviceCache.js';

const Ctx = createContext({ ctx: null, loading: true, error: null, refresh: () => {} });

export function UserContextProvider({ children }) {
  // Native: start from the last-known /me so the shell (name, workspace,
  // subscription state) paints at once; the fresh answer replaces it.
  const [ctx, setCtx] = useState(() => readCache('me'));
  const [loading, setLoading] = useState(() => !readCache('me'));
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    const r = await fetchMe({ force: true });
    setCtx(r);
    return r;
  }, []);

  useEffect(() => {
    let live = true;
    // Shared with RootRouter/RoleRouter: on launch this is the SAME request
    // they already made, not a third round trip (see lib/landing.js).
    fetchMe()
      .then((r) => live && setCtx(r))
      .catch((e) => live && setError(e))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, []);

  return <Ctx.Provider value={{ ctx, loading, error, refresh }}>{children}</Ctx.Provider>;
}

export function useUserContext() {
  return useContext(Ctx);
}
