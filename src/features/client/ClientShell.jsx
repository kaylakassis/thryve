// Layout shell for the /me/* client portal. Mirrors AppShell but with a
// pared-down sidebar (5 tabs, no business actions) and a tinted "for clients"
// brand mark so users always know which view they're in.
//
// On mobile: same hamburger drawer + bottom-nav pattern as the business shell.
import React, { useEffect, useState } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Icons } from '../../components/Icons.jsx';
import VerifyEmailBanner from '../../components/VerifyEmailBanner.jsx';
import TermsAcceptModal from '../../components/TermsAcceptModal.jsx';
import { SkelLine, SkelStatGrid, SkelRowList } from '../../components/Skeleton.jsx';
import { useTweaks } from '../../lib/tweaks.js';
import { useViewport } from '../../lib/viewport.js';
import { useAuth } from '../../lib/auth.jsx';
import { useClientPortal, ClientPortalProvider } from './clientContext.jsx';
import { ViewSwitch } from '../../components/ViewToggle.jsx';

// Sections mirror the business sidebar's RUN / MONEY / GROW grouping so
// toggling between views feels like the same product, not two apps.
const NAV = [
  { to: '/me',           label: 'Home',      icon: 'Home',     end: true },
  { to: '/me/messages',  label: 'Messages',  icon: 'Chat',     section: 'Activity' },
  { to: '/me/bookings',  label: 'Bookings',  icon: 'Calendar', section: 'Activity' },
  { to: '/me/orders',    label: 'Orders',    icon: 'Gift',     section: 'Activity' },
  { to: '/me/invoices',  label: 'Payments',  icon: 'Dollar',   section: 'Money' },
  { to: '/me/billing',   label: 'Billing',   icon: 'Lock',     section: 'Money' },
  { to: '/me/programs',  label: 'Programs',  icon: 'Gift',     section: 'Tools' },
  { to: '/me/documents', label: 'Documents', icon: 'Doc',      section: 'Tools' },
  { to: '/me/discover',  label: 'Discover',  icon: 'Globe',    section: 'Tools' },
];

export default function ClientShell() {
  return (
    <ClientPortalProvider>
      <ClientShellInner/>
    </ClientPortalProvider>
  );
}

function ClientShellInner() {
  const [tweaks] = useTweaks();
  const viewport = useViewport();
  const { data, loading } = useClientPortal();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    document.body.classList.remove('dir-calm', 'dir-bold');
    document.body.classList.add(`dir-${tweaks.direction}`);
    return () => document.body.classList.remove(`dir-${tweaks.direction}`);
  }, [tweaks.direction]);

  useEffect(() => {
    if (viewport.isMobile) document.body.classList.add('has-mobile-nav');
    else document.body.classList.remove('has-mobile-nav');
    return () => document.body.classList.remove('has-mobile-nav');
  }, [viewport.isMobile]);

  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  if (loading) {
    return <ClientShellSkeleton tweaks={tweaks} viewport={viewport}/>;
  }

  return (
    <div className={`app-root dir-${tweaks.direction}`}>
      <div style={{ display: 'flex', alignItems: 'stretch', minHeight: '100vh' }}>
        {!viewport.isMobile && (
          <ClientSidebar variant={viewport.isTablet ? 'compact' : 'full'}
            data={data} direction={tweaks.direction}/>
        )}

        <main style={{
          flex: 1, minWidth: 0,
          display: 'flex', flexDirection: 'column',
          minHeight: '100vh',
        }}>
          <VerifyEmailBanner/>
          <ClientTopbar isMobile={viewport.isMobile} onMenuClick={() => setDrawerOpen(true)} data={data}/>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Outlet/>
          </div>
        </main>
      </div>

      {viewport.isMobile && <ClientMobileNav/>}
      {viewport.isMobile && drawerOpen && (
        <ClientMobileDrawer direction={tweaks.direction} data={data}
          onClose={() => setDrawerOpen(false)}/>
      )}
      <TermsAcceptModal/>
    </div>
  );
}

