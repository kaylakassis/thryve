// Shared navigation config for Sidebar + breadcrumbs.
//
// Items with `superAdminOnly: true` are filtered out of the rendered
// sidebar for everyone except super-admins (Sidebar.jsx checks
// useAuth().user.isSuperAdmin and skips them otherwise). The route still
// exists in App.jsx - visibility is purely cosmetic; the API endpoints
// behind /admin already enforce super-admin auth.
// `productOnlyHidden: true` items are filtered out of the sidebar when
// the workspace's business_type === 'product' - Calendar is meaningless
// to a candle-maker / retailer. Sidebar.jsx pulls business_type from
// useUserContext() and drops these. The route still exists in App.jsx
// so deep links + manual navigation still work.
// `section` groups items under a small label in the sidebar so the 13-item
// list reads as a few calm sections instead of a flat wall. Purely visual —
// every route stays reachable and deep-linkable. Items without a section
// (Dashboard, Ivy, Admin) render pinned above the groups.
export const NAV = [
  { id: 'dashboard', to: '/dashboard',  label: 'Dashboard',      icon: 'Home' },
  { id: 'ivy',       to: '/ivy',        label: 'Ivy',        icon: 'Spark', accent: true },
  // Run — the day-to-day.
  { id: 'clients',   to: '/clients',    label: 'Clients',        icon: 'Users',    section: 'Run' },
  { id: 'calendar',  to: '/calendar',   label: 'Calendar',       icon: 'Calendar', section: 'Run', productOnlyHidden: true },
  { id: 'comms',     to: '/messages',   label: 'Messages',       icon: 'Chat',     section: 'Run' },
  { id: 'projects',  to: '/projects',   label: 'Projects',       icon: 'Doc',      section: 'Run' },
  { id: 'programs',  to: '/programs',   label: 'Programs',       icon: 'Gift',     section: 'Run', accent: true },
  // Money.
  { id: 'finance',   to: '/finance',    label: 'Finance',        icon: 'Dollar',   section: 'Money' },
  // Grow.
  { id: 'campaigns', to: '/campaigns',  label: 'Campaigns',      icon: 'Mail',     section: 'Grow' },
  { id: 'reviews',   to: '/reviews',    label: 'Reviews',        icon: 'Heart',    section: 'Grow' },
  { id: 'rewards',   to: '/rewards',    label: 'Rewards',        icon: 'Gift',     section: 'Grow' },
  { id: 'referrals', to: '/referrals',  label: 'Referrals',      icon: 'Users',    section: 'Grow' },
  { id: 'website',   to: '/website',    label: 'Website',        icon: 'Globe',    section: 'Grow' },
  { id: 'workflows', to: '/workflows',  label: 'Workflows',      icon: 'Spark',    section: 'Grow' },
  // Tools.
  { id: 'docs',      to: '/documents',  label: 'Documents',      icon: 'Doc',      section: 'Tools' },
  { id: 'goals',     to: '/goals',      label: 'Goals & Tasks',  icon: 'Check',    section: 'Tools' },
  { id: 'admin',     to: '/admin',      label: 'Admin',          icon: 'Settings', superAdminOnly: true },
];

// Tabs an owner can never hide from their own nav: the home landing and the
// flagship copilot. Everything else is theirs to customize (Settings ->
// Navigation). `admin` isn't here because it's already super-admin-only.
export const ALWAYS_VISIBLE_NAV = new Set(['dashboard', 'ivy']);

// The set of tabs the Navigation settings card lets an owner hide/show:
// everything except the always-visible anchors and the super-admin console.
export function hideableNav() {
  return NAV.filter((n) => !n.superAdminOnly && !ALWAYS_VISIBLE_NAV.has(n.id));
}

// THE single source of truth for which nav items a given user sees. Composes
// three rules (union of everything hidden):
//   • superAdminOnly  — hidden unless the user is a super-admin
//   • productOnlyHidden — hidden for product-only businesses (e.g. Calendar)
//   • hiddenNav        — the owner's own per-account hide list (ui_prefs)
// An always-visible id (dashboard/ivy) is never dropped, even if it somehow
// appears in hiddenNav. Used by Sidebar, MobileDrawer, and CommandPalette.
export function visibleNavFor({ isSuperAdmin = false, businessType = 'both', hiddenNav = [] } = {}) {
  const hidden = new Set(Array.isArray(hiddenNav) ? hiddenNav : []);
  return NAV.filter((n) => {
    if (n.superAdminOnly && !isSuperAdmin) return false;
    if (n.productOnlyHidden && businessType === 'product') return false;
    if (hidden.has(n.id) && !ALWAYS_VISIBLE_NAV.has(n.id)) return false;
    return true;
  });
}

export const TITLES = {
  dashboard: { title: 'Dashboard',     subtitle: 'Home' },
  clients:   { title: 'Clients',       subtitle: 'Your people' },
  projects:  { title: 'Projects',      subtitle: 'Engagements' },
  programs:  { title: 'Programs',      subtitle: 'Courses, plans and paid communities' },
  calendar:  { title: 'Calendar',      subtitle: 'This week' },
  finance:   { title: 'Finance',       subtitle: 'Money in, money out' },
  goals:     { title: 'Goals & Tasks', subtitle: 'Stay on track' },
  workflows: { title: 'Workflows',     subtitle: 'Automations that run while you sleep' },
  rewards:   { title: 'Rewards',       subtitle: 'Loyalty & referrals' },
  referrals: { title: 'Referrals',     subtitle: 'Refer a friend, you both get a free week' },
  reviews:   { title: 'Reviews',       subtitle: 'Publish & respond to client reviews' },
  comms:     { title: 'Messages',      subtitle: 'Inbox' },
  campaigns: { title: 'Campaigns',     subtitle: 'Newsletters & announcements' },
  docs:      { title: 'Documents',     subtitle: 'Notes & files' },
  website:   { title: 'Website',       subtitle: 'Public presence' },
  ivy:       { title: 'Ivy',       subtitle: 'Your AI copilot' },
  admin:     { title: 'Admin',         subtitle: 'Operator console' },
  // /account isn't in NAV (it's reached from the sidebar profile menu)
  // but it has its own tutorial and Topbar title block, so it needs an
  // entry here for AppShell to look up.
  account:   { title: 'Account',       subtitle: 'Settings & billing' },
  // /more is the native app's fifth tab (everything not on the tab bar).
  more:      { title: 'More',          subtitle: 'Everything else' },
};
