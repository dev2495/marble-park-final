'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { gql, useMutation, useQuery } from '@apollo/client';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bath, Bell, Boxes, Briefcase, ChevronLeft, ChevronRight, ClipboardCheck, FileSpreadsheet,
  LayoutDashboard, ListChecks, LogOut, PackageSearch, Receipt, Search, Settings, Shield,
  Truck, Users, UserCog,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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
      { name: 'Master Data', href: '/dashboard/master-data', icon: Settings, roles: ['admin', 'owner', 'inventory_manager', 'office_staff'] },
      { name: 'Settings', href: '/dashboard/settings', icon: Settings, roles: ['admin', 'owner'] },
    ],
  },
];

const roleOptions = [
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
  '/dashboard/inventory/inwards': 'Inwards',
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
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [roleOverride, setRoleOverride] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  // Persistent collapse state. Default = expanded. A true collapse hides labels;
  // there's no more "hover-to-peek" trick — operators found it disorienting
  // because labels stayed clipped under the icon when the cursor wasn't
  // exactly on the rail.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      router.push('/login');
      return;
    }
    const stored = localStorage.getItem('user');
    if (stored) setUser(JSON.parse(stored));
    setRoleOverride(localStorage.getItem('role_override') || '');
    const savedCollapsed = localStorage.getItem('mp_sidebar_collapsed');
    if (savedCollapsed === '1') setCollapsed(true);
  }, [router]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('mp_sidebar_collapsed', next ? '1' : '0');
      return next;
    });
  };

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
  const [markNotificationRead] = useMutation(MARK_NOTIFICATION_READ, { onCompleted: () => refetchNotifications() });

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
    localStorage.removeItem('role_override');
    window.location.href = '/login';
  };

  const sidebarWidth = collapsed ? 'w-[4.5rem]' : 'w-[16rem]';

  return (
    <div className="min-h-screen w-full bg-[var(--bg)] text-[var(--ink-2)]">
      {/* Sidebar — light surface, collapsible. */}
      <aside
        aria-label="Primary workspace navigation"
        className={cn(
          'fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-[var(--line)] bg-white transition-[width] duration-200 ease-out lg:flex',
          sidebarWidth,
        )}
      >
        {/* Brand */}
        <div className={cn('flex items-center gap-3 border-b border-[var(--line)] px-4', collapsed ? 'h-16 justify-center px-2' : 'h-16')}>
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[var(--brand-600)] text-sm font-bold text-white">MP</div>
            {!collapsed ? (
              <div className="min-w-0">
                <div className="truncate font-display text-lg font-bold leading-tight text-[var(--ink)]">Marble Park</div>
                <div className="truncate text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--ink-4)]">Retail Ops</div>
              </div>
            ) : null}
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 custom-scrollbar">
          {visibleSections.map((section) => (
            <div key={section.title} className="px-3 pb-4">
              {!collapsed ? (
                <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-5)]">{section.title}</p>
              ) : (
                <div className="mx-2 mb-1.5 h-px bg-[var(--line)]" aria-hidden />
              )}
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active = isNavActive(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        title={item.name}
                        className={cn(
                          'group flex h-9 items-center gap-3 rounded-md px-2.5 text-sm font-medium transition-colors',
                          collapsed ? 'justify-center' : '',
                          active
                            ? 'bg-[var(--brand-50)] text-[var(--brand-700)]'
                            : 'text-[var(--ink-3)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)]',
                        )}
                      >
                        <item.icon
                          className={cn('h-[18px] w-[18px] shrink-0', active ? 'text-[var(--brand-600)]' : 'text-[var(--ink-4)] group-hover:text-[var(--ink-2)]')}
                          strokeWidth={1.6}
                        />
                        {!collapsed ? <span className="truncate">{item.name}</span> : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer: user + collapse + logout */}
        <div className="border-t border-[var(--line)] p-3">
          <div className={cn('flex items-center gap-3', collapsed ? 'justify-center' : '')}>
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[var(--bg-soft)] text-sm font-semibold text-[var(--ink-2)]">
              {(user?.name?.[0] || 'M').toUpperCase()}
            </div>
            {!collapsed ? (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[var(--ink)]">{user?.name || 'Marble Park User'}</p>
                <p className="truncate text-[11px] font-medium capitalize text-[var(--ink-4)]">{effectiveRole.replace('_', ' ')}</p>
              </div>
            ) : null}
          </div>
          <div className={cn('mt-3 flex gap-1.5', collapsed ? 'flex-col items-center' : '')}>
            <button
              onClick={toggleCollapsed}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="grid h-9 w-9 place-items-center rounded-md text-[var(--ink-3)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)]"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
            <button
              onClick={handleLogout}
              title="Sign out"
              className={cn(
                'flex h-9 items-center justify-center gap-2 rounded-md text-sm font-medium text-[var(--ink-3)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)]',
                collapsed ? 'w-9' : 'flex-1 px-3',
              )}
            >
              <LogOut className="h-4 w-4" />
              {!collapsed ? <span>Sign out</span> : null}
            </button>
          </div>
        </div>
      </aside>

      <main
        className={cn('min-w-0 transition-[padding] duration-200 ease-out', collapsed ? 'lg:pl-[4.5rem]' : 'lg:pl-[16rem]')}
      >
        {/* Topbar */}
        <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/75">
          <div className="flex flex-col gap-3 px-4 py-3.5 lg:flex-row lg:items-center lg:justify-between lg:px-6">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold text-[var(--ink)] lg:text-lg">
                  {pageTitles[pathname] || pageTitles[pathname.replace(/\/[^/]+$/, '')] || 'Workspace'}
                </h1>
              </div>
              <Link href="/dashboard" className="grid h-9 w-9 place-items-center rounded-md bg-[var(--brand-600)] text-xs font-bold text-white lg:hidden">MP</Link>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1 lg:w-[26rem] lg:flex-none">
                <div className={cn('flex h-9 items-center rounded-md border bg-white px-3 transition-colors', showResults ? 'border-[var(--brand-400)]' : 'border-[var(--line)]')}>
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
                  {searching ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--brand-600)]" /> : null}
                </div>

                <AnimatePresence>
                  {showResults && searchQuery.length >= 2 ? (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 6 }}
                      transition={{ duration: 0.16 }}
                      className="absolute right-0 top-full z-50 mt-2 w-full overflow-hidden rounded-md border border-[var(--line)] bg-white p-1 shadow-lg-soft lg:w-[26rem]"
                    >
                      <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">Products</div>
                      <div className="max-h-80 overflow-y-auto custom-scrollbar">
                        {searchResults?.globalSearch?.products?.length ? (
                          searchResults.globalSearch.products.map((product: any) => (
                            <button
                              key={product.id}
                              onClick={() => router.push(`/dashboard/products?sku=${product.sku}`)}
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
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>

              {user?.role === 'admin' ? (
                <div className="hidden h-9 items-center gap-1.5 rounded-md border border-[var(--line)] bg-white px-2 text-xs font-medium text-[var(--ink-2)] lg:flex">
                  <Shield className="h-3.5 w-3.5 text-[var(--brand-600)]" />
                  <select
                    value={effectiveRole}
                    onChange={(event) => {
                      localStorage.setItem('role_override', event.target.value);
                      setRoleOverride(event.target.value);
                      window.location.href = '/dashboard';
                    }}
                    className="bg-transparent text-xs font-medium outline-none"
                    aria-label="Role preview"
                  >
                    {roleOptions.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                  </select>
                </div>
              ) : null}

              <div className="relative">
                <Button
                  variant="outline"
                  size="icon"
                  className="relative h-9 w-9 rounded-md border-[var(--line)] hover:bg-[var(--bg-soft)]"
                  onClick={() => setShowNotifications((current) => !current)}
                  aria-label="Notifications"
                >
                  <Bell className="h-4 w-4 text-[var(--ink-2)]" />
                  {Number(notificationData?.unreadNotificationCount || 0) > 0 ? (
                    <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-semibold text-white">
                      {notificationData.unreadNotificationCount}
                    </span>
                  ) : null}
                </Button>
                <AnimatePresence>
                  {showNotifications ? (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 6 }}
                      transition={{ duration: 0.16 }}
                      className="absolute right-0 top-full z-50 mt-2 w-[22rem] overflow-hidden rounded-md border border-[var(--line)] bg-white p-2 shadow-lg-soft"
                    >
                      <div className="flex items-center justify-between px-2 py-1">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">Notifications</p>
                        <Link href="/dashboard" onClick={() => setShowNotifications(false)} className="text-xs font-medium text-[var(--brand-700)] hover:underline">Open</Link>
                      </div>
                      <div className="mt-1 max-h-96 space-y-1 overflow-y-auto custom-scrollbar">
                        {(notificationData?.notifications || []).length ? (notificationData?.notifications || []).map((notification: any) => (
                          <button
                            key={notification.id}
                            onClick={async () => {
                              await markNotificationRead({ variables: { id: notification.id } });
                              if (notification.href) router.push(notification.href);
                              setShowNotifications(false);
                            }}
                            className={cn(
                              'w-full rounded-md p-2.5 text-left transition-colors hover:bg-[var(--bg-soft)]',
                              !notification.readAt ? 'bg-[var(--brand-50)]' : '',
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-sm font-semibold text-[var(--ink)]">{notification.title}</p>
                              {!notification.readAt ? <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand-600)]" /> : null}
                            </div>
                            <p className="mt-0.5 line-clamp-2 text-xs text-[var(--ink-3)]">{notification.message}</p>
                            <p className="mt-1 text-[10px] font-medium uppercase tracking-wider text-[var(--ink-5)]">
                              {notification.type} · {new Date(notification.createdAt).toLocaleString()}
                            </p>
                          </button>
                        )) : <p className="p-3 text-sm text-[var(--ink-4)]">No notifications yet.</p>}
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* Mobile nav strip */}
          <nav className="flex gap-1 overflow-x-auto border-t border-[var(--line)] px-4 py-2 lg:hidden">
            {visibleSections.flatMap((s) => s.items).map((item) => {
              const active = isNavActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium',
                    active ? 'bg-[var(--brand-600)] text-white' : 'bg-[var(--bg-soft)] text-[var(--ink-2)]',
                  )}
                >
                  <item.icon className="h-3.5 w-3.5" />
                  {item.name}
                </Link>
              );
            })}
          </nav>
        </header>

        <div className="px-4 py-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
