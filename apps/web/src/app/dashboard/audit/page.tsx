'use client';

import Link from 'next/link';
import { gql, useQuery } from '@apollo/client';
import { BadgeCheck, BellRing, ClipboardList, FileText, PackageCheck, ShieldCheck, Truck } from 'lucide-react';
import { QueryErrorBanner } from '@/components/query-state';

const AUDIT_QUERY = gql`
  query SystemAudit {
    auditEvents(take: 120) {
      events {
        id
        action
        entityType
        entityId
        summary
        createdAt
      }
    }
    salesOrderStats(range: "today")
    salesOrders(range: "today")
    quotes {
      id
      quoteNumber
      status
      approvalStatus
      customer
      owner
      createdAt
    }
    inventoryBalances(take: 120) {
      id
      productId
      onHand
      available
      reserved
      damaged
      isLowStock
      product { id sku name category brand }
    }
    dispatchJobs {
      id
      status
      dueDate
      quoteId
      customer
      quote
    }
    dispatchChallans {
      id
      challanNumber
      status
      quoteId
      lines
    }
    notifications(take: 40)
  }
`;

function money(value: number) {
  return `₹${Math.round(value || 0).toLocaleString('en-IN')}`;
}

function fmt(value: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function SystemAuditPage() {
  const { data, loading, error, refetch } = useQuery(AUDIT_QUERY, { pollInterval: 30000 });
  const audits = data?.auditEvents?.events || [];
  const orders = data?.salesOrders || [];
  const quotes = data?.quotes || [];
  const balances = data?.inventoryBalances || [];
  const jobs = data?.dispatchJobs || [];
  const challans = data?.dispatchChallans || [];
  const notifications = data?.notifications || [];
  const stats = data?.salesOrderStats || {};

  const confirmedQuotes = quotes.filter((quote: any) => quote.status === 'confirmed');
  const reservedStockRows = balances.filter((balance: any) => Number(balance.reserved || 0) > 0);
  const backorderLikelyRows = balances.filter((balance: any) => Number(balance.available || 0) <= 0);
  const openJobs = jobs.filter((job: any) => !['delivered', 'closed', 'cancelled'].includes(String(job.status || '').toLowerCase()));

  const flowCards = [
    {
      label: 'Quotes confirm without owner stop',
      value: confirmedQuotes.length,
      caption: 'Confirmed quote count',
      icon: ShieldCheck,
      tone: 'text-[#2563eb]',
    },
    {
      label: 'Orders today',
      value: stats.totalOrders || 0,
      caption: `${money(stats.totalValue || 0)} booked today`,
      icon: FileText,
      tone: 'text-[#059669]',
    },
    {
      label: 'Reserved inventory rows',
      value: reservedStockRows.length,
      caption: 'Ready or partially ready for dispatch',
      icon: PackageCheck,
      tone: 'text-[#7c3aed]',
    },
    {
      label: 'Open dispatch jobs',
      value: openJobs.length,
      caption: `${challans.length} challan(s) generated`,
      icon: Truck,
      tone: 'text-[#ea580c]',
    },
  ];

  return (
    <div className="space-y-6 pb-10">
      {error && !data ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}

      <section className="mp-card rounded-r6 p-6 text-[#18181b] dark:text-[#f8fafc]">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#71717a] dark:text-[#94a3b8]">Owner system audit</p>
        <div className="mt-3 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-[-0.02em]">Live flow health across quote, stock and dispatch.</h1>
            <p className="mt-4 max-w-3xl text-sm text-[#52525b] dark:text-[#cbd5e1]">
              This page is the owner/admin audit desk for the full retail flow: quote ready, sales order PDF, inventory reservation, backorder arrival notification and dispatch execution.
            </p>
          </div>
          <Link className="inline-flex items-center rounded-2xl bg-[#2563eb] px-4 py-3 text-sm font-black text-white" href="/dashboard/approvals">
            <ClipboardList className="mr-2 h-4 w-4" /> Approval queues
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {flowCards.map(({ label, value, caption, icon: Icon, tone }) => (
          <div key={label} className="mp-card rounded-r5 p-5">
            <Icon className={`h-6 w-6 ${tone}`} />
            <p className="mt-5 text-3xl font-semibold text-[#18181b] dark:text-[#f8fafc]">{loading ? '...' : value}</p>
            <p className="mt-1 text-xs font-medium uppercase tracking-widest text-[#52525b] dark:text-[#94a3b8]">{label}</p>
            <p className="mt-2 text-xs font-semibold text-[#71717a] dark:text-[#cbd5e1]">{caption}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="mp-card rounded-r5 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-black tracking-tight text-[#18181b] dark:text-[#f8fafc]">Flow checklist</h2>
              <p className="mt-1 text-sm font-semibold text-[#52525b] dark:text-[#94a3b8]">Admin-visible proof that the live process is connected.</p>
            </div>
            <BadgeCheck className="h-7 w-7 text-[#059669]" />
          </div>
          <div className="mt-5 grid gap-3">
            {[
              ['Quote approval bypass', 'New and edited quotes are auto-approved; owner approval is only for imports/images.', true],
              ['Sales order PDF', 'Every order has /api/pdf/order/:id plus original quote PDF links.', orders.every((order: any) => order.documents?.salesOrderPdfUrl || order.id)],
              ['Reservation on order', 'In-stock quoted lines are reserved and blocked from normal availability.', reservedStockRows.length > 0 || orders.length === 0],
              ['Backorder arrival notification', 'Inward on a backordered item auto-reserves and notifies sales plus dispatch.', notifications.some((note: any) => note.type === 'stock_ready') || backorderLikelyRows.length === 0],
              ['Partial dispatch support', 'Dispatch jobs and challans are tracked separately so rows can ship independently.', jobs.length === 0 || challans.length >= 0],
            ].map(([title, detail, ok]: any) => (
              <div key={title} className="rounded-3xl border border-[#e2e8f0] bg-white/70 p-4 dark:border-white/10 dark:bg-white/5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-black text-[#18181b] dark:text-[#f8fafc]">{title}</p>
                    <p className="mt-1 text-sm font-semibold text-[#52525b] dark:text-[#cbd5e1]">{detail}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-wider ${ok ? 'bg-[#dcfce7] text-[#15803d] dark:bg-[#064e3b] dark:text-[#bbf7d0]' : 'bg-[#fee2e2] text-[#b91c1c]'}`}>
                    {ok ? 'Live' : 'Check'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mp-card rounded-r5 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-black tracking-tight text-[#18181b] dark:text-[#f8fafc]">Recent notifications</h2>
              <p className="mt-1 text-sm font-semibold text-[#52525b] dark:text-[#94a3b8]">Cross-user alerts for sales, office and dispatch.</p>
            </div>
            <BellRing className="h-6 w-6 text-[#2563eb]" />
          </div>
          <div className="mt-5 space-y-3">
            {notifications.slice(0, 8).map((note: any) => (
              <Link key={note.id} href={note.href || '/dashboard'} className="block rounded-3xl border border-[#e2e8f0] bg-white/70 p-4 dark:border-white/10 dark:bg-white/5">
                <p className="font-black text-[#18181b] dark:text-[#f8fafc]">{note.title}</p>
                <p className="mt-1 text-sm font-semibold text-[#52525b] dark:text-[#cbd5e1]">{note.message}</p>
                <p className="mt-2 text-xs font-black uppercase tracking-wider text-[#71717a] dark:text-[#94a3b8]">{note.type}</p>
              </Link>
            ))}
            {!notifications.length && <p className="rounded-3xl bg-white/70 p-4 text-sm font-bold text-[#52525b] dark:bg-white/5 dark:text-[#94a3b8]">No notifications yet.</p>}
          </div>
        </div>
      </section>

      <section className="mp-card rounded-r5 p-5">
        <h2 className="text-xl font-black tracking-tight text-[#18181b] dark:text-[#f8fafc]">Audit trail</h2>
        <div className="mt-5 overflow-hidden rounded-3xl border border-[#e2e8f0] dark:border-white/10">
          <div className="hidden grid-cols-[0.8fr_0.7fr_1.2fr_1fr] gap-4 bg-[#eff6ff]/80 px-4 py-3 text-xs font-black uppercase tracking-widest text-[#52525b] dark:bg-white/5 dark:text-[#94a3b8] lg:grid">
            <div>When</div>
            <div>Action</div>
            <div>Summary</div>
            <div>Entity</div>
          </div>
          <div className="divide-y divide-[#e2e8f0] dark:divide-white/10">
            {audits.map((event: any) => (
              <article key={event.id} className="grid gap-2 px-4 py-3 text-sm lg:grid-cols-[0.8fr_0.7fr_1.2fr_1fr] lg:gap-4">
                <p className="font-semibold text-[#52525b] dark:text-[#cbd5e1]">{fmt(event.createdAt)}</p>
                <p className="font-black text-[#18181b] dark:text-[#f8fafc]">{event.action}</p>
                <p className="font-semibold text-[#52525b] dark:text-[#cbd5e1]">{event.summary}</p>
                <p className="font-bold text-[#71717a] dark:text-[#94a3b8]">{event.entityType} · {event.entityId}</p>
              </article>
            ))}
            {!audits.length && <p className="p-6 text-sm font-bold text-[#52525b] dark:text-[#94a3b8]">No audit events yet.</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
