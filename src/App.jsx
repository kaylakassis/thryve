// Top-level route table. Most route components are lazy-loaded so a
// fresh visit to /signin doesn't pull the entire business app + admin
// console into the initial bundle. Eager:
//   AuthPage, AppShell, ClientShell, RootRouter, RequireAuth, RoleRouter
//   - first-paint critical or used by every authenticated request.
// Everything else loads on demand inside <Suspense>; the fallback is a
// minimal centered spinner so navigation never feels stuck.
import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { isNative } from './lib/platform.js';
import AppShell from './components/layout/AppShell.jsx';
import ViewToggle from './components/ViewToggle.jsx';
import PWAPrompts from './components/PWAPrompts.jsx';
import NativeAppLock from './components/NativeAppLock.jsx';
import LaunchVeil from './lib/launchVeil.jsx';
import RequireAuth from './features/auth/RequireAuth.jsx';
import AuthPage from './features/auth/AuthPage.jsx';
import EarlyAccessGate from './features/auth/EarlyAccessGate.jsx';
import RoleRouter from './features/auth/RoleRouter.jsx';
import RootRouter from './features/marketing/RootRouter.jsx';
import ClientShell from './features/client/ClientShell.jsx';
import { ClientPortalProvider } from './features/client/clientContext.jsx';
import { ErrorBoundary } from './lib/monitoring.js';
import { tryStaleChunkRecovery } from './lib/staleChunk.js';
import { isPlatformHost } from './lib/publicUrl.js';

// ── Lazy: business app pages ──
const Dashboard   = lazy(() => import('./features/dashboard/Dashboard.jsx'));
const Clients     = lazy(() => import('./features/clients/Clients.jsx'));
const Projects    = lazy(() => import('./features/projects/Projects.jsx'));
const Calendar    = lazy(() => import('./features/calendar/Calendar.jsx'));
const Finance     = lazy(() => import('./features/finance/Finance.jsx'));
const Goals       = lazy(() => import('./features/goals/Goals.jsx'));
const Workflows   = lazy(() => import('./features/workflows/Workflows.jsx'));
const Rewards     = lazy(() => import('./features/rewards/Rewards.jsx'));
const Referrals   = lazy(() => import('./features/referrals/Referrals.jsx'));
const Reviews     = lazy(() => import('./features/reviews/Reviews.jsx'));
const Messages    = lazy(() => import('./features/messages/Messages.jsx'));
const Campaigns   = lazy(() => import('./features/campaigns/Campaigns.jsx'));
const Documents   = lazy(() => import('./features/documents/Documents.jsx'));
const Website     = lazy(() => import('./features/website/Website.jsx'));
const IvyPro      = lazy(() => import('./features/ivy/IvyPro.jsx'));
const AccountPage = lazy(() => import('./features/account/AccountPage.jsx'));
const AdminPage   = lazy(() => import('./features/admin/AdminPage.jsx'));
const MorePage    = lazy(() => import('./features/more/MorePage.jsx'));

// ── Lazy: client portal ──
const ClientHome      = lazy(() => import('./features/client/ClientHome.jsx'));
const ClientMessages  = lazy(() => import('./features/client/ClientMessages.jsx'));
const ClientBookings  = lazy(() => import('./features/client/ClientBookings.jsx'));
const ClientInvoices  = lazy(() => import('./features/client/ClientInvoices.jsx'));
const ClientOrders    = lazy(() => import('./features/client/ClientOrders.jsx'));
const ClientDocuments = lazy(() => import('./features/client/ClientDocuments.jsx'));
const ClientBilling   = lazy(() => import('./features/client/ClientBilling.jsx'));
const ClientDiscover  = lazy(() => import('./features/client/ClientDiscover.jsx'));
const ClientNotifications = lazy(() => import('./features/client/ClientNotifications.jsx'));
const ClientProfile   = lazy(() => import('./features/client/ClientProfile.jsx'));
const AcceptGroupInvite = lazy(() => import('./features/client/AcceptGroupInvite.jsx'));
const NotFoundPage    = lazy(() => import('./features/marketing/NotFoundPage.jsx'));

// ── Lazy: secondary auth flows + onboarding ──
const ForgotPasswordPage = lazy(() => import('./features/auth/ForgotPasswordPage.jsx'));
const ResetPasswordPage  = lazy(() => import('./features/auth/ResetPasswordPage.jsx'));
const VerifyEmailPage    = lazy(() => import('./features/auth/VerifyEmailPage.jsx'));
const AccountRecoverPage = lazy(() => import('./features/auth/AccountRecoverPage.jsx'));
const OnboardingPage     = lazy(() => import('./features/onboarding/OnboardingPage.jsx'));

