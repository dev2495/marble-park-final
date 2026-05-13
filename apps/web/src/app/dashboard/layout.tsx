'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { gql, useMutation, useQuery } from '@apollo/client';
import {
  Bath, Bell, Boxes, Briefcase, ChevronDown, ClipboardCheck, FileSpreadsheet,
  History, KeyRound, LayoutDashboard, ListChecks, LogOut, Menu, PackageSearch, Receipt, Search, Settings, Shield,
  Truck, UserCircle2, Users, UserCog, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { UserAvatar } from '@/components/user-avatar';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import { ThemeToggle, ThemeToggleButton } from '@/components/theme-toggle';

const ME_QUERY = gql`
  query LayoutMe {
    me { id name email avatarUrl role }
  }
`;

const SEARCH_QUERY = gql`
  query GlobalSearch($query: String!) {
    globalSearch(query: $query) {
      products
      leads
      quotes
    }
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

const navSections: Array<{ title: string; items: Array<{ name: string; href: string; icon: any; roles: string[] }> }> = [
  {
    title: 'Operate',
    items: [
      { name: 'Command Center', href: '/dashboard', icon: LayoutDashboard, roles: ['admin', 'owner', 'sales_manager', 'sales', 'inventory_manager', 'dispatch_ops', 'office_staff'] },
      { name: 'Approvals', href: '/dashboard/approvals', icon: ClipboardCheck, roles: ['admin', 'owner'] },
      { name: 'Sales Desk', href: '/dashboard/sales', icon: Briefcase, roles: ['admin', 'owner', 'sales_manager', 'sales'] },
    ],
  },
  {
    title: 'Pipeline',
    items: [
      { name: 'Leads', href: '/dashboard/leads', icon: PackageSearch, roles: ['admin', 'owner', 'sales_manager', 'sales', 'office_staff'] },
      { name: 'Intents', href: '/dashboard/intents', icon: ListChecks, roles: ['admin', 'owner', 'sales_manager', 'office_staff'] },
      { name: 'Quotes', href: '/dashboard/quotes', icon: FileSpreadsheet, roles: ['admin', 'owner', 'sales_manager', 'sales', 'office_staff'] },
      { name: 'Orders', href: '/dashboard/orders', icon: Receipt, roles: ['admin', 'owner', 'sales_manager', 'sales', 'office_staff', 'dispatch_ops'] },
    ],
  },
  {
    title: 'Stock',
    items: [
      { name: 'Catalogue', href: '/dashboard/products', icon: Bath, roles: ['admin', 'owner', 'sales_manager', 'sales', 'inventory_manager', 'office_staff'] },
      { name: 'Inventory', href: '/dashboard/inventory', icon: Boxes, roles: ['admin', 'owner', 'inventory_manager', 'sales_manager', 'office_staff'] },
      { name: 'Dispatch', href: '/dashboard/dispatch', icon: Truck, roles: ['admin', 'owner', 'dispatch_ops', 'sales_manager', 'office_staff'] },
    ],
  },
  {
    title: 'People & Data',
    items: [
      { name: 'Customers', href: '/dashboard/customers', icon: Users, roles: ['admin', 'owner', 'sales_manager', 'sales', 'dispatch_ops', 'office_staff'] },
      { name: 'Users', href: '/dashboard/users', icon: UserCog, roles: ['admin', 'owner'] },
      { name: 'Audit Log', href: '/dashboard/audit', icon: History, roles: ['admin', 'owner'] },
      { name: 'Master Data', href: '/dashboard/master-data', icon: Settings, roles: ['admin', 'owner', 'inventory_manager', 'office_staff'] },
      { name: 'Settings', href: '/dashboard/settings', icon: Settings, roles: ['admin', 'owner'] },
    ],
  },
  {
    title: 'Account',
    items: [
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
  '/dashboard/products': 'Catalogue',
  '/dashboard/inventory': 'Inventory',
  '/dashboard/inventory/inwards': 'GRN Inward',
  '/dashboard/sales': 'Sales Desk',
  '/dashboard/approvals': 'Approval Desk',
  '/dashboard/intents': 'Intent Desk',
  '/dashboard/orders': 'Sales Orders',
  '/dashboard/quotes': 'Quote Register',
  '/dashboard/quotes/approvals': 'Approval Desk',
  '/dashboard/quotes/new': 'Quote Studio',
  '/dashboard/leads': 'CRM Pipeline',
  '/dashboard/leads/new': 'New Lead',
  '/dashboard/customers': 'Customers',
  '/dashboard/dispatch': 'Dispatch',
  '/dashboard/users': 'User Management',
  '/dashboard/master-data': 'Master Data',
  '/dashboard/master-data/products': 'Product Master',
  '/dashboard/master-data/brands': 'Brand Master',
  '/dashboard/master-data/finishes': 'Finish Master',
  '/dashboard/master-data/imports': 'Import Center',
  '/dashboard/master-data/catalogue-review': 'Image Review',
  '/dashboard/master-data/categories': 'Category Master',
  '/dashboard/master-data/vendors': 'Vendor Master',
  '/dashboard/settings': 'Settings',
  '/dashboard/profile': 'My Profile',
  '/dashboard/audit': 'Audit Log',
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
  const [searchQuery, setSearchQuery] = useState('');
  const [showResults, setShowResults] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      router.push('/login');
      return;
    }
    const stored = localStorage.getItem('user');
    if (stored) setUser(JSON.parse(stored));
    setRoleOverride(localStorage.getItem('role_override') || '');
  }, [router]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  const clearSidebarTimer = () => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const closeSidebarSoon = () => {
    clearSidebarTimer();
    closeTimerRef.current = window.setTimeout(() => setSidebarOpen(false), 110);
  };

  const openSidebar = () => {
    clearSidebarTimer();
    setSidebarOpen(true);
  };

  // Route changes previously left Safari focus/hover state stuck open. Treat
  // every navigation as a hard rail reset so the next hover starts cleanly.
  useEffect(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    clearSidebarTimer();
    setSidebarOpen(false);
    setMobileNavOpen(false);
    return clearSidebarTimer;
  }, [pathname]);

  const effectiveRole = user?.role === 'admin' && roleOverride ? roleOverride : user?.role || 'owner';
  const visibleSections = navSections
    .map((section) => ({ ...section, items: section.items.filter((item) => item.roles.includes(effectiveRole)) }))
    .filter((section) => section.items.length > 0);
  const isNavActive = (href: string) =>
    href === '/dashboard' ? pathname === '/dashboard' : pathname === href || pathname.startsWith(`${href}/`);

  const { data: searchResults, loading: searching } = useQuery(SEARCH_QUERY, {
    variables: { query: searchQuery },
    skip: searchQuery.length < 2,
  });
  const { data: notificationData, refetch: refetchNotifications } = useQuery(NOTIFICATIONS_QUERY, {
    skip: !user,
    pollInterval: 30000,
  });
  const { data: meData } = useQuery(ME_QUERY, { skip: !user, fetchPolicy: 'cache-and-network' });
  const me = meData?.me || user;
  const [markNotificationRead] = useMutation(MARK_NOTIFICATION_READ, { onCompleted: () => refetchNotifications() });

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
    localStorage.removeItem('role_override');
    window.location.href = '/login';
  };

  const labelClass = sidebarOpen
    ? 'pointer-events-auto max-w-[12rem] translate-x-0 opacity-100'
    : 'pointer-events-none max-w-0 -translate-x-2 opacity-0';

  const unreadCount = Number(notificationData?.unreadNotificationCount || 0);

  return (
    <div className="min-h-screen w-full bg-[var(--bg)] text-[var(--ink-2)]">
      {/* ─── Sidebar — narrow by default, opens only while hovered ───────── */}
      <aside
        aria-label="Primary workspace navigation"
        onMouseEnter={openSidebar}
        onMouseLeave={closeSidebarSoon}
        onFocusCapture={openSidebar}
        onBlurCapture={closeSidebarSoon}
        className={cn(
          'fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-[var(--line)] bg-[var(--surface)] lg:flex',
          'transition-[width,box-shadow,background-color,border-color] duration-300 ease-out',
          sidebarOpen ? 'w-[16rem] shadow-[0_24px_60px_-28px_rgba(15,23,42,0.45)]' : 'w-[4.5rem] shadow-sm',
        )}
      >
        <div className={cn('flex h-full flex-col overflow-hidden transition-[width] duration-300 ease-out', sidebarOpen ? 'w-[16rem]' : 'w-[4.5rem]')}>
          <div className={cn('flex h-16 items-center gap-3 border-b border-[var(--line)]', sidebarOpen ? 'px-4' : 'justify-center px-2')}>
            <Link href="/dashboard" onClick={() => setSidebarOpen(false)} className="flex min-w-0 items-center gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#2563eb] text-sm font-bold text-white shadow-[0_4px_12px_-4px_rgba(37,99,235,0.45)]">MP</div>
              <div className={cn('min-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 ease-out', labelClass)}>
                <p className="text-base font-bold leading-tight text-[var(--ink)]">Marble Park</p>
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--ink-4)]">Retail Ops</p>
              </div>
            </Link>
          </div>

          <nav className="flex-1 overflow-y-auto py-3 custom-scrollbar">
            {visibleSections.map((section) => (
              <div key={section.title} className="px-3 pb-4">
                <p
                  className={cn(
                    'overflow-hidden whitespace-nowrap px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-5)] transition-all duration-200 ease-out',
                    labelClass,
                  )}
                  aria-hidden="true"
                >
                  {section.title}
                </p>
                <ul className="space-y-0.5">
                  {section.items.map((item) => {
                    const active = isNavActive(item.href);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          title={item.name}
                          onClick={() => setSidebarOpen(false)}
                          className={cn(
                            'flex h-9 items-center gap-3 rounded-md text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-200',
                            sidebarOpen ? 'px-2.5' : 'justify-center px-0',
                            active
                              ? 'bg-[var(--brand-50)] text-[var(--brand-800)] shadow-[inset_0_0_0_1px_var(--brand-100)]'
                              : 'text-[var(--ink-3)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)]',
                          )}
                        >
                          <item.icon
                            className={cn('h-[18px] w-[18px] shrink-0 transition-colors', active ? 'text-[var(--brand-700)]' : 'text-[var(--ink-4)]')}
                            strokeWidth={1.6}
                          />
                          <span className={cn('overflow-hidden truncate whitespace-nowrap transition-all duration-200 ease-out', labelClass)}>{item.name}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>

          <div className="border-t border-[var(--line)] p-3">
            <Link href="/dashboard/profile" onClick={() => setSidebarOpen(false)} className={cn('flex items-center gap-3 rounded-md p-1 transition-colors hover:bg-[var(--bg-soft)]', !sidebarOpen && 'justify-center')} title="Open profile">
              <UserAvatar user={me} size="md" />
              <div className={cn('min-w-0 flex-1 overflow-hidden whitespace-nowrap transition-all duration-200 ease-out', labelClass)}>
                <p className="truncate text-sm font-semibold text-[var(--ink)]">{me?.name || 'Marble Park User'}</p>
                <p className="truncate text-[11px] font-medium capitalize text-[var(--ink-4)]">{effectiveRole.replace('_', ' ')}</p>
              </div>
            </Link>
            <div className={cn('mt-3 flex gap-1.5', sidebarOpen ? 'items-center' : 'flex-col items-center')}>
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-[var(--ink-4)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand-600)] shadow-[0_0_0_4px_var(--brand-50)]" />
              </div>
              <button
                onClick={handleLogout}
                title="Sign out"
                className={cn('flex h-9 items-center justify-center gap-2 rounded-md text-sm font-medium text-[var(--ink-3)] transition-colors hover:bg-[var(--bg-soft)] hover:text-[var(--ink)]', sidebarOpen ? 'flex-1 px-3' : 'w-9')}
              >
                <LogOut className="h-4 w-4 shrink-0" />
                <span className={cn('overflow-hidden truncate whitespace-nowrap transition-all duration-200 ease-out', labelClass)}>Sign out</span>
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile navigation — explicit top button, no accidental rail. */}
      {mobileNavOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-slate-950/35 backdrop-blur-sm"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="relative flex h-full w-[84vw] max-w-[22rem] flex-col border-r border-[var(--line)] bg-[var(--surface)] shadow-[0_30px_100px_-50px_rgba(15,23,42,0.75)]">
            <div className="flex h-16 items-center justify-between border-b border-[var(--line)] px-4">
              <Link href="/dashboard" onClick={() => setMobileNavOpen(false)} className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-r3 bg-[var(--brand-600)] text-sm font-black text-white">MP</div>
                <div>
                  <p className="text-base font-bold text-[var(--ink)]">Marble Park</p>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-4)]">Retail Ops</p>
                </div>
              </Link>
              <button type="button" onClick={() => setMobileNavOpen(false)} className="grid h-9 w-9 place-items-center rounded-md border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-3)]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3 custom-scrollbar">
              {visibleSections.map((section) => (
                <div key={section.title} className="pb-4">
                  <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-5)]">{section.title}</p>
                  <ul className="space-y-1">
                    {section.items.map((item) => {
                      const active = isNavActive(item.href);
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            onClick={() => setMobileNavOpen(false)}
                            className={cn(
                              'flex h-11 items-center gap-3 rounded-r3 px-3 text-sm font-semibold transition-colors',
                              active ? 'bg-[var(--brand-50)] text-[var(--brand-800)]' : 'text-[var(--ink-3)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)]',
                            )}
                          >
                            <item.icon className="h-[18px] w-[18px]" strokeWidth={1.6} />
                            {item.name}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>
            <div className="border-t border-[var(--line)] p-4">
              <div className="flex items-center gap-3">
                <UserAvatar user={me} size="md" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--ink)]">{me?.name || 'Marble Park User'}</p>
                  <p className="truncate text-xs capitalize text-[var(--ink-4)]">{effectiveRole.replace('_', ' ')}</p>
                </div>
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      <main className="min-w-0 transition-[padding] duration-300 ease-out lg:pl-[4.5rem]">
        {/* ─── Topbar ───────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--surface)]">
          <div className="flex flex-col gap-3 px-4 py-3.5 lg:flex-row lg:items-center lg:justify-between lg:px-6">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                aria-label="Open navigation"
                onClick={() => setMobileNavOpen(true)}
                className="grid h-9 w-9 place-items-center rounded-md border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-3)] shadow-sm-soft lg:hidden"
              >
                <Menu className="h-4 w-4" />
              </button>
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold text-[var(--ink)] lg:text-lg">
                  {pageTitles[pathname] || pageTitles[pathname.replace(/\/[^/]+$/, '')] || 'Workspace'}
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Global search */}
              <div className="relative min-w-0 flex-1 lg:w-[26rem] lg:flex-none">
                <div className={cn('flex h-9 items-center rounded-md border bg-[var(--surface)] px-3 shadow-sm-soft transition-colors', showResults ? 'border-[var(--brand-400)]' : 'border-[var(--line)]')}>
                  <Search className="mr-2 h-4 w-4 text-[var(--ink-4)]" />
                  <input
                    value={searchQuery}
                    onChange={(event) => {
                      setSearchQuery(event.target.value);
                      setShowResults(event.target.value.length > 1);
                    }}
                    onFocus={() => setShowResults(searchQuery.length > 1)}
                    onBlur={() => setTimeout(() => setShowResults(false), 180)}
                    placeholder="Search SKU, customer, lead, quote…"
                    className="w-full bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-5)]"
                  />
                  {searching ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#2563eb]" /> : null}
                </div>

                {showResults && searchQuery.length >= 2 ? (
                  <div className="animate-fade-in animate-slide-in absolute right-0 top-full z-50 mt-2 w-full overflow-hidden rounded-md border border-[var(--line)] bg-[var(--surface)] p-1 shadow-[0_12px_32px_-12px_rgba(24,24,27,0.18)] lg:w-[26rem]">
                    <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">Products</div>
                    <div className="max-h-80 overflow-y-auto custom-scrollbar">
                      {searchResults?.globalSearch?.products?.length ? (
                        searchResults.globalSearch.products.map((product: any) => (
                          <button
                            key={product.id}
                            onMouseDown={() => router.push(`/dashboard/products?sku=${product.sku}`)}
                            className="flex w-full items-center justify-between gap-3 rounded-md p-2.5 text-left transition-colors hover:bg-[var(--bg-soft)]"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-[var(--ink)]">{product.name}</p>
                              <p className="truncate text-[11px] font-medium text-[var(--ink-4)]">
                                <span className="mp-mono">{product.sku}</span> · {product.brand}
                              </p>
                            </div>
                            <span className="shrink-0 text-sm font-semibold text-[var(--ink)]">₹{Number(product.sellPrice || 0).toLocaleString('en-IN')}</span>
                          </button>
                        ))
                      ) : (
                        <p className="p-3 text-sm text-[var(--ink-4)]">No matches.</p>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Quick light/dark toggle */}
              <ThemeToggleButton className="inline-flex" />

              {/* ─── Notifications dropdown (Radix — close on outside click) ─── */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="relative grid h-9 w-9 place-items-center rounded-md border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)] shadow-sm-soft transition-colors hover:bg-[var(--bg-soft)]"
                    aria-label="Notifications"
                  >
                    <Bell className="h-4 w-4" />
                    {unreadCount > 0 ? (
                      <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#dc2626] px-1 text-[10px] font-semibold text-white">
                        {unreadCount}
                      </span>
                    ) : null}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[22rem]">
                  <DropdownMenuLabel className="flex items-center justify-between">
                    <span>Notifications</span>
                    {unreadCount > 0 ? <span className="rounded-full bg-[var(--danger-bg)] px-1.5 text-[10px] font-semibold text-[var(--danger)]">{unreadCount} new</span> : null}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <div className="max-h-96 overflow-y-auto custom-scrollbar">
                    {(notificationData?.notifications || []).length ? (notificationData?.notifications || []).map((notification: any) => (
                      <DropdownMenuItem
                        key={notification.id}
                        onSelect={async (event) => {
                          event.preventDefault();
                          await markNotificationRead({ variables: { id: notification.id } });
                          if (notification.href) router.push(notification.href);
                        }}
                        className={cn('items-start gap-2.5 px-2.5 py-2.5', !notification.readAt ? 'bg-[var(--brand-50)]' : '')}
                      >
                        <span className={cn('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', !notification.readAt ? 'bg-[var(--brand-600)]' : 'bg-[var(--line)]')} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-[var(--ink)]">{notification.title}</p>
                          <p className="mt-0.5 line-clamp-2 text-xs text-[var(--ink-3)]">{notification.message}</p>
                          <p className="mt-1 text-[10px] font-medium uppercase tracking-wider text-[var(--ink-5)]">
                            {notification.type} · {new Date(notification.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </DropdownMenuItem>
                    )) : (
                      <p className="px-3 py-6 text-center text-sm text-[var(--ink-4)]">No notifications yet.</p>
                    )}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* ─── Profile dropdown ─── */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex h-9 items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface)] pl-1 pr-2 shadow-sm-soft transition-colors hover:bg-[var(--bg-soft)]"
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

                  {['admin', 'owner'].includes(user?.role) ? (
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

        <div className="px-4 py-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
