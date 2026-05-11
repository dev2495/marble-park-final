'use client';

import { useState } from 'react';
import Link from 'next/link';
import { gql, useQuery } from '@apollo/client';
import { motion } from 'framer-motion';
import { AlertTriangle, Boxes, PackagePlus, Search, ShieldCheck, Warehouse } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';

const GET_INVENTORY = gql`
  query InventoryBalances($search: String, $take: Int) {
    inventoryBalances(search: $search, take: $take) {
      id
      onHand
      available
      reserved
      damaged
      product { id sku name brand sellPrice category finish unit media }
      updatedAt
    }
  }
`;

const GET_DASHBOARD = gql`
  query InventoryDashboard {
    inventoryDashboard { summary }
  }
`;

const GET_LOW_STOCK = gql`
  query LowStockBalances($take: Int) {
    lowStockBalances(take: $take) {
      id
      onHand
      available
      reserved
      lowStockThreshold
      reorderPoint
      isLowStock
      product { id sku name brand category sellPrice media }
      updatedAt
    }
  }
`;

function money(value: number) {
  return `₹${Math.round(value || 0).toLocaleString('en-IN')}`;
}

export default function InventoryPage() {
  const [search, setSearch] = useState('');
  const { data, loading, error, refetch } = useQuery(GET_INVENTORY, { variables: { search: search || undefined, take: 180 } });
  const { data: dashboardData, error: dashboardError } = useQuery(GET_DASHBOARD);
  const { data: lowStockData, error: lowStockError } = useQuery(GET_LOW_STOCK, { variables: { take: 24 } });
  const lowStockRows: any[] = lowStockData?.lowStockBalances || [];
  const balances = data?.inventoryBalances || [];
  const dashboard = dashboardData?.inventoryDashboard?.summary || {};

  const stats = [
    { label: 'Stock valuation', value: money(dashboard.totalValue || 0), icon: ShieldCheck, tone: 'text-[#047857]' },
    { label: 'Available qty', value: (dashboard.totalAvailable || 0).toLocaleString('en-IN'), icon: Boxes, tone: 'text-[#047857]' },
    { label: 'Reserved qty', value: (dashboard.totalReserved || 0).toLocaleString('en-IN'), icon: Warehouse, tone: 'text-[#b17643]' },
    { label: 'Low stock', value: dashboard.lowStock || 0, icon: AlertTriangle, tone: 'text-red-700' },
  ];

  return (
    <div className="space-y-7 pb-10">
      <section className="grid gap-5 lg:grid-cols-[0.82fr_1.18fr]">
        <div className="mp-dark-panel relative overflow-hidden rounded-[2.25rem] p-7 text-white">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_16%,rgba(59,130,246,0.40),transparent_32%),radial-gradient(circle_at_88%_85%,rgba(99,102,241,0.32),transparent_28%)]" />
          <div className="relative">
            <p className="text-[10px] font-black uppercase tracking-[0.26em] text-[#ead7bd]">Inventory truth</p>
            <h1 className="mt-4 text-5xl font-black leading-[0.95] tracking-[-0.05em]">Stock desk for sales, inward and dispatch.</h1>
            <p className="mt-5 text-sm font-semibold leading-6 text-[#f6eadb]">Catalogue-only SKUs are visible with zero stock until inwarded. This avoids fake stock while keeping every quoted item searchable.</p>
            <Button asChild size="lg" className="mt-7 bg-[#ffffff] text-[#241b14] hover:bg-white"><Link href="/dashboard/inventory/inwards"><PackagePlus className="mr-2 h-5 w-5" /> New inward</Link></Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {stats.map((stat, index) => (
            <motion.div key={stat.label} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className="mp-card rounded-[2rem] p-5">
              <div className={`grid h-12 w-12 place-items-center rounded-2xl bg-[#f6eadb] ${stat.tone}`}><stat.icon className="h-6 w-6" strokeWidth={1.5} /></div>
              <div className="mt-5 text-3xl font-black tracking-tight text-[#241b14]">{stat.value}</div>
              <div className="mt-1 text-sm font-black text-[#6f6258]">{stat.label}</div>
            </motion.div>
          ))}
        </div>
      </section>

      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {dashboardError ? <QueryErrorBanner error={dashboardError} /> : null}
      {lowStockError ? <QueryErrorBanner error={lowStockError} /> : null}

      {lowStockRows.length > 0 ? (
        <section className="mp-card rounded-[2rem] border border-red-200/70 bg-red-50/60 p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.26em] text-red-700">Low-stock alerts</p>
              <h2 className="mt-2 text-2xl font-black text-[#241b14]">{lowStockRows.length} SKU{lowStockRows.length === 1 ? '' : 's'} need re-ordering</h2>
              <p className="mt-1 text-sm font-bold text-[#6f6258]">Available stock has dropped to or below each product's threshold (or explicit reorder point if set).</p>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto custom-scrollbar">
            <table className="w-full min-w-[760px] text-left">
              <thead className="text-[10px] font-black uppercase tracking-widest text-red-800/80">
                <tr>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2 text-center">Available</th>
                  <th className="px-3 py-2 text-center">Threshold</th>
                  <th className="px-3 py-2 text-center">Reorder pt.</th>
                  <th className="px-3 py-2 text-right">Last updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-red-200/60">
                {lowStockRows.map((row: any) => (
                  <tr key={row.id} className="text-sm">
                    <td className="px-3 py-2">
                      <div className="font-black text-[#241b14]">{row.product?.name}</div>
                      <div className="text-[10px] font-black uppercase tracking-wider text-[#6f6258]">{row.product?.sku} · {row.product?.brand}</div>
                    </td>
                    <td className="px-3 py-2 text-center"><span className="rounded-full bg-red-200/80 px-3 py-1 text-sm font-black text-red-900">{row.available}</span></td>
                    <td className="px-3 py-2 text-center font-black text-[#8a552e]">{row.lowStockThreshold}</td>
                    <td className="px-3 py-2 text-center font-black text-[#8a552e]">{row.reorderPoint ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-xs font-bold text-[#6f6258]">{row.updatedAt ? new Date(row.updatedAt).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="mp-card rounded-[2rem] p-4 lg:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative max-w-xl flex-1">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#6f6258]" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search inventory by SKU, brand or product..." aria-label="Search inventory" className="h-[3.25rem] pl-12" />
          </div>
          <p className="text-sm font-bold text-[#6f6258]">Showing {balances.length.toLocaleString('en-IN')} rows</p>
        </div>

        <div className="mt-5 overflow-hidden rounded-[1.5rem] border border-[#d9cbbd]/12 bg-white/72">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full min-w-[860px] text-left">
              <thead className="bg-[#f6eadb]/65 text-[10px] font-black uppercase tracking-widest text-[#d9cbbd]">
                <tr>
                  <th className="px-5 py-4">Product</th>
                  <th className="px-5 py-4">Category</th>
                  <th className="px-5 py-4 text-center">On hand</th>
                  <th className="px-5 py-4 text-center">Available</th>
                  <th className="px-5 py-4 text-center">Reserved</th>
                  <th className="px-5 py-4 text-right">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#d9cbbd]/10">
                {loading ? (
                  <tr><td colSpan={6} className="px-5 py-12 text-center text-sm font-bold text-[#6f6258]">Loading inventory...</td></tr>
                ) : balances.map((item: any) => (
                  <tr key={item.id} className="transition hover:bg-[#ffffff]">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <img src={item.product?.media?.primary || '/catalogue-art/faucet.svg'} alt="" className="h-12 w-12 rounded-2xl bg-[#f6eadb] object-contain p-1" />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-black text-[#241b14]">{item.product?.name}</div>
                          <div className="text-[10px] font-black uppercase tracking-wider text-[#6f6258]">{item.product?.sku} · {item.product?.brand}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm font-bold text-[#2d251f]">{item.product?.category}</td>
                    <td className="px-5 py-4 text-center font-black">{item.onHand}</td>
                    <td className="px-5 py-4 text-center"><span className="rounded-full bg-[#ecfdf5] px-3 py-1 text-sm font-black text-[#047857]">{item.available}</span></td>
                    <td className="px-5 py-4 text-center font-black text-[#b17643]">{item.reserved}</td>
                    <td className="px-5 py-4 text-right font-black">{money((item.available || 0) * (item.product?.sellPrice || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
