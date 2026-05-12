'use client';

import { gql, useQuery } from '@apollo/client';
import { useState } from 'react';
import { CreditCard, Download, IndianRupee, Receipt, Truck, WalletCards } from 'lucide-react';
import { QueryErrorBanner } from '@/components/query-state';

const ORDERS = gql`
  query SalesOrders($paymentMode: String, $range: String) {
    salesOrders(paymentMode: $paymentMode, range: $range)
    salesOrderStats(range: $range)
  }
`;

function money(value: number) {
  return `₹${Math.round(value || 0).toLocaleString('en-IN')}`;
}

function orderLines(order: any) {
  return Array.isArray(order?.lines) ? order.lines : [];
}

export default function OrdersPage() {
  const [range, setRange] = useState('today');
  const [paymentMode, setPaymentMode] = useState('');
  const { data, loading, error, refetch } = useQuery(ORDERS, {
    variables: { paymentMode: paymentMode || undefined, range },
  });
  const stats = data?.salesOrderStats || {};
  const orders = data?.salesOrders || [];

  return (
    <div className="space-y-6 pb-10">
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}

      <section className="mp-card rounded-r6 p-6 text-[#18181b] dark:text-[#f8fafc]">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#71717a] dark:text-[#94a3b8]">Sales orders</p>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-[-0.02em]">Cash, credit and dispatch-ready order book.</h1>
        <p className="mt-4 max-w-3xl text-sm text-[#52525b] dark:text-[#cbd5e1]">
          Quotes convert here without owner approval. Inventory is reserved when available, backorders stay blocked until inward, and every order carries a forwarding PDF.
        </p>
      </section>

      <section className="mp-card flex flex-wrap gap-2 rounded-r5 p-3">
        {['today', 'week', 'month', 'all'].map((item) => (
          <button
            key={item}
            onClick={() => setRange(item)}
            className={`rounded-2xl px-4 py-3 text-sm font-black uppercase tracking-wider ${range === item ? 'bg-[#18181b] text-white dark:bg-white dark:text-[#111827]' : 'bg-white/70 text-[#27272a] dark:bg-white/8 dark:text-[#e2e8f0]'}`}
          >
            {item}
          </button>
        ))}
        <span className="mx-2 hidden h-10 w-px bg-[#cbd5e1]/25 sm:block" />
        {[
          ['', 'All'],
          ['cash', 'Cash'],
          ['credit', 'Credit'],
        ].map(([value, label]) => (
          <button
            key={value || 'all'}
            onClick={() => setPaymentMode(value)}
            className={`rounded-2xl px-4 py-3 text-sm font-black uppercase tracking-wider ${paymentMode === value ? 'bg-[#2563eb] text-white' : 'bg-white/70 text-[#27272a] dark:bg-white/8 dark:text-[#e2e8f0]'}`}
          >
            {label}
          </button>
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          [Receipt, 'Orders', stats.totalOrders || 0],
          [IndianRupee, 'Total value', money(stats.totalValue || 0)],
          [WalletCards, 'Cash / advance', `${stats.cashOrders || 0} · ${money(stats.cashAdvance || 0)}`],
          [CreditCard, 'Credit value', `${stats.creditOrders || 0} · ${money(stats.creditValue || 0)}`],
        ].map(([Icon, label, value]: any) => (
          <div key={label} className="mp-card rounded-r5 p-5">
            <Icon className="h-6 w-6 text-[#2563eb]" />
            <p className="mt-5 text-3xl font-semibold text-[#18181b] dark:text-[#f8fafc]">{loading ? '...' : value}</p>
            <p className="mt-1 text-xs font-medium uppercase tracking-widest text-[#52525b] dark:text-[#94a3b8]">{label}</p>
          </div>
        ))}
      </section>

      <section className="overflow-hidden rounded-r5 border border-[#e4e4e7]/20 bg-white/80 shadow-xl shadow-[#475569]/8 dark:border-white/10 dark:bg-[#111827]/80">
        <div className="hidden grid-cols-[0.9fr_1fr_0.7fr_0.7fr_0.9fr] gap-4 border-b border-[#e4e4e7]/20 bg-[#eff6ff]/75 px-5 py-4 text-xs font-medium uppercase tracking-widest text-[#52525b] dark:border-white/10 dark:bg-white/5 dark:text-[#94a3b8] lg:grid">
          <div>Order</div>
          <div>Customer / sales</div>
          <div>Payment</div>
          <div className="text-right">Value</div>
          <div>Documents / dispatch</div>
        </div>
        <div className="divide-y divide-[#cbd5e1]/20 dark:divide-white/10">
          {loading && <div className="p-10 text-center text-sm font-bold text-[#52525b] dark:text-[#94a3b8]">Loading orders...</div>}
          {!loading && !orders.length && <div className="p-10 text-center text-sm font-bold text-[#52525b] dark:text-[#94a3b8]">No orders in this filter.</div>}
          {orders.map((order: any) => {
            const docs = order.documents || {};
            const salesOrderPdfUrl = docs.salesOrderPdfUrl || `/api/pdf/order/${order.id}`;
            const quotePdfUrl = docs.quotePdfUrl || `/api/pdf/quote/${order.quoteId}`;
            return (
              <article key={order.id} className="grid gap-4 p-5 lg:grid-cols-[0.9fr_1fr_0.7fr_0.7fr_0.9fr] lg:items-center">
                <div>
                  <p className="text-lg font-semibold text-[#18181b] dark:text-[#f8fafc]">{order.orderNumber}</p>
                  <p className="mt-1 text-xs font-bold text-[#52525b] dark:text-[#94a3b8]">Quote {order.quoteId}</p>
                  <p className="mt-1 text-xs font-bold text-[#52525b] dark:text-[#94a3b8]">{orderLines(order).length} line(s)</p>
                </div>
                <div>
                  <p className="font-semibold text-[#18181b] dark:text-[#f8fafc]">{order.customer?.name || 'Customer'}</p>
                  <p className="text-xs font-bold text-[#52525b] dark:text-[#94a3b8]">{order.owner?.name || 'Sales user'}</p>
                </div>
                <div>
                  <span className={`rounded-full px-3 py-1.5 text-xs font-medium uppercase tracking-wider ${order.paymentMode === 'cash' ? 'bg-[#ecfdf5] text-[#059669] dark:bg-[#064e3b] dark:text-[#bbf7d0]' : 'bg-[#eff6ff] text-[#1d4ed8] dark:bg-[#1e3a8a] dark:text-[#bfdbfe]'}`}>
                    {order.paymentMode} · {order.paymentStatus}
                  </span>
                  {order.advanceAmount > 0 && <p className="mt-2 text-xs font-bold text-[#52525b] dark:text-[#94a3b8]">Advance {money(order.advanceAmount)}</p>}
                </div>
                <div className="text-right text-xl font-semibold text-[#18181b] dark:text-[#f8fafc]">{money(order.totalAmount)}</div>
                <div className="flex flex-wrap gap-2 text-sm font-semibold">
                  <a className="inline-flex items-center rounded-2xl bg-[#2563eb] px-3 py-2 text-xs font-black uppercase tracking-wider text-white" href={salesOrderPdfUrl} target="_blank" rel="noreferrer">
                    <Download className="mr-2 h-4 w-4" /> Order PDF
                  </a>
                  <a className="inline-flex items-center rounded-2xl bg-white px-3 py-2 text-xs font-black uppercase tracking-wider text-[#1d4ed8] ring-1 ring-[#dbeafe] dark:bg-white/8 dark:text-[#bfdbfe] dark:ring-white/10" href={quotePdfUrl} target="_blank" rel="noreferrer">
                    Quote PDF
                  </a>
                  <span className="inline-flex items-center rounded-2xl bg-[#f8fafc] px-3 py-2 text-xs font-black uppercase tracking-wider text-[#475569] ring-1 ring-[#e2e8f0] dark:bg-white/8 dark:text-[#cbd5e1] dark:ring-white/10">
                    <Truck className="mr-2 h-4 w-4" /> {order.status}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
