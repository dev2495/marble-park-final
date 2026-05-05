'use client';

import { useState } from 'react';
import Link from 'next/link';
import { gql, useQuery } from '@apollo/client';
import { motion } from 'framer-motion';
import { AlertTriangle, Boxes, PackagePlus, Search, ShieldCheck, Warehouse } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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

function money(value: number) {
  return `₹${Math.round(value || 0).toLocaleString('en-IN')}`;
}

export default function InventoryPage() {
  const [search, setSearch] = useState('');
  const { data, loading } = useQuery(GET_INVENTORY, { variables: { search: search || undefined, take: 180 } });
  const { data: dashboardData } = useQuery(GET_DASHBOARD);
  const balances = data?.inventoryBalances || [];
  const dashboard = dashboardData?.inventoryDashboard?.summary || {};

  const stats = [
    { label: 'Stock valuation', value: money(dashboard.totalValue || 0), icon: ShieldCheck, tone: 'text-[#24544d]' },
    { label: 'Available qty', value: (dashboard.totalAvailable || 0).toLocaleString('en-IN'), icon: Boxes, tone: 'text-[#24544d]' },
    { label: 'Reserved qty', value: (dashboard.totalReserved || 0).toLocaleString('en-IN'), icon: Warehouse, tone: 'text-[#b57942]' },
    { label: 'Low stock', value: dashboard.lowStock || 0, icon: AlertTriangle, tone: 'text-red-700' },
  ];

  return (
    <div className="space-y-7 pb-10">
      <section className="grid gap-5 lg:grid-cols-[0.82fr_1.18fr]">
        <div className="mp-dark-panel relative overflow-hidden rounded-[2.25rem] p-7 text-white">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_16%,rgba(181,123,66,0.46),transparent_32%),radial-gradient(circle_at_88%_85%,rgba(36,84,77,0.42),transparent_28%)]" />
          <div className="relative">
            <p className="text-[10px] font-black uppercase tracking-[0.26em] text-[#e8c39b]">Inventory truth</p>
            <h1 className="mt-4 text-5xl font-black leading-[0.95] tracking-[-0.05em]">Stock desk for sales, inward and dispatch.</h1>
            <p className="mt-5 text-sm font-semibold leading-6 text-[#d9c4a9]">Catalogue-only SKUs are visible with zero stock until inwarded. This avoids fake stock while keeping every quoted item searchable.</p>
            <Button asChild size="lg" className="mt-7 bg-[#fffaf3] text-[#211b16] hover:bg-white"><Link href="/dashboard/inventory/inwards"><PackagePlus className="mr-2 h-5 w-5" /> New inward</Link></Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {stats.map((stat, index) => (
            <motion.div key={stat.label} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className="mp-card rounded-[2rem] p-5">
              <div className={`grid h-12 w-12 place-items-center rounded-2xl bg-[#ead7c0] ${stat.tone}`}><stat.icon className="h-6 w-6" strokeWidth={1.5} /></div>
              <div className="mt-5 text-3xl font-black tracking-tight text-[#211b16]">{stat.value}</div>
              <div className="mt-1 text-sm font-black text-[#7d6b5c]">{stat.label}</div>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="mp-card rounded-[2rem] p-4 lg:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative max-w-xl flex-1">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#8b6b4c]" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search inventory by SKU, brand or product..." className="h-[3.25rem] pl-12" />
          </div>
          <p className="text-sm font-bold text-[#7d6b5c]">Showing {balances.length.toLocaleString('en-IN')} rows</p>
        </div>

        <div className="mt-5 overflow-hidden rounded-[1.5rem] border border-[#7a5b3c]/12 bg-white/72">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full min-w-[860px] text-left">
              <thead className="bg-[#ead7c0]/65 text-[10px] font-black uppercase tracking-widest text-[#7a5b3c]">
                <tr>
                  <th className="px-5 py-4">Product</th>
                  <th className="px-5 py-4">Category</th>
                  <th className="px-5 py-4 text-center">On hand</th>
                  <th className="px-5 py-4 text-center">Available</th>
                  <th className="px-5 py-4 text-center">Reserved</th>
                  <th className="px-5 py-4 text-right">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#7a5b3c]/10">
                {loading ? (
                  <tr><td colSpan={6} className="px-5 py-12 text-center text-sm font-bold text-[#7d6b5c]">Loading inventory...</td></tr>
                ) : balances.map((item: any) => (
                  <tr key={item.id} className="transition hover:bg-[#fffaf3]">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <img src={item.product?.media?.primary || '/catalogue-art/faucet.svg'} alt="" className="h-12 w-12 rounded-2xl bg-[#ead7c0] object-contain p-1" />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-black text-[#211b16]">{item.product?.name}</div>
                          <div className="text-[10px] font-black uppercase tracking-wider text-[#8b6b4c]">{item.product?.sku} · {item.product?.brand}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm font-bold text-[#5f4b3b]">{item.product?.category}</td>
                    <td className="px-5 py-4 text-center font-black">{item.onHand}</td>
                    <td className="px-5 py-4 text-center"><span className="rounded-full bg-[#dbe8e3] px-3 py-1 text-sm font-black text-[#24544d]">{item.available}</span></td>
                    <td className="px-5 py-4 text-center font-black text-[#b57942]">{item.reserved}</td>
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
