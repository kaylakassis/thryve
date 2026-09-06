import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './lib/auth.jsx';
import { initMonitoring, ErrorBoundary } from './lib/monitoring.js';
import { tryStaleChunkRecovery } from './lib/staleChunk.js';
import { registerServiceWorker } from './lib/pwa.js';
import { initNativeStatusBar } from './lib/nativeStatusBar.js';
import { isNative } from './lib/platform.js';
import App from './App.jsx';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/global.css';

initMonitoring();

// Lets the stylesheet give the phone app its own chrome (see the
// "NATIVE APP" block in global.css) without touching the web.
if (isNative()) document.documentElement.classList.add('native');

// Global capture for everything that escapes a React error boundary:
//   • Promise rejections that no .catch() handled
//   • Synchronous errors thrown outside React (timers, listeners)
//   • Vite's preloadError event for failed dynamic imports
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (e) => {
    // eslint-disable-next-line no-console
    console.warn('[vite:preloadError] stale chunk; reloading.', e?.payload || e);
    tryStaleChunkRecovery({ message: 'Failed to fetch dynamically imported module' });
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (tryStaleChunkRecovery(e?.reason)) return;
    // eslint-disable-next-line no-console
    console.error('[unhandledrejection]', e?.reason?.message || '', e?.reason);
  });
  window.addEventListener('error', (e) => {
    if (tryStaleChunkRecovery(e?.error || { message: e?.message })) return;
    // eslint-disable-next-line no-console
    console.error('[window error]', e?.error || e?.message || e);
  });
}


function FatalFallback({ resetError, error }) {
  // If the error is a stale-chunk failure (user has an old tab open
  // after a Vercel redeploy), reload immediately instead of showing
  // the snag screen. The reload picks up the fresh index.html and
  // re-fetches the new asset hashes. Gated by sessionStorage cooldown
  // so we don't loop on a genuinely-broken deploy.
  if (tryStaleChunkRecovery(error)) return null;
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, background: 'var(--page, #F6F5F1)', color: 'var(--fg, #141414)',
      fontFamily: '-apple-system, system-ui, "Inter", sans-serif',
    }}>
      <div style={{
        maxWidth: 480, padding: 32, borderRadius: 14,
        background: 'var(--surface, #FFFFFF)', border: '1px solid var(--border, #E8E4DC)',
        textAlign: 'center',
      }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 500, fontFamily: 'var(--font-display)' }}>
          Something broke.
        </h1>
        <p style={{ margin: '0 0 20px', fontSize: 14, color: 'var(--muted, #85827B)', lineHeight: 1.55 }}>
          Sorry about that. We've logged it and will take a look.
          You can try again, or refresh the page.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button onClick={resetError}
            style={{
              padding: '10px 18px', borderRadius: 10, border: 0, cursor: 'pointer',
              background: 'var(--accent, #004225)', color: 'var(--accent-ink, #FFFFFF)',
              fontWeight: 550, fontSize: 14,
            }}>
            Try again
          </button>
          <button onClick={() => window.location.reload()}
            style={{
              padding: '10px 18px', borderRadius: 10, cursor: 'pointer',
              background: 'transparent', color: 'var(--fg-2, #3F3D38)',
              border: '1px solid var(--border-strong, #D9D3C6)', fontSize: 14,
            }}>
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary fallback={({ resetError, error }) => <FatalFallback resetError={resetError} error={error}/>}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);

// Offline app shell + install/update prompts (no-op in dev).
registerServiceWorker();
initNativeStatusBar();
