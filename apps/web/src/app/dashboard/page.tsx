'use client';

import { gql, useQuery } from '@apollo/client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowUpRight, Bath, FileSpreadsheet, PackageCheck, ShieldCheck, Truck, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';

const DASHBOARD = gql`
  query Dashboard($salesOwnerId: String!) {
    ownerDashboard {
      stats
      recentQuotes
      recentLeads
      userPerformance
      analytics
    }
    salesDashboard(ownerId: $salesOwnerId) {
      stats
      pendingFollowups
      recentQuotes
    }
    inventoryDashboard {
      stats
      summary
    }
    dispatchJobs {
      id
      quoteId
      siteAddress
      status
      dueDate
      customer
    }
    productStats
  }
`;

function money(value: number) {
  return `₹${Math.round(Number(value || 0)).toLocaleString('en-IN')}`;
}

const roleCopy: Record<string, { title: string; body: string; cta: string; href: string }> = {
  admin: { title: 'Admin control tower for people, roles and store flow.', body: 'Switch roles, create users, inspect sales performance, catalogue coverage, quote value and dispatch pressure from one desk.', cta: 'Manage users', href: '/dashboard/users' },
  owner: { title: 'Owner command for sales, stock and dispatch truth.', body: 'See who is selling, where quote value is stuck, which catalogue images are missing and what needs dispatch attention.', cta: 'Open analytics', href: '/dashboard/users' },
  sales_manager: { title: 'Sales manager board for pipeline movement.', body: 'Track lead aging, quote conversion and user-wise performance without mixing stock operations into the daily sales desk.', cta: 'Open CRM', href: '/dashboard/leads' },
  sales: { title: 'Sales desk built around catalogue-led quoting.', body: 'Search real catalogue SKUs, build image-backed quotes and keep every customer follow-up visible.', cta: 'Build quote', href: '/dashboard/quotes' },
  inventory_manager: { title: 'Inventory landing for inward and stock accuracy.', body: 'Catalogue-only products stay visible with zero stock until inwarded, keeping sales honest and dispatch clean.', cta: 'Open inwards', href: '/dashboard/inventory/inwards' },
  dispatch_ops: { title: 'Dispatch desk for packing, challans and delivery status.', body: 'Confirmed quotes become pending dispatch jobs with site address and customer context ready for action.', cta: 'Open dispatch', href: '/dashboard/dispatch' },
  office_staff: { title: 'Office staff desk for intents, quotes and final orders.', body: 'Review product intents from sales, generate quote PDFs, convert approved quotes into cash or credit sales orders, and keep dispatch clean.', cta: 'Open intents', href: '/dashboard/intents' },
};

