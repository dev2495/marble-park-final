'use client';

import { gql, useQuery } from '@apollo/client';
import { useState } from 'react';
import { CreditCard, IndianRupee, Receipt, WalletCards } from 'lucide-react';
import { QueryErrorBanner } from '@/components/query-state';

const ORDERS = gql`query SalesOrders($paymentMode: String, $range: String) { salesOrders(paymentMode: $paymentMode, range: $range) salesOrderStats(range: $range) }`;
function money(value: number) { return `₹${Math.round(value || 0).toLocaleString('en-IN')}`; }

export default function OrdersPage() {
  const [range, setRange] = useState('today');
  const [paymentMode, setPaymentMode] = useState('');
  const { data, loading, error, refetch } = useQuery(ORDERS, { variables: { paymentMode: paymentMode || undefined, range } });
  const stats = data?.salesOrderStats || {};
  const orders = data?.salesOrders || [];
  return <div className="space-y-6 pb-10">
    {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
    <section className="rounded-[2.25rem] bg-[#0e1a3d] p-7 text-white shadow-2xl shadow-[#0e1a3d]/15"><p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#bfdbfe]">Sales orders</p><h1 className="mt-3 text-5xl font-black tracking-[-0.055em]">Cash and credit order book for owner review.</h1><p className="mt-4 max-w-3xl text-sm font-semibold leading-6 text-[#dbeafe]">Approved final quotes convert here. Cash orders track advance/full payment; credit orders are tagged for reporting and dispatch visibility.</p></section>
    <section className="mp-card flex flex-wrap gap-2 rounded-[2rem] p-3">{['today','week','month','all'].map((item)=><button key={item} onClick={()=>setRange(item)} className={`rounded-2xl px-4 py-3 text-sm font-black uppercase tracking-wider ${range===item?'bg-[#0e1a3d] text-white':'bg-white/70 text-[#1e293b]'}`}>{item}</button>)}<span className="mx-2 hidden h-10 w-px bg-[#cbd5e1]/15 sm:block" />{[['','All'],['cash','Cash'],['credit','Credit']].map(([value,label])=><button key={value || 'all'} onClick={()=>setPaymentMode(value)} className={`rounded-2xl px-4 py-3 text-sm font-black uppercase tracking-wider ${paymentMode===value?'bg-[#2563eb] text-white':'bg-white/70 text-[#1e293b]'}`}>{label}</button>)}</section>
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{[[Receipt,'Orders',stats.totalOrders || 0],[IndianRupee,'Total value',money(stats.totalValue || 0)],[WalletCards,'Cash / advance',`${stats.cashOrders || 0} · ${money(stats.cashAdvance || 0)}`],[CreditCard,'Credit value',`${stats.creditOrders || 0} · ${money(stats.creditValue || 0)}`]].map(([Icon,label,value]: any)=><div key={label} className="mp-card rounded-[2rem] p-5"><Icon className="h-6 w-6 text-[#2563eb]"/><p className="mt-5 text-3xl font-black text-[#0e1a3d]">{loading?'...':value}</p><p className="mt-1 text-[10px] font-black uppercase tracking-widest text-[#475569]">{label}</p></div>)}</section>
    <section className="overflow-hidden rounded-[2rem] border border-[#cbd5e1]/10 bg-[#ffffff]/80 shadow-xl shadow-[#475569]/8"><div className="hidden grid-cols-[0.9fr_1fr_0.65fr_0.65fr_0.7fr] gap-4 border-b border-[#cbd5e1]/10 bg-[#dbeafe]/75 px-5 py-4 text-[10px] font-black uppercase tracking-widest text-[#475569] lg:grid"><div>Order</div><div>Customer / Sales</div><div>Payment</div><div className="text-right">Value</div><div>Dispatch state</div></div><div className="divide-y divide-[#cbd5e1]/10">{loading && <div className="p-10 text-center text-sm font-bold text-[#475569]">Loading orders...</div>}{!loading && !orders.length && <div className="p-10 text-center text-sm font-bold text-[#475569]">No orders in this filter.</div>}{orders.map((order:any)=><article key={order.id} className="grid gap-4 p-5 lg:grid-cols-[0.9fr_1fr_0.65fr_0.65fr_0.7fr] lg:items-center"><div><p className="text-lg font-black text-[#0e1a3d]">{order.orderNumber}</p><p className="mt-1 text-xs font-bold text-[#475569]">Quote {order.quoteId}</p></div><div><p className="font-black text-[#0e1a3d]">{order.customer?.name || 'Customer'}</p><p className="text-xs font-bold text-[#475569]">{order.owner?.name || 'Sales user'}</p></div><div><span className={`rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-wider ${order.paymentMode==='cash'?'bg-[#ecfdf5] text-[#047857]':'bg-[#dbeafe] text-[#1d4ed8]'}`}>{order.paymentMode} · {order.paymentStatus}</span>{order.advanceAmount>0&&<p className="mt-2 text-xs font-bold text-[#475569]">Advance {money(order.advanceAmount)}</p>}</div><div className="text-right text-xl font-black text-[#0e1a3d]">{money(order.totalAmount)}</div><div className="text-sm font-black text-[#1e293b]">{order.status}</div></article>)}</div></section>
  </div>;
}