// ----- desktop / tablet sidebar -----
function ClientSidebar({ variant, data, direction }) {
  const compact = variant === 'compact';
  return (
    <aside style={{
      width: compact ? 64 : 248, minWidth: compact ? 64 : 248,
      background: 'var(--sidebar-bg)',
      borderRight: '1px solid var(--border)',
      padding: compact ? '14px 8px' : '18px 14px',
      display: 'flex', flexDirection: 'column', gap: compact ? 14 : 18,
      height: '100vh', position: 'sticky', top: 0,
    }}>
      <BrandMark direction={direction} compact={compact}/>

      {/* Business ↔ Client switch, inline under the brand - same spot as
          the business sidebar so the two views read as one product. */}
      {!compact && <ViewSwitch/>}

      <nav style={{
        display: 'flex', flexDirection: 'column', gap: compact ? 4 : 2,
        flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain',
      }}>
        {NAV.map((item, i) => {
          const Icon = Icons[item.icon] || Icons.Home;
          const showHeader = !compact && item.section && item.section !== NAV[i - 1]?.section;
          return (
            <React.Fragment key={item.to}>
              {showHeader && (
                <div style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                  textTransform: 'uppercase', color: 'var(--muted)',
                  padding: '12px 12px 4px', opacity: 0.75,
                }}>{item.section}</div>
              )}
              <NavLink to={item.to} end={item.end} title={item.label}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                style={compact ? { justifyContent: 'center', padding: 10 } : null}
              >
                {({ isActive }) => (
                  <>
                    <Icon size={compact ? 19 : 17} sw={isActive ? 1.9 : 1.5}/>
                    {!compact && <span>{item.label}</span>}
                    {!compact && item.to === '/me/messages' && data?.summary?.unreadMessages > 0 && (
                      <span className="nav-badge">{data.summary.unreadMessages}</span>
                    )}
                  </>
                )}
              </NavLink>
            </React.Fragment>
          );
        })}
      </nav>

      <UserBlock data={data} compact={compact}/>
    </aside>
  );
}

function BrandMark({ direction, compact }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: compact ? 0 : '4px 6px',
      justifyContent: compact ? 'center' : 'flex-start' }}>
      <div style={{
        width: compact ? 36 : 30, height: compact ? 36 : 30, borderRadius: 8,
        background: '#042b25', overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <img src="/icon-512.png" alt="" draggable="false" style={{ width: '100%', height: '100%', display: 'block' }}/>
      </div>
      {!compact && (
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1, flex: 1 }}>
          <span style={{
            fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 18,
            letterSpacing: '-0.01em', color: 'var(--sidebar-fg)',
          }}>Ivy</span>
          <span style={{
            fontSize: 10, color: 'var(--accent)', marginTop: 3,
            letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600,
          }}>For clients</span>
        </div>
      )}
    </div>
  );
}

