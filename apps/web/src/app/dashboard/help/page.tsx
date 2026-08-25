'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, BookOpen, CheckCircle2, Download, ExternalLink, FileText, Grid3X3, PackageCheck, PlayCircle, ScanLine, Search, ShieldCheck, Store } from 'lucide-react';
import { HELP_GUIDES } from '@/lib/help-content';

const ROLES = ['All', 'Sales', 'Office', 'Inventory', 'Dispatch', 'Owner'];
const TODAY_WORKFLOWS = [
  { id: 'showroom-scan-intent', title: 'Sales: scan to intent', summary: 'Scan a showroom QR into a new lead or editable intent, verify the item, then save.', href: '/dashboard/leads/new', icon: ScanLine },
  { id: 'setup-master-data', title: 'Tiles: design to variant', summary: 'Create catalogue design, governed size and the permanent inwardable warehouse SKU.', href: '/dashboard/master-data/tiles', icon: Grid3X3 },
  { id: 'procurement-inward', title: 'Inward: PO or manual GRN', summary: 'Receive boxes/pieces into an exact costed lot, then hand that GRN to labels.', href: '/dashboard/procurement', icon: PackageCheck },
  { id: 'display-assets', title: 'Display: stock or vendor sample', summary: 'Issue from an exact lot, or register a genuine non-stock vendor display.', href: '/dashboard/inventory/display-assets', icon: Store },
];

