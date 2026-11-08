'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { gql, useQuery } from '@apollo/client';
import { useMemo } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { REPORTS } from './report-config';

const REPORT_OPTIONS = gql`query OwnerReportOptions { ownerReportOptions }`;

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data } = useQuery(REPORT_OPTIONS, { fetchPolicy: 'cache-first' });
  const allowed: string[] | undefined = data?.ownerReportOptions?.allowed;
  const visible = useMemo(() => REPORTS.filter((report) => !allowed || allowed.includes(report.slug)), [allowed]);
  const groups = Array.from(new Set(visible.map((report) => report.group)));
  const active = (slug: string) => pathname === `/dashboard/reports/${slug}`;
  return (
    <div className="ox -mx-1 xl:grid xl:grid-cols-[216px_minmax(0,1fr)] xl:gap-6">
      <aside className="hidden xl:block"><nav aria-label="Reports" className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pb-6">
        <Link href="/dashboard" className="mb-1 flex min-h-10 items-center gap-2 rounded-[9px] px-2.5 text-[13.5px] text-[var(--ink-3)] hover:bg-[var(--surface)]"><LayoutDashboard className="h-4 w-4" aria-hidden="true" />Dashboard</Link>
        {groups.map((group) => <div key={group}><p className="mx-2.5 mb-1.5 mt-4 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--ink-4)]">{group}</p>{visible.filter((report) => report.group === group).map((report) => <Link key={report.slug} href={`/dashboard/reports/${report.slug}`} aria-current={active(report.slug) ? 'page' : undefined} className={`flex min-h-10 items-center rounded-[9px] px-2.5 text-[13.5px] transition-colors ${active(report.slug) ? 'bg-[var(--surface)] font-medium text-[var(--ox-brand-text)] shadow-sm' : 'text-[var(--ink-3)] hover:bg-[var(--surface)] hover:text-[var(--ink)]'}`}>{report.label}</Link>)}</div>)}
      </nav></aside>
      <div className="min-w-0">
        <nav aria-label="Reports" className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1 xl:hidden">{visible.map((report) => <Link key={report.slug} href={`/dashboard/reports/${report.slug}`} aria-current={active(report.slug) ? 'page' : undefined} className={`inline-flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 text-[13px] ${active(report.slug) ? 'border-[var(--ox-brand)]/35 bg-[var(--ox-brand-soft)] font-medium text-[var(--ox-brand-text)]' : 'border-[var(--line)] bg-[var(--surface)] text-[var(--ink-3)]'}`}>{report.label}</Link>)}</nav>
        {children}
      </div>
    </div>
  );
}
