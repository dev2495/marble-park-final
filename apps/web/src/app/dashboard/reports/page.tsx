'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { gql, useQuery } from '@apollo/client';
import { Loader2 } from 'lucide-react';
import { REPORTS } from './report-config';

const OPTIONS = gql`query OwnerReportOptions { ownerReportOptions }`;

export default function ReportsIndex() {
  const router = useRouter();
  const { data } = useQuery(OPTIONS);
  useEffect(() => {
    const allowed: string[] | undefined = data?.ownerReportOptions?.allowed;
    if (!allowed) return;
    const first = allowed.includes('stock-value') ? 'stock-value' : REPORTS.find((report) => allowed.includes(report.slug))?.slug;
    router.replace(first ? `/dashboard/reports/${first}` : '/dashboard');
  }, [data, router]);
  return <div className="grid min-h-[40vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-[var(--ink-4)]" aria-label="Loading reports" /></div>;
}
