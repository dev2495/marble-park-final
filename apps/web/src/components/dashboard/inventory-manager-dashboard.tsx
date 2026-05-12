'use client';

import { useMemo } from 'react';
import { gql, useQuery } from '@apollo/client';
import Link from 'next/link';
import {
  BarChart, Bar, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Cell,
  PieChart, Pie,
} from 'recharts';
import {
  AlertTriangle, ArrowRight, Boxes, IndianRupee, PackageCheck, PackagePlus, Plus,
  ShieldCheck, TrendingDown, Warehouse,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';
import {
  KpiTile, MotionGrid, MotionItem, Panel, EmptyState, GreetingStrip,
  moneyShort, moneyExact, type Tone,
} from './primitives';

const INV_DASH = gql`
  query InventoryManagerDash {
    inventoryDashboard { stats summary }
    lowStockBalances(take: 12) {
      id available reserved onHand damaged lowStockThreshold reorderPoint
      product { id sku name brand category sellPrice }
    }
    inventoryBalances(take: 200) {
      id available reserved onHand damaged
      product { id sku name brand category sellPrice }
    }
  }
`;

export function InventoryManagerDashboard({ effectiveRole, user }: { effectiveRole: string; user: any }) {
  const { data, loading, error, refetch } = useQuery(INV_DASH);

  const stats = data?.inventoryDashboard?.stats || {};
  const summary = data?.inventoryDashboard?.summary || {};
  const lowStock: any[] = data?.lowStockBalances || [];
  const balances: any[] = data?.inventoryBalances || [];

  // ── By category breakdown (value)
  const byCategory = useMemo(() => {
    const m = new Map<string, { name: string; value: number; qty: number }>();
    for (const b of balances) {
      const c = b.product?.category || 'Uncategorised';
      const cur = m.get(c) || { name: c, value: 0, qty: 0 };
      cur.value += Number(b.available || 0) * Number(b.product?.sellPrice || 0);
      cur.qty += Number(b.available || 0);
      m.set(c, cur);
    }
    return Array.from(m.values()).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [balances]);

  // ── Top brands by value
  const byBrand = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of balances) {
      const v = Number(b.available || 0) * Number(b.product?.sellPrice || 0);
      const key = b.product?.brand || 'Other';
      m.set(key, (m.get(key) || 0) + v);
    }
    return Array.from(m.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6);
  }, [balances]);

  const totalValue = useMemo(() => byCategory.reduce((s, c) => s + c.value, 0), [byCategory]);
  const totalAvailable = useMemo(() => byCategory.reduce((s, c) => s + c.qty, 0), [byCategory]);
  const reservedQty = useMemo(() => balances.reduce((s, b) => s + Number(b.reserved || 0), 0), [balances]);
  const damagedQty = useMemo(() => balances.reduce((s, b) => s + Number(b.damaged || 0), 0), [balances]);

  const tiles: Array<{ label: string; value: any; caption: string; icon: any; tone: Tone; href: string; numeric?: boolean; format?: (v: number) => string }> = [
    { label: 'Stock valuation', value: totalValue, caption: `${balances.length} SKUs tracked`, icon: IndianRupee, tone: 'success', href: '/dashboard/inventory', numeric: true, format: moneyShort },
    { label: 'Available qty', value: totalAvailable, caption: `${reservedQty.toLocaleString('en-IN')} reserved`, icon: Boxes, tone: 'brand', href: '/dashboard/inventory', numeric: true },
    { label: 'Low-stock SKUs', value: lowStock.length, caption: lowStock.length ? 'Below threshold — re-order' : 'All above threshold', icon: AlertTriangle, tone: lowStock.length ? 'danger' : 'success', href: '/dashboard/inventory', numeric: true },
    { label: 'Damaged qty', value: damagedQty, caption: 'Removed from sellable stock', icon: TrendingDown, tone: damagedQty > 0 ? 'warning' : 'neutral', href: '/dashboard/inventory', numeric: true },
  ];

  const COLORS = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#0ea5e9', '#db2777', '#dc2626', '#14b8a6'];

  return (
    <div className="space-y-6">
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}

      <GreetingStrip
        role={effectiveRole}
        user={user}
        name={user?.name}
        subtitle="Stock health, inward activity, and what needs your attention."
        actions={
          <>
            <Button asChild size="sm"><Link href="/dashboard/inventory/inwards"><PackagePlus className="mr-1.5 h-4 w-4" /> New inward</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href="/dashboard/inventory">Stock desk</Link></Button>
          </>
        }
      />

      <MotionGrid className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile) => <MotionItem key={tile.label}><KpiTile {...tile} loading={loading} /></MotionItem>)}
      </MotionGrid>

      <section className="grid gap-3 xl:grid-cols-[1.4fr_1fr]">
        <Panel title="Stock value by category" subtitle="Available qty × sell price" tone="brand">
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byCategory} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(113,113,122,0.10)" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} width={60} tickFormatter={(v) => moneyShort(Number(v))} />
                <Tooltip formatter={(v: any) => moneyExact(Number(v))} cursor={{ fill: 'rgba(37,99,235,0.04)' }} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} animationDuration={900}>
                  {byCategory.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Top brands by value" subtitle="Where the money sits" tone="violet">
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={byBrand} dataKey="value" nameKey="name" innerRadius={50} outerRadius={92} paddingAngle={2} stroke="white" strokeWidth={2} animationDuration={900}>
                  {byBrand.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: any) => moneyExact(Number(v))} />
              </PieChart>
            </ResponsiveContainer>
            <div className="-mt-4 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              {byBrand.map((b, i) => (
                <div key={b.name} className="flex items-center gap-1.5 truncate">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                  <span className="truncate text-[#52525b]">{b.name}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </section>

      <Panel title="Re-order list" subtitle={`${lowStock.length} SKU${lowStock.length === 1 ? '' : 's'} below threshold`} tone="danger" rightAction={<Link href="/dashboard/inventory" className="text-xs font-medium text-[#1d4ed8] hover:underline">Inventory</Link>}>
        {lowStock.length ? (
          <div className="overflow-hidden rounded-r3 border border-[#f4f4f5]">
            <table className="w-full text-sm">
              <thead className="bg-[#fafafa] text-left text-[11px] font-semibold uppercase tracking-wider text-[#71717a]">
                <tr>
                  <th className="px-3 py-2.5">Product</th>
                  <th className="px-3 py-2.5">SKU</th>
                  <th className="px-3 py-2.5 text-right">On hand</th>
                  <th className="px-3 py-2.5 text-right">Available</th>
                  <th className="px-3 py-2.5 text-right">Reserved</th>
                  <th className="px-3 py-2.5 text-right">Threshold</th>
                  <th className="px-3 py-2.5 text-right">Sell price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f4f4f5]">
                {lowStock.map((row: any) => (
                  <tr key={row.id} className="text-[#27272a]">
                    <td className="px-3 py-2.5">
                      <p className="text-sm font-medium text-[#18181b]">{row.product?.name}</p>
                      <p className="text-[11px] text-[#71717a]">{row.product?.category} · {row.product?.brand}</p>
                    </td>
                    <td className="px-3 py-2.5 mp-mono text-[12px] text-[#52525b]">{row.product?.sku}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{row.onHand}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      <span className="rounded-full bg-[#fecaca] px-2 py-0.5 text-[11px] font-semibold text-[#b91c1c]">{row.available}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[#52525b]">{row.reserved}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[#71717a]">≤ {row.reorderPoint ?? row.lowStockThreshold}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{moneyShort(row.product?.sellPrice || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState>All inventory above threshold.</EmptyState>}
      </Panel>
    </div>
  );
}
