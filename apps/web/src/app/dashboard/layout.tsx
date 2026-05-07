'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { gql, useMutation, useQuery } from '@apollo/client';
import { AnimatePresence, motion } from 'framer-motion';
import { Bath, Bell, Boxes, Briefcase, ClipboardCheck, FileSpreadsheet, LayoutDashboard, ListChecks, LogOut, PackageSearch, Receipt, Search, Settings, Shield, Truck, Users, UserCog } from 'lucide-react';
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

const navItems = [
  { name: 'Command', href: '/dashboard', icon: LayoutDashboard, roles: ['admin', 'owner', 'sales_manager', 'sales', 'inventory_manager', 'dispatch_ops', 'office_staff'] },
  { name: 'Approvals', href: '/dashboard/approvals', icon: ClipboardCheck, roles: ['admin', 'owner'] },
  { name: 'Catalogue', href: '/dashboard/products', icon: Bath, roles: ['admin', 'owner', 'sales_manager', 'sales', 'inventory_manager', 'office_staff'] },
  { name: 'Sales Desk', href: '/dashboard/sales', icon: Briefcase, roles: ['admin', 'owner', 'sales_manager', 'sales'] },
  { name: 'Intents', href: '/dashboard/intents', icon: ListChecks, roles: ['admin', 'owner', 'sales_manager', 'office_staff'] },
  { name: 'Orders', href: '/dashboard/orders', icon: Receipt, roles: ['admin', 'owner', 'sales_manager', 'sales', 'office_staff', 'dispatch_ops'] },
  { name: 'Inventory', href: '/dashboard/inventory', icon: Boxes, roles: ['admin', 'owner', 'inventory_manager', 'sales_manager', 'office_staff'] },
  { name: 'Quotes', href: '/dashboard/quotes', icon: FileSpreadsheet, roles: ['admin', 'owner', 'sales_manager', 'sales', 'office_staff'] },
  { name: 'CRM', href: '/dashboard/leads', icon: PackageSearch, roles: ['admin', 'owner', 'sales_manager', 'sales', 'office_staff'] },
  { name: 'Customers', href: '/dashboard/customers', icon: Users, roles: ['admin', 'owner', 'sales_manager', 'sales', 'dispatch_ops', 'office_staff'] },
  { name: 'Dispatch', href: '/dashboard/dispatch', icon: Truck, roles: ['admin', 'owner', 'dispatch_ops', 'sales_manager', 'office_staff'] },
  { name: 'Users', href: '/dashboard/users', icon: UserCog, roles: ['admin', 'owner'] },
  { name: 'Master Data', href: '/dashboard/master-data', icon: Settings, roles: ['admin', 'owner', 'inventory_manager', 'office_staff'] },
  { name: 'Settings', href: '/dashboard/settings', icon: Settings, roles: ['admin', 'owner'] },
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
  '/dashboard': 'Command',
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
  const visibleNavItems = navItems.filter((item) => item.roles.includes(effectiveRole));
  const isNavActive = (href: string) => href === '/dashboard' ? pathname === '/dashboard' : pathname === href || pathname.startsWith(`${href}/`);

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

  return (
    <div className="min-h-screen w-full bg-[#f3eadf] text-[#211b16]">
      <aside
        aria-label="Primary workspace navigation"
        className="group/sidebar fixed inset-y-0 left-0 z-50 hidden w-[5.75rem] p-3 transition-[width] duration-300 ease-out hover:w-80 focus-within:w-80 lg:block"
      >
        <div className="mp-dark-panel flex h-full flex-col overflow-hidden rounded-[2rem] p-3 text-[#fffaf3] shadow-2xl shadow-[#211b16]/10 transition-all duration-300 group-hover/sidebar:shadow-[#211b16]/20 group-focus-within/sidebar:shadow-[#211b16]/20">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_5%,rgba(181,123,66,0.38),transparent_30%),radial-gradient(circle_at_95%_75%,rgba(36,84,77,0.40),transparent_28%)]" />
          <div className="relative flex items-center justify-center p-3 transition-all duration-300 group-hover/sidebar:justify-start group-hover/sidebar:gap-4 group-focus-within/sidebar:justify-start group-focus-within/sidebar:gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[#fffaf3] text-xl font-black text-[#211b16] shadow-2xl">MP</div>
            <div className="w-0 min-w-0 overflow-hidden opacity-0 transition-all duration-300 group-hover/sidebar:w-44 group-hover/sidebar:opacity-100 group-focus-within/sidebar:w-44 group-focus-within/sidebar:opacity-100">
              <h1 className="text-2xl font-black tracking-tight">Marble Park</h1>
              <p className="mt-1 text-[10px] font-black uppercase tracking-[0.24em] text-[#d5b58f]">Retail Ops</p>
            </div>
          </div>

          <nav className="relative mt-5 flex-1 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
            {visibleNavItems.map((item) => {
              const active = isNavActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.name}
                  className={cn(
                    'group relative flex min-h-14 items-center justify-center rounded-2xl px-0 py-4 text-sm font-black transition-all group-hover/sidebar:justify-start group-hover/sidebar:gap-4 group-hover/sidebar:px-4 group-focus-within/sidebar:justify-start group-focus-within/sidebar:gap-4 group-focus-within/sidebar:px-4',
                    active ? 'bg-[#fffaf3] text-[#211b16] shadow-xl' : 'text-[#cdb89c] hover:bg-white/10 hover:text-white'
                  )}
                >
                  <item.icon className={cn('h-5 w-5', active ? 'text-[#b57942]' : 'text-[#8e765d] group-hover:text-[#e8c39b]')} strokeWidth={1.7} />
                  <span className="w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-300 group-hover/sidebar:w-40 group-hover/sidebar:opacity-100 group-focus-within/sidebar:w-40 group-focus-within/sidebar:opacity-100">{item.name}</span>
                  {active && <motion.span layoutId="mp-active-nav" className="absolute right-2 h-2 w-2 rounded-full bg-[#b57942] transition-all group-hover/sidebar:right-3 group-focus-within/sidebar:right-3" />}
                </Link>
              );
            })}
          </nav>

          <div className="relative mx-auto w-14 space-y-3 rounded-[1.75rem] border border-white/10 bg-white/[0.08] p-3 backdrop-blur transition-all duration-300 group-hover/sidebar:mx-0 group-hover/sidebar:w-full group-focus-within/sidebar:mx-0 group-focus-within/sidebar:w-full">
            <div className="flex items-center justify-center transition-all duration-300 group-hover/sidebar:justify-start group-hover/sidebar:gap-3 group-focus-within/sidebar:justify-start group-focus-within/sidebar:gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#e8c39b] font-black text-[#211b16]">{user?.name?.[0] || 'M'}</div>
              <div className="w-0 min-w-0 flex-1 overflow-hidden opacity-0 transition-all duration-300 group-hover/sidebar:w-40 group-hover/sidebar:opacity-100 group-focus-within/sidebar:w-40 group-focus-within/sidebar:opacity-100">
                <p className="truncate text-sm font-black text-white">{user?.name || 'Marble Park User'}</p>
                <p className="text-[10px] font-black uppercase tracking-wider text-[#d5b58f]">{effectiveRole}</p>
              </div>
            </div>
            <Button onClick={handleLogout} variant="ghost" title="Sign out" className="h-11 w-full justify-center rounded-2xl px-0 text-[#e8c39b] hover:bg-white/10 hover:text-white group-hover/sidebar:justify-start group-hover/sidebar:px-4 group-focus-within/sidebar:justify-start group-focus-within/sidebar:px-4">
              <LogOut className="h-4 w-4 group-hover/sidebar:mr-3 group-focus-within/sidebar:mr-3" />
              <span className="w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-300 group-hover/sidebar:w-20 group-hover/sidebar:opacity-100 group-focus-within/sidebar:w-20 group-focus-within/sidebar:opacity-100">Sign out</span>
            </Button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 p-3 lg:p-4 lg:pl-[5.75rem]">
        <div className="mp-shell-panel min-h-[calc(100vh-1.5rem)] overflow-hidden rounded-[2.25rem] lg:min-h-[calc(100vh-2rem)]">
          <header className="sticky top-0 z-40 border-b border-[#7a5b3c]/10 bg-[#fffaf3]/78 px-4 py-4 backdrop-blur-2xl lg:px-7">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#8b6b4c]">Retail command center</p>
                  <h2 className="mt-1 text-3xl font-black tracking-[-0.04em] text-[#211b16] lg:text-4xl">{pageTitles[pathname] || pageTitles[pathname.replace(/\/[^/]+$/, '')] || 'Workspace'}</h2>
                </div>
                <Link href="/dashboard" className="grid h-12 w-12 place-items-center rounded-2xl bg-[#211b16] text-sm font-black text-[#fffaf3] shadow-xl lg:hidden">MP</Link>
              </div>

              <div className="flex items-center gap-3">
                <div className="relative min-w-0 flex-1 xl:w-[34rem] xl:flex-none">
                  <div className={cn('flex h-[3.25rem] items-center rounded-2xl border px-4 transition-all', showResults ? 'border-[#b57942]/35 bg-white shadow-2xl' : 'border-[#7a5b3c]/12 bg-white/66')}>
                    <Search className="mr-3 h-5 w-5 text-[#8b6b4c]" />
                    <input
                      value={searchQuery}
                      onChange={(event) => {
                        setSearchQuery(event.target.value);
                        setShowResults(event.target.value.length > 1);
                      }}
                      onFocus={() => setShowResults(searchQuery.length > 1)}
                      onBlur={() => setTimeout(() => setShowResults(false), 180)}
                      placeholder="Search SKU, customer, lead, quote..."
                      className="w-full bg-transparent text-sm font-bold text-[#211b16] outline-none placeholder:text-[#9a8777]"
                    />
                    {searching && <span className="h-2 w-2 animate-ping rounded-full bg-[#b57942]" />}
                  </div>

                  <AnimatePresence>
                    {showResults && searchQuery.length >= 2 && (
                      <motion.div initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.98 }} className="absolute right-0 top-full z-50 mt-3 w-full overflow-hidden rounded-[1.75rem] border border-[#7a5b3c]/12 bg-[#fffaf3] p-3 shadow-2xl xl:w-[34rem]">
                        <div className="text-[10px] font-black uppercase tracking-[0.24em] text-[#8b6b4c]">Products</div>
                        <div className="mt-2 max-h-80 space-y-1 overflow-y-auto custom-scrollbar">
                          {searchResults?.globalSearch?.products?.length ? searchResults.globalSearch.products.map((product: any) => (
                            <button key={product.id} onClick={() => router.push(`/dashboard/products?sku=${product.sku}`)} className="flex w-full items-center justify-between rounded-2xl p-3 text-left transition hover:bg-[#ead7c0]/60">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-black text-[#211b16]">{product.name}</p>
                                <p className="text-[10px] font-black uppercase tracking-wider text-[#8b6b4c]">{product.sku} · {product.brand}</p>
                              </div>
                              <span className="ml-3 shrink-0 text-sm font-black text-[#24544d]">₹{Number(product.sellPrice || 0).toLocaleString('en-IN')}</span>
                            </button>
                          )) : <p className="p-3 text-sm font-semibold text-[#8b6b4c]">No product matches.</p>}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {user?.role === 'admin' && (
                  <div className="hidden items-center gap-2 rounded-2xl border border-[#7a5b3c]/12 bg-white/70 px-3 py-2 xl:flex">
                    <Shield className="h-4 w-4 text-[#b57942]" />
                    <select
                      value={effectiveRole}
                      onChange={(event) => {
                        localStorage.setItem('role_override', event.target.value);
                        setRoleOverride(event.target.value);
                        window.location.href = '/dashboard';
                      }}
                      className="bg-transparent text-xs font-black uppercase tracking-wider text-[#211b16] outline-none"
                    >
                      {roleOptions.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                    </select>
                  </div>
                )}

                <div className="relative">
                  <Button variant="outline" size="icon" className="relative rounded-2xl bg-white/70" onClick={() => setShowNotifications((current) => !current)}>
                    <Bell className="h-5 w-5 text-[#5f4b3b]" />
                    {Number(notificationData?.unreadNotificationCount || 0) > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#b57942] px-1 text-[10px] font-black text-white">{notificationData.unreadNotificationCount}</span>}
                  </Button>
                  <AnimatePresence>
                    {showNotifications && (
                      <motion.div initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.98 }} className="absolute right-0 top-full z-50 mt-3 w-[22rem] overflow-hidden rounded-[1.75rem] border border-[#7a5b3c]/12 bg-[#fffaf3] p-3 shadow-2xl">
                        <div className="flex items-center justify-between px-2 py-1">
                          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#8b6b4c]">Notifications</p>
                          <Link href="/dashboard" onClick={() => setShowNotifications(false)} className="text-xs font-black text-[#b57942]">Command</Link>
                        </div>
                        <div className="mt-2 max-h-96 space-y-2 overflow-y-auto custom-scrollbar">
                          {(notificationData?.notifications || []).map((notification: any) => (
                            <button key={notification.id} onClick={async () => { await markNotificationRead({ variables: { id: notification.id } }); if (notification.href) router.push(notification.href); setShowNotifications(false); }} className={`w-full rounded-2xl p-3 text-left transition hover:bg-[#ead7c0]/65 ${notification.readAt ? 'bg-white/50' : 'bg-white shadow-sm'}`}>
                              <div className="flex items-start justify-between gap-3">
                                <p className="text-sm font-black text-[#211b16]">{notification.title}</p>
                                {!notification.readAt && <span className="mt-1 h-2 w-2 rounded-full bg-[#b57942]" />}
                              </div>
                              <p className="mt-1 line-clamp-3 text-xs font-bold leading-5 text-[#7d6b5c]">{notification.message}</p>
                              <p className="mt-2 text-[10px] font-black uppercase tracking-wider text-[#a7907c]">{notification.type} · {new Date(notification.createdAt).toLocaleString()}</p>
                            </button>
                          ))}
                          {!notificationData?.notifications?.length && <p className="rounded-2xl bg-white/60 p-4 text-sm font-bold text-[#8b6b4c]">No notifications yet.</p>}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>

            <nav className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:hidden">
              {visibleNavItems.map((item) => {
                const active = isNavActive(item.href);
                return (
                  <Link key={item.href} href={item.href} className={cn('whitespace-nowrap rounded-2xl px-4 py-2 text-xs font-black', active ? 'bg-[#211b16] text-white' : 'bg-white/70 text-[#5f4b3b]')}>
                    {item.name}
                  </Link>
                );
              })}
            </nav>
          </header>

          <div className="relative min-h-[calc(100vh-7rem)] overflow-y-auto p-4 custom-scrollbar lg:p-7">
            <div className="pointer-events-none absolute right-0 top-0 h-80 w-80 rounded-full bg-[#b57942]/10 blur-3xl" />
            <div className="pointer-events-none absolute bottom-0 left-0 h-80 w-80 rounded-full bg-[#24544d]/10 blur-3xl" />
            <div className="relative">{children}</div>
          </div>
        </div>
      </main>
    </div>
  );
}
