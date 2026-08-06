'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { gql, useMutation, useQuery } from '@apollo/client';
import { CalendarClock, CheckCircle2, ClipboardList, Download, ExternalLink, PackageCheck, PackageSearch, Plus, Search, Send, Trash2, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { QueryErrorBanner } from '@/components/query-state';
import { cn } from '@/lib/utils';

const ME = gql`
  query ProcurementDeskMe {
    me { id role }
  }
`;

const PROCUREMENT = gql`
  query ProcurementDesk {
    procurementSummary
    purchaseDemandQueue(take: 250)
    purchaseOrders(take: 80)
    goodsReceiptNotes(take: 20)
    vendors(status: "active", take: 150)
    stockLocations(status: "active")
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

const DELETE_PO = gql`
  mutation DeletePurchaseOrder($id: ID!) {
    deletePurchaseOrder(id: $id)
  }
`;

const SEARCH_PRODUCTS = gql`query SearchProductsForPo($query: String!) { globalSearch(query: $query) { products } }`;

function money(value: number) {
  return `₹${Math.round(Number(value || 0)).toLocaleString('en-IN')}`;
}

function moneyExact(value: number) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Live PO commercial estimate (mirrors server po-pricing). */
function estimatePoCommercial(lines: Array<{ quantity: number; unitCost: number }>, discountPercent: number, taxRate: number) {
  const disc = Math.max(0, Math.min(100, Number(discountPercent || 0)));
  const tax = Math.max(0, Math.min(100, Number(taxRate || 0)));
  const subtotal = lines.reduce((sum, line) => sum + Math.max(0, Number(line.quantity || 0)) * Math.max(0, Number(line.unitCost || 0)), 0);
  const discountAmount = Math.round((subtotal * disc / 100 + Number.EPSILON) * 100) / 100;
  const taxableValue = Math.round((subtotal - discountAmount + Number.EPSILON) * 100) / 100;
  const taxAmount = Math.round((taxableValue * tax / 100 + Number.EPSILON) * 100) / 100;
  const grandTotal = Math.round((taxableValue + taxAmount + Number.EPSILON) * 100) / 100;
  return { subtotal, discountAmount, taxableValue, taxAmount, grandTotal, discountPercent: disc, taxRate: tax };
}

function statusTone(status?: string) {
  if (status === 'received' || status === 'allocated') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (status === 'partial_received') return 'bg-blue-50 text-blue-700 ring-blue-200';
  if (status === 'ordered') return 'bg-amber-50 text-amber-800 ring-amber-200';
  if (status === 'cancelled') return 'bg-red-50 text-red-700 ring-red-200';
  return 'bg-zinc-50 text-zinc-700 ring-zinc-200';
}

export default function ProcurementPage() {
  const [selectedDemand, setSelectedDemand] = useState<Record<string, boolean>>({});
  const [demandCostRows, setDemandCostRows] = useState<Record<string, string>>({});
  const [vendorId, setVendorId] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [poNotes, setPoNotes] = useState('');
  const [activePoId, setActivePoId] = useState('');
  const [receiveRows, setReceiveRows] = useState<Record<string, string>>({});
  const [damagedRows, setDamagedRows] = useState<Record<string, string>>({});
  const [batchRows, setBatchRows] = useState<Record<string, string>>({});
  const [costRows, setCostRows] = useState<Record<string, string>>({});
  const [receiptKey, setReceiptKey] = useState(() => crypto.randomUUID());
  const [receiveMessage, setReceiveMessage] = useState('');
  const [supplierChallan, setSupplierChallan] = useState('');
  const [supplierBill, setSupplierBill] = useState('');
  const [receiveLocationId, setReceiveLocationId] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [directLines, setDirectLines] = useState<any[]>([]);
  const [poMessage, setPoMessage] = useState('');
  const [poDiscountPercent, setPoDiscountPercent] = useState('');
  const [poTaxRate, setPoTaxRate] = useState('');

  const { data: meData } = useQuery(ME);
  const canDeletePo = meData?.me?.role === 'admin' || meData?.me?.role === 'owner';
  const { data, loading, error, refetch } = useQuery(PROCUREMENT, {
    pollInterval: 120000,
    skipPollAttempt: () => typeof document !== 'undefined' && document.hidden,
    notifyOnNetworkStatusChange: false,
  });
  const { data: productSearchData, error: productSearchError } = useQuery(SEARCH_PRODUCTS, { variables: { query: productSearch }, skip: productSearch.trim().length < 2 });
  const [createPo, { loading: creatingPo, error: createPoError }] = useMutation(CREATE_PO, {
    onCompleted: (result) => {
      const po = result.createPurchaseOrder;
      setPoMessage(`${po.poNumber} created${Number(po.grandTotal || 0) > 0 ? ` · order value ${moneyExact(po.grandTotal)}` : ''}. Open the supplier PDF or select it for GRN receiving.`);
      setActivePoId(po.id);
      setSelectedDemand({});
      setDemandCostRows({});
      setDirectLines([]);
      setVendorId('');
      setVendorName('');
      setExpectedDate('');
      setPoNotes('');
      setPoDiscountPercent('');
      setPoTaxRate('');
      setProductSearch('');
      refetch();
    },
  });
  const [receivePo, { loading: receivingPo, error: receivePoError }] = useMutation(RECEIVE_PO, { onCompleted: (result) => { setReceiveMessage(`Posted ${result.receivePurchaseOrder?.grnNumber || 'GRN'} and updated inventory/backorder allocation.`); setReceiveRows({}); setDamagedRows({}); setBatchRows({}); setCostRows({}); setReceiptKey(crypto.randomUUID()); setSupplierChallan(''); setSupplierBill(''); refetch(); } });
  const [deletePo, { loading: deletingPo, error: deletePoError }] = useMutation(DELETE_PO, {
    onCompleted: (result) => {
      const deleted = result.deletePurchaseOrder;
      setPoMessage(`${deleted?.poNumber || 'Purchase order'} permanently deleted. GRNs kept; stock unchanged.`);
      if (activePoId && deleted?.id === activePoId) setActivePoId('');
      refetch();
    },
  });

  const confirmDeletePo = (po: any) => {
    if (!canDeletePo || deletingPo) return;
    const ok = window.confirm(`Permanently delete ${po.poNumber}? GRNs stay; stock is unchanged.`);
    if (!ok) return;
    deletePo({ variables: { id: po.id } });
  };

  const summary = data?.procurementSummary || {};
  const demands = useMemo<any[]>(() => data?.purchaseDemandQueue || [], [data?.purchaseDemandQueue]);
  const purchaseOrders = useMemo<any[]>(() => data?.purchaseOrders || [], [data?.purchaseOrders]);
  const grns = useMemo<any[]>(() => data?.goodsReceiptNotes || [], [data?.goodsReceiptNotes]);
  const vendors = useMemo<any[]>(() => data?.vendors || [], [data?.vendors]);
  const locations = useMemo<any[]>(() => data?.stockLocations || [], [data?.stockLocations]);
  const defaultLocation = useMemo(() => locations.find((location) => location.defaultStockScope) || locations[0], [locations]);
  const receiveLocation = useMemo(() => locations.find((location) => location.id === receiveLocationId) || defaultLocation, [defaultLocation, locations, receiveLocationId]);
  const activePo = useMemo(() => purchaseOrders.find((po) => po.id === activePoId) || purchaseOrders.find((po) => ['ordered', 'partial_received'].includes(po.status)) || purchaseOrders[0], [purchaseOrders, activePoId]);
  const selectedIds = Object.entries(selectedDemand).filter(([, checked]) => checked).map(([id]) => id);
  const selectedRows = demands.filter((row) => selectedIds.includes(row.id));
  const demandEstimate = useMemo(
    () => estimatePoCommercial(
      selectedRows.map((row) => ({ quantity: Number(row.quantity || 0), unitCost: Number(demandCostRows[row.id] || 0) })),
      Number(poDiscountPercent || 0),
      Number(poTaxRate || 0),
    ),
    [selectedRows, demandCostRows, poDiscountPercent, poTaxRate],
  );
  const directEstimate = useMemo(
    () => estimatePoCommercial(
      directLines.map((line) => ({ quantity: Number(line.quantity || 0), unitCost: Number(line.unitCost || 0) })),
      Number(poDiscountPercent || 0),
      Number(poTaxRate || 0),
    ),
    [directLines, poDiscountPercent, poTaxRate],
  );
  const selectedDemandCostsValid = selectedRows.length > 0;

  const commercialInput = () => ({
    discountPercent: poDiscountPercent === '' ? undefined : Number(poDiscountPercent || 0),
    taxRate: poTaxRate === '' ? undefined : Number(poTaxRate || 0),
  });

  useEffect(() => {
    if (!receiveLocationId && defaultLocation?.id) setReceiveLocationId(defaultLocation.id);
  }, [defaultLocation?.id, receiveLocationId]);

  const submitPo = () => {
    if (!selectedIds.length) return;
    createPo({
      variables: {
        input: {
          demandIds: selectedIds,
          lines: JSON.stringify(selectedRows.map((row) => ({ purchaseDemandId: row.id, unitCost: Number(demandCostRows[row.id] || 0) }))),
          vendorId: vendorId || undefined,
          vendorName: vendorName || vendors.find((vendor) => vendor.id === vendorId)?.name || selectedRows[0]?.vendorName || selectedRows[0]?.brand || 'Vendor confirmation pending',
          expectedDate: expectedDate ? new Date(expectedDate).toISOString() : undefined,
          notes: poNotes || 'Created from sales-order purchase demand.',
          ...commercialInput(),
        },
      },
    });
  };

  const addDirectProduct = (product: any) => {
    setDirectLines((current) => current.some((line) => line.productId === product.id) ? current : [...current, { productId: product.id, sku: product.sku, internalCode: product.internalCode || '', name: product.name, brand: product.brand, unit: product.purchaseUom || product.unit || 'PC', quantity: 1, unitCost: Number(product.costPrice || 0) > 0 ? String(product.costPrice) : '' }]);
    setProductSearch('');
  };
  const updateDirectLine = (productId: string, patch: any) => setDirectLines((current) => current.map((line) => line.productId === productId ? { ...line, ...patch } : line));
  const submitDirectPo = () => {
    if (!directLines.length || !vendorId) return;
    createPo({
      variables: {
        input: {
          demandIds: [],
          lines: JSON.stringify(directLines),
          vendorId,
          vendorName: vendorName || vendors.find((vendor) => vendor.id === vendorId)?.name,
          expectedDate: expectedDate ? new Date(expectedDate).toISOString() : undefined,
          notes: poNotes || 'Direct purchase order from Product Master.',
          ...commercialInput(),
        },
      },
    });
  };

  const submitReceive = () => {
    if (!activePo) return;
    const lines = (activePo.lines || [])
      .map((line: any) => {
        const remaining = Math.max(0, Number(line.orderedQuantity || 0) - Number(line.receivedQuantity || 0));
        const typed = receiveRows[line.id];
        const receivedQuantity = typed === undefined ? remaining : Number(typed || 0);
        return {
          purchaseOrderLineId: line.id,
          receivedQuantity,
          damagedQuantity: Number(damagedRows[line.id] || 0),
          supplierBatch: batchRows[line.id] || undefined,
          unitCost: costRows[line.id] === undefined || costRows[line.id] === '' ? undefined : Number(costRows[line.id]),
          location: receiveLocation ? `${receiveLocation.code} · ${receiveLocation.name}` : 'Default plant',
          locationId: receiveLocation?.id,
        };
      })
      .filter((line: any) => Number(line.receivedQuantity || 0) > 0);
    if (!lines.length) return;
    receivePo({
      variables: {
        input: {
          purchaseOrderId: activePo.id,
          supplierChallan: supplierChallan || undefined,
          supplierBill: supplierBill || undefined,
          locationId: receiveLocation?.id || undefined,
          lines: JSON.stringify(lines),
          notes: 'Received from procurement desk.',
          idempotencyKey: receiptKey,
        },
      },
    });
  };

  return (
    <div className="space-y-7 pb-10">
      {error ? <QueryErrorBanner error={error} onRetry={() => refetch()} /> : null}
      {createPoError ? <QueryErrorBanner error={createPoError} /> : null}
      {productSearchError ? <QueryErrorBanner error={productSearchError} /> : null}
      {receivePoError ? <QueryErrorBanner error={receivePoError} /> : null}
      {deletePoError ? <QueryErrorBanner error={deletePoError} /> : null}
      {receiveMessage ? <div className="rounded-r4 border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">{receiveMessage}</div> : null}
      {poMessage ? <div className="rounded-r4 border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">{poMessage}</div> : null}

      <section className="border-b border-[var(--line)] pb-5 pt-2">
        <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-4)]">Procurement control</p>
            <h1 className="mt-2 text-2xl font-black text-[var(--ink)]">Purchase demand and inward</h1>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-md border border-[var(--line)] bg-[var(--surface)] px-5 py-3"><p className="text-xl font-black text-[var(--ink)]">{summary.openDemand || 0}</p><p className="text-[10px] font-black uppercase text-[var(--ink-4)]">Open demand</p></div>
            <div className="rounded-md border border-[var(--line)] bg-[var(--surface)] px-5 py-3"><p className="text-xl font-black text-[var(--ink)]">{summary.activePurchaseOrders || 0}</p><p className="text-[10px] font-black uppercase text-[var(--ink-4)]">Active POs</p></div>
            <div className="rounded-md border border-[var(--line)] bg-[var(--surface)] px-5 py-3"><p className="text-xl font-black text-[var(--ink)]">{summary.recentGrn || 0}</p><p className="text-[10px] font-black uppercase text-[var(--ink-4)]">7d GRNs</p></div>
          </div>
        </div>
      </section>

      <section className="mp-panel p-5">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--brand-700)]">Direct purchase</p><h2 className="mt-2 text-2xl font-black text-[var(--ink)]">Create PO from Product Master</h2><p className="mt-1 text-sm font-semibold text-[var(--ink-4)]">Use this for showroom replenishment or planned buying that did not originate from a customer backorder.</p></div><span className="text-xs font-bold uppercase tracking-wider text-[var(--ink-4)]">{directLines.length} line(s)</span></div>
        <div className="relative mt-5">
          <Search className="absolute left-3 top-3.5 h-4 w-4 text-[var(--ink-4)]" /><Input value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Search SKU, internal code, brand or product name" className="pl-10" />
          {productSearch.length >= 2 && productSearchData?.globalSearch?.products?.length ? <div className="absolute z-30 mt-2 max-h-72 w-full overflow-y-auto rounded-md border border-[var(--line)] bg-[var(--surface)] p-2 shadow-xl">{productSearchData.globalSearch.products.map((product: any) => <button key={product.id} type="button" onClick={() => addDirectProduct(product)} className="flex w-full items-center justify-between rounded p-3 text-left hover:bg-[var(--brand-50)]"><span><span className="block text-sm font-bold text-[var(--ink)]">{product.internalCode || product.sku} · {product.name}</span><span className="text-xs font-semibold text-[var(--ink-4)]">{product.sku} · {product.brand}</span></span><Plus className="h-4 w-4" /></button>)}</div> : null}
        </div>
        {directLines.length ? (
          <div className="mt-4 space-y-2 text-sm">
            <div className="hidden grid-cols-[minmax(0,1fr)_7rem_6rem_9rem_2.5rem] gap-3 border-b border-[var(--line)] px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-[var(--ink-4)] sm:grid">
              <span>Product</span><span>Quantity</span><span>Unit</span><span>Unit cost (optional)</span><span />
            </div>
            {directLines.map((line) => (
              <div key={line.productId} className="relative grid grid-cols-2 gap-3 rounded-md border border-[var(--line)] bg-[var(--surface)] p-3 sm:grid-cols-[minmax(0,1fr)_7rem_6rem_9rem_2.5rem] sm:items-end sm:border-x-0 sm:border-t-0 sm:bg-transparent">
                <div className="col-span-2 min-w-0 pr-10 sm:col-span-1 sm:pr-0">
                  <p className="break-words font-bold text-[var(--ink)]">{line.internalCode || line.sku} · {line.name}</p>
                  <p className="text-xs text-[var(--ink-4)]">{line.brand}</p>
                </div>
                <label className="min-w-0 space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-4)] sm:sr-only">Quantity</span>
                  <Input aria-label={`Quantity for ${line.sku}`} type="number" min={1} step={1} value={line.quantity} onChange={(event) => updateDirectLine(line.productId, { quantity: Number(event.target.value) })} className="w-full" />
                </label>
                <label className="min-w-0 space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-4)] sm:sr-only">Unit</span>
                  <Input aria-label={`Unit for ${line.sku}`} value={line.unit} onChange={(event) => updateDirectLine(line.productId, { unit: event.target.value })} className="w-full" />
                </label>
                <label className="col-span-2 min-w-0 space-y-1 sm:col-span-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-4)] sm:sr-only">Unit cost (optional)</span>
                  <Input aria-label={`Optional unit cost for ${line.sku}`} type="number" min={0} step="0.01" value={line.unitCost} onChange={(event) => updateDirectLine(line.productId, { unitCost: event.target.value })} placeholder="Enter at GRN" className="w-full" />
                </label>
                <button type="button" title="Remove line" aria-label={`Remove ${line.sku}`} onClick={() => setDirectLines((current) => current.filter((row) => row.productId !== line.productId))} className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded text-red-700 hover:bg-red-50 sm:static"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="mt-5 grid gap-3 rounded-md border border-[var(--line)] bg-[var(--bg-soft)] p-4 md:grid-cols-[1fr_1fr_1.2fr]">
          <label className="space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-4)]">PO discount % <span className="font-semibold normal-case tracking-normal text-[var(--ink-5)]">(optional)</span></span>
            <Input type="number" min={0} max={100} step="0.01" value={poDiscountPercent} onChange={(event) => setPoDiscountPercent(event.target.value)} placeholder="0" />
          </label>
          <label className="space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-4)]">GST % <span className="font-semibold normal-case tracking-normal text-[var(--ink-5)]">(optional)</span></span>
            <Input type="number" min={0} max={100} step="0.01" value={poTaxRate} onChange={(event) => setPoTaxRate(event.target.value)} placeholder="0 = no GST" />
          </label>
          <div className="rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--ink-3)]">
            <p className="flex justify-between gap-3"><span>Subtotal</span><span>{moneyExact(directEstimate.subtotal)}</span></p>
            {directEstimate.discountAmount > 0 ? <p className="mt-1 flex justify-between gap-3"><span>Discount</span><span>−{moneyExact(directEstimate.discountAmount)}</span></p> : null}
            {directEstimate.taxAmount > 0 ? <p className="mt-1 flex justify-between gap-3"><span>GST {directEstimate.taxRate}%</span><span>{moneyExact(directEstimate.taxAmount)}</span></p> : null}
            <p className="mt-2 flex justify-between gap-3 border-t border-[var(--line)] pt-2 text-sm font-black text-[var(--ink)]"><span>Order value</span><span>{moneyExact(directEstimate.grandTotal)}</span></p>
          </div>
        </div>
        <p className="mt-2 text-xs font-semibold text-[var(--ink-4)]">Discount and GST apply after unit cost × qty. Leave blank for a plain cost PO. Stock/GRN still posts at unit cost.</p>
        <div className="mt-5 grid gap-3 md:grid-cols-[1fr_12rem_auto]"><select value={vendorId} onChange={(event) => { setVendorId(event.target.value); setVendorName(vendors.find((vendor) => vendor.id === event.target.value)?.name || ''); }} className="h-11 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--ink)]"><option value="">Select vendor from master</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select><Input type="date" value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} /><Button onClick={submitDirectPo} disabled={!vendorId || !directLines.length || directLines.some((line) => Number(line.quantity) <= 0) || creatingPo}><Send className="mr-2 h-4 w-4" />Create direct PO</Button></div>
        <p className="mt-2 text-xs font-semibold text-[var(--ink-4)]">Blank costs stay pending on the PO. Enter the actual cost at GRN or leave it blank to use the SKU default.</p>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="mp-panel overflow-hidden">
          <div className="border-b border-[var(--line)] p-5">
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">Demand queue</p>
                <h2 className="mt-2 text-2xl font-black text-[var(--ink)]">Customer orders waiting for purchase</h2>
              </div>
              <Button asChild variant="secondary"><Link href="/dashboard/pending-inward"><PackageSearch className="mr-2 h-4 w-4" /> Pending inward</Link></Button>
            </div>
          </div>

          <div className="max-h-[36rem] overflow-y-auto p-3 custom-scrollbar">
            {loading ? <div className="p-6 text-sm font-bold text-[var(--ink-3)]">Loading demand...</div> : null}
            {!loading && !demands.length ? (
              <div className="grid min-h-[18rem] place-items-center text-center">
                <div>
                  <CheckCircle2 className="mx-auto h-11 w-11 text-emerald-600" />
                  <h3 className="mt-3 text-xl font-black text-[var(--ink)]">No purchase demand open.</h3>
                  <p className="mt-2 text-sm font-semibold text-[var(--ink-3)]">New backorders and tile special orders will appear here after sales-order conversion.</p>
                </div>
              </div>
            ) : demands.map((row, index) => {
              const checked = !!selectedDemand[row.id];
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => {
                    setSelectedDemand((current) => ({ ...current, [row.id]: !checked }));
                    if (!checked && demandCostRows[row.id] === undefined) setDemandCostRows((current) => ({ ...current, [row.id]: String(row.metadata?.unitCost || '') }));
                  }}
                  className={cn('mb-2 w-full rounded-r4 border p-4 text-left transition-all', checked ? 'border-[var(--brand-400)] bg-[var(--brand-50)] shadow-sm-soft' : 'border-[var(--line)] bg-[var(--surface)] hover:border-[var(--line-strong)]')}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-base font-black text-[var(--ink)]">{row.sku} · {row.name}</p>
                      <p className="mt-1 text-xs font-bold uppercase tracking-wider text-[var(--ink-4)]">{row.salesOrder?.orderNumber || 'Order'} · {row.customer?.name || 'Customer'} · {row.owner?.name || 'Sales'}</p>
                    </div>
                    <span className={cn('shrink-0 rounded-full px-3 py-1 text-[10px] font-black uppercase ring-1', statusTone(row.status))}>{row.status}</span>
                  </div>
                  <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs font-bold text-[var(--ink-4)]">
                    <span>Qty <b className="block text-lg text-[var(--ink)]">{row.quantity}</b></span>
                    <span>Ordered <b className="block text-lg text-amber-700">{row.orderedQuantity}</b></span>
                    <span>Received <b className="block text-lg text-emerald-700">{row.receivedQuantity}</b></span>
                    <span>Vendor <b className="block truncate text-[var(--ink)]">{row.vendorName || row.brand || 'Assign'}</b></span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="border-t border-[var(--line)] bg-[var(--bg-soft)] p-5">
            <div className="grid gap-3 md:grid-cols-[1fr_12rem]">
              <select
                value={vendorId}
                onChange={(event) => {
                  setVendorId(event.target.value);
                  setVendorName(vendors.find((vendor) => vendor.id === event.target.value)?.name || '');
                }}
                className="h-11 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--ink)] shadow-sm-soft outline-none focus:border-[var(--brand-400)]"
              >
                <option value="">Select vendor from master</option>
                {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
              </select>
              <Input type="date" value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} />
            </div>
            <textarea value={poNotes} onChange={(event) => setPoNotes(event.target.value)} placeholder="PO note / vendor follow-up detail" className="mt-3 min-h-[72px] w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--ink)] outline-none focus:border-[var(--brand-400)]" />
            {selectedRows.length ? <div className="mt-3 space-y-2">{selectedRows.map((row) => <label key={row.id} className="grid items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface)] p-3 text-xs font-bold text-[var(--ink-3)] sm:grid-cols-[1fr_10rem]"><span className="truncate">{row.sku} · {row.name} · {row.quantity} {row.unit || 'PC'}</span><Input aria-label={`Optional unit cost for ${row.sku}`} type="number" min={0} step="0.01" value={demandCostRows[row.id] || ''} onChange={(event) => setDemandCostRows((current) => ({ ...current, [row.id]: event.target.value }))} placeholder="Optional cost" /></label>)}</div> : null}
            <div className="mt-3 grid gap-3 rounded-md border border-[var(--line)] bg-[var(--surface)] p-3 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-4)]">PO discount % (optional)</span>
                <Input type="number" min={0} max={100} step="0.01" value={poDiscountPercent} onChange={(event) => setPoDiscountPercent(event.target.value)} placeholder="0" />
              </label>
              <label className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-4)]">GST % (optional)</span>
                <Input type="number" min={0} max={100} step="0.01" value={poTaxRate} onChange={(event) => setPoTaxRate(event.target.value)} placeholder="0 = no GST" />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs font-bold text-[var(--ink-4)]">
                <p className="uppercase tracking-wider">{selectedIds.length} row(s) selected</p>
                <p className="mt-1 font-semibold normal-case tracking-normal">
                  Subtotal {moneyExact(demandEstimate.subtotal)}
                  {demandEstimate.discountAmount > 0 ? ` · Disc −${moneyExact(demandEstimate.discountAmount)}` : ''}
                  {demandEstimate.taxAmount > 0 ? ` · GST ${moneyExact(demandEstimate.taxAmount)}` : ''}
                  {' · '}<span className="text-[var(--ink)]">Order {moneyExact(demandEstimate.grandTotal)}</span>
                </p>
              </div>
              <Button onClick={submitPo} disabled={!selectedDemandCostsValid || creatingPo}><Send className="mr-2 h-4 w-4" /> Create vendor PO</Button>
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="mp-panel p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">GRN receive</p>
                <h2 className="mt-2 text-2xl font-black text-[var(--ink)]">Receive against purchase order</h2>
              </div>
              <Button asChild variant="secondary"><Link href="/dashboard/inventory/inwards"><PackageCheck className="mr-2 h-4 w-4" /> Full GRN page</Link></Button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <select value={activePo?.id || ''} onChange={(event) => setActivePoId(event.target.value)} className="h-11 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--ink)]">
                {purchaseOrders.map((po) => <option key={po.id} value={po.id}>{po.poNumber} · {po.vendorName} · {po.status}</option>)}
              </select>
              <Input value={supplierChallan} onChange={(event) => setSupplierChallan(event.target.value)} placeholder="Supplier challan no." />
              <Input value={supplierBill} onChange={(event) => setSupplierBill(event.target.value)} placeholder="Supplier bill no." />
              <select value={receiveLocation?.id || ''} onChange={(event) => setReceiveLocationId(event.target.value)} className="h-11 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--ink)]">
                {locations.map((location) => <option key={location.id} value={location.id}>{location.defaultStockScope ? 'Default · ' : ''}{location.code} · {location.name}</option>)}
              </select>
              <Button onClick={submitReceive} disabled={!activePo || receivingPo}><Truck className="mr-2 h-4 w-4" /> Post GRN</Button>
            </div>

            <div className="mt-4 space-y-2">
              {!activePo ? <div className="rounded-r4 border border-dashed border-[var(--line)] p-6 text-center text-sm font-bold text-[var(--ink-4)]">No purchase order selected.</div> : (activePo.lines || []).map((line: any) => {
                const remaining = Math.max(0, Number(line.orderedQuantity || 0) - Number(line.receivedQuantity || 0));
                return (
                  <div key={line.id} className="rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-[var(--ink)]">{line.sku} · {line.name}</p>
                        <p className="mt-1 text-xs font-bold uppercase tracking-wider text-[var(--ink-4)]">Ordered {line.orderedQuantity} · Received {line.receivedQuantity} · Remaining {remaining}</p>
                      </div>
                      <div className="grid w-44 grid-cols-2 gap-2"><label className="text-[10px] font-bold uppercase text-[var(--ink-4)]">Received<Input type="number" min={0} max={remaining} value={receiveRows[line.id] ?? String(remaining)} onChange={(event) => setReceiveRows((current) => ({ ...current, [line.id]: event.target.value }))} className="mt-1 text-center font-black" /></label><label className="text-[10px] font-bold uppercase text-red-600">Damaged<Input type="number" min={0} max={Number(receiveRows[line.id] ?? remaining)} value={damagedRows[line.id] ?? '0'} onChange={(event) => setDamagedRows((current) => ({ ...current, [line.id]: event.target.value }))} className="mt-1 text-center font-black" /></label></div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2"><Input value={batchRows[line.id] || ''} onChange={(event) => setBatchRows((current) => ({ ...current, [line.id]: event.target.value }))} placeholder="Supplier batch / lot"/><div><Input aria-label={`Optional GRN cost for ${line.sku}`} type="number" min={0} value={costRows[line.id] ?? ''} onChange={(event) => setCostRows((current) => ({ ...current, [line.id]: event.target.value }))} placeholder="Actual cost (optional)"/><p className="mt-1 text-[10px] font-semibold text-[var(--ink-4)]">Fallback: {Number(line.unitCost || 0) > 0 ? `PO ${money(line.unitCost)}` : Number(line.skuCost || 0) > 0 ? `SKU ${money(line.skuCost)}` : 'not recorded'}</p></div></div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {purchaseOrders.slice(0, 6).map((po: any) => (
              <article key={po.id} className={cn('rounded-r4 border p-4 shadow-sm-soft transition', activePo?.id === po.id ? 'border-[var(--brand-400)] bg-[var(--brand-50)]' : 'border-[var(--line)] bg-[var(--surface)]')}>
                <a href={`/api/pdf/purchase-order/${po.id}`} target="_blank" rel="noreferrer" className="block text-left" title={`Open ${po.poNumber} PDF`}>
                  <ClipboardList className="h-5 w-5 text-[var(--brand-700)]" />
                  <p className="mt-3 text-sm font-black text-[var(--ink)]">{po.poNumber}</p>
                  <p className="mt-1 text-xs font-bold text-[var(--ink-4)]">{po.vendorName}</p>
                  <p className="mt-2 text-xs font-semibold text-[var(--ink-3)]">
                    {Number(po.grandTotal || 0) > 0
                      ? `Order value ${moneyExact(po.grandTotal)}`
                      : (po.lines || []).some((line: any) => Number(line.unitCost || 0) > 0)
                        ? `Known costs ${moneyExact((po.lines || []).reduce((sum: number, line: any) => sum + Number(line.orderedQuantity || 0) * Number(line.unitCost || 0), 0))}`
                        : 'Costs pending at GRN'}
                    {Number(po.discountAmount || 0) > 0 || Number(po.taxAmount || 0) > 0
                      ? ` · ${Number(po.discountPercent || 0) > 0 ? `Disc ${po.discountPercent}%` : ''}${Number(po.discountPercent || 0) > 0 && Number(po.taxRate || 0) > 0 ? ' · ' : ''}${Number(po.taxRate || 0) > 0 ? `GST ${po.taxRate}%` : ''}`
                      : ''}
                  </p>
                  <span className={cn('mt-3 inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase ring-1', statusTone(po.status))}>{po.status}</span>
                </a>
                <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--line)] pt-3">
                  <a href={`/api/pdf/purchase-order/${po.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center rounded border border-[var(--line)] px-2.5 py-1.5 text-xs font-bold text-[var(--ink)]"><ExternalLink className="mr-1.5 h-3.5 w-3.5" />Open PO</a>
                  <a href={`/api/pdf/purchase-order/${po.id}?download=1`} className="inline-flex items-center rounded border border-[var(--line)] px-2.5 py-1.5 text-xs font-bold text-[var(--ink)]"><Download className="mr-1.5 h-3.5 w-3.5" />PDF</a>
                  {canDeletePo ? (
                    <button type="button" disabled={deletingPo} onClick={() => confirmDeletePo(po)} className="inline-flex items-center rounded border border-red-200 px-2.5 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50" title="Permanently delete PO (Admin/Owner)">
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />Delete
                    </button>
                  ) : null}
                  <button type="button" onClick={() => setActivePoId(po.id)} className="ml-auto text-xs font-bold text-[var(--brand-700)]">Receive</button>
                </div>
              </article>
            ))}
          </div>

          <div className="mp-panel p-5">
            <div className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-[var(--brand-700)]" /><h3 className="font-black text-[var(--ink)]">Recent GRNs</h3></div>
            <div className="mt-3 space-y-2">
              {grns.map((grn: any) => (
                <div key={grn.id} className="flex items-center justify-between rounded-r4 border border-[var(--line)] bg-[var(--surface)] p-3 text-sm">
                  <div><p className="font-black text-[var(--ink)]">{grn.grnNumber}</p><p className="text-xs font-bold text-[var(--ink-4)]">{grn.vendorName}</p></div>
                  <span className="text-xs font-bold text-emerald-700">{grn.lines?.reduce((sum: number, line: any) => sum + Number(line.acceptedQuantity || 0), 0)} accepted</span>
                </div>
              ))}
              {!grns.length ? <p className="rounded-r4 border border-dashed border-[var(--line)] p-4 text-center text-sm font-bold text-[var(--ink-4)]">No GRN posted yet.</p> : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