// ── Lazy: public surfaces (often a fresh visit's first hit) ──
const PublicBooking = lazy(() => import('./features/calendar/PublicBooking.jsx'));
const PublicSite    = lazy(() => import('./features/website/PublicSite.jsx'));
const EmbedContact  = lazy(() => import('./features/embed/EmbedContact.jsx'));
const SignPage      = lazy(() => import('./features/documents/SignPage.jsx'));
const PublicInvoice = lazy(() => import('./features/finance/PublicInvoice.jsx'));
const PublicQuote   = lazy(() => import('./features/finance/PublicQuote.jsx'));
const ReviewPage    = lazy(() => import('./features/reviews/ReviewPage.jsx'));
const PrivacyPage   = lazy(() => import('./features/legal/PrivacyPage.jsx'));
const TermsPage     = lazy(() => import('./features/legal/TermsPage.jsx'));
const DoNotSellPage = lazy(() => import('./features/legal/DoNotSellPage.jsx'));
const SiteAbout     = lazy(() => import('./features/marketing/site/SiteAbout.jsx'));
const WelcomePage   = lazy(() => import('./features/auth/WelcomePage.jsx'));
const SiteSupport   = lazy(() => import('./features/marketing/site/SiteSupport.jsx'));
const VerticalPage  = lazy(() => import('./features/marketing/VerticalPage.jsx'));
const SitePricing     = lazy(() => import('./features/marketing/site/SitePricing.jsx'));
const SiteTour        = lazy(() => import('./features/marketing/site/SiteTour.jsx'));
const SiteFeatures    = lazy(() => import('./features/marketing/site/SiteFeatures.jsx'));
const SiteCompare     = lazy(() => import('./features/marketing/site/SiteCompare.jsx'));
const ComparePage     = lazy(() => import('./features/marketing/ComparePage.jsx'));
const SecurityPage    = lazy(() => import('./features/marketing/SecurityPage.jsx'));
const MobilePage      = lazy(() => import('./features/marketing/MobilePage.jsx'));
const IntegrationsPage = lazy(() => import('./features/marketing/IntegrationsPage.jsx'));
const WaitlistPage    = lazy(() => import('./features/auth/WaitlistPage.jsx'));

// Centered, low-key spinner. Avoids blank-flash but doesn't fight the
// destination page's own loader for visual real estate. Lives inside
// the route so it only renders during chunk fetches.
function RouteFallback() {
  return (
    <div style={{
      minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--muted)', fontSize: 13,
    }}>
      <div style={{
        width: 12, height: 12, borderRadius: 99,
        border: '2px solid var(--border)',
        borderTopColor: 'var(--accent)',
        animation: 'ivy-spin 0.7s linear infinite',
      }}/>
    </div>
  );
}

