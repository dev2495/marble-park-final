'use client';

import Link from 'next/link';
import { gql, useMutation, useQuery } from '@apollo/client';
import { useState } from 'react';
import { CheckCircle2, Database, FileImage, FileSpreadsheet, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryErrorBanner } from '@/components/query-state';

const APPROVALS = gql`
  query OwnerApprovals {
    quotes(status: "pending_approval") { id quoteNumber title projectName discountPercent lines customer owner approvalStatus approval }
    importBatches
    catalogReviewTasks(status: "pending_approval", take: 80)
  }
`;
const APPROVE_QUOTE = gql`mutation ApproveQuote($id: ID!, $note: String) { approveQuote(id: $id, note: $note) { id status approvalStatus } }`;
const APPROVE_IMPORT = gql`mutation ApproveImport($importBatchId: String!, $note: String) { approveImportBatch(importBatchId: $importBatchId, note: $note) { id result } }`;
const APPROVE_CATALOG = gql`mutation ApproveCatalog($id: String!, $note: String) { approveCatalogReviewTask(id: $id, note: $note) { data } }`;

function total(lines: any[]) { return (Array.isArray(lines) ? lines : []).reduce((sum, line) => sum + Number(line.qty || line.quantity || 0) * Number(line.price || line.sellPrice || 0), 0); }
function money(value: number) { return `₹${Math.round(value || 0).toLocaleString('en-IN')}`; }