export default function DashboardPage() {
  const [user, setUser] = useState<any>(null);
  const [effectiveRole, setEffectiveRole] = useState('owner');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('user') || 'null');
      const override = localStorage.getItem('role_override');
      setUser(stored);
      setEffectiveRole(stored?.role === 'admin' && override ? override : stored?.role || 'owner');
    } catch {
      setEffectiveRole('owner');
    } finally {
      setReady(true);
    }
  }, []);

  const { data, loading, error, refetch } = useQuery(DASHBOARD, { variables: { salesOwnerId: user?.id || '' }, skip: !ready || !user?.id });
  const stats = data?.ownerDashboard?.stats || {};
  const productStats = data?.productStats || {};
  const userPerformance = data?.ownerDashboard?.userPerformance || [];
  const recentQuotes = data?.ownerDashboard?.recentQuotes || [];
  const recentLeads = data?.ownerDashboard?.recentLeads || [];
  const inventoryStats = data?.inventoryDashboard?.stats || {};
  const salesStats = data?.salesDashboard?.stats || {};
  const dispatchJobs = data?.dispatchJobs || [];
  const copy = roleCopy[effectiveRole] || roleCopy.owner;

  const cards = [
    { label: 'Catalogue SKUs', value: productStats.totalProducts || stats.totalProducts || 0, icon: Bath, note: `${productStats.totalBrands || 0} brands` },
    { label: 'Image coverage', value: `${stats.catalogueImageCoverage || 0}%`, icon: PackageCheck, note: `${stats.catalogueImages || 0} mapped` },
    { label: 'Quote value', value: money(stats.totalQuoteValue || 0), icon: FileSpreadsheet, note: `${stats.quoteConversionRate || 0}% conversion` },
    { label: 'Dispatch pending', value: stats.pendingDispatchJobs || 0, icon: Truck, note: `${stats.activeDispatchJobs || 0} active jobs` },
  ];

  const roleCards = effectiveRole === 'sales'
    ? [
        { label: 'My leads', value: salesStats.myLeads || 0 },
        { label: 'My quotes', value: salesStats.myQuotes || 0 },
        { label: 'Won quotes', value: salesStats.wonQuotes || 0 },
        { label: 'Quote value', value: money(salesStats.quoteValue || 0) },
      ]
    : effectiveRole === 'inventory_manager'
      ? [
          { label: 'Total quantity', value: inventoryStats.totalQuantity || 0 },
          { label: 'Available', value: inventoryStats.totalAvailable || 0 },
          { label: 'Zero-stock SKUs', value: inventoryStats.outOfStock || 0 },
          { label: 'Stock value', value: money(inventoryStats.totalValue || 0) },
        ]
      : effectiveRole === 'dispatch_ops'
        ? [
            { label: 'Pending jobs', value: dispatchJobs.filter((job: any) => job.status === 'pending').length },
            { label: 'Packed', value: dispatchJobs.filter((job: any) => job.status === 'packed').length },
            { label: 'In transit', value: dispatchJobs.filter((job: any) => job.status === 'dispatched').length },
            { label: 'Delivered', value: dispatchJobs.filter((job: any) => job.status === 'delivered').length },
          ]
        : cards;

  return (
    <div className="space-y-7 pb-10">
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      <section className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-[2.25rem] bg-[#211b16] p-8 text-white shadow-2xl shadow-[#211b16]/18">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(181,123,66,0.42),transparent_32%),radial-gradient(circle_at_92%_20%,rgba(36,84,77,0.45),transparent_28%)]" />
          <div className="relative max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.24em] text-[#e8c39b]"><ShieldCheck className="h-4 w-4" /> {effectiveRole.replace('_', ' ')} landing</div>
            <h1 className="mt-4 text-5xl font-black leading-[0.92] tracking-[-0.055em] lg:text-7xl">{copy.title}</h1>
            <p className="mt-5 max-w-2xl text-base font-semibold leading-7 text-[#d9c4a9]">{copy.body}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button asChild size="lg" className="bg-[#fffaf3] text-[#211b16] hover:bg-white"><a href={copy.href}>{copy.cta}</a></Button>
              <Button asChild variant="outline" size="lg" className="border-white/15 bg-white/10 text-white hover:bg-white/15"><a href="/dashboard/products">Catalogue</a></Button>
            </div>
          </div>
        </motion.div>

        <div className="grid grid-cols-2 gap-4">
          {roleCards.map((card: any, index: number) => (
            <motion.div key={card.label} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className="mp-card rounded-[2rem] p-5">
              <div className="flex items-center justify-between">
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#ead7c0] text-[#7a4f2e]"><ArrowUpRight className="h-6 w-6" strokeWidth={1.5} /></div>
                <span className="text-[10px] font-black uppercase tracking-widest text-[#8b6b4c]">{card.note || 'live'}</span>
              </div>
              <div className="mt-5 text-4xl font-black tracking-[-0.04em] text-[#211b16]">{loading ? '...' : card.value}</div>
              <div className="mt-1 text-sm font-black text-[#7d6b5c]">{card.label}</div>
            </motion.div>
          ))}
        </div>
      </section>

      {(effectiveRole === 'admin' || effectiveRole === 'owner' || effectiveRole === 'sales_manager') && (
        <section className="grid gap-5 xl:grid-cols-[1.08fr_0.92fr]">
          <div className="mp-card rounded-[2rem] p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-black tracking-tight">Sales user performance</h2>
                <p className="mt-1 text-sm font-semibold text-[#7d6b5c]">Leads, quote value and won value by user.</p>
              </div>
              <Users className="h-7 w-7 text-[#24544d]" />
            </div>
            <div className="mt-5 overflow-hidden rounded-[1.5rem] border border-[#7a5b3c]/10">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#ead7c0]/70 text-[10px] uppercase tracking-widest text-[#6e563f]"><tr><th className="p-3">User</th><th className="p-3">Leads</th><th className="p-3">Quotes</th><th className="p-3">Won</th><th className="p-3 text-right">Value</th></tr></thead>
                <tbody className="divide-y divide-[#7a5b3c]/10 bg-white/50">
                  {userPerformance.map((row: any) => (
                    <tr key={row.id}>
                      <td className="p-3"><div className="font-black text-[#211b16]">{row.name}</div><div className="text-xs font-bold text-[#8b6b4c]">{row.role}</div></td>
                      <td className="p-3 font-black">{row.leads}</td>
                      <td className="p-3 font-black">{row.quotes}</td>
                      <td className="p-3 font-black text-[#24544d]">{row.confirmedQuotes}</td>
                      <td className="p-3 text-right font-black">{money(row.quoteValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-5">
            <div className="mp-card rounded-[2rem] p-6">
              <h2 className="text-2xl font-black tracking-tight">CRM queue</h2>
              <div className="mt-5 space-y-3">
                {recentLeads.slice(0, 4).map((lead: any) => <div key={lead.id} className="rounded-2xl bg-white/65 p-4"><div className="flex justify-between gap-4"><span className="truncate font-black">{lead.title}</span><span className="text-xs font-black uppercase text-[#b57942]">{lead.stage}</span></div><p className="mt-1 truncate text-sm font-semibold text-[#7d6b5c]">{lead.customer?.name || lead.owner?.name}</p></div>)}
              </div>
            </div>
            <div className="mp-card rounded-[2rem] p-6">
              <h2 className="text-2xl font-black tracking-tight">Recent quotes</h2>
              <div className="mt-5 space-y-3">
                {recentQuotes.slice(0, 4).map((quote: any) => <div key={quote.id} className="rounded-2xl bg-white/65 p-4"><div className="flex justify-between gap-4"><span className="font-black">{quote.quoteNumber}</span><span className="text-xs font-black uppercase text-[#24544d]">{quote.status}</span></div><p className="mt-1 truncate text-sm font-semibold text-[#7d6b5c]">{quote.customer?.name || quote.title}</p></div>)}
              </div>
            </div>
          </div>
        </section>
      )}

      {effectiveRole === 'dispatch_ops' && <section className="mp-card rounded-[2rem] p-6"><h2 className="text-2xl font-black">Pending dispatch jobs</h2><div className="mt-5 grid gap-3 lg:grid-cols-2">{dispatchJobs.slice(0, 8).map((job: any) => <div key={job.id} className="rounded-2xl bg-white/65 p-4"><div className="font-black">{job.customer?.name || job.customer?.companyName || 'Customer'}</div><div className="mt-1 text-sm font-bold text-[#7d6b5c]">{job.siteAddress}</div><div className="mt-3 text-xs font-black uppercase tracking-widest text-[#b57942]">{job.status}</div></div>)}</div></section>}
    </div>
  );
}