function UserBlock({ data, compact }) {
  const { user, signOut } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const initials = (user?.name || user?.email || '?')
    .split(/[\s@.]+/).filter(Boolean).slice(0, 2)
    .map((p) => p[0].toUpperCase()).join('');
  const doSignOut = async () => { await signOut(); nav('/signin', { replace: true }); };
  const goBusiness = () => nav('/');

  if (compact) {
    return (
      <button onClick={doSignOut} title="Sign out"
        style={{
          width: 36, height: 36, margin: '0 auto', borderRadius: 99,
          background: 'var(--accent)', color: 'var(--accent-ink)',
          fontSize: 12, fontWeight: 600,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{initials}</button>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      {open && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, right: 0,
          padding: 4, borderRadius: 10,
          background: 'var(--surface)', border: '1px solid var(--border-strong)',
          boxShadow: 'var(--shadow)', zIndex: 50,
          display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          {data?.isOwner && (
            <button onClick={goBusiness} style={menuBtn}>
              <Icons.Trending size={13}/> Switch to business view
            </button>
          )}
          <NavLink to="/me/profile" onClick={() => setOpen(false)} style={{ ...menuBtn, textDecoration: 'none' }}>
            <Icons.Edit size={13}/> Your profile
          </NavLink>
          <NavLink to="/me/notifications" onClick={() => setOpen(false)} style={{ ...menuBtn, textDecoration: 'none' }}>
            <Icons.Bell size={13}/> Email preferences
          </NavLink>
          {/* /account renders inside the AppShell + RoleRouter, which
              redirects client-only users back to /me. Only show the
              link when the user is actually an owner. */}
          {data?.isOwner && (
            <NavLink to="/account" onClick={() => setOpen(false)} style={{ ...menuBtn, textDecoration: 'none' }}>
              <Icons.Settings size={13}/> Account settings
            </NavLink>
          )}
          <button onClick={doSignOut} style={menuBtn}>
            <Icons.Arrow size={13}/> Sign out
          </button>
        </div>
      )}
      <button onClick={() => setOpen((v) => !v)} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
        padding: 6, borderRadius: 10,
        background: open ? 'var(--surface)' : 'transparent',
        border: `1px solid ${open ? 'var(--border)' : 'transparent'}`,
        textAlign: 'left', cursor: 'pointer',
      }}>
        <div style={{
          width: 30, height: 30, borderRadius: 99,
          background: 'var(--accent)', color: 'var(--accent-ink)',
          fontSize: 12, fontWeight: 600,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--sidebar-fg)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.name || user?.email?.split('@')[0]}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.email || ''}
          </div>
        </div>
        <Icons.More size={14} stroke="var(--muted)"/>
      </button>
    </div>
  );
}

const menuBtn = {
  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
  padding: '8px 10px', borderRadius: 8, textAlign: 'left',
  fontSize: 13, color: 'var(--fg)', cursor: 'pointer',
};

