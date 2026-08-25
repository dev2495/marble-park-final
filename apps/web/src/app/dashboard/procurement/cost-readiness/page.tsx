"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { gql, useMutation, useQuery } from "@apollo/client";
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, CircleDollarSign, Search, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { QueryErrorBanner } from "@/components/query-state";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

const DATA = gql`
  query PurchaseOrderCostReadiness($search: String, $skip: Int) {
    purchaseOrderCostReadinessPage(search: $search, skip: $skip, take: 20)
    me { id role }
  }
`;

const COMPLETE = gql`
  mutation CompletePurchaseOrderCosts($input: CompletePurchaseOrderCostsInput!) {
    completePurchaseOrderCosts(input: $input)
  }
`;

function money(value: unknown) {
  return `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export default function PurchaseOrderCostReadinessPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [rates, setRates] = useState<Record<string, { enteredUnitCost: string; rateUom: string }>>({});
  const [reason, setReason] = useState("Complete supplier rates before first receipt");
  const [notice, setNotice] = useState("");
  const debounced = useDebouncedValue(search, 250);
  const { data, loading, error, refetch } = useQuery(DATA, {
    variables: { search: debounced || undefined, skip: page * 20 },
    fetchPolicy: "cache-and-network",
  });
  const [complete, completeState] = useMutation(COMPLETE);
  const items = useMemo(
    () => data?.purchaseOrderCostReadinessPage?.items || [],
    [data?.purchaseOrderCostReadinessPage?.items],
  );
  const selected = useMemo(
    () => items.find((order: any) => order.id === selectedId) || items[0] || null,
    [items, selectedId],
  );

  useEffect(() => {
    if (!selected) return;
    setSelectedId(selected.id);
    setRates(Object.fromEntries((selected.missingLines || []).map((line: any) => [line.id, {
      enteredUnitCost: "",
      rateUom: line.product?.purchaseUom || line.product?.baseUom || line.rateUom || line.unit || "PC",
    }])));
    setNotice("");
  }, [selected]);

  const ready = useMemo(() => {
    if (!selected || Number(selected.blockedReceivedLineCount || 0) > 0) return false;
    return (selected.missingLines || []).length > 0 && (selected.missingLines || []).every((line: any) => Number(rates[line.id]?.enteredUnitCost || 0) > 0 && rates[line.id]?.rateUom);
  }, [rates, selected]);

  async function submit() {
    if (!selected || !ready) return;
    const response = await complete({
      variables: {
        input: {
          purchaseOrderId: selected.id,
          reason: reason.trim(),
          lines: JSON.stringify((selected.missingLines || []).map((line: any) => ({
            purchaseOrderLineId: line.id,
            enteredUnitCost: Number(rates[line.id].enteredUnitCost),
            rateUom: rates[line.id].rateUom,
          }))),
        },
      },
    });
    setNotice(`${response.data?.completePurchaseOrderCosts?.poNumber || selected.poNumber} is rate-complete and ready for PO-linked GRN.`);
    setRates({});
    setSelectedId("");
    await refetch();
  }

  return (
    <div className="space-y-5 pb-10">
      {error ? <QueryErrorBanner error={error} /> : null}
      {completeState.error ? <QueryErrorBanner error={completeState.error} /> : null}
      <header className="overflow-hidden rounded-[1.4rem] bg-[linear-gradient(128deg,#251f1e_0%,#522925_55%,#a9332d_100%)] p-6 text-white shadow-[0_24px_70px_-38px_rgba(91,30,26,.8)] sm:p-8">
        <Button asChild variant="outline" size="sm" className="border-white/25 bg-white/10 text-white hover:bg-white/20">
          <Link href="/dashboard/procurement?view=orders"><ArrowLeft className="mr-2 h-4 w-4" />Procurement</Link>
        </Button>
        <div className="mt-5 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.2em] text-rose-100/80">Owner-only cost readiness</p>
            <h1 className="mt-2 font-display text-3xl font-bold sm:text-4xl">Complete legacy PO rates safely.</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-rose-50/75">No PO is deleted and no received lot is silently repriced. This queue only completes missing supplier rates before the first receipt, then locks the cost source to the PO.</p>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/10 px-5 py-4">
            <b className="text-3xl">{Number(data?.purchaseOrderCostReadinessPage?.total || 0).toLocaleString("en-IN")}</b>
            <p className="text-xs text-rose-100/75">open PO(s) need rates</p>
          </div>
        </div>
      </header>

      {notice ? <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800"><CheckCircle2 className="h-5 w-5" />{notice}</div> : null}

      <section className="grid gap-5 xl:grid-cols-[.9fr_1.5fr]">
        <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-sm">
          <div className="border-b border-[var(--line)] p-4">
            <label className="relative block">
              <Search className="absolute left-3 top-3 h-4 w-4 text-[var(--ink-4)]" />
              <Input className="pl-9" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Search PO, supplier, SKU or item" />
            </label>
          </div>
          <div className="divide-y divide-[var(--line)]">
            {items.map((order: any) => (
              <button key={order.id} type="button" onClick={() => setSelectedId(order.id)} className={`w-full p-4 text-left transition ${selected?.id === order.id ? "bg-[#fff0eb]" : "hover:bg-[var(--bg-soft)]"}`}>
                <div className="flex items-start justify-between gap-3">
                  <span><b className="block">{order.poNumber}</b><small className="text-[var(--ink-4)]">{order.vendorName}</small></span>
                  <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-800">{order.missingLineCount} line(s)</span>
                </div>
                <p className="mt-2 text-xs text-[var(--ink-4)]">Discount {Number(order.discountPercent || 0)}% · {Number(order.taxRate || 0) > 0 ? `GST ${Number(order.taxRate)}%` : "Without GST"}</p>
              </button>
            ))}
            {!loading && !items.length ? <div className="p-10 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" /><b className="mt-3 block">Every open PO has a complete rate</b><p className="mt-1 text-sm text-[var(--ink-4)]">Nothing needs remediation for these filters.</p></div> : null}
          </div>
          <div className="flex items-center justify-between border-t border-[var(--line)] p-3">
            <span className="text-xs text-[var(--ink-4)]">Page {page + 1}</span>
            <div className="flex gap-2"><Button size="icon" variant="outline" disabled={!page} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button><Button size="icon" variant="outline" disabled={!data?.purchaseOrderCostReadinessPage?.hasNext} onClick={() => setPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button></div>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
          {selected ? (
            <>
              <div className="flex flex-col justify-between gap-3 border-b border-[var(--line)] pb-4 sm:flex-row sm:items-start">
                <div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#a3312d]">Selected purchase order</p><h2 className="mt-1 text-xl font-bold">{selected.poNumber} · {selected.vendorName}</h2><p className="mt-1 text-xs text-[var(--ink-4)]">Header discount {Number(selected.discountPercent || 0)}% · {Number(selected.taxRate || 0) > 0 ? `GST ${Number(selected.taxRate)}%` : "Without GST"} · existing total {money(selected.grandTotal)}</p></div>
                <CircleDollarSign className="h-7 w-7 text-[#a3312d]" />
              </div>
              {Number(selected.blockedReceivedLineCount || 0) > 0 ? <div className="mt-4 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><p><b>Owner review required.</b> {selected.blockedReceivedLineCount} zero-cost line(s) were already received. This page will not rewrite historical lot valuation; use the audited cost-correction workflow.</p></div> : null}
              <div className="mt-4 space-y-3">
                {(selected.missingLines || []).map((line: any) => {
                  const uoms = Array.from(new Set([line.product?.purchaseUom, line.product?.baseUom, line.rateUom, line.unit].filter(Boolean)));
                  return <div key={line.id} className="grid gap-3 rounded-xl border border-[var(--line)] bg-[var(--bg-soft)]/45 p-4 md:grid-cols-[1fr_150px_150px] md:items-end">
                    <div><b className="text-sm">{line.product?.internalCode || line.sku} · {line.name}</b><p className="mt-1 text-xs text-[var(--ink-4)]">Ordered {line.orderedQuantity} {line.unit} · {Number(line.product?.piecesPerPack || 1)} {line.product?.baseUom || "PC"}/{line.product?.purchaseUom || line.rateUom || line.unit}</p></div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-4)]">Supplier rate ₹<Input className="mt-1" type="number" min="0.0001" step="0.01" disabled={Number(line.receivedQuantity || 0) > 0} value={rates[line.id]?.enteredUnitCost || ""} onChange={(event) => setRates({ ...rates, [line.id]: { ...(rates[line.id] || { rateUom: String(uoms[0] || "PC") }), enteredUnitCost: event.target.value } })} placeholder="Required" /></label>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-4)]">Rate UOM<SearchableSelect className="mt-1" disabled={Number(line.receivedQuantity || 0) > 0} value={rates[line.id]?.rateUom || String(uoms[0] || "PC")} onValueChange={(value) => setRates({ ...rates, [line.id]: { ...(rates[line.id] || { enteredUnitCost: "" }), rateUom: value } })} options={uoms.map((uom: any) => ({ value: String(uom), label: String(uom), description: String(uom) === String(line.product?.purchaseUom) && Number(line.product?.piecesPerPack || 1) > 1 ? `${line.product.piecesPerPack} ${line.product.baseUom || "PC"} per ${uom}` : "Base stock unit" }))} placeholder="UOM" searchPlaceholder="Search UOM" /></label>
                  </div>;
                })}
              </div>
              <label className="mt-4 block text-[10px] font-bold uppercase tracking-wider text-[var(--ink-4)]">Audit reason<Input className="mt-1" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
              <Button className="mt-4 w-full" disabled={!ready || reason.trim().length < 3 || completeState.loading} onClick={submit}><ShieldCheck className="mr-2 h-4 w-4" />{completeState.loading ? "Saving locked cost snapshot…" : "Complete rates and unlock PO receiving"}</Button>
              <p className="mt-3 text-xs leading-5 text-[var(--ink-4)]">Supplier rate is entered before GST. The PO discount is applied automatically; the resulting pre-tax net base-unit cost becomes the immutable GRN/lot snapshot.</p>
            </>
          ) : <div className="grid min-h-[28rem] place-items-center text-center"><div><CircleDollarSign className="mx-auto h-9 w-9 text-[var(--ink-4)]" /><b className="mt-3 block">Choose a legacy PO</b><p className="mt-1 text-sm text-[var(--ink-4)]">Its missing rate lines will load here.</p></div></div>}
        </div>
      </section>
    </div>
  );
}
