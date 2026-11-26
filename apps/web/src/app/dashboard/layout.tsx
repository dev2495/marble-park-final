'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { gql, useMutation, useQuery } from '@apollo/client';
import {
  Bath, Bell, Boxes, Briefcase, ChevronDown, ClipboardCheck, ClipboardList, FileSpreadsheet,
  KeyRound, LayoutDashboard, ListChecks, LogOut, PackageSearch, Receipt, Settings, Shield,
  Truck, UserCircle2, Users, UserCog, UserCheck, BadgeCheck, CreditCard, FileText, RotateCcw,
  Menu, X,
  ArrowLeftRight, QrCode, Scale, BarChart3, HelpCircle, BellRing, Store,
  DoorOpen, Target, CalendarClock, Database, PanelLeftOpen, PanelLeftClose,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { UserAvatar } from '@/components/user-avatar';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import { ThemeToggle } from '@/components/theme-toggle';
import { guideForRoute } from '@/lib/help-content';
import { CompanyLogo } from '@/components/company-logo';
import { SessionTimeoutGuard } from '@/components/session-timeout-guard';
import { GlobalSearch } from '@/components/global-search';
import { useFocusTrap } from '@/hooks/use-focus-trap';
import { useShellDocumentTitle } from '@/hooks/use-document-title';
import { useTableHeaderScope } from '@/hooks/use-table-header-scope';

const ME_QUERY = gql`
  query LayoutMe {
    me { id name email avatarUrl role effectivePermissions permissionOverrides }
    documentSettings { data }
  }
`;

const NOTIFICATIONS_QUERY = gql`
  query NotificationsBell {
    unreadNotificationCount
    notifications(take: 8)
  }
`;

const MARK_NOTIFICATION_READ = gql`
  mutation MarkNotificationRead($id: ID!) {
    markNotificationRead(id: $id)
  }
`;

const LOGOUT_MUTATION = gql`mutation Logout { logout }`;

const navSections: Array<{ title: string; items: Array<{ name: string; href: string; icon: any; roles: string[]; permission?: string; permissions?: string[] }> }> = [
  {
    title: 'Operate',
    items: [
      { name: 'Command Center', href: '/dashboard', icon: LayoutDashboard, roles: ['admin', 'owner', 'sales_manager', 'sales', 'inventory_manager', 'dispatch_ops', 'office_staff'] },
      { name: 'Work inbox', href: '/dashboard/notifications', icon: Bell, roles: ['admin', 'owner', 'sales_manager', 'sales', 'inventory_manager', 'dispatch_ops', 'office_staff'] },
      { name: 'Approvals', href: '/dashboard/approvals', icon: ClipboardCheck, roles: ['admin', 'owner'], permission: 'approvals.manage' },
      { name: 'Sales Desk', href: '/dashboard/sales', icon: Briefcase, roles: ['admin', 'owner', 'sales_manager', 'sales'] },
      { name: 'Reports', href: '/dashboard/reports', icon: BarChart3, roles: [], permissions: ['reports.executive', 'reports.sales', 'reports.inventory', 'reports.procurement', 'reports.finance', 'reports.fulfilment', 'reports.audit'] },
    ],
  },
  {
    title: 'Pipeline',
    items: [
      { name: 'Walk-ins', href: '/dashboard/walk-ins', icon: DoorOpen, roles: ['admin', 'owner', 'sales_manager', 'sales', 'office_staff'] },
      { name: 'Leads', href: '/dashboard/leads', icon: Target, roles: ['admin', 'owner', 'sales_manager', 'sales', 'office_staff'] },
      { name: 'Intents', href: '/dashboard/intents', icon: ListChecks, roles: ['admin', 'owner', 'sales_manager', 'office_staff'], permission: 'quotes.manage' },
      { name: 'Quotes', href: '/dashboard/quotes', icon: FileSpreadsheet, roles: ['admin', 'owner', 'sales_manager', 'sales', 'office_staff'], permission: 'quotes.manage' },
      { name: 'Orders', href: '/dashboard/orders', icon: Receipt, roles: ['admin', 'owner', 'sales_manager', 'sales', 'office_staff', 'dispatch_ops'] },
      { name: 'Customer Accounts', href: '/dashboard/payments', icon: CreditCard, roles: ['admin', 'owner', 'sales_manager', 'sales', 'office_staff'], permission: 'payments.manage' },
      { name: 'Documents', href: '/dashboard/documents', icon: FileText, roles: ['admin', 'owner', 'sales_manager', 'sales', 'inventory_manager', 'dispatch_ops', 'office_staff'], permission: 'documents.view' },
    ],
  },
  {
    title: 'Stock',
    items: [
      { name: 'Catalogue', href: '/dashboard/products', icon: Bath, roles: ['admin', 'owner', 'sales_manager', 'sales', 'inventory_manager', 'office_staff'], permission: 'products.manage' },
      { name: 'Inventory', href: '/dashboard/inventory', icon: Boxes, roles: ['admin', 'owner', 'inventory_manager', 'sales_manager', 'office_staff'], permission: 'inventory.manage' },
      { name: 'Stock Alert Policy', href: '/dashboard/inventory/stock-alerts', icon: BellRing, roles: ['admin', 'owner'] },
      { name: 'Pending Inward', href: '/dashboard/pending-inward', icon: PackageSearch, roles: ['admin', 'owner', 'dispatch_ops', 'inventory_manager', 'sales_manager', 'sales', 'office_staff'], permission: 'goods_receipts.manage' },
      { name: 'Procurement', href: '/dashboard/procurement', icon: ClipboardList, roles: ['admin', 'owner', 'inventory_manager', 'office_staff'], permission: 'procurement.manage' },
      { name: 'Transfers', href: '/dashboard/inventory/transfers', icon: ArrowLeftRight, roles: ['admin', 'owner', 'inventory_manager'], permission: 'transfers.manage' },
      { name: 'Display Assets', href: '/dashboard/inventory/display-assets', icon: Store, roles: ['admin', 'owner', 'inventory_manager'], permission: 'inventory.manage' },
      { name: 'Labels & Scan', href: '/dashboard/inventory/labels', icon: QrCode, roles: ['admin', 'owner', 'inventory_manager', 'dispatch_ops'], permission: 'labels.manage' },
      { name: 'Stock Control', href: '/dashboard/inventory/control', icon: Scale, roles: ['admin', 'owner', 'inventory_manager'], permission: 'stock_counts.manage' },
      { name: 'Dispatch', href: '/dashboard/dispatch', icon: Truck, roles: ['admin', 'owner', 'dispatch_ops', 'sales_manager', 'office_staff'], permission: 'dispatch.manage' },
      { name: 'Returns', href: '/dashboard/returns', icon: RotateCcw, roles: ['admin', 'owner', 'inventory_manager', 'dispatch_ops', 'sales_manager'], permission: 'returns.manage' },
    ],
  },
  {
    title: 'People & Data',
    items: [
      { name: 'Customers', href: '/dashboard/customers', icon: Users, roles: ['admin', 'owner', 'sales_manager', 'sales', 'dispatch_ops', 'office_staff'] },
      { name: 'Follow-ups', href: '/dashboard/follow-ups', icon: CalendarClock, roles: [], permission: 'follow_ups.manage' },
      { name: 'Users', href: '/dashboard/users', icon: UserCog, roles: ['admin', 'owner'], permission: 'users.manage' },
      { name: 'System Audit', href: '/dashboard/audit', icon: BadgeCheck, roles: ['admin', 'owner'], permission: 'audit.view' },
      { name: 'Master Data', href: '/dashboard/master-data', icon: Database, roles: ['admin', 'owner', 'inventory_manager', 'office_staff'], permission: 'master_data.manage' },
      { name: 'Settings', href: '/dashboard/settings', icon: Settings, roles: ['admin', 'owner'], permission: 'settings.manage' },
    ],
  },
  {
    title: 'Account',
    items: [
      { name: 'Help Center', href: '/dashboard/help', icon: HelpCircle, roles: ['admin', 'owner', 'sales_manager', 'sales', 'inventory_manager', 'dispatch_ops', 'office_staff'] },
      { name: 'My Profile', href: '/dashboard/profile', icon: UserCircle2, roles: ['admin', 'owner', 'sales_manager', 'sales', 'inventory_manager', 'dispatch_ops', 'office_staff'] },
    ],
  },
];

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'owner', label: 'Owner' },
  { value: 'sales_manager', label: 'Sales Manager' },
  { value: 'sales', label: 'Sales' },
  { value: 'inventory_manager', label: 'Inventory' },
  { value: 'dispatch_ops', label: 'Dispatch' },
  { value: 'office_staff', label: 'Office Staff' },
];