// ----- topbar (mobile shows hamburger) -----
function ClientTopbar({ isMobile, onMenuClick, data }) {
  const { pathname } = useLocation();
  const EXTRA_TITLES = { '/me/profile': 'Profile', '/me/notifications': 'Notifications' };
  const current = NAV.find((n) => n.end ? pathname === n.to : pathname.startsWith(n.to))
    || (EXTRA_TITLES[pathname] ? { label: EXTRA_TITLES[pathname] } : NAV[0]);
  return (
    <header style={{
      display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 16,
      padding: isMobile ? '12px 14px' : '22px 32px 18px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--page)',
      position: 'sticky', top: 0, zIndex: 40,
    }}>
      {isMobile && (
        <button onClick={onMenuClick} aria-label="Open menu"
          style={{ padding: 8, borderRadius: 8, color: 'var(--fg-2)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icons.Menu size={20} sw={1.8}/>
        </button>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--muted)', fontSize: 12, marginBottom: 4 }}>
            <span>Your portal</span>
            <span>·</span>
            <span style={{ color: 'var(--fg-2)' }}>{current.label}</span>
          </div>
        )}
        <h1 className="page-title" style={{ margin: 0, fontSize: isMobile ? 20 : 28, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {current.label}
        </h1>
      </div>
    </header>
  );
}

// ----- mobile bottom nav + drawer -----
// Cap the bottom bar at the 5 highest-traffic tabs (matching the business
// app's MobileBottomNav). All 8 items crammed into 375px left ~47px per
// slot with truncated labels; the rest (Documents, Billing, Discover) stay
// one tap away in the hamburger drawer, which already lists everything.
const MOBILE_NAV_PRIMARY = new Set(['/me', '/me/messages', '/me/bookings', '/me/orders', '/me/invoices']);

function ClientMobileNav() {
  return (
    <nav className="mobile-nav" aria-label="Primary">
      {NAV.filter((item) => MOBILE_NAV_PRIMARY.has(item.to)).map((item) => {
        const Icon = Icons[item.icon];
        return (
          <NavLink key={item.to} to={item.to} end={item.end}
            className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}
          >
            {({ isActive }) => (
              <>
                <Icon size={20} sw={isActive ? 1.9 : 1.6}/>
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}

function ClientMobileDrawer({ direction, data, onClose }) {
  const { user, signOut } = useAuth();
  const nav = useNavigate();
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);
  const doSignOut = async () => { await signOut(); nav('/signin', { replace: true }); };
  const initials = (user?.name || user?.email || '?')
    .split(/[\s@.]+/).filter(Boolean).slice(0, 2)
    .map((p) => p[0].toUpperCase()).join('');

  return (
    <>
      <div className="mobile-drawer-backdrop" onClick={onClose}/>
      <aside className="mobile-drawer">
        <div style={{ padding: '18px 16px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <BrandMark direction={direction} compact={false}/>
          <button onClick={onClose} aria-label="Close menu"
            style={{ padding: 8, borderRadius: 8, color: 'var(--muted)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icons.X size={18}/>
          </button>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 12px' }}>
          {NAV.map((item) => {
            const Icon = Icons[item.icon];
            return (
              <NavLink key={item.to} to={item.to} end={item.end}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              >
                {({ isActive }) => (
                  <>
                    <Icon size={18} sw={isActive ? 1.8 : 1.5}/>
                    <span>{item.label}</span>
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>
        <div style={{ flex: 1 }}/>
        <div style={{ padding: 12, borderTop: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data?.isOwner && (
            <NavLink to="/" className="nav-item" style={{ padding: '10px 12px' }}>
              <Icons.Trending size={16} sw={1.6}/> Switch to business view
            </NavLink>
          )}
          <NavLink to="/me/profile" className="nav-item" style={{ padding: '10px 12px' }}>
            <Icons.Edit size={16} sw={1.6}/> Your profile
          </NavLink>
          <NavLink to="/me/notifications" className="nav-item" style={{ padding: '10px 12px' }}>
            <Icons.Bell size={16} sw={1.6}/> Email preferences
          </NavLink>
          {/* /account redirects client-only users via RoleRouter - only
              expose the link to owners. */}
          {data?.isOwner && (
            <NavLink to="/account" className="nav-item" style={{ padding: '10px 12px' }}>
              <Icons.Settings size={16} sw={1.6}/> Account settings
            </NavLink>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10,
            paddingTop: 4, borderTop: '1px solid var(--border)' }}>
            <div style={{
              width: 34, height: 34, borderRadius: 99,
              background: 'var(--accent)', color: 'var(--accent-ink)',
              fontSize: 12, fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{initials}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--sidebar-fg)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user?.name || user?.email?.split('@')[0]}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user?.email || ''}
              </div>
            </div>
            <button onClick={doSignOut} className="btn btn-ghost"
              style={{ padding: '6px 10px', fontSize: 12.5 }}>Sign out</button>
          </div>
        </div>
      </aside>
    </>
  );
}

// Renders the shell chrome (sidebar + topbar shape) with skeleton placeholders
// for the page body. Avoids the dead "Loading…" flash on first paint.
function ClientShellSkeleton({ tweaks, viewport }) {
  return (
    <div className={`app-root dir-${tweaks.direction}`}>
      <div style={{ display: 'flex', alignItems: 'stretch', minHeight: '100vh' }}>
        {!viewport.isMobile && (
          <aside style={{
            width: viewport.isTablet ? 64 : 248, minWidth: viewport.isTablet ? 64 : 248,
            background: 'var(--sidebar-bg)', borderRight: '1px solid var(--border)',
            padding: viewport.isTablet ? '14px 8px' : '18px 14px',
            display: 'flex', flexDirection: 'column', gap: 14,
            height: '100vh', position: 'sticky', top: 0,
          }}>
            <SkelLine width="80%" height={28} style={{ borderRadius: 8 }}/>
            {Array.from({ length: 6 }, (_, i) => (
              <SkelLine key={i} width="100%" height={32} style={{ borderRadius: 8 }}/>
            ))}
          </aside>
        )}
        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{
            height: 56, padding: '0 20px',
            display: 'flex', alignItems: 'center', gap: 12,
            borderBottom: '1px solid var(--border)',
          }}>
            <SkelLine width={140} height={16} style={{ borderRadius: 6 }}/>
          </div>
          <div className="page-pad" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <SkelLine width={220} height={26} style={{ borderRadius: 8 }}/>
            <SkelStatGrid count={4}/>
            <SkelRowList rows={3} withAvatar/>
          </div>
        </main>
      </div>
    </div>
  );
}
