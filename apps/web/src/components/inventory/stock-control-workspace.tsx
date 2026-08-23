'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowRightLeft,
  BadgeCheck,
  Boxes,
  ClipboardCheck,
  History,
  PackagePlus,
  RotateCcw,
  Scale,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const WORKFLOW = [
  { label: 'Control board', short: 'Overview', caption: 'See risk and next work', href: '/dashboard/inventory/control', icon: Scale },
  { label: 'Physical count', short: 'Count', caption: 'Capture exact lots', href: '/dashboard/inventory/stock-count', icon: ClipboardCheck },
  { label: 'Reconcile', short: 'Reconcile', caption: 'Prove every balance', href: '/dashboard/inventory/reconciliation', icon: BadgeCheck },
  { label: 'Movement ledger', short: 'Ledger', caption: 'Trace the source trail', href: '/dashboard/inventory/ledger', icon: History },
  { label: 'Opening & close', short: 'Open & close', caption: 'Onboard and lock periods', href: '/dashboard/inventory/opening-stock', icon: PackagePlus },
];

export type StockControlMetric = {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
};

const METRIC_TONE = {
  neutral: 'text-[var(--ink)]',
  success: 'text-emerald-700',
  warning: 'text-amber-700',
  danger: 'text-red-700',
  info: 'text-blue-700',
};

export function StockControlWorkspace({
  title,
  description,
  metrics = [],
  action,
  children,
}: {
  title: string;
  description: string;
  metrics?: StockControlMetric[];
  action?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="space-y-5 pb-10">
      <section className="overflow-hidden rounded-r6 border border-[var(--line)] bg-[var(--surface)] shadow-sm-soft">
        <div className="relative border-b border-[var(--line)] px-5 py-5 sm:px-6">
          <div className="pointer-events-none absolute inset-y-0 right-0 w-1/3 bg-[radial-gradient(circle_at_90%_10%,rgba(157,42,36,0.10),transparent_64%)]" />
          <div className="relative flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[var(--brand-700)]">Inventory truth · one workspace</p>
              <h1 className="mt-2 font-display text-3xl font-bold tracking-[-0.03em] text-[var(--ink)]">{title}</h1>
              <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-[var(--ink-3)]">{description}</p>
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
          </div>
        </div>

        <nav aria-label="Stock control workflow" className="overflow-x-auto border-b border-[var(--line)] bg-[var(--bg-soft)] p-2 custom-scrollbar">
          <div className="grid min-w-[52rem] grid-cols-5 gap-1.5 xl:min-w-0">
            {WORKFLOW.map((item, index) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'group relative flex min-h-[4.25rem] items-center gap-3 overflow-hidden rounded-r3 border px-3.5 text-sm font-bold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-500)]',
                    active
                      ? 'border-[var(--brand-700)] bg-[var(--brand-700)] text-white shadow-sm'
                      : 'border-transparent bg-transparent text-[var(--ink-3)] hover:border-[var(--line)] hover:bg-[var(--surface)] hover:text-[var(--ink)]',
                  )}
                >
                  <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-r2 text-[11px] tabular-nums', active ? 'bg-white/14 text-white' : 'border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-4)]')}><Icon className="h-4 w-4"/></span>
                  <span className="min-w-0 text-left"><span className="block truncate">{item.label}</span><span className={cn('mt-0.5 block truncate text-[10px] font-semibold', active ? 'text-white/70' : 'text-[var(--ink-4)]')}>{item.caption}</span></span>
                  <span className="sr-only">Step {index + 1}: {item.short}</span>
                </Link>
              );
            })}
          </div>
        </nav>

        {metrics.length ? (
          <div className="grid divide-y divide-[var(--line)] sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-5">
            {metrics.slice(0, 5).map((metric) => (
              <div key={metric.label} className="group min-w-0 px-5 py-4 transition-colors hover:bg-[var(--bg-soft)]/70">
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--ink-4)]">{metric.label}</p>
                <p className={cn('mt-1.5 text-2xl font-black tabular-nums', METRIC_TONE[metric.tone || 'neutral'])}>{metric.value}</p>
                {metric.note ? <p className="mt-1 text-xs font-medium leading-5 text-[var(--ink-4)]">{metric.note}</p> : null}
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <div className="flex flex-wrap items-center gap-2 rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-2 shadow-sm-soft">
        <span className="px-2 text-[10px] font-black uppercase tracking-[0.14em] text-[var(--ink-4)]">Continue to</span>
        <Link href="/dashboard/inventory/transfers" className="inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-bold text-[var(--ink-3)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)]"><ArrowRightLeft className="h-4 w-4" />Transfers</Link>
        <Link href="/dashboard/returns" className="inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-bold text-[var(--ink-3)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)]"><RotateCcw className="h-4 w-4" />Returns</Link>
        <Link href="/dashboard/inventory" className="inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-bold text-[var(--ink-3)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)]"><Boxes className="h-4 w-4" />Stock position</Link>
      </div>

      {children}
    </div>
  );
}