const pageTitles: Record<string, string> = {
  '/dashboard': 'Command Center',
  '/dashboard/notifications': 'Work inbox',
  '/dashboard/products': 'Catalogue',
  '/dashboard/inventory': 'Inventory',
  '/dashboard/inventory/stock-alerts': 'Stock Alert Policy',
  '/dashboard/inventory/inwards': 'GRN Receiving',
  '/dashboard/inventory/opening-stock': 'Opening Stock',
  '/dashboard/inventory/transfers': 'Stock Transfers',
  '/dashboard/inventory/display-assets': 'Display Assets',
  '/dashboard/inventory/labels': 'Labels & Scan',
  '/dashboard/inventory/control': 'Inventory Control',
  '/dashboard/inventory/adjustments': 'Stock Adjustments',
  '/dashboard/inventory/reconciliation': 'Stock Reconciliation',
  '/dashboard/pending-inward': 'Pending Inward',
  '/dashboard/procurement': 'Procurement',
  '/dashboard/sales': 'Sales Desk',
  '/dashboard/approvals': 'Approval Desk',
  '/dashboard/intents': 'Intent Desk',
  '/dashboard/orders': 'Sales Orders',
  '/dashboard/orders/new': 'Direct Order',
  '/dashboard/procurement/cost-readiness': 'Cost Readiness',
  '/dashboard/payments': 'Customer Accounts',
  '/dashboard/documents': 'File Vault',
  '/dashboard/quotes': 'Quote Register',
  '/dashboard/quotes/approvals': 'Approval Desk',
  '/dashboard/quotes/new': 'Quote Studio',
  '/dashboard/walk-ins': 'Showroom Walk-ins',
  '/dashboard/leads': 'CRM Pipeline',
  '/dashboard/leads/new': 'New Lead',
  '/dashboard/customers': 'Customers',
  '/dashboard/follow-ups': 'Follow-ups',
  '/dashboard/dispatch': 'Dispatch',
  '/dashboard/returns': 'Returns',
  '/dashboard/reports': 'Management Reports',
  '/dashboard/reports/setup': 'Report Data Readiness',
  '/dashboard/inventory/stock-count': 'Stock Count',
  '/dashboard/inventory/ledger': 'Stock Ledger',
  '/dashboard/users': 'User Management',
  '/dashboard/audit': 'System Audit',
  '/dashboard/master-data': 'Master Data',
  '/dashboard/master-data/products': 'Product Master',
  '/dashboard/master-data/pricing-readiness': 'MRP Control Desk',
  '/dashboard/master-data/brands': 'Brand Master',
  '/dashboard/master-data/finishes': 'Finish Master',
  '/dashboard/master-data/imports': 'Excel Import',
  '/dashboard/master-data/categories': 'Category Master',
  '/dashboard/master-data/tiles': 'Tile Master',
  '/dashboard/master-data/tile-sizes': 'Tile Size Master',
  '/dashboard/master-data/vendors': 'Vendor Master',
  '/dashboard/master-data/architects': 'Architect Master',
  '/dashboard/settings': 'Settings',
  '/dashboard/profile': 'My Profile',
  '/dashboard/help': 'Help Center',
};