export default function ApprovalsPage() {
  const [tab, setTab] = useState<'quotes'|'imports'|'images'>('quotes');
  const { data, loading, error, refetch } = useQuery(APPROVALS);
  const [approveQuote, { loading: approvingQuote, error: approveQuoteError }] = useMutation(APPROVE_QUOTE, { onCompleted: () => refetch() });
  const [approveImport, { loading: approvingImport, error: approveImportError }] = useMutation(APPROVE_IMPORT, { onCompleted: () => refetch() });
  const [approveCatalog, { loading: approvingCatalog, error: approveCatalogError }] = useMutation(APPROVE_CATALOG, { onCompleted: () => refetch() });
  const mutationError = approveQuoteError || approveImportError || approveCatalogError;
  const quotes = data?.quotes || [];
  const imports = (data?.importBatches || []).filter((batch: any) => batch.status === 'pending_approval');
  const catalogTasks = data?.catalogReviewTasks || [];
  const totalPending = quotes.length + imports.length + catalogTasks.length;

  return <div className="space-y-6 pb-10">
    {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
    {mutationError ? <QueryErrorBanner error={mutationError} /> : null}
    <section className="rounded-[2.25rem] bg-[#0e1a3d] p-7 text-white shadow-2xl shadow-[#0e1a3d]/15"><p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#bfdbfe]">Owner approval desk</p><h1 className="mt-3 text-5xl font-black tracking-[-0.055em]">All approvals, separated by workflow.</h1><p className="mt-4 max-w-2xl text-sm font-semibold leading-6 text-[#dbeafe]">Quote approvals, catalogue imports and extracted image mappings live here only for admin and owner.</p></section>
    <section className="grid gap-4 md:grid-cols-4">{[['Total pending', totalPending], ['Quotes', quotes.length], ['Imports', imports.length], ['Images', catalogTasks.length]].map(([label, value]) => <div key={label} className="mp-card rounded-[2rem] p-5"><p className="text-[10px] font-black uppercase tracking-widest text-[#475569]">{label}</p><p className="mt-2 text-3xl font-black text-[#0e1a3d]">{loading ? '...' : value}</p></div>)}</section>
    <section className="mp-card flex flex-wrap gap-2 rounded-[2rem] p-3">{[['quotes','Quote approvals',quotes.length,FileSpreadsheet],['imports','Import approvals',imports.length,Database],['images','Image approvals',catalogTasks.length,FileImage]].map(([id,label,count,Icon]: any)=><button key={id} onClick={()=>setTab(id)} className={`flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-black ${tab===id?'bg-[#0e1a3d] text-white':'bg-white/70 text-[#1e293b]'}`}><Icon className="h-4 w-4"/>{label}<span className="rounded-full bg-[#dbeafe] px-2 py-0.5 text-[10px] text-[#1d4ed8]">{count}</span></button>)}</section>
    {!loading && totalPending === 0 && <div className="mp-card grid min-h-64 place-items-center rounded-[2rem] p-8 text-center"><div><ShieldAlert className="mx-auto h-10 w-10 text-[#2563eb]" /><h2 className="mt-4 text-2xl font-black text-[#0e1a3d]">No approvals pending</h2><p className="mt-2 text-sm font-bold text-[#475569]">Approval requests will appear here automatically.</p></div></div>}
    {tab === 'quotes' && <section className="space-y-3">{quotes.map((quote: any) => <article key={quote.id} className="mp-card grid gap-4 rounded-[2rem] p-5 lg:grid-cols-[1fr_0.7fr_0.55fr_auto] lg:items-center"><div><Link href={`/dashboard/quotes/${quote.id}`} className="text-xl font-black text-[#0e1a3d] hover:underline">{quote.quoteNumber}</Link><p className="mt-1 text-sm font-bold text-[#475569]">{quote.title || quote.projectName || 'Retail quotation'}</p>{quote.approval?.availabilityIssues?.length > 0 && <p className="mt-2 rounded-2xl bg-amber-50 px-3 py-2 text-xs font-black text-amber-800">Availability warning: {quote.approval.availabilityIssues.length} short item(s)</p>}</div><div><p className="font-black text-[#0e1a3d]">{quote.customer?.name || 'Customer'}</p><p className="text-xs font-bold text-[#475569]">Owner: {quote.owner?.name || 'Unassigned'}</p></div><div className="text-right"><p className="text-2xl font-black text-[#0e1a3d]">{money(total(quote.lines))}</p><p className="text-xs font-black uppercase tracking-wider text-[#2563eb]">Discount {quote.discountPercent || 0}%</p></div><Button disabled={approvingQuote} onClick={() => approveQuote({ variables: { id: quote.id, note: 'Approved from owner approval desk' } })}><CheckCircle2 className="mr-2 h-4 w-4" /> Approve quote</Button></article>)}</section>}
    {tab === 'imports' && <section className="space-y-3">{imports.map((batch: any) => <article key={batch.id} className="mp-card flex flex-wrap items-center justify-between gap-4 rounded-[2rem] p-5"><div><p className="text-xl font-black text-[#0e1a3d]">{batch.brand || 'Catalogue import'} · {batch.rowCount} rows</p><p className="mt-1 text-xs font-bold text-[#475569]">{batch.id} · {batch.status}</p></div><Button disabled={approvingImport} onClick={() => approveImport({ variables: { importBatchId: batch.id, note: 'Approved from owner approval desk' } })}><CheckCircle2 className="mr-2 h-4 w-4" /> Approve import</Button></article>)}</section>}
    {tab === 'images' && <section className="space-y-3">{catalogTasks.map((task: any) => <article key={task.id} className="mp-card flex flex-wrap items-center justify-between gap-4 rounded-[2rem] p-5"><div className="flex items-center gap-4">{task.imageUrl && <img src={task.imageUrl} alt="catalogue task" className="h-24 w-28 rounded-2xl bg-white object-contain" />}<div><p className="text-xl font-black text-[#0e1a3d]">{task.detectedSku || 'Image mapping'} · {task.status}</p><p className="mt-1 text-xs font-bold text-[#475569]">Product: {task.mappedProductId || 'not mapped'} · {task.id}</p></div></div><Button disabled={approvingCatalog || !task.mappedProductId} onClick={() => approveCatalog({ variables: { id: task.id, note: 'Approved from owner approval desk' } })}><CheckCircle2 className="mr-2 h-4 w-4" /> Approve image</Button></article>)}</section>}
  </div>;
}
