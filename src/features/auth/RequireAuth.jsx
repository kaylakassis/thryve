// Redirects to /signin if there's no authenticated user.
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth.jsx';
import { useTweaks } from '../../lib/tweaks.js';
import { isNative } from '../../lib/platform.js';
import LaunchFrame from '../../components/LaunchFrame.jsx';

export default function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const [tweaks] = useTweaks();
  const location = useLocation();

  if (loading) {
    // Native: a device that remembers a session shows the app immediately
    // and lets /auth/me confirm behind it - the home screen's own requests
    // go out in parallel with the session check instead of after it. If
    // the check fails, the redirect below fires. No hint → hold the veil.
    if (isNative()) {
      let hint = false;
      try { hint = localStorage.getItem('ivy_signed_in') === '1'; } catch { /* private mode */ }
      if (hint) return children;
      return <LaunchFrame/>;
    }
    return (
      <div className={`app-root dir-${tweaks.direction}`} style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--muted)', fontSize: 13,
      }}>
        Loading…
      </div>
    );
  }

  if (!user) {
    return <Navigate to={isNative() ? '/welcome' : '/signin'} replace state={{ from: location.pathname }} />;
  }

  return children;
}