/**
 * Dashboard layout.
 *
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │ Sidebar (hover-to-peek floating rail, 72px → 256px)                │
 *   │   • Pure-CSS animation, instant open, 250ms lazy-close              │
 *   │   • Scrim sibling (peer-hover/rail:…) dims content when expanded    │
 *   │   • Footer: avatar → /dashboard/profile                             │
 *   ├─────────────────────────────────────────────────────────────────────┤
 *   │ Topbar (sticky, blurred)                                            │
 *   │   • Title · Search · Notifications (Radix) · Profile menu (Radix)   │
 *   │   • All popovers close-on-outside-click via Radix                   │
 *   └─────────────────────────────────────────────────────────────────────┘
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [roleOverride, setRoleOverride] = useState('');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Side menu: opens by its toggle button (click, tap, Enter/Space), stays
  // open until closed, and the choice is remembered. Hover still peeks on a
  // mouse; keyboard focus inside the rail shows the labels too.
  const [railOpen, setRailOpen] = useState(false);
  const railRef = useRef<HTMLElement>(null);
  const railToggleRef = useRef<HTMLButtonElement>(null);
  const mobileNavRef = useRef<HTMLDivElement>(null);
  const mobileNavButtonRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    setRailOpen(localStorage.getItem('mp_rail_open') === '1');
  }, []);
  const setRail = useCallback((open: boolean) => {
    setRailOpen(open);
    try { localStorage.setItem('mp_rail_open', open ? '1' : '0'); } catch { /* ignore */ }
  }, []);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
  useFocusTrap(mobileNavRef, mobileNavOpen, { onEscape: closeMobileNav });
  useEffect(() => { setMobileNavOpen(false); }, [pathname]);
  useTableHeaderScope(mainRef);
  const { data: meData, loading: meLoading, error: meError } = useQuery(ME_QUERY, { fetchPolicy: 'network-only', errorPolicy: 'all' });
  const [logout] = useMutation(LOGOUT_MUTATION);

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (stored) setUser(JSON.parse(stored));
    setRoleOverride(localStorage.getItem('role_override') || '');
  }, []);

  useEffect(() => {
    if (meData?.me) {
      setUser(meData.me);
      localStorage.setItem('user', JSON.stringify(meData.me));
      return;
    }
    if (!meLoading && meError && !user) router.replace('/login');
  }, [meData, meLoading, meError, router, user]);

  const me = meData?.me || user;
  const company = meData?.documentSettings?.data || {};
  const companyName = company.companyName || 'Marble Park';
  const companyLogo = company.logoUrl || '/brand/marble-park-logo.png';
  const previewingRole = user?.role === 'admin' && roleOverride;
  const effectiveRole = previewingRole ? roleOverride : me?.role || user?.role || 'owner';
  const effectivePermissions = previewingRole ? [] : (me?.effectivePermissions || user?.effectivePermissions || []);
  const can = (permission: string) => effectivePermissions.includes(permission);
  const visibleSections = navSections
    .map((section) => ({ ...section, items: section.items.filter((item) => item.roles.includes(effectiveRole) || (item.permission && can(item.permission)) || item.permissions?.some(can)) }))
    .filter((section) => section.items.length > 0);
  const isNavActive = (href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard';
    if (pathname === href) return true;
    // Inventory tower has nested routes with their own nav entries — keep parent exact-only.
    if (href === '/dashboard/inventory') return false;
    return pathname.startsWith(`${href}/`);
  };

  const { data: notificationData, loading: notificationsLoading, error: notificationsError, refetch: refetchNotifications } = useQuery(NOTIFICATIONS_QUERY, {
    skip: !user,
    pollInterval: 60000,
    skipPollAttempt: () => typeof document !== 'undefined' && document.hidden,
  });
  const [markNotificationRead] = useMutation(MARK_NOTIFICATION_READ, { onCompleted: () => refetchNotifications() });
  useEffect(() => {
    const refresh = () => { if (user && !document.hidden) void refetchNotifications(); };
    window.addEventListener('notification-updated', refresh);
    window.addEventListener('focus', refresh);
    return () => { window.removeEventListener('notification-updated', refresh); window.removeEventListener('focus', refresh); };
  }, [user, refetchNotifications]);

  const handleLogout = async () => {
    await logout().catch(() => null);
    localStorage.setItem('mp_session_event', JSON.stringify({ type: 'logout', at: Date.now() }));
    localStorage.removeItem('user');
    localStorage.removeItem('role_override');
    window.location.href = '/login';
  };

  // Labels show when the rail is opened, hovered with a mouse, or holds keyboard focus (kit.css).
  const labelReveal = 'mp-rail-label';

  const unreadCount = Number(notificationData?.unreadNotificationCount || 0);

  // Page title for the top bar and the browser tab ("Quotes | Marble Park").
  const menuMatch = navSections.flatMap((section) => section.items).filter((item) => isNavActive(item.href)).sort((a, b) => b.href.length - a.href.length)[0];
  const currentTitle = pageTitles[pathname] || pageTitles[pathname.replace(/\/[^/]+$/, '')] || menuMatch?.name || 'Workspace';
  useShellDocumentTitle(currentTitle === 'Workspace' ? (pathname === '/dashboard' ? 'Dashboard' : null) : currentTitle, pathname);

  // Escape closes the opened side menu and puts focus back on its button.
  const onRailKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return;
    if (railOpen) {
      event.stopPropagation();
      setRail(false);
      railToggleRef.current?.focus();
    } else if (railRef.current?.contains(document.activeElement)) {
      event.stopPropagation();
      (document.activeElement as HTMLElement | null)?.blur();
      mainRef.current?.focus();
    }
  };

  return (
    <div className="mp-app-shell min-h-screen w-full text-[var(--ink-2)]">
      <a href="#main-content" className="mp-skip-link" onClick={() => window.setTimeout(() => mainRef.current?.focus(), 0)}>Skip to main content</a>
      <SessionTimeoutGuard />
      {/* ─── Sidebar — icon rail; the toggle opens it, hover peeks on a mouse ── */}
      <aside
        ref={railRef}
        id="primary-navigation"
        aria-label="Main menu"
        data-open={railOpen ? 'true' : 'false'}
        data-pinned={railOpen ? 'true' : 'false'}
        onKeyDown={onRailKeyDown}
        className={cn(
          'mp-sidebar fixed inset-y-0 left-0 z-40 hidden w-[4.5rem] flex-col overflow-hidden border-r lg:flex',
          'will-change-[width] transition-[width,box-shadow] duration-300 [transition-timing-function:var(--eo)]',
        )}
      >
        <div className="flex h-full w-[16rem] flex-col overflow-hidden">
          <div className="flex h-16 items-center gap-3 border-b border-[var(--line)] px-4">
            <Link href="/dashboard" className="flex min-w-0 items-center gap-3 rounded-md" aria-label={`${companyName} home`}>
              <CompanyLogo src={companyLogo} name={companyName} className="h-10 w-10" imageClassName="p-0.5" />
              <div className={cn('min-w-0 whitespace-nowrap', labelReveal)} aria-hidden="true">
                <p className="text-base font-bold leading-tight text-[var(--ink)]">{companyName}</p>
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--ink-4)]">Retail Ops</p>
              </div>
            </Link>
          </div>

          <div className="px-3 pt-3">
            <button
              ref={railToggleRef}
              type="button"
              onClick={() => setRail(!railOpen)}
              aria-expanded={railOpen}
              aria-controls="primary-navigation-links"
              title={railOpen ? 'Collapse menu' : 'Expand menu'}
              className="mp-nav-inactive flex h-9 w-full items-center gap-3 rounded-md px-2.5 text-sm font-medium transition-colors"
            >
              {railOpen ? <PanelLeftClose className="h-[18px] w-[18px] shrink-0 text-[var(--ink-4)]" strokeWidth={1.6} aria-hidden="true" /> : <PanelLeftOpen className="h-[18px] w-[18px] shrink-0 text-[var(--ink-4)]" strokeWidth={1.6} aria-hidden="true" />}
              <span className={cn('truncate whitespace-nowrap', labelReveal)}>{railOpen ? 'Collapse menu' : 'Expand menu'}</span>
            </button>
          </div>

          <nav id="primary-navigation-links" aria-label="Main menu links" className="flex-1 overflow-y-auto py-3 custom-scrollbar">
            {visibleSections.map((section) => (
              <div key={section.title} className="px-3 pb-4">
                <p
                  className={cn(
                    'px-2 pb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-5)] whitespace-nowrap',
                    labelReveal,
                  )}
                  aria-hidden="true"
                >
                  {section.title}
                </p>
                <ul className="space-y-0.5">
                  {section.items.map((item) => {
                    const active = isNavActive(item.href);
                    return (
                      <li key={`${section.title}:${item.href}:${item.name}`}>
                        <Link
                          href={item.href}
                          prefetch={false}
                          title={item.name}
                          aria-current={active ? 'page' : undefined}
                          onClick={(event) => { if (event.detail > 0) event.currentTarget.blur(); }}
                          className={cn(
                            'flex h-9 items-center gap-3 rounded-md text-sm font-medium transition-colors',
                            'px-2.5',
                            active ? 'mp-nav-active' : 'mp-nav-inactive',
                          )}
                        >
                          <item.icon
                            className={cn('h-[18px] w-[18px] shrink-0 transition-colors', active ? 'text-current' : 'text-[var(--ink-4)]')}
                            strokeWidth={1.6}
                            aria-hidden="true"
                          />
                          <span className={cn('truncate whitespace-nowrap', labelReveal)}>{item.name}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>

          {/* Sidebar footer — user card (click → profile) + sign out. */}
          <div className="border-t border-[var(--line)] p-3">
            <Link href="/dashboard/profile" prefetch={false} className="flex items-center gap-3 rounded-md p-1 transition-colors hover:bg-[var(--bg-soft)]" title="Open profile">
              <UserAvatar user={me} size="md" />
              <div className={cn('min-w-0 flex-1 whitespace-nowrap', labelReveal)}>
                <p className="truncate text-sm font-semibold text-[var(--ink)]">{me?.name || 'Marble Park User'}</p>
                <p className="truncate text-[11px] font-medium capitalize text-[var(--ink-4)]">{effectiveRole.replace('_', ' ')}</p>
              </div>
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              title="Sign out"
              className="mt-3 flex h-9 w-full items-center gap-3 rounded-md px-2.5 text-sm font-medium text-[var(--ink-3)] transition-colors hover:bg-[var(--bg-soft)] hover:text-[var(--ink)]"
            >
              <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className={cn('truncate whitespace-nowrap', labelReveal)}>Sign out</span>
            </button>
          </div>
        </div>
      </aside>

      <div className={cn('mp-main-shell min-w-0 transition-[padding] duration-300 [transition-timing-function:var(--eo)]', railOpen ? 'lg:pl-[16rem]' : 'lg:pl-[4.5rem]')}>
        {/* ─── Topbar (a banner landmark, outside main) ──────────────────── */}
        <header className="mp-topbar sticky top-0 z-20 border-b backdrop-blur-xl supports-[backdrop-filter]:bg-white/75">
          <div className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  ref={mobileNavButtonRef}
                  type="button"
                  onClick={() => setMobileNavOpen(true)}
                  className="mp-topbar-btn shrink-0 lg:hidden"
                  aria-label="Open menu"
                  aria-expanded={mobileNavOpen}
                  aria-controls="mobile-navigation"
                >
                  <Menu className="h-4 w-4" aria-hidden="true" />
                </button>
                <div className="min-w-0">
                {/* Page title in the bar; each page owns its single <h1>. */}
                <p className="truncate text-base font-semibold tracking-[-0.01em] text-[var(--ink)] lg:text-lg">
                  {currentTitle}
                </p>
                </div>
              </div>
              <Link href="/dashboard" className="rounded-md lg:hidden" aria-label={`${companyName} home`}><CompanyLogo src={companyLogo} name={companyName} className="h-9 w-9" /></Link>
            </div>

            <div className="flex items-center gap-2">
              {/* Global search: everything a person may open, grouped */}
              <GlobalSearch />

              {/* Quick light/dark toggle */}
              <ThemeToggle className="hidden sm:inline-flex" />

              <Link
                href={`/dashboard/help#${guideForRoute(pathname)}`}
                title="Help for this page"
                aria-label="Help for this page"
                className="mp-topbar-btn"
              >
                <HelpCircle className="h-4 w-4" aria-hidden="true" />
              </Link>

              {/* ─── Notifications dropdown (Radix — close on outside click) ─── */}
              <DropdownMenu onOpenChange={open => { if (open) void refetchNotifications(); }}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="mp-topbar-btn relative"
                    aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} new` : 'Notifications'}
                  >
                    <Bell className="h-4 w-4" aria-hidden="true" />
                    {unreadCount > 0 ? (
                      <span aria-hidden="true" className="absolute -right-1.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--danger-solid)] px-1 text-[11px] font-semibold leading-none text-white ring-2 ring-[var(--surface)]">
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    ) : null}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-1rem))]">
                  <DropdownMenuLabel className="flex items-center justify-between">
                    <span>Work inbox</span>
                    {unreadCount > 0 ? <span className="rounded-full bg-[var(--danger-bg)] px-1.5 text-xs font-semibold text-[var(--danger)]">{unreadCount} new</span> : null}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <div className="max-h-96 overflow-y-auto custom-scrollbar">
                    {notificationsError ? <p role="alert" className="px-3 py-4 text-sm">Inbox unavailable. <button className="underline" onClick={() => void refetchNotifications()}>Retry</button></p> : notificationsLoading && !notificationData ? <p role="status" className="p-4 text-sm">Loading inbox…</p> : (notificationData?.notifications || []).length ? (notificationData?.notifications || []).map((notification: any) => (
                      <DropdownMenuItem
                        key={notification.id}
                        onSelect={() => {
                          if (!notification.readAt) void markNotificationRead({ variables: { id: notification.id } }).catch(() => undefined);
                          router.push(notification.href?.startsWith('/dashboard/') ? notification.href : '/dashboard/notifications');
                        }}
                        className={cn('items-start gap-2.5 px-2.5 py-2.5', !notification.readAt ? 'bg-[var(--brand-50)]' : '')}
                      >
                        <span className={cn('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', !notification.readAt ? 'bg-[var(--brand-600)]' : 'bg-[var(--line)]')} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-[var(--ink)]">{notification.title}</p>
                          <p className="mt-0.5 line-clamp-2 text-xs text-[var(--ink-3)]">{notification.message}</p>
                          <p className="mt-1 text-xs font-medium uppercase tracking-wider text-[var(--ink-5)]">
                            {notification.category === 'action' ? notification.status === 'resolved' ? 'Completed' : 'Needs action' : 'Update'} · {new Date(notification.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </DropdownMenuItem>
                    )) : (
                      <p className="px-3 py-6 text-center text-sm text-[var(--ink-4)]">No notifications yet.</p>
                    )}
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild><Link className="justify-center font-semibold" href="/dashboard/notifications">Open full inbox →</Link></DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* ─── Profile dropdown ─── */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="mp-topbar-btn flex items-center gap-2 pl-1 pr-2"
                    aria-label="Profile menu"
                  >
                    <UserAvatar user={me} size="sm" />
                    <span className="hidden text-sm font-medium text-[var(--ink)] sm:inline-block">{me?.name?.split(/\s+/)[0] || 'Account'}</span>
                    <ChevronDown className="h-3.5 w-3.5 text-[var(--ink-4)]" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <div className="flex items-center gap-3 px-2.5 py-2">
                    <UserAvatar user={me} size="md" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--ink)]">{me?.name || 'Marble Park User'}</p>
                      <p className="truncate text-[11px] text-[var(--ink-4)]">{me?.email}</p>
                    </div>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => router.push('/dashboard/profile')}>
                    <UserCircle2 className="h-4 w-4 text-[var(--ink-3)]" />
                    <span>View profile</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => router.push('/dashboard/profile#change-password')}>
                    <KeyRound className="h-4 w-4 text-[var(--ink-3)]" />
                    <span>Change password</span>
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />
                  <div className="flex items-center justify-between px-2.5 py-1.5">
                    <span className="text-xs font-medium text-[var(--ink-3)]">Theme</span>
                    <ThemeToggle />
                  </div>

                  {user?.role === 'admin' ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="flex items-center gap-1.5"><Shield className="h-3 w-3 text-[var(--brand-600)]" /> Preview as role</DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={effectiveRole}
                        onValueChange={(value) => {
                          // Picking "admin" clears the override so admin lands
                          // on their own admin command center, not a stale
                          // preview of themselves.
                          if (value === 'admin') {
                            localStorage.removeItem('role_override');
                            setRoleOverride('');
                          } else {
                            localStorage.setItem('role_override', value);
                            setRoleOverride(value);
                          }
                          window.location.href = '/dashboard';
                        }}
                      >
                        {ROLE_OPTIONS.map((role) => (
                          <DropdownMenuRadioItem key={role.value} value={role.value}>
                            {role.label}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </>
                  ) : null}

                  {can('settings.manage') ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => router.push('/dashboard/settings')}>
                        <Settings className="h-4 w-4 text-[var(--ink-3)]" />
                        <span>System settings</span>
                      </DropdownMenuItem>
                    </>
                  ) : null}

                  <DropdownMenuSeparator />
                  <DropdownMenuItem danger onSelect={handleLogout}>
                    <LogOut className="h-4 w-4" />
                    <span>Sign out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

        </header>

        {mobileNavOpen ? (
          <div ref={mobileNavRef} id="mobile-navigation" className="mp-mobile-nav fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <div aria-hidden="true" className="mp-overlay absolute inset-0 bg-[rgba(15,16,22,0.48)] backdrop-blur-[2px]" onClick={() => setMobileNavOpen(false)} />
            <aside className="mp-sheet-in-left relative flex h-full w-[86vw] max-w-[22rem] flex-col overflow-hidden border-r border-[var(--line)] bg-[var(--surface)] shadow-[var(--sh-xl)]">
              <div className="flex h-16 items-center justify-between border-b border-[var(--line)] px-4">
                <Link href="/dashboard" onClick={() => setMobileNavOpen(false)} className="flex items-center gap-3">
                  <CompanyLogo src={companyLogo} name={companyName} className="h-10 w-10" />
                  <div>
                    <p className="text-base font-bold text-[var(--ink)]">{companyName}</p>
                    <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--ink-4)]">Retail Ops</p>
                  </div>
                </Link>
                <button type="button" onClick={() => setMobileNavOpen(false)} className="mp-icon-btn grid h-10 w-10 place-items-center rounded-md border border-[var(--line)] bg-[var(--bg-soft)] text-[var(--ink)]" aria-label="Close menu">
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <nav aria-label="Main menu" className="flex-1 overflow-y-auto p-3 custom-scrollbar">
                {visibleSections.map((section) => (
                  <div key={section.title} className="pb-4">
                    <p className="px-2 pb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-5)]">{section.title}</p>
                    <ul className="space-y-1">
                      {section.items.map((item) => {
                        const active = isNavActive(item.href);
                        return (
                          <li key={`${section.title}:${item.href}:${item.name}`}>
                            <Link
                              href={item.href}
                              prefetch={false}
                              onClick={() => setMobileNavOpen(false)}
                              aria-current={active ? 'page' : undefined}
                              className={cn(
                                'flex h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
                                active ? 'mp-nav-active' : 'mp-nav-inactive',
                              )}
                            >
                              <item.icon className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />
                              {item.name}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </nav>
              <div className="border-t border-[var(--line)] p-3">
                <Link href="/dashboard/profile" onClick={() => setMobileNavOpen(false)} className="flex items-center gap-3 rounded-md p-2 transition-colors hover:bg-[var(--bg-soft)]">
                  <UserAvatar user={me} size="md" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--ink)]">{me?.name || 'Marble Park User'}</p>
                    <p className="truncate text-[11px] font-medium capitalize text-[var(--ink-4)]">{effectiveRole.replace('_', ' ')}</p>
                  </div>
                </Link>
              </div>
            </aside>
          </div>
        ) : null}

        <main id="main-content" ref={mainRef} tabIndex={-1} className="mp-main min-w-0">
          <div className="mp-page px-4 py-6 lg:px-8 lg:py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