// Page-scoped failure card. Surface enough info that a user can
// recover OR get unstuck:
//   • Show the actual error message (it's their session; safe to show).
//   • "Try again" - resets the boundary.
//   • "Go home"  - hard navigate to /, clears the route, clears any
//     localStorage onboarding gate so a fresh load isn't trapped.
//   • "Sign out" - clears auth cookie and bounces.
//   • Email link with the error pre-filled.
function RouteCrash({ resetError, error }) {
  // First: if this is a stale-chunk error from a fresh Vercel deploy,
  // hard-reload to fetch the new index.html. The user never sees this
  // screen in that case.
  if (tryStaleChunkRecovery(error)) return null;
  const msg = (error && (error.message || String(error))) || 'unknown';
  const goHome = () => {
    try {
      // If the user has a stale onboarding-skip flag from a prior session
      // it could be sending them through a broken redirect chain. Clear
      // it on hard recovery.
      localStorage.removeItem('ivy_skip_onboarding_until');
    } catch { /* private mode */ }
    window.location.href = '/';
  };
  const signOut = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    try { localStorage.clear(); } catch {}
    window.location.href = '/';
  };
  const mail = `mailto:hello@joinivy.ai?subject=${encodeURIComponent('Error on Ivy')}&body=${encodeURIComponent(`I hit an error: ${msg}\n\nURL: ${typeof window !== 'undefined' ? window.location.href : ''}\n\n`)}`;
  return (
    <div style={{
      minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div className="card" style={{
        maxWidth: 480, padding: 28, textAlign: 'center',
      }}>
        <div style={{
          fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 500,
          letterSpacing: '-0.02em', marginBottom: 10,
        }}>Something went wrong.</div>
        <div style={{ color: 'var(--muted)', fontSize: 13.5, lineHeight: 1.55, marginBottom: 14 }}>
          We've logged it on our side. While we look into it, you can try a
          few things below to get back to work.
        </div>
        <div style={{
          fontSize: 11.5, color: 'var(--muted-2)', background: 'var(--surface-2)',
          border: '1px solid var(--border)', borderRadius: 8,
          padding: '8px 10px', marginBottom: 18, fontFamily: 'ui-monospace, monospace',
          wordBreak: 'break-word', textAlign: 'left',
        }}>
          {msg.slice(0, 280)}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button onClick={resetError} className="btn btn-primary"
            style={{ padding: '8px 16px' }}>Try again</button>
          <button onClick={goHome} className="btn btn-outline"
            style={{ padding: '8px 16px' }}>Go home</button>
          <button onClick={signOut} className="btn btn-outline"
            style={{ padding: '8px 16px' }}>Sign out</button>
        </div>
        <div style={{ marginTop: 14, fontSize: 12.5 }}>
          <a href={mail} style={{ color: 'var(--accent)' }}>Email us for help</a>
        </div>
      </div>
    </div>
  );
}

// Marketing pages exist for the website only. Inside the native app they
// would render the dark site chrome (nav, footer, "Get started") around a
// user who is already in the app, so on Capacitor they bounce to "/", which
// RootRouter then resolves to sign-in or the app. The web is unaffected.
function WebOnly({ children }) {
  return isNative() ? <Navigate to="/" replace/> : children;
}
// The mirror image: screens that only make sense inside the native shell.
function NativeOnly({ children }) {
  return isNative() ? children : <Navigate to="/" replace/>;
}

export default function App() {
  // Custom-domain mode: when the app is loaded on a business owner's
  // connected custom domain (not a platform host), the ONLY thing that
  // domain serves is that owner's published site, resolved server-side
  // by host. The dashboard, auth, and marketing live only on the
  // platform domain. /book/:slug stays available so the site's
  // "Book a session" button works on the custom domain too.
  const onCustomDomain = typeof window !== 'undefined'
    && !isPlatformHost(window.location.host);
  if (onCustomDomain) {
    return (
      <Suspense fallback={<RouteFallback/>}>
        <ErrorBoundary fallback={({ resetError, error }) => <RouteCrash resetError={resetError} error={error}/>}>
          <Routes>
            <Route path="/book/:slug" element={<PublicBooking />} />
            <Route path="*"           element={<PublicSite byHost />} />
          </Routes>
        </ErrorBoundary>
      </Suspense>
    );
  }

  return (
    <>
    <Suspense fallback={<RouteFallback/>}>
      <ErrorBoundary fallback={({ resetError, error }) => <RouteCrash resetError={resetError} error={error}/>}>
      <Routes>
        {/* Public marketing landing - also handles "I'm logged in, where to?"
            redirect for authenticated users. */}
        <Route path="/" element={<RootRouter />} />

        {/* Auth - primary entry pages are eager (first paint); the
            secondary flows (forgot/reset/verify) load lazily. */}
        <Route path="/welcome"         element={<NativeOnly><WelcomePage /></NativeOnly>} />
        <Route path="/signin"          element={<EarlyAccessGate mode="signin"><AuthPage mode="signin" /></EarlyAccessGate>} />
        <Route path="/signup"          element={<EarlyAccessGate><AuthPage mode="signup" /></EarlyAccessGate>} />
        {/* Directly-linkable waitlist landing (for marketing/social). "/"
            also renders this for logged-out visitors when launch mode is
            'waitlist' (see RootRouter), which passes the real beta-password
            availability. The direct link shows join only. */}
        <Route path="/waitlist"        element={<WaitlistPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password"  element={<ResetPasswordPage />} />
        <Route path="/verify-email"    element={<VerifyEmailPage />} />
        <Route path="/account-recover" element={<AccountRecoverPage />} />

        {/* Public */}
        <Route path="/book/:slug"      element={<PublicBooking />} />
        <Route path="/site/:handle"        element={<PublicSite />} />
        <Route path="/site/:handle/:slug"  element={<PublicSite />} />
        <Route path="/sign/:token"     element={<SignPage />} />
        <Route path="/invoice/:token"  element={<PublicInvoice />} />
        <Route path="/quote/:token"    element={<PublicQuote />} />
        <Route path="/review/:token"   element={<ReviewPage />} />

        {/* Embeds - same components rendered inside iframes on the
            owner's external website. embed.js (served from /public)
            handles auto-sizing via postMessage. */}
        <Route path="/embed/book/:slug"    element={<PublicBooking embedded />} />
        <Route path="/embed/contact/:slug" element={<EmbedContact />} />

        {/* Legal (public, no auth) */}
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms"   element={<TermsPage />} />
        <Route path="/do-not-sell" element={<DoNotSellPage />} />

        {/* Marketing - extra public surfaces beyond the home page. */}
        <Route path="/about"       element={<WebOnly><SiteAbout /></WebOnly>} />
        <Route path="/support"     element={<WebOnly><SiteSupport /></WebOnly>} />
        <Route path="/tour"        element={<WebOnly><SiteTour /></WebOnly>} />
        <Route path="/features"    element={<WebOnly><SiteFeatures /></WebOnly>} />
        <Route path="/compare"     element={<WebOnly><SiteCompare /></WebOnly>} />
        <Route path="/for/:slug"   element={<WebOnly><VerticalPage /></WebOnly>} />
        <Route path="/pricing"     element={<WebOnly><SitePricing /></WebOnly>} />
        <Route path="/vs/:slug"    element={<WebOnly><ComparePage /></WebOnly>} />
        <Route path="/security"    element={<WebOnly><SecurityPage /></WebOnly>} />
        <Route path="/mobile"      element={<WebOnly><MobilePage /></WebOnly>} />
        <Route path="/integrations" element={<WebOnly><IntegrationsPage /></WebOnly>} />

        {/* First-run wizard for new owners. Auth-gated but no AppShell so it
            can't get caught in RoleRouter's "redirect un-onboarded users to
            /onboarding" loop. */}
        <Route path="/onboarding"
          element={<RequireAuth><OnboardingPage /></RequireAuth>} />

        {/* Business app shell (auth-gated). RoleRouter sends client-only
            users to /me before the shell renders. Dashboard lives at
            /dashboard so the marketing page can own /. */}
        <Route element={<RequireAuth><RoleRouter><AppShell /></RoleRouter></RequireAuth>}>
          <Route path="/dashboard"  element={<Dashboard />} />
          <Route path="/clients"    element={<Clients />} />
          <Route path="/projects"   element={<Projects />} />
          <Route path="/calendar"   element={<Calendar />} />
          <Route path="/finance"    element={<Finance />} />
          <Route path="/goals"      element={<Goals />} />
          <Route path="/workflows"  element={<Workflows />} />
          <Route path="/rewards"    element={<Rewards />} />
          <Route path="/referrals"  element={<Referrals />} />
          <Route path="/reviews"    element={<Reviews />} />
          <Route path="/messages"   element={<Messages />} />
          <Route path="/campaigns"  element={<Campaigns />} />
          <Route path="/documents"  element={<Documents />} />
          <Route path="/website"    element={<Website />} />
          <Route path="/ivy"        element={<IvyPro />} />
          <Route path="/account"    element={<AccountPage />} />
          <Route path="/more"       element={<NativeOnly><MorePage /></NativeOnly>} />
          <Route path="/admin"      element={<AdminPage />} />
        </Route>

        {/* Client portal shell (auth-gated). Anyone can navigate here directly;
            the data they see is filtered by their email / user_id. */}
        {/* Group-chat invite landing - auth required; component itself
            handles the "redirect to /signup with next=..." bounce. */}
        <Route path="/invite/group/:token"
          element={<RequireAuth><ClientPortalProvider><AcceptGroupInvite /></ClientPortalProvider></RequireAuth>} />

        <Route element={<RequireAuth><ClientShell /></RequireAuth>}>
          <Route path="/me"           element={<ClientHome />} />
          <Route path="/me/messages"  element={<ClientMessages />} />
          <Route path="/me/bookings"  element={<ClientBookings />} />
          <Route path="/me/orders"    element={<ClientOrders />} />
          <Route path="/me/invoices"  element={<ClientInvoices />} />
          <Route path="/me/documents" element={<ClientDocuments />} />
          <Route path="/me/billing"   element={<ClientBilling />} />
          <Route path="/me/discover"  element={<ClientDiscover />} />
          <Route path="/me/notifications" element={<ClientNotifications />} />
          <Route path="/me/profile"       element={<ClientProfile />} />
        </Route>

        {/* 404 catch-all. Must be last so it only matches when nothing
            else does. Without this, mistyped URLs render a blank
            <Routes/> outlet. */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      </ErrorBoundary>
    </Suspense>
    <ViewToggle/>
    {isNative() && <NativeAppLock/>}
    {isNative() && <LaunchVeil/>}
    {/* "Add Ivy to your home screen" prompts are for Safari visitors. In the
        native app the user is already there, so never mount them. */}
    {!isNative() && <PWAPrompts/>}
    </>
  );
}
