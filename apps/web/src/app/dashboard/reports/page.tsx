'use client';

import { useMemo, useState } from 'react';
import { gql, useQuery } from '@apollo/client';
import { BarChart3, Boxes, ClipboardList, IndianRupee, RefreshCw, Truck } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const REPORT = gql`query ManagementReport($from: String, $to: String) { managementReport(from: $from, to: $to) }`;
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value || 0);
const number = (value: number) => new Intl.NumberFormat('en-IN').format(value || 0);
const isoDate = (date: Date) => date.toISOString().slice(0, 10);

export default function ReportsPage() {
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(isoDate(new Date(today.getTime() - 29 * 86400000)));
  const [to, setTo] = useState(isoDate(today));
  const { data, loading, error, refetch } = useQuery(REPORT, { variables: { from, to }, fetchPolicy: 'network-only' });
  const report = data?.managementReport;
  const tiles = report ? [
    { label: 'Net sales', value: money(report.finance.netSales), note: `${report.finance.invoiceCount ?? 0} dispatched invoices`, icon: IndianRupee },
    { label: 'Collections', value: money(report.finance.collections), note: `${money(report.finance.outstanding)} outstanding`, icon: BarChart3 },
    { label: 'Stock value', value: money(report.inventory.value), note: `${number(report.inventory.available)} available`, icon: Boxes },
    { label: 'Open demand', value: number(report.procurement.backorderQuantity), note: `${report.procurement.openPurchaseOrders} open POs`, icon: ClipboardList },
    { label: 'Deliveries', value: `${report.fulfilment.delivered}/${report.fulfilment.challans}`, note: `${report.fulfilment.pending} pending`, icon: Truck },
  ] : [];
  return (
    <div className="space-y-5 pb-10">
      <header className="flex flex-col gap-3 border-b border-[var(--line)] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--ink-4)]">Owner control</p><h1 className="mt-1 text-2xl font-black text-[var(--ink)]">Management reports</h1></div>
        <div className="flex flex-wrap items-center gap-2"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /><span className="text-sm font-bold text-[var(--ink-4)]">to</span><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /><Button variant="secondary" onClick={() => refetch()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button></div>
      </header>
      {error ? <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error.message}</div> : null}
      {loading && !report ? <div className="h-44 animate-pulse rounded-md border border-[var(--line)] bg-[var(--surface)]" /> : null}
      {report ? <>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{tiles.map(({ label, value, note, icon: Icon }) => <div key={label} className="mp-panel p-4"><Icon className="h-5 w-5 text-[var(--brand-700)]" /><p className="mt-4 text-xs font-bold uppercase text-[var(--ink-4)]">{label}</p><p className="mt-1 text-xl font-black text-[var(--ink)]">{value}</p><p className="mt-1 text-xs font-semibold text-[var(--ink-3)]">{note}</p></div>)}</section>
        <section className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
          <div className="mp-panel p-5"><h2 className="font-black text-[var(--ink)]">Sales, collections and credits</h2><div className="mt-4 h-72"><ResponsiveContainer width="100%" height="100%"><AreaChart data={report.trend}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip formatter={(v: number) => money(v)} /><Area type="monotone" dataKey="sales" stroke="#2563eb" fill="#dbeafe" /><Area type="monotone" dataKey="collections" stroke="#059669" fill="#d1fae5" /><Area type="monotone" dataKey="credits" stroke="#dc2626" fill="#fee2e2" /></AreaChart></ResponsiveContainer></div></div>
          <div className="mp-panel overflow-hidden"><div className="border-b border-[var(--line)] p-5"><h2 className="font-black text-[var(--ink)]">Stock by category</h2></div><div className="max-h-80 overflow-auto">{report.categoryStock.map((row: any) => <div key={row.category} className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3 last:border-0"><div><p className="text-sm font-black text-[var(--ink)]">{row.category}</p><p className="text-xs font-semibold text-[var(--ink-4)]">{number(row.quantity)} units · {number(row.reserved)} reserved</p></div><span className="text-sm font-black text-[var(--ink)]">{money(row.value)}</span></div>)}</div></div>
        </section>
        <section className="grid gap-5 lg:grid-cols-2"><div className="mp-panel p-5"><h2 className="font-black text-[var(--ink)]">Procurement control</h2><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><Metric label="Open demand lines" value={number(report.procurement.openDemandCount)} /><Metric label="Accepted inward" value={number(report.procurement.receivedQuantity)} /><Metric label="Damaged inward" value={number(report.procurement.damagedReceivedQuantity)} /><Metric label="Open POs" value={number(report.procurement.openPurchaseOrders)} /></div></div><div className="mp-panel p-5"><h2 className="font-black text-[var(--ink)]">Returns and period close</h2><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><Metric label="Returns received" value={`${report.fulfilment.receivedReturns}/${report.fulfilment.returns}`} /><Metric label="Credit notes" value={money(report.finance.creditNotes)} /><Metric label="Last stock close" value={report.periodCloses[0]?.periodKey || 'Not closed'} /><Metric label="Closed stock value" value={money(report.periodCloses[0]?.totalValue || 0)} /></div></div></section>
      </> : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-md border border-[var(--line)] bg-[var(--bg-soft)] p-3"><p className="text-xs font-bold uppercase text-[var(--ink-4)]">{label}</p><p className="mt-2 text-lg font-black text-[var(--ink)]">{value}</p></div>; }
