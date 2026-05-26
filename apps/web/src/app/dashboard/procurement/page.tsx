'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { gql, useMutation, useQuery } from '@apollo/client';
import {
  AlertTriangle, Check, ChevronDown, ClipboardList, Download, Edit3, History as HistoryIcon,
  Inbox, Loader2, Package, Plus, RefreshCw, Search, Send, Sparkles, Truck, Users, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';
import { HelpButton } from '@/components/help/help-button';

// ===========================================================================
// GraphQL — uses the existing procurement module (procurementSummary,
// purchaseDemandQueue, purchaseOrders, goodsReceiptNotes, createPurchaseOrder,
// receivePurchaseOrder). All shapes documented in procurement.service.ts.
// ===========================================================================
const PROCUREMENT_DESK = gql`
  query ProcurementDesk {
    procurementSummary
    purchaseDemandQueue(take: 250)
    purchaseOrders(take: 80)
    goodsReceiptNotes(take: 30)
    vendors(status: "active", take: 150)
  }
`;
const CREATE_PO = gql`
  mutation CreatePurchaseOrder($input: CreatePurchaseOrderInput!) {
    createPurchaseOrder(input: $input)
  }
`;
const RECEIVE_PO = gql`
  mutation ReceivePurchaseOrder($input: ReceivePurchaseOrderInput!) {
    receivePurchaseOrder(input: $input)
  }
`;

// ===========================================================================
// Types & constants
// ===========================================================================
type Demand = {
  id: string;
  productId: string;
  sku: string;
  name: string;
  category?: string;
  brand?: string;
  finish?: string;
  unit?: string;
  quantity: number;
  orderedQuantity?: number;
  receivedQuantity?: number;
  status: string;
  customer?: { id: string; name: string; mobile?: string; city?: string } | null;
  owner?: { id: string; name: string } | null;
  salesOrder?: { id: string; orderNumber?: string; status?: string; createdAt?: string } | null;
  vendorName?: string | null;
  notes?: string;
  metadata?: any;
  createdAt?: string;
};
type PO = {
  id: string;
  poNumber: string;
  vendorId?: string | null;
  vendorName: string;
  status: string;
  expectedDate?: string | null;
  sentAt?: string | null;
  orderedAt?: string | null;
  closedAt?: string | null;
  createdAt: string;
  notes?: string;
  lines: Array<{
    id: string;
    productId: string;
    sku: string;
    name: string;
    orderedQuantity: number;
    receivedQuantity?: number;
    metadata?: any;
  }>;
};
type GRN = {
  id: string;
  grnNumber: string;
  vendorName: string;
  supplierChallan?: string;
  supplierBill?: string;
  createdAt: string;
  notes?: string;
  lines: Array<{ sku?: string; name?: string; orderedQuantity?: number; acceptedQuantity?: number; rejectedQuantity?: number }>;
};
type Vendor = { id: string; name: string; category?: string; status?: string };

const VIEWS = ['demand', 'pos', 'grn', 'vendors', 'history'] as const;
type View = (typeof VIEWS)[number];

// ===========================================================================
// Helpers
// ===========================================================================
function moneyShort(n: number) {
  const v = Number(n || 0);
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(2)}Cr`;
  if (v >= 100000) return `₹${(v / 100000).toFixed(2)}L`;
  if (v >= 1000) return `₹${(v / 1000).toFixed(1)}k`;
  return `₹${v.toLocaleString('en-IN')}`;
}
function ageDaysSince(dateStr?: string | null) {
  if (!dateStr) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000));
}
function ageBadge(ageDays: number) {
  if (ageDays >= 7) return { cls: 'bg-rose-50 text-rose-700 border-rose-200', label: `${ageDays} d` };
  if (ageDays >= 4) return { cls: 'bg-amber-50 text-amber-800 border-amber-200', label: `${ageDays} d` };
  return { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: `${ageDays} d` };
}
function poStatusBadge(status: string) {
  switch (status) {
    case 'draft': return 'bg-slate-50 text-slate-600 border-slate-200';
    case 'ordered':
    case 'sent': return 'bg-blue-50 text-blue-800 border-blue-200';
    case 'partial_received':
    case 'partial': return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'received': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'overdue': return 'bg-rose-50 text-rose-700 border-rose-200';
    case 'closed': return 'bg-slate-50 text-slate-600 border-slate-200';
    default: return 'bg-slate-50 text-slate-600 border-slate-200';
  }
}
function thumbColour(category?: string) {
  switch ((category || '').toLowerCase()) {
    case 'faucet': return 'bg-blue-50 text-blue-700';
    case 'shower': return 'bg-sky-50 text-sky-700';
    case 'tile':
    case 'tiles': return 'bg-amber-50 text-amber-700';
    case 'sanitary':
    case 'sanitaryware': return 'bg-rose-50 text-rose-700';
    case 'sink': return 'bg-violet-50 text-violet-700';
    default: return 'bg-slate-100 text-slate-600';
  }
}
function thumbInitials(name: string, category?: string) {
  const cat = (category || '').slice(0, 2).toUpperCase();
  if (cat) return cat;
  return (name || '?').slice(0, 2).toUpperCase();
}

// ===========================================================================
// Page
// ===========================================================================
export default function ProcurementPage() {
  const [view, setView] = useState<View>('demand');
  useEffect(() => {
    const h = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
    const v = new URLSearchParams(h).get('view') as View;
    if (v && VIEWS.includes(v)) setView(v);
  }, []);
  const switchView = (v: View) => {
    setView(v);
    if (typeof window !== 'undefined') window.history.replaceState(null, '', `#view=${v}`);
  };

  const [filters, setFilters] = useState({ search: '', staleOnly: false, tilesOnly: false, category: '', brand: '' });
  const { data, loading, error, refetch } = useQuery(PROCUREMENT_DESK, { pollInterval: 60000, fetchPolicy: 'cache-and-network' });

  const summary = data?.procurementSummary || {};
  const demandsRaw = useMemo<Demand[]>(() => data?.purchaseDemandQueue || [], [data?.purchaseDemandQueue]);
  const posRaw = useMemo<PO[]>(() => data?.purchaseOrders || [], [data?.purchaseOrders]);
  const grnsRaw = useMemo<GRN[]>(() => data?.goodsReceiptNotes || [], [data?.goodsReceiptNotes]);
  const vendorList = useMemo<Vendor[]>(() => data?.vendors || [], [data?.vendors]);

  // Filter demand client-side
  const demand = useMemo(() => {
    return demandsRaw.filter((d) => d.status === 'open' || d.status === 'partial_received').filter((d) => {
      if (filters.tilesOnly && String(d.category || '').toLowerCase() !== 'tiles') return false;
      if (filters.category && String(d.category || '').toLowerCase() !== filters.category.toLowerCase()) return false;
      if (filters.brand && String(d.brand || '').toLowerCase() !== filters.brand.toLowerCase()) return false;
      if (filters.search.trim()) {
        const q = filters.search.trim().toLowerCase();
        const hay = `${d.name || ''} ${d.sku || ''} ${d.brand || ''} ${d.category || ''} ${d.customer?.name || ''} ${d.salesOrder?.orderNumber || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filters.staleOnly && ageDaysSince(d.createdAt) < 7) return false;
      return true;
    });
  }, [demandsRaw, filters]);

  const openPos = useMemo(() => posRaw.filter((po) => ['draft', 'ordered', 'sent', 'partial_received', 'partial'].includes(po.status)), [posRaw]);

  const distinctCategories = useMemo(() => Array.from(new Set(demandsRaw.map((d) => d.category).filter(Boolean) as string[])).sort(), [demandsRaw]);
  const distinctBrands = useMemo(() => Array.from(new Set(demandsRaw.map((d) => d.brand).filter(Boolean) as string[])).sort(), [demandsRaw]);

  // Vendor suggestions (from prior PO history)
  const vendorByName = useMemo(() => new Map(vendorList.map((v) => [v.name?.toLowerCase(), v])), [vendorList]);
  const productVendorHistory = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const po of posRaw) {
      for (const line of po.lines || []) {
        if (!line.productId) continue;
        const list = map.get(line.productId) || [];
        if (po.vendorName && !list.includes(po.vendorName)) list.unshift(po.vendorName);
        map.set(line.productId, list.slice(0, 4));
      }
    }
    return map;
  }, [posRaw]);

  // Demand selection
  const [selected, setSelected] = useState<Map<string, number>>(new Map());
  const toggleSelect = (row: Demand) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.set(row.id, Number(row.quantity || 1));
      return next;
    });
  };
  const updateQty = (id: string, qty: number) => {
    setSelected((prev) => {
      const next = new Map(prev);
      next.set(id, Math.max(1, qty));
      return next;
    });
  };
  const clearSelection = () => setSelected(new Map());

  // Vendor tray
  const [trayVendorId, setTrayVendorId] = useState('');
  const [trayVendorName, setTrayVendorName] = useState('');
  const [trayExpectedDate, setTrayExpectedDate] = useState('');
  const [trayNotes, setTrayNotes] = useState('');
  const [createPO, { loading: creatingPO, error: createPOError }] = useMutation(CREATE_PO, {
    onCompleted: () => {
      clearSelection();
      setTrayVendorId('');
      setTrayVendorName('');
      setTrayExpectedDate('');
      setTrayNotes('');
      refetch();
    },
  });
  const submitPO = () => {
    if (selected.size === 0) return;
    const vendor = vendorList.find((v) => v.id === trayVendorId);
    createPO({
      variables: {
        input: {
          demandIds: Array.from(selected.keys()),
          vendorId: trayVendorId || undefined,
          vendorName: vendor?.name || trayVendorName || 'Vendor confirmation pending',
          expectedDate: trayExpectedDate ? new Date(trayExpectedDate).toISOString() : null,
          notes: trayNotes || 'Created from procurement desk',
        },
      },
    });
  };
  const trayValue = useMemo(() => {
    let total = 0;
    for (const [id, qty] of selected) {
      const row = demandsRaw.find((d) => d.id === id);
      if (row) total += Number(qty) * Number(row.metadata?.unitCost || 0);
    }
    return total;
  }, [selected, demandsRaw]);

  // GRN state
  const [grnPoId, setGrnPoId] = useState('');
  const [grnSupplierBill, setGrnSupplierBill] = useState('');
  const [grnSupplierChallan, setGrnSupplierChallan] = useState('');
  const [grnLineQty, setGrnLineQty] = useState<Map<string, number>>(new Map());
  const [grnLineDmg, setGrnLineDmg] = useState<Map<string, number>>(new Map());
  const [receivePO, { loading: receivingPO, error: receivePOError }] = useMutation(RECEIVE_PO, {
    onCompleted: () => {
      setGrnPoId('');
      setGrnSupplierBill('');
      setGrnSupplierChallan('');
      setGrnLineQty(new Map());
      setGrnLineDmg(new Map());
      refetch();
    },
  });
  const grnSelectedPo = useMemo(() => openPos.find((p) => p.id === grnPoId), [openPos, grnPoId]);
  const submitGRN = () => {
    if (!grnSelectedPo) return;
    const lines = (grnSelectedPo.lines || []).map((l) => ({
      purchaseOrderLineId: l.id,
      receivedQuantity: Number(grnLineQty.get(l.id) ?? Math.max(0, Number(l.orderedQuantity || 0) - Number(l.receivedQuantity || 0))),
      damagedQuantity: Number(grnLineDmg.get(l.id) || 0),
    })).filter((l) => l.receivedQuantity > 0);
    if (!lines.length) return;
    receivePO({
      variables: {
        input: {
          purchaseOrderId: grnSelectedPo.id,
          supplierChallan: grnSupplierChallan || null,
          supplierBill: grnSupplierBill || null,
          lines: JSON.stringify(lines),
        },
      },
    });
  };

  // Computed KPIs from summary + counts
  const kpis = {
    openDemand: Number(summary.openDemand || 0) + Number(summary.partialDemand || 0),
    openDemandValue: demandsRaw.filter((d) => d.status === 'open').reduce((s, d) => s + Number(d.quantity) * Number(d.metadata?.unitCost || 0), 0),
    staleDemandCount: demandsRaw.filter((d) => (d.status === 'open' || d.status === 'partial_received') && ageDaysSince(d.createdAt) >= 7).length,
    openPoCount: openPos.length,
    openPoValue: openPos.reduce((s, po) => s + Number(po.lines?.reduce?.((ls: number, l: any) => ls + Number(l.orderedQuantity || 0) * Number(l.unitCost || 0), 0) || 0), 0),
    expectedThisWeek: openPos.filter((po) => {
      if (!po.expectedDate) return false;
      const days = Math.floor((new Date(po.expectedDate).getTime() - Date.now()) / 86400000);
      return days >= 0 && days <= 7;
    }).length,
    grnsLast7d: Number(summary.recentGrn || 0),
    grnValueLast7d: grnsRaw.filter((g) => Date.now() - new Date(g.createdAt).getTime() < 7 * 86400000)
      .reduce((s, g) => s + Number((g.lines || []).reduce((ls: number, l: any) => ls + Number(l.acceptedQuantity || 0), 0)), 0),
    activeVendorCount: vendorList.length,
  };

  return (
    <div className="space-y-4 pb-32">
      {/* Action row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex flex-wrap rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1 shadow-sm-soft">
          <ViewTab active={view === 'demand'} onClick={() => switchView('demand')} icon={Inbox} label="Demand" badge={kpis.openDemand > 0 ? kpis.openDemand : undefined} highlight={kpis.staleDemandCount > 0} />
          <ViewTab active={view === 'pos'} onClick={() => switchView('pos')} icon={ClipboardList} label="Open POs" subtle={kpis.openPoCount} />
          <ViewTab active={view === 'grn'} onClick={() => switchView('grn')} icon={Package} label="GRN inward" />
          <ViewTab active={view === 'vendors'} onClick={() => switchView('vendors')} icon={Users} label="Vendors" subtle={kpis.activeVendorCount} />
          <ViewTab active={view === 'history'} onClick={() => switchView('history')} icon={HistoryIcon} label="History" />
        </div>
        <div className="flex items-center gap-2">
          <HelpButton topicId="vendors" variant="inline" label="Help" />
          <Button variant="outline" onClick={() => switchView('grn')}>
            <Package className="mr-1.5 h-4 w-4" /> Quick GRN
          </Button>
          <Button onClick={() => switchView('demand')}>
            <Plus className="mr-1.5 h-4 w-4" /> {kpis.openDemand > 0 ? 'Convert demand to PO' : 'Demand queue'}
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KpiTile tone="amber" alert={kpis.staleDemandCount > 0} icon={Inbox} label="Open demand"
          value={`${kpis.openDemand} SKU${kpis.openDemand === 1 ? '' : 's'}`}
          hint={kpis.staleDemandCount > 0 ? `${kpis.staleDemandCount} stale > 7d` : `est ${moneyShort(kpis.openDemandValue)}`}
          onClick={() => { switchView('demand'); setFilters((f) => ({ ...f, staleOnly: kpis.staleDemandCount > 0 ? true : f.staleOnly })); }} />
        <KpiTile tone="blue" icon={ClipboardList} label="Open POs"
          value={String(kpis.openPoCount)} hint={`${moneyShort(kpis.openPoValue)} committed`}
          onClick={() => switchView('pos')} />
        <KpiTile tone="sky" icon={Truck} label="Expected this week"
          value={`${kpis.expectedThisWeek} PO${kpis.expectedThisWeek === 1 ? '' : 's'}`}
          hint="from open POs with ETA"
          onClick={() => switchView('pos')} />
        <KpiTile tone="good" icon={Check} label="GRNs 7d"
          value={`${kpis.grnsLast7d} batches`} hint={`${kpis.grnValueLast7d} units received`}
          onClick={() => switchView('history')} />
        <KpiTile tone="violet" icon={Users} label="Active vendors"
          value={String(kpis.activeVendorCount)} hint="master list"
          onClick={() => switchView('vendors')} />
      </section>

      {/* Filter bar */}
      {view === 'demand' || view === 'pos' ? (
        <section className="sticky top-[64px] z-20 -mx-4 lg:-mx-8 border-y border-[var(--line)] bg-[var(--bg)]/95 px-4 py-3 backdrop-blur lg:px-8">
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect label="Category" value={filters.category} onChange={(v) => setFilters({ ...filters, category: v })}
              options={[{ value: '', label: 'All' }, ...distinctCategories.map((c) => ({ value: c, label: c }))]} />
            <FilterSelect label="Brand" value={filters.brand} onChange={(v) => setFilters({ ...filters, brand: v })}
              options={[{ value: '', label: 'All' }, ...distinctBrands.map((b) => ({ value: b, label: b }))]} />
            <span className="hidden h-5 w-px bg-[var(--line)] sm:block" />
            <Pill active={filters.staleOnly} danger label="Stale 7d+" icon={AlertTriangle}
              onClick={() => setFilters({ ...filters, staleOnly: !filters.staleOnly })} />
            <Pill active={filters.tilesOnly} label="Tiles only"
              onClick={() => setFilters({ ...filters, tilesOnly: !filters.tilesOnly })} />
            <div className="ml-auto flex items-center gap-2">
              <div className="flex h-9 items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5">
                <Search className="h-3.5 w-3.5 text-[var(--ink-4)]" />
                <input value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                  placeholder="SKU, product, vendor…"
                  className="w-36 bg-transparent text-xs text-[var(--ink)] outline-none placeholder:text-[var(--ink-5)] sm:w-48" />
              </div>
              <button type="button" onClick={() => refetch()} className="grid h-9 w-9 place-items-center rounded-md border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-3)] hover:bg-[var(--bg-soft)]">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {error && !data ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {createPOError ? <QueryErrorBanner error={createPOError} /> : null}
      {receivePOError ? <QueryErrorBanner error={receivePOError} /> : null}

      {view === 'demand' ? (
        <DemandView demand={demand} vendorList={vendorList} productVendorHistory={productVendorHistory}
          recentGrns={grnsRaw} loading={loading} selected={selected}
          onToggleSelect={toggleSelect} onUpdateQty={updateQty} />
      ) : null}
      {view === 'pos' ? <OpenPosView pos={openPos} loading={loading} onPickForGrn={(id) => { setGrnPoId(id); switchView('grn'); }} /> : null}
      {view === 'grn' ? (
        <GrnView openPOs={openPos} grnPoId={grnPoId} setGrnPoId={setGrnPoId}
          grnSelectedPo={grnSelectedPo as any} grnLineQty={grnLineQty} setGrnLineQty={setGrnLineQty}
          grnLineDmg={grnLineDmg} setGrnLineDmg={setGrnLineDmg}
          grnSupplierBill={grnSupplierBill} setGrnSupplierBill={setGrnSupplierBill}
          grnSupplierChallan={grnSupplierChallan} setGrnSupplierChallan={setGrnSupplierChallan}
          onSubmit={submitGRN} submitting={receivingPO} />
      ) : null}
      {view === 'vendors' ? <VendorsView vendors={vendorList} pos={posRaw} /> : null}
      {view === 'history' ? <HistoryView recentGrns={grnsRaw} /> : null}

      {selected.size > 0 ? (
        <DemandTray selected={selected} demand={demandsRaw} vendorList={vendorList}
          trayVendorId={trayVendorId} setTrayVendorId={setTrayVendorId}
          trayVendorName={trayVendorName} setTrayVendorName={setTrayVendorName}
          trayExpectedDate={trayExpectedDate} setTrayExpectedDate={setTrayExpectedDate}
          trayNotes={trayNotes} setTrayNotes={setTrayNotes}
          trayValue={trayValue} onSubmit={submitPO} onClear={clearSelection} submitting={creatingPO} />
      ) : null}
    </div>
  );
}

// ===========================================================================
// View tab + KPI tile + filter primitives
// ===========================================================================
function ViewTab({ active, onClick, icon: Icon, label, badge, subtle, highlight }: { active: boolean; onClick: () => void; icon: any; label: string; badge?: number; subtle?: number; highlight?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={
        active
          ? 'inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-3)] px-3 py-1.5 text-xs font-bold text-[var(--bg)] shadow-sm'
          : 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-[var(--ink-2)] hover:text-[var(--ink)]'
      }>
      <Icon className="h-3.5 w-3.5" /> {label}
      {badge != null ? (
        <span className={`ml-0.5 rounded-full px-1.5 py-px text-[10px] font-bold ${highlight ? (active ? 'bg-[var(--bg)] text-rose-700' : 'bg-rose-100 text-rose-700') : (active ? 'bg-[var(--bg)] text-[var(--ink)]' : 'bg-rose-100 text-rose-700')}`}>{badge}</span>
      ) : null}
      {subtle != null && badge == null ? (
        <span className="ml-0.5 text-[10px] font-bold text-[var(--ink-4)]">{subtle}</span>
      ) : null}
    </button>
  );
}

function KpiTile({ tone, icon: Icon, label, value, hint, alert, onClick }: {
  tone: 'blue' | 'violet' | 'good' | 'amber' | 'sky';
  icon: any; label: string; value: string; hint: string; alert?: boolean; onClick?: () => void;
}) {
  const toneMap = {
    blue: 'bg-[var(--brand-50)] text-[var(--brand-700)]',
    violet: 'bg-violet-50 text-violet-700',
    good: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    sky: 'bg-sky-50 text-sky-700',
  };
  return (
    <button type="button" onClick={onClick}
      className={`text-left rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm-soft transition hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-22px_rgba(15,23,42,0.35)] hover:border-[var(--line-strong)] ${
        alert ? 'ring-1 ring-rose-200 shadow-[0_10px_25px_-20px_rgba(220,38,38,0.4)]' : ''
      }`}>
      <div className="flex items-center gap-3">
        <div className={`grid h-10 w-10 place-items-center rounded-r3 ${toneMap[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ink-4)]">{label}</p>
          <p className="text-xl font-bold leading-tight text-[var(--ink)]">{value}</p>
          <p className="text-[11px] text-[var(--ink-4)]">{hint}</p>
        </div>
      </div>
    </button>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  const current = options.find((o) => o.value === value);
  return (
    <label className="relative inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ink-2)] hover:border-[var(--line-strong)]">
      <span className="text-[var(--ink-4)]">{label}:</span>
      <span>{current?.label || 'All'}</span>
      <ChevronDown className="h-3 w-3 text-[var(--ink-4)]" />
      <select value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label={label}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
function Pill({ active, onClick, label, icon: Icon, danger }: { active: boolean; onClick: () => void; label: string; icon?: any; danger?: boolean }) {
  let cls = 'inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ink-3)] hover:bg-[var(--bg-soft)]';
  if (active) {
    cls = danger
      ? 'inline-flex items-center gap-1.5 rounded-full border border-rose-600 bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white'
      : 'inline-flex items-center gap-1.5 rounded-full border border-[var(--surface-3)] bg-[var(--surface-3)] px-2.5 py-1.5 text-xs font-semibold text-[var(--bg)]';
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {Icon ? <Icon className="h-3 w-3" /> : null}
      {label}
    </button>
  );
}

// ===========================================================================
// Demand view
// ===========================================================================
function DemandView({ demand, vendorList, productVendorHistory, recentGrns, loading, selected, onToggleSelect, onUpdateQty }: {
  demand: Demand[]; vendorList: Vendor[]; productVendorHistory: Map<string, string[]>; recentGrns: GRN[]; loading: boolean;
  selected: Map<string, number>;
  onToggleSelect: (row: Demand) => void;
  onUpdateQty: (id: string, qty: number) => void;
}) {
  // Top vendors derived from vendorList sorted by name; we don't have open PO count without server-side aggregation, so show first 8.
  const top = vendorList.slice(0, 8);
  return (
    <section className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
      <div className="rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm-soft">
        <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[var(--ink-2)]">
          <Inbox className="h-3.5 w-3.5 text-amber-700" /> Demand queue
          <span className="rounded-full bg-[var(--bg-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--ink-3)] tracking-normal capitalize">{demand.length} SKUs</span>
          {selected.size > 0 ? (
            <span className="ml-auto rounded-full bg-[var(--brand-50)] px-2 py-0.5 text-[10px] font-bold tracking-normal text-[var(--brand-700)] capitalize">{selected.size} selected</span>
          ) : null}
        </h2>

        {loading && demand.length === 0 ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-r4 bg-[var(--bg-soft)]" />)}
          </div>
        ) : null}
        {!loading && demand.length === 0 ? (
          <div className="grid place-items-center rounded-r4 border border-dashed border-[var(--line)] p-12 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-emerald-700">
              <Check className="h-5 w-5" />
            </div>
            <p className="mt-4 text-sm font-bold text-[var(--ink)]">No purchase demand open</p>
            <p className="mt-1 text-xs text-[var(--ink-4)]">When customer orders need stock that isn't on hand, the shortfall appears here automatically.</p>
          </div>
        ) : null}

        <ul className="space-y-1">
          {demand.map((row) => {
            const isSelected = selected.has(row.id);
            const qty = selected.get(row.id) ?? Number(row.quantity || 1);
            const age = ageBadge(ageDaysSince(row.createdAt));
            const suggested = productVendorHistory.get(row.productId) || [];
            return (
              <li key={row.id}
                className={`grid items-center gap-3 rounded-r3 px-2 py-2 transition-colors hover:bg-[var(--bg-soft)] ${
                  isSelected ? 'bg-[var(--brand-50)]/40 ring-1 ring-[var(--brand-100)]' : ''
                } sm:grid-cols-[22px_minmax(0,1fr)_70px_80px_120px_120px_120px]`}>
                <button type="button" onClick={() => onToggleSelect(row)}
                  aria-label={isSelected ? 'Deselect' : 'Select'}
                  className={`grid h-4 w-4 place-items-center rounded border transition-colors ${isSelected ? 'border-[var(--brand-600)] bg-[var(--brand-600)] text-white' : 'border-[var(--line-strong)] bg-white hover:border-[var(--brand-500)]'}`}>
                  {isSelected ? <Check className="h-2.5 w-2.5" /> : null}
                </button>
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-r3 text-[10px] font-bold ${thumbColour(row.category)}`}>
                    {thumbInitials(row.name, row.category)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--ink)]">{row.name}</p>
                    <p className="truncate text-[10px] font-mono text-[var(--ink-4)]">{row.sku}{row.brand ? ` · ${row.brand}` : ''}{row.category ? ` · ${row.category}` : ''}</p>
                  </div>
                </div>
                <span className={`inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${age.cls}`}>{age.label}</span>
                <div className="text-[11px] text-[var(--ink-3)] tabular-nums">
                  <span className="font-bold text-[var(--ink)]">{row.quantity}</span><span className="text-[var(--ink-5)]"> needed</span>
                </div>
                <div className="flex items-center gap-1 rounded-md border border-[var(--line)] bg-white p-1">
                  <button type="button" onClick={() => onUpdateQty(row.id, Math.max(1, qty - 1))} className="grid h-5 w-5 place-items-center rounded text-[var(--ink-3)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)]">−</button>
                  <input value={qty} onChange={(e) => onUpdateQty(row.id, Math.max(1, Number(e.target.value) || 1))}
                    onFocus={(e) => e.target.select()}
                    className="w-12 bg-transparent text-center text-xs font-bold text-[var(--ink)] outline-none mp-mono" />
                  <button type="button" onClick={() => onUpdateQty(row.id, qty + 1)} className="grid h-5 w-5 place-items-center rounded text-[var(--ink-3)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)]">+</button>
                </div>
                <div className="text-[10px] text-[var(--ink-4)] leading-snug">
                  {suggested.length ? (
                    <>
                      <p className="font-bold uppercase tracking-widest text-[var(--ink-5)]">Past vendors</p>
                      <p className="truncate font-semibold text-[var(--ink-2)]">{suggested.slice(0, 2).join(', ')}{suggested.length > 2 ? ` +${suggested.length - 2}` : ''}</p>
                    </>
                  ) : row.vendorName ? (
                    <>
                      <p className="font-bold uppercase tracking-widest text-[var(--ink-5)]">Brand</p>
                      <p className="truncate font-semibold text-[var(--ink-2)]">{row.vendorName}</p>
                    </>
                  ) : (
                    <p className="italic text-[var(--ink-5)]">no vendor yet</p>
                  )}
                </div>
                <div className="text-[10px] text-[var(--ink-4)]">
                  <p>{row.salesOrder?.orderNumber || 'Sales order'}</p>
                  <p className="truncate font-semibold text-[var(--ink-3)]">{row.customer?.name || 'Customer'}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="space-y-4">
        <div className="rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm-soft">
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[var(--ink-2)]">
            <Users className="h-3.5 w-3.5 text-violet-700" /> Top vendors
            <span className="rounded-full bg-[var(--bg-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--ink-3)] tracking-normal">{vendorList.length}</span>
          </h3>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {top.length === 0 ? (
              <div className="col-span-2 rounded-r3 border border-dashed border-[var(--line)] p-4 text-center text-xs text-[var(--ink-4)]">No vendors yet</div>
            ) : null}
            {top.map((v) => (
              <Link key={v.id} href="/dashboard/master-data/vendors"
                className="flex items-center gap-2 rounded-r3 border border-[var(--line)] bg-[var(--bg-soft)]/40 p-2.5 transition hover:-translate-y-0.5 hover:bg-[var(--bg-soft)]">
                <div className="grid h-7 w-7 shrink-0 place-items-center rounded bg-gradient-to-br from-violet-500 to-violet-700 text-[10px] font-bold text-white">
                  {(v.name || '?').slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-[var(--ink)]">{v.name}</p>
                  <p className="text-[10px] text-[var(--ink-4)]">{v.category || 'Vendor'}</p>
                </div>
              </Link>
            ))}
            <Link href="/dashboard/master-data/vendors" className="col-span-2 mt-1 inline-flex items-center justify-center gap-2 rounded-r3 border border-dashed border-[var(--line)] bg-[var(--surface)] p-2 text-xs font-semibold text-[var(--ink-3)] hover:bg-[var(--bg-soft)]">
              <Plus className="h-3 w-3" /> Vendor master
            </Link>
          </div>
        </div>

        <div className="rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm-soft">
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[var(--ink-2)]">
            <Check className="h-3.5 w-3.5 text-emerald-700" /> Recent GRNs
            <span className="rounded-full bg-[var(--bg-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--ink-3)] tracking-normal">latest</span>
          </h3>
          <div className="mt-3 space-y-1.5">
            {recentGrns.length === 0 ? (
              <p className="rounded-r3 border border-dashed border-[var(--line)] p-3 text-center text-xs text-[var(--ink-4)]">No GRNs yet</p>
            ) : null}
            {recentGrns.slice(0, 5).map((g) => {
              const total = (g.lines || []).reduce((s: number, l: any) => s + Number(l.acceptedQuantity || 0), 0);
              return (
                <div key={g.id} className="flex items-center gap-2 rounded-r3 border border-[var(--line)] bg-[var(--bg-soft)]/40 p-2">
                  <div className="grid h-7 w-7 shrink-0 place-items-center rounded bg-emerald-50 text-emerald-700"><Check className="h-3 w-3" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-bold text-[var(--ink)] mp-mono">{g.grnNumber}</p>
                    <p className="truncate text-[10px] text-[var(--ink-4)]">{g.vendorName} · {new Date(g.createdAt).toLocaleDateString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-[var(--ink)]">{total}</p>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--ink-5)]">units</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

// ===========================================================================
// Open POs view
// ===========================================================================
function OpenPosView({ pos, loading, onPickForGrn }: { pos: PO[]; loading: boolean; onPickForGrn: (id: string) => void }) {
  if (loading && pos.length === 0) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-44 animate-pulse rounded-r5 bg-[var(--bg-soft)]" />)}
      </div>
    );
  }
  if (!pos.length) {
    return (
      <div className="rounded-r5 border border-dashed border-[var(--line)] bg-[var(--surface)] p-12 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-blue-50 text-blue-700"><ClipboardList className="h-5 w-5" /></div>
        <p className="mt-4 text-sm font-bold text-[var(--ink)]">No open purchase orders</p>
        <p className="mt-1 text-xs text-[var(--ink-4)]">Send vendor POs from the Demand view.</p>
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {pos.map((po) => {
        const totalOrdered = (po.lines || []).reduce((s: number, l: any) => s + Number(l.orderedQuantity || 0), 0);
        const totalReceived = (po.lines || []).reduce((s: number, l: any) => s + Number(l.receivedQuantity || 0), 0);
        const progress = totalOrdered > 0 ? (totalReceived / totalOrdered) * 100 : 0;
        const lineSummary = (po.lines || []).slice(0, 3);
        const expectedIn = po.expectedDate ? Math.floor((new Date(po.expectedDate).getTime() - Date.now()) / 86400000) : null;
        let displayStatus = po.status;
        if (po.status === 'ordered' && expectedIn != null && expectedIn < 0) displayStatus = 'overdue';
        const expHint = expectedIn == null ? null
          : expectedIn < 0 ? `${-expectedIn} d overdue`
          : expectedIn === 0 ? 'today'
          : expectedIn === 1 ? 'tomorrow'
          : `in ${expectedIn} d`;
        return (
          <article key={po.id} className="group rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm-soft transition hover:-translate-y-0.5 hover:border-[var(--line-strong)] hover:shadow-[0_18px_36px_-22px_rgba(15,23,42,0.35)]">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2.5 min-w-0">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-r3 bg-gradient-to-br from-blue-500 to-blue-700 text-[11px] font-bold text-white">
                  {(po.vendorName || 'V').slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-[var(--ink)]">{po.vendorName || 'Vendor'}</p>
                  <p className="truncate text-[10px] font-bold uppercase tracking-widest text-[var(--ink-4)]">{po.lines?.length || 0} {po.lines?.length === 1 ? 'line' : 'lines'}</p>
                </div>
              </div>
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${poStatusBadge(displayStatus)}`}>{displayStatus}</span>
            </div>

            <p className="mt-3 mp-mono text-[11px] text-[var(--ink-3)]">{po.poNumber}</p>

            <div className="mt-3 grid grid-cols-3 gap-2 border-t border-dashed border-[var(--line)] pt-3">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--ink-5)]">Units</p>
                <p className="mt-0.5 text-sm font-bold text-[var(--ink)]">{totalOrdered}</p>
              </div>
              <div>
                <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--ink-5)]">Received</p>
                <p className="mt-0.5 text-sm font-bold text-emerald-700">{totalReceived}</p>
              </div>
              <div>
                <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--ink-5)]">Expected</p>
                <p className={`mt-0.5 text-sm font-bold ${expectedIn != null && expectedIn < 0 ? 'text-rose-700' : expectedIn != null && expectedIn <= 2 ? 'text-amber-700' : 'text-[var(--ink)]'}`}>
                  {expHint || '—'}
                </p>
              </div>
            </div>

            <div className="mt-3">
              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-[var(--ink-5)]">
                <span>Progress</span>
                <span className="text-[var(--ink-2)]">{totalReceived}/{totalOrdered}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--bg-soft)]">
                <span className="block h-full bg-gradient-to-r from-emerald-500 to-emerald-600 transition-all" style={{ width: `${Math.min(100, progress)}%` }} />
              </div>
            </div>

            {lineSummary.length ? (
              <div className="mt-3 space-y-0.5 text-[10px] text-[var(--ink-3)]">
                {lineSummary.map((l: any, i: number) => (
                  <p key={i} className="truncate"><span className="font-bold text-[var(--ink-2)] mp-mono">{l.sku}</span> · {l.orderedQuantity}</p>
                ))}
                {(po.lines || []).length > 3 ? <p className="text-[var(--ink-5)]">+{po.lines.length - 3} more</p> : null}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => onPickForGrn(po.id)}
                className="inline-flex h-7 items-center gap-1.5 rounded-md bg-[var(--brand-600)] px-2.5 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-[var(--brand-700)]">
                <Package className="h-3 w-3" /> Receive
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

// ===========================================================================
// GRN view
// ===========================================================================
function GrnView({ openPOs, grnPoId, setGrnPoId, grnSelectedPo, grnLineQty, setGrnLineQty, grnLineDmg, setGrnLineDmg, grnSupplierBill, setGrnSupplierBill, grnSupplierChallan, setGrnSupplierChallan, onSubmit, submitting }: any) {
  const [search, setSearch] = useState('');
  const matches = openPOs.filter((po: PO) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return po.poNumber.toLowerCase().includes(q) || (po.vendorName || '').toLowerCase().includes(q);
  });
  return (
    <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <div className="rounded-r5 border border-[var(--line)] bg-gradient-to-br from-emerald-50/50 via-white to-white p-5 shadow-sm-soft">
        <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-emerald-800">
          <Package className="h-3.5 w-3.5" /> Quick GRN — receive against PO
        </h2>

        {!grnSelectedPo ? (
          <>
            <div className="mt-4 flex h-10 items-center gap-2 rounded-md border border-[var(--line)] bg-white px-3">
              <Search className="h-4 w-4 text-[var(--ink-4)]" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Scan/type PO number, vendor or SKU…"
                className="flex-1 bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-5)]" />
            </div>
            <div className="mt-3 space-y-1.5">
              {matches.length === 0 ? (
                <p className="rounded-r3 border border-dashed border-[var(--line)] p-6 text-center text-xs text-[var(--ink-4)]">No open POs match. Create one from Demand view first.</p>
              ) : null}
              {matches.slice(0, 8).map((po: PO) => {
                const totalOrdered = (po.lines || []).reduce((s: number, l: any) => s + Number(l.orderedQuantity || 0), 0);
                return (
                  <button key={po.id} type="button" onClick={() => setGrnPoId(po.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-r3 border border-[var(--line)] bg-white p-3 text-left transition hover:border-emerald-300 hover:bg-emerald-50/40">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded bg-gradient-to-br from-blue-500 to-blue-700 text-[10px] font-bold text-white">
                        {(po.vendorName || 'V').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-[var(--ink)]">{po.vendorName}</p>
                        <p className="truncate text-[10px] mp-mono text-[var(--ink-4)]">{po.poNumber} · {po.lines?.length || 0} lines · {totalOrdered} units</p>
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${poStatusBadge(po.status)}`}>{po.status}</span>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <div className="mt-4">
            <div className="flex items-center justify-between gap-2 rounded-r4 border border-emerald-200 bg-emerald-50/60 p-3">
              <div>
                <p className="text-sm font-bold text-[var(--ink)] mp-mono">{grnSelectedPo.poNumber} · {grnSelectedPo.vendorName}</p>
                <p className="mt-0.5 text-[10px] text-[var(--ink-4)]">{grnSelectedPo.lines?.length || 0} lines · status {grnSelectedPo.status}</p>
              </div>
              <button type="button" onClick={() => setGrnPoId('')} className="rounded-md border border-[var(--line)] bg-white p-1.5 text-[var(--ink-3)] hover:text-[var(--ink)]">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Input placeholder="Supplier challan #" value={grnSupplierChallan} onChange={(e) => setGrnSupplierChallan(e.target.value)} />
              <Input placeholder="Supplier bill / invoice #" value={grnSupplierBill} onChange={(e) => setGrnSupplierBill(e.target.value)} />
            </div>

            <h3 className="mt-4 text-[10px] font-bold uppercase tracking-widest text-[var(--ink-4)]">Receive these lines</h3>
            <ul className="mt-2 space-y-1">
              {(grnSelectedPo.lines || []).map((l: any) => {
                const remaining = Math.max(0, Number(l.orderedQuantity || 0) - Number(l.receivedQuantity || 0));
                const recv = grnLineQty.get(l.id) ?? remaining;
                const dmg = grnLineDmg.get(l.id) ?? 0;
                return (
                  <li key={l.id} className="grid items-center gap-3 rounded-r3 border border-[var(--line)] bg-white p-2.5 sm:grid-cols-[1fr_70px_100px_100px_70px]">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-[var(--ink)]">{l.name || l.sku}</p>
                      <p className="text-[10px] mp-mono text-[var(--ink-4)]">{l.sku}</p>
                    </div>
                    <div className="text-[10px] text-[var(--ink-4)]">
                      <p>{l.orderedQuantity} ordered</p>
                      <p className="text-[var(--ink-5)]">{Number(l.receivedQuantity || 0)} prior</p>
                    </div>
                    <div>
                      <label className="text-[9px] font-bold uppercase tracking-widest text-[var(--ink-5)]">Receive</label>
                      <input type="number" min="0" max={l.orderedQuantity} value={recv}
                        onChange={(e) => {
                          const next = new Map(grnLineQty);
                          next.set(l.id, Math.max(0, Number(e.target.value || 0)));
                          setGrnLineQty(next);
                        }}
                        className="mt-0.5 h-8 w-full rounded-md border border-emerald-300 bg-white px-2 text-center text-sm font-bold text-emerald-700 mp-mono" />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold uppercase tracking-widest text-[var(--ink-5)]">Damaged</label>
                      <input type="number" min="0" value={dmg}
                        onChange={(e) => {
                          const next = new Map(grnLineDmg);
                          next.set(l.id, Math.max(0, Number(e.target.value || 0)));
                          setGrnLineDmg(next);
                        }}
                        className="mt-0.5 h-8 w-full rounded-md border border-[var(--line)] bg-white px-2 text-center text-sm font-bold text-rose-700 mp-mono" />
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--ink-5)]">Net</p>
                      <p className="mt-0.5 text-sm font-bold text-emerald-700 mp-mono">{Math.max(0, Number(recv) - Number(dmg))}</p>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-[var(--ink-3)]">
                <p>Auto-reserves to waiting reservations.</p>
                <p className="text-[10px] text-[var(--ink-4)]">Damaged units logged as write-off.</p>
              </div>
              <Button onClick={onSubmit} disabled={submitting}>
                {submitting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
                Post GRN
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm-soft">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[var(--ink-2)]">
          <Sparkles className="h-3.5 w-3.5 text-violet-700" /> What happens on post
        </h3>
        <ol className="mt-3 space-y-2 text-xs text-[var(--ink-3)]">
          <li className="flex gap-2"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--brand-50)] text-[10px] font-bold text-[var(--brand-700)]">1</span><span><b className="text-[var(--ink)]">Stock bumped:</b> on-hand += received − damaged for each SKU.</span></li>
          <li className="flex gap-2"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--brand-50)] text-[10px] font-bold text-[var(--brand-700)]">2</span><span><b className="text-[var(--ink)]">PO updated:</b> status → received / partial. Received date stamped.</span></li>
          <li className="flex gap-2"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--brand-50)] text-[10px] font-bold text-[var(--brand-700)]">3</span><span><b className="text-[var(--ink)]">Auto-reserve:</b> waiting backordered reservations claim stock FIFO.</span></li>
          <li className="flex gap-2"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--brand-50)] text-[10px] font-bold text-[var(--brand-700)]">4</span><span><b className="text-[var(--ink)]">Movement ledgered:</b> inward + damaged write-off recorded.</span></li>
          <li className="flex gap-2"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--brand-50)] text-[10px] font-bold text-[var(--brand-700)]">5</span><span><b className="text-[var(--ink)]">Audit:</b> reference number generated · entry written.</span></li>
        </ol>
      </div>
    </section>
  );
}

// ===========================================================================
// Vendors view
// ===========================================================================
function VendorsView({ vendors, pos }: { vendors: Vendor[]; pos: PO[] }) {
  const openPoByVendor = new Map<string, number>();
  for (const po of pos) {
    if (po.status !== 'received' && po.status !== 'closed') {
      openPoByVendor.set(po.vendorName, (openPoByVendor.get(po.vendorName) || 0) + 1);
    }
  }
  if (!vendors.length) {
    return (
      <div className="rounded-r5 border border-dashed border-[var(--line)] bg-[var(--surface)] p-12 text-center">
        <Users className="mx-auto h-8 w-8 text-[var(--ink-4)]" />
        <p className="mt-3 text-sm font-bold text-[var(--ink)]">No vendors yet</p>
        <p className="mt-1 text-xs text-[var(--ink-4)]">Add vendors from the Vendor master.</p>
        <Link href="/dashboard/master-data/vendors" className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-[var(--brand-600)] px-3 py-1.5 text-xs font-bold text-white">Open vendor master →</Link>
      </div>
    );
  }
  return (
    <div className="rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm-soft">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[var(--ink-2)]">
          <Users className="h-3.5 w-3.5" /> Vendors
          <span className="rounded-full bg-[var(--bg-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--ink-3)] tracking-normal">{vendors.length}</span>
        </h2>
        <Link href="/dashboard/master-data/vendors" className="text-xs font-semibold text-[var(--brand-700)] hover:underline">Open master →</Link>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {vendors.map((v) => (
          <div key={v.id} className="rounded-r4 border border-[var(--line)] bg-[var(--bg-soft)]/40 p-3 transition hover:-translate-y-0.5 hover:bg-[var(--bg-soft)]">
            <div className="flex items-center gap-2">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-r3 bg-gradient-to-br from-violet-500 to-violet-700 text-[10px] font-bold text-white">{(v.name || '?').slice(0, 2).toUpperCase()}</div>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-[var(--ink)]">{v.name}</p>
                <p className="truncate text-[10px] text-[var(--ink-4)]">{v.category || 'Vendor'}</p>
              </div>
            </div>
            <div className="mt-2 text-[10px] text-[var(--ink-4)]">
              <p><b className="text-[var(--ink-2)]">{openPoByVendor.get(v.name) || 0}</b> open PO{(openPoByVendor.get(v.name) || 0) === 1 ? '' : 's'}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===========================================================================
// History view
// ===========================================================================
function HistoryView({ recentGrns }: { recentGrns: GRN[] }) {
  if (!recentGrns.length) {
    return (
      <div className="rounded-r5 border border-dashed border-[var(--line)] bg-[var(--surface)] p-12 text-center">
        <HistoryIcon className="mx-auto h-8 w-8 text-[var(--ink-4)]" />
        <p className="mt-3 text-sm font-bold text-[var(--ink)]">No GRN history yet</p>
      </div>
    );
  }
  return (
    <div className="rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm-soft">
      <h2 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[var(--ink-2)]">
        <HistoryIcon className="h-3.5 w-3.5" /> Inward history
        <span className="rounded-full bg-[var(--bg-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--ink-3)] tracking-normal">{recentGrns.length} recent</span>
      </h2>
      <ul className="space-y-1.5">
        {recentGrns.map((g) => {
          const total = (g.lines || []).reduce((s: number, l: any) => s + Number(l.acceptedQuantity || 0), 0);
          return (
            <li key={g.id} className="flex items-center gap-3 rounded-r4 border border-[var(--line)] bg-[var(--bg-soft)]/40 p-3 transition hover:bg-[var(--bg-soft)]">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-r3 bg-emerald-50 text-emerald-700"><Check className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-[var(--ink)] mp-mono">{g.grnNumber}</p>
                <p className="truncate text-[11px] text-[var(--ink-4)]">{g.vendorName} · {new Date(g.createdAt).toLocaleString()}</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-[var(--ink)] mp-mono">{total}</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ink-5)]">{g.lines?.length || 0} {g.lines?.length === 1 ? 'line' : 'lines'}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ===========================================================================
// Demand tray
// ===========================================================================
function DemandTray({ selected, demand, vendorList, trayVendorId, setTrayVendorId, trayVendorName, setTrayVendorName, trayExpectedDate, setTrayExpectedDate, trayNotes, setTrayNotes, trayValue, onSubmit, onClear, submitting }: any) {
  const trayVendor = vendorList.find((v: any) => v.id === trayVendorId);
  return (
    <div role="region" aria-label="Demand selection" className="fixed bottom-4 left-1/2 z-40 w-[min(95vw,820px)] -translate-x-1/2 rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[0_30px_80px_-30px_rgba(15,23,42,0.55)]">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[var(--brand-600)] px-2.5 py-1 text-xs font-bold text-white">{selected.size}</span>
          <p className="text-xs font-bold text-[var(--ink-2)]">
            row{selected.size === 1 ? '' : 's'} selected · {Array.from(selected.values()).reduce((s: number, q: any) => s + Number(q || 0), 0)} units
          </p>
        </div>
        <button type="button" onClick={onClear} className="ml-auto rounded-md p-1 text-[var(--ink-4)] hover:text-[var(--ink)]">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_1fr]">
        <select value={trayVendorId} onChange={(e) => { setTrayVendorId(e.target.value); setTrayVendorName(''); }} className="h-10 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--ink)]">
          <option value="">Pick vendor from master…</option>
          {vendorList.map((v: any) => <option key={v.id} value={v.id}>{v.name}{v.category ? ` · ${v.category}` : ''}</option>)}
        </select>
        <Input type="date" value={trayExpectedDate} onChange={(e) => setTrayExpectedDate(e.target.value)} placeholder="Expected delivery" />
      </div>
      {!trayVendorId ? (
        <Input value={trayVendorName} onChange={(e) => setTrayVendorName(e.target.value)} placeholder="…or type a vendor name (not in master)" className="mt-2" />
      ) : null}
      <textarea value={trayNotes} onChange={(e) => setTrayNotes(e.target.value)} rows={2}
        placeholder="Notes for vendor (e.g. matte chrome finish, urgent for Sharma villa)…"
        className="mt-2 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] p-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink-5)]" />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--ink-3)]">
          Estimated total <b className="text-[var(--ink)] text-base">{moneyShort(trayValue)}</b>
          {trayVendor ? <span className="ml-2 text-[var(--ink-4)]">· {trayVendor.name}</span> : null}
        </p>
        <Button onClick={onSubmit} disabled={submitting || (!trayVendorId && !trayVendorName.trim())}>
          {submitting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
          Create PO &amp; notify vendor
        </Button>
      </div>
    </div>
  );
}