export default function HelpCenterPage() {
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('All');
  const [selectedId, setSelectedId] = useState('');

  useEffect(() => {
    const applyHash = () => setSelectedId(window.location.hash.replace('#', ''));
    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, []);

  const guides = useMemo(() => HELP_GUIDES.filter((guide) => {
    const haystack = `${guide.title} ${guide.summary} ${guide.steps.join(' ')} ${guide.roles.join(' ')}`.toLowerCase();
    return (!query.trim() || haystack.includes(query.toLowerCase())) && (role === 'All' || guide.roles.includes(role));
  }), [query, role]);
  const selected = HELP_GUIDES.find((guide) => guide.id === selectedId);

  return <div className="space-y-8 pb-12">
    <section className="border-b border-[var(--line)] pb-7 pt-2">
      <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase text-[var(--brand-700)]">Marble Park learning center</p>
          <h1 className="mt-2 font-display text-3xl font-bold text-[var(--ink)]">Complete operating guide</h1>
          <p className="mt-3 text-sm leading-6 text-[var(--ink-3)]">Task-by-task instructions for showroom sales, quotation, purchasing, physical stock, dispatch, returns, finance and control. Use the help icon on any page to open the matching guide.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/help/Marble-Park-Purchasing-Pricing-Cost-Guide.pdf" target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-md bg-[var(--brand-700)] px-4 text-sm font-semibold text-white"><Download className="mr-2 h-4 w-4"/>Purchasing &amp; cost guide</a>
          <a href="/help/Marble-Park-Tile-Inward-Display-Scan-Client-Handover.pdf" target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-md bg-[var(--brand-700)] px-4 text-sm font-semibold text-white"><Download className="mr-2 h-4 w-4"/>Client handover</a>
          <a href="/help/Marble-Park-ERP-User-Guide.pdf" target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-md bg-[var(--ink)] px-4 text-sm font-semibold text-white"><Download className="mr-2 h-4 w-4"/>PDF manual</a>
          <a href="/help/user-guide.html" target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-md border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--ink)]"><ExternalLink className="mr-2 h-4 w-4"/>Offline HTML</a>
        </div>
      </div>
    </section>

    <section aria-labelledby="today-workflows-title">
      <div><p className="text-xs font-semibold text-[var(--brand-700)]">Client quick start</p><h2 id="today-workflows-title" className="mt-1 text-xl font-semibold text-[var(--ink)]">Tile, inward, display and showroom scan</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-3)]">These four journeys cover the physical-identity changes released together. Open the guide for a worked example or go directly to the workspace.</p></div>
      <div className="mt-5 grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {TODAY_WORKFLOWS.map((workflow) => { const Icon = workflow.icon; return <article key={workflow.id} className="flex min-h-56 flex-col rounded-md border border-[var(--line)] bg-[var(--surface)] p-5"><div className="grid h-10 w-10 place-items-center rounded-md bg-[var(--brand-50)] text-[var(--brand-700)]"><Icon className="h-5 w-5"/></div><h3 className="mt-5 font-semibold text-[var(--ink)]">{workflow.title}</h3><p className="mt-2 flex-1 text-sm leading-6 text-[var(--ink-3)]">{workflow.summary}</p><div className="mt-5 flex flex-wrap gap-2"><a href={`#${workflow.id}`} className="inline-flex h-9 items-center rounded-md bg-[var(--brand-700)] px-3 text-xs font-semibold text-white">Worked example</a><Link href={workflow.href} className="inline-flex h-9 items-center rounded-md border border-[var(--line)] px-3 text-xs font-semibold text-[var(--ink)]">Open workspace</Link></div></article>; })}
      </div>
    </section>

    <section aria-labelledby="lifecycle-title">
      <div className="flex items-end justify-between gap-4"><div><p className="text-xs font-semibold text-[var(--ink-4)]">The operating model</p><h2 id="lifecycle-title" className="mt-1 text-xl font-semibold text-[var(--ink)]">Customer promise to physical fulfilment</h2></div><span className="hidden text-xs font-medium text-[var(--ink-4)] md:block">Every arrow preserves source and quantity history</span></div>
      <div className="mt-4 grid overflow-hidden rounded-md border border-[var(--line)] bg-[var(--surface)] md:grid-cols-6">
        {['Lead + intent', 'Quote + revision', 'Partial order', 'Reserve / procure', 'Pick + dispatch', 'Payment + return'].map((step, index) => <div key={step} className="relative border-b border-[var(--line)] p-4 last:border-0 md:border-b-0 md:border-r"><span className="text-[10px] font-semibold text-[var(--brand-700)]">0{index + 1}</span><p className="mt-2 text-sm font-semibold text-[var(--ink)]">{step}</p>{index < 5 ? <ArrowRight className="absolute -right-2.5 top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 rounded-full bg-[var(--surface)] p-1 text-[var(--ink-4)] md:block"/> : null}</div>)}
      </div>
    </section>

    {selected ? <section className="rounded-md border border-[var(--brand-200)] bg-[var(--brand-50)] p-5" aria-live="polite">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"><div><p className="text-xs font-semibold text-[var(--brand-700)]">Help for your current page</p><h2 className="mt-1 text-xl font-semibold text-[var(--ink)]">{selected.title}</h2><p className="mt-1 max-w-3xl text-sm text-[var(--ink-3)]">{selected.summary}</p></div><a href={`#${selected.id}`} className="inline-flex h-9 shrink-0 items-center rounded-md bg-[var(--brand-700)] px-3 text-sm font-semibold text-white">Open steps<ArrowRight className="ml-2 h-4 w-4"/></a></div>
    </section> : null}

    <section>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div><p className="text-xs font-semibold text-[var(--ink-4)]">Find an answer</p><h2 className="mt-1 text-xl font-semibold text-[var(--ink)]">Workflow library</h2></div>
        <div className="flex flex-col gap-2 sm:flex-row"><label className="flex h-10 min-w-72 items-center rounded-md border border-[var(--line)] bg-[var(--surface)] px-3"><Search className="mr-2 h-4 w-4 text-[var(--ink-4)]"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search action, page or outcome" className="w-full bg-transparent text-sm outline-none"/></label><div className="flex max-w-full gap-1 overflow-x-auto rounded-md border border-[var(--line)] bg-[var(--surface)] p-1">{ROLES.map((item) => <button key={item} onClick={() => setRole(item)} className={`h-8 shrink-0 rounded px-3 text-xs font-semibold ${role === item ? 'bg-[var(--ink)] text-white' : 'text-[var(--ink-3)] hover:bg-[var(--bg-soft)]'}`}>{item}</button>)}</div></div>
      </div>
      <div className="mt-5 grid items-start gap-4 xl:grid-cols-2">
        {guides.map((guide) => <details id={guide.id} key={guide.id} open={selectedId === guide.id} className="group scroll-mt-24 rounded-md border border-[var(--line)] bg-[var(--surface)] open:border-[var(--brand-300)]">
          <summary className="cursor-pointer list-none p-5"><div className="flex gap-4"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[var(--bg-soft)] text-[var(--brand-700)]"><BookOpen className="h-5 w-5"/></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-semibold text-[var(--ink)]">{guide.title}</h3><span className="text-xs text-[var(--ink-4)]">{guide.duration}</span></div><p className="mt-1 text-sm leading-6 text-[var(--ink-3)]">{guide.summary}</p><div className="mt-3 flex flex-wrap gap-1.5">{guide.roles.map((item) => <span key={item} className="rounded bg-[var(--bg-soft)] px-2 py-1 text-[10px] font-semibold text-[var(--ink-3)]">{item}</span>)}</div></div><span className="grid h-7 w-7 shrink-0 place-items-center text-xl text-[var(--ink-4)] transition group-open:rotate-45">+</span></div></summary>
          <div className="border-t border-[var(--line)] p-5">
            <div className="flex flex-wrap items-center gap-2">{guide.flow.map((step, index) => <div key={step} className="flex items-center gap-2"><span className="rounded bg-[var(--brand-50)] px-2 py-1 text-[11px] font-semibold text-[var(--brand-800)]">{step}</span>{index < guide.flow.length - 1 ? <ArrowRight className="h-3.5 w-3.5 text-[var(--ink-5)]"/> : null}</div>)}</div>
            {guide.examples?.length ? <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-4"><p className="text-xs font-semibold text-amber-900">Worked example - training data only</p>{guide.examples.map((example) => <p key={example} className="mt-2 text-sm leading-6 text-amber-950">{example}</p>)}</div> : null}
            <ol className="mt-5 space-y-3">{guide.steps.map((step, index) => <li key={step} className="grid grid-cols-[1.75rem_1fr] gap-2 text-sm leading-6 text-[var(--ink-2)]"><span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--ink)] text-[10px] font-semibold text-white">{index + 1}</span><span>{step}</span></li>)}</ol>
            <div className="mt-5 border-l-2 border-emerald-500 pl-4"><p className="text-xs font-semibold text-emerald-800">Before you finish</p>{guide.checks.map((check) => <p key={check} className="mt-2 flex gap-2 text-xs leading-5 text-[var(--ink-3)]"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600"/>{check}</p>)}</div>
            <div className="mt-5 flex flex-wrap gap-2"><Link href={guide.href} className="inline-flex h-9 items-center rounded-md bg-[var(--brand-700)] px-3 text-sm font-semibold text-white">Open workspace<ArrowRight className="ml-2 h-4 w-4"/></Link>{guide.video ? <a href={guide.video} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-md border border-[var(--line)] px-3 text-sm font-semibold text-[var(--ink)]"><PlayCircle className="mr-2 h-4 w-4"/>Watch video</a> : null}</div>
          </div>
        </details>)}
      </div>
    </section>

    <section>
      <div><p className="text-xs font-semibold text-[var(--ink-4)]">Watch by job</p><h2 className="mt-1 text-xl font-semibold text-[var(--ink)]">Training videos</h2></div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">{HELP_GUIDES.filter((guide, index, list) => guide.video && list.findIndex((item) => item.video === guide.video) === index).map((guide) => <article key={guide.video} className="overflow-hidden rounded-md border border-[var(--line)] bg-[var(--surface)]"><video controls preload="metadata" poster={guide.image} className="aspect-video w-full bg-[#18181b]"><source src={guide.video} type="video/mp4"/>Your browser does not support embedded video.</video><div className="p-4"><p className="text-xs font-semibold text-[var(--brand-700)]">{guide.duration} walkthrough</p><h3 className="mt-1 font-semibold text-[var(--ink)]">{guide.title}</h3><p className="mt-2 text-sm leading-6 text-[var(--ink-3)]">{guide.summary}</p></div></article>)}</div>
    </section>

    <section className="grid gap-4 border-t border-[var(--line)] pt-7 md:grid-cols-3"><div className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-600"/><div><p className="font-semibold text-[var(--ink)]">Use named accounts</p><p className="mt-1 text-sm text-[var(--ink-4)]">Never share the owner login.</p></div></div><div className="flex gap-3"><FileText className="mt-0.5 h-5 w-5 text-[var(--brand-700)]"/><div><p className="font-semibold text-[var(--ink)]">Keep source documents</p><p className="mt-1 text-sm text-[var(--ink-4)]">PO, GRN, challan and receipt evidence stays linked.</p></div></div><div className="flex gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600"/><div><p className="font-semibold text-[var(--ink)]">Finish the queue</p><p className="mt-1 text-sm text-[var(--ink-4)]">Resolve backorders and reconciliation exceptions daily.</p></div></div></section>
  </div>;
}
