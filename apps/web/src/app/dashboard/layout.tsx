'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { gql, useMutation, useQuery } from '@apollo/client';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bath, Bell, Boxes, Briefcase, ClipboardCheck, FileSpreadsheet,
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

/**
 * Layout sidebar — hover-to-peek floating rail.
 *
 *   • Rail width: 4.5rem (72px). Always visible — icons only.
 *   • Expanded width: 16rem (256px). Triggered by hover OR focus-within
 *     (keyboard accessibility free).
 *   • Floats OVER the content via fixed position + soft shadow. Main
 *     content padding stays constant at the rail width so the page never
 *     reflows when the panel opens.
 *   • Entry: instant (delay-0). Exit: 250 ms grace delay so accidental
 *     mouse-outs don't snap it shut. Pure CSS — `transition-delay` is set
 *     short on the hover state and long on the resting state.
 *   • Labels: opacity tween, 120 ms ease-out, delayed ~140 ms after the
 *     width starts opening so they "arrive" inside the panel instead of
 *     getting clipped during the slide.
 *   • Active item: gentle blue tint that's still visible in the rail
 *     state (icon column).
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [roleOverride, setRoleOverride] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

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

  // Shared tween classes for fading labels in *after* the rail opens.
  // delay-0 in resting state (instant fade-out), delay-[140ms] when hovered
  // (so labels appear after the width animation has begun, never clipped).
  const fadeIn =
    'opacity-0 -translate-x-1 transition-[opacity,transform] duration-150 ease-out ' +
    'group-hover/rail:opacity-100 group-hover/rail:translate-x-0 group-hover/rail:delay-[140ms] ' +
    'group-focus-within/rail:opacity-100 group-focus-within/rail:translate-x-0 group-focus-within/rail:delay-[140ms]';

  return (
    <div className="min-h-screen w-full bg-[#fafafa] text-[#27272a]">
      {/* ─── Sidebar — hover-to-peek floating rail ───────────────────────── */}
      <aside
        aria-label="Primary workspace navigation"
        className={cn(
          'group/rail fixed inset-y-0 left-0 z-40 hidden w-[4.5rem] overflow-hidden border-r border-[#e4e4e7] bg-white lg:block',
          // Width + shadow tweens. The 250 ms delay on the resting state +
          // 0 ms delay on the hover state creates "instant open, lazy close".
          'transition-[width,box-shadow] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] delay-[250ms]',
          'hover:w-[16rem] hover:shadow-[0_24px_60px_-20px_rgba(24,24,27,0.18)] hover:delay-0',
          'focus-within:w-[16rem] focus-within:shadow-[0_24px_60px_-20px_rgba(24,24,27,0.18)] focus-within:delay-0',
        )}
      >
        <div className="flex h-full w-[16rem] flex-col">
          {/* Brand */}
          <div className="flex h-16 items-center gap-3 border-b border-[#e4e4e7] px-4">
            <Link href="/dashboard" className="flex min-w-0 items-center gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#2563eb] text-sm font-bold text-white">MP</div>
              <div className={cn('min-w-0 whitespace-nowrap', fadeIn)}>
                <p className="text-base font-bold leading-tight text-[#18181b]">Marble Park</p>
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[#71717a]">Retail Ops</p>
              </div>
            </Link>
          </div>

          {/* Nav */}
          <nav className="flex-1 overflow-y-auto py-3 custom-scrollbar">
            {visibleSections.map((section) => (
              <div key={section.title} className="px-3 pb-4">
                {/* Section title — visible only when expanded */}
                <p
                  className={cn(
                    'px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a1a1aa]',
                    'whitespace-nowrap opacity-0 transition-opacity duration-150',
                    'group-hover/rail:opacity-100 group-hover/rail:delay-[140ms]',
                    'group-focus-within/rail:opacity-100 group-focus-within/rail:delay-[140ms]',
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
                          className={cn(
                            'flex h-9 items-center gap-3 rounded-md px-2.5 text-sm font-medium transition-colors',
                            active
                              ? 'bg-[#eff6ff] text-[#1d4ed8]'
                              : 'text-[#52525b] hover:bg-[#f4f4f5] hover:text-[#18181b]',
                          )}
                        >
                          <item.icon
                            className={cn(
                              'h-[18px] w-[18px] shrink-0 transition-colors',
                              active ? 'text-[#2563eb]' : 'text-[#71717a]',
                            )}
                            strokeWidth={1.6}
                          />
                          <span className={cn('truncate whitespace-nowrap', fadeIn)}>{item.name}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>

          {/* Footer: user + sign out */}
          <div className="border-t border-[#e4e4e7] p-3">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#f4f4f5] text-sm font-semibold text-[#27272a]">
                {(user?.name?.[0] || 'M').toUpperCase()}
              </div>
              <div className={cn('min-w-0 flex-1 whitespace-nowrap', fadeIn)}>
                <p className="truncate text-sm font-semibold text-[#18181b]">{user?.name || 'Marble Park User'}</p>
                <p className="truncate text-[11px] font-medium capitalize text-[#71717a]">{effectiveRole.replace('_', ' ')}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              title="Sign out"
              className="mt-3 flex h-9 w-full items-center gap-3 rounded-md px-2.5 text-sm font-medium text-[#52525b] transition-colors hover:bg-[#f4f4f5] hover:text-[#18181b]"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              <span className={cn('truncate whitespace-nowrap', fadeIn)}>Sign out</span>
            </button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 lg:pl-[4.5rem]">
        {/* Topbar */}
        <header className="sticky top-0 z-30 border-b border-[#e4e4e7] bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/75">
          <div className="flex flex-col gap-3 px-4 py-3.5 lg:flex-row lg:items-center lg:justify-between lg:px-6">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold text-[#18181b] lg:text-lg">
                  {pageTitles[pathname] || pageTitles[pathname.replace(/\/[^/]+$/, '')] || 'Workspace'}
                </h1>
              </div>
              <Link href="/dashboard" className="grid h-9 w-9 place-items-center rounded-md bg-[#2563eb] text-xs font-bold text-white lg:hidden">MP</Link>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1 lg:w-[26rem] lg:flex-none">
                <div className={cn('flex h-9 items-center rounded-md border bg-white px-3 transition-colors', showResults ? 'border-[#60a5fa]' : 'border-[#e4e4e7]')}>
                  <Search className="mr-2 h-4 w-4 text-[#71717a]" />
                  <input
                    value={searchQuery}
                    onChange={(event) => {
                      setSearchQuery(event.target.value);
                      setShowResults(event.target.value.length > 1);
                    }}
                    onFocus={() => setShowResults(searchQuery.length > 1)}
                    onBlur={() => setTimeout(() => setShowResults(false), 180)}
                    placeholder="Search SKU, customer, lead, quote…"
                    className="w-full bg-transparent text-sm text-[#18181b] outline-none placeholder:text-[#a1a1aa]"
                  />
                  {searching ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#2563eb]" /> : null}
                </div>

                <AnimatePresence>
                  {showResults && searchQuery.length >= 2 ? (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 6 }}
                      transition={{ duration: 0.16 }}
                      className="absolute right-0 top-full z-50 mt-2 w-full overflow-hidden rounded-md border border-[#e4e4e7] bg-white p-1 shadow-[0_12px_32px_-12px_rgba(24,24,27,0.18)] lg:w-[26rem]"
                    >
                      <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#71717a]">Products</div>
                      <div className="max-h-80 overflow-y-auto custom-scrollbar">
                        {searchResults?.globalSearch?.products?.length ? (
                          searchResults.globalSearch.products.map((product: any) => (
                            <button
                              key={product.id}
                              onClick={() => router.push(`/dashboard/products?sku=${product.sku}`)}
                              className="flex w-full items-center justify-between gap-3 rounded-md p-2.5 text-left transition-colors hover:bg-[#f4f4f5]"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-[#18181b]">{product.name}</p>
                                <p className="truncate text-[11px] font-medium text-[#71717a]">
                                  <span className="mp-mono">{product.sku}</span> · {product.brand}
                                </p>
                              </div>
                              <span className="shrink-0 text-sm font-semibold text-[#18181b]">₹{Number(product.sellPrice || 0).toLocaleString('en-IN')}</span>
                            </button>
                          ))
                        ) : (
                          <p className="p-3 text-sm text-[#71717a]">No matches.</p>
                        )}
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>

              {user?.role === 'admin' ? (
                <div className="hidden h-9 items-center gap-1.5 rounded-md border border-[#e4e4e7] bg-white px-2 text-xs font-medium text-[#27272a] lg:flex">
                  <Shield className="h-3.5 w-3.5 text-[#2563eb]" />
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
                  className="relative h-9 w-9 rounded-md border-[#e4e4e7] hover:bg-[#f4f4f5]"
                  onClick={() => setShowNotifications((current) => !current)}
                  aria-label="Notifications"
                >
                  <Bell className="h-4 w-4 text-[#27272a]" />
                  {Number(notificationData?.unreadNotificationCount || 0) > 0 ? (
                    <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#dc2626] px-1 text-[10px] font-semibold text-white">
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
                      className="absolute right-0 top-full z-50 mt-2 w-[22rem] overflow-hidden rounded-md border border-[#e4e4e7] bg-white p-2 shadow-[0_12px_32px_-12px_rgba(24,24,27,0.18)]"
                    >
                      <div className="flex items-center justify-between px-2 py-1">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#71717a]">Notifications</p>
                        <Link href="/dashboard" onClick={() => setShowNotifications(false)} className="text-xs font-medium text-[#1d4ed8] hover:underline">Open</Link>
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
                              'w-full rounded-md p-2.5 text-left transition-colors hover:bg-[#f4f4f5]',
                              !notification.readAt ? 'bg-[#eff6ff]' : '',
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-sm font-semibold text-[#18181b]">{notification.title}</p>
                              {!notification.readAt ? <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#2563eb]" /> : null}
                            </div>
                            <p className="mt-0.5 line-clamp-2 text-xs text-[#52525b]">{notification.message}</p>
                            <p className="mt-1 text-[10px] font-medium uppercase tracking-wider text-[#a1a1aa]">
                              {notification.type} · {new Date(notification.createdAt).toLocaleString()}
                            </p>
                          </button>
                        )) : <p className="p-3 text-sm text-[#71717a]">No notifications yet.</p>}
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* Mobile nav strip */}
          <nav className="flex gap-1 overflow-x-auto border-t border-[#e4e4e7] px-4 py-2 lg:hidden">
            {visibleSections.flatMap((s) => s.items).map((item) => {
              const active = isNavActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium',
                    active ? 'bg-[#2563eb] text-white' : 'bg-[#f4f4f5] text-[#27272a]',
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
