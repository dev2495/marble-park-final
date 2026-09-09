"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { gql, useMutation, useQuery } from "@apollo/client";
import {
  Camera,
  Bookmark,
  Check,
  ChevronDown,
  ClipboardList,
  Download,
  ExternalLink,
  Package,
  PackageCheck,
  PackageSearch,
  Search,
  SlidersHorizontal,
  Send,
  Truck,
  UserCheck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QueryErrorBanner } from "@/components/query-state";

const DATA = gql`
  query DispatchWorkbench($search: String, $status: String, $brand: String, $category: String, $locationId: String, $sort: String, $cursor: String, $take: Float) {
    dispatchQueue
    pickLists(take: 120)
    stockLocations(status: "active")
    productCategories
    productBrands
    reservedDispatchLines(search: $search, status: $status, brand: $brand, category: $category, locationId: $locationId, sort: $sort, cursor: $cursor, take: $take)
  }
`;
const CREATE_PICK = gql`
  mutation CreatePick($input: CreatePickListInput!) {
    createPickList(input: $input)
  }
`;
const TRANSITION_PICK = gql`
  mutation TransitionPick(
    $id: ID!
    $action: String!
    $input: PickListTransitionInput
  ) {
    transitionPickList(id: $id, action: $action, input: $input)
  }
`;
const CREATE_CHALLAN = gql`
  mutation CreateChallan($input: CreateChallanInput!) {
    createChallan(input: $input) {
      id
      status
      challanNumber
    }
  }
`;
const UPDATE_CHALLAN = gql`
  mutation UpdateChallan($id: ID!, $status: String!) {
    updateChallanStatus(id: $id, status: $status) {
      id
      status
    }
  }
`;
const CONFIRM_DELIVERY = gql`
  mutation ConfirmDelivery($id: ID!, $input: ConfirmDeliveryInput!) {
    confirmDelivery(id: $id, input: $input)
  }
`;

const stages = [
  "ready",
  "picking",
  "picked",
  "packed",
  "completed",
  "challan_created",
  "dispatched",
];

export default function DispatchPage() {
  const [registerSearch, setRegisterSearch] = useState("");
  useEffect(() => { setRegisterSearch(new URLSearchParams(window.location.search).get('search') || ''); }, []);
  const [registerStatus, setRegisterStatus] = useState("");
  const [registerBrand, setRegisterBrand] = useState("");
  const [registerCategory, setRegisterCategory] = useState("");
  const [registerLocation, setRegisterLocation] = useState("");
  const [registerSort, setRegisterSort] = useState("inward_first");
  const [expandedLine, setExpandedLine] = useState<Record<string, boolean>>({});
  const [registerCursor, setRegisterCursor] = useState("");
  const deferredRegisterSearch = useDeferredValue(registerSearch);
  const [locationByJob, setLocationByJob] = useState<Record<string, string>>(
    {},
  );
  const [packQty, setPackQty] = useState<Record<string, number>>({});
  const [deliveryId, setDeliveryId] = useState("");
  const [delivery, setDelivery] = useState({
    receivedByName: "",
    receivedByPhone: "",
    proofType: "manual",
    proofUrl: "",
    notes: "",
  });
  const [uploadingProof, setUploadingProof] = useState(false);
  const { data, error, refetch } = useQuery(DATA, {
    variables: {
      search: deferredRegisterSearch || undefined,
      status: registerStatus || undefined,
      brand: registerBrand || undefined,
      category: registerCategory || undefined,
      locationId: registerLocation || undefined,
      sort: registerSort,
      cursor: registerCursor || undefined,
      take: 24,
    },
    pollInterval: 120000,
    skipPollAttempt: () => typeof document !== "undefined" && document.hidden,
    fetchPolicy: "cache-and-network",
  });
  const [createPick, createPickState] = useMutation(CREATE_PICK, {
    onCompleted: () => refetch(),
  });
  const [transitionPick, pickState] = useMutation(TRANSITION_PICK, {
    onCompleted: () => refetch(),
  });
  const [createChallan, challanState] = useMutation(CREATE_CHALLAN, {
    onCompleted: () => refetch(),
  });
  const [updateChallan, updateState] = useMutation(UPDATE_CHALLAN, {
    onCompleted: () => refetch(),
  });
  const [confirmDelivery, deliveryState] = useMutation(CONFIRM_DELIVERY, {
    onCompleted: () => {
      setDeliveryId("");
      setDelivery({
        receivedByName: "",
        receivedByPhone: "",
        proofType: "manual",
        proofUrl: "",
        notes: "",
      });
      refetch();
    },
  });
  const jobs = useMemo<any[]>(
    () => data?.dispatchQueue || [],
    [data?.dispatchQueue],
  );
  const picks = data?.pickLists || [];
  const reservedRegister = data?.reservedDispatchLines || { items: [], summary: {}, total: 0 };
  const reservedRows = reservedRegister.items || [];
  const locations = (data?.stockLocations || []).filter(
    (row: any) => row.code !== "IN-TRANSIT",
  );
  const registerBrands: string[] = [...(data?.productBrands || [])].filter(Boolean).sort();
  const registerCategories: string[] = [...(data?.productCategories || [])].filter(Boolean).sort();
  const defaultLocation =
    locations.find((row: any) => row.defaultStockScope)?.id ||
    locations[0]?.id ||
    "";
  const activeJobs = useMemo(
    () =>
      jobs.filter(
        (job: any) =>
          job.status !== "delivered" ||
          job.lines?.some((line: any) => Number(line.remainingQty) > 0),
      ),
    [jobs],
  );
  const busy =
    createPickState.loading ||
    pickState.loading ||
    challanState.loading ||
    updateState.loading ||
    deliveryState.loading;
  useEffect(() => {
    const saved = localStorage.getItem('mp.dispatch.view'); if (!saved) return;
    try { const view = JSON.parse(saved); setRegisterStatus(view.status || ''); setRegisterBrand(view.brand || ''); setRegisterCategory(view.category || ''); setRegisterLocation(view.locationId || ''); setRegisterSort(view.sort || 'inward_first'); } catch { localStorage.removeItem('mp.dispatch.view'); }
  }, []);
  const saveRegisterView = () => localStorage.setItem('mp.dispatch.view', JSON.stringify({ status: registerStatus, brand: registerBrand, category: registerCategory, locationId: registerLocation, sort: registerSort }));
  const exportRegister = () => {
    const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const csv = [['Order','Customer','SKU','Item','State','Ordered','Reserved','Backordered','Dispatched','Left'], ...reservedRows.map((row: any) => [row.order?.orderNumber,row.customer?.name,row.sku,row.name,row.status,row.orderedQuantity,row.reservedQuantity,row.backorderedQuantity,row.dispatchedQuantity,row.leftToDispatch])].map((line) => line.map(quote).join(',')).join('\n');
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = 'marble-park-dispatch-view.csv'; link.click(); URL.revokeObjectURL(link.href);
  };
  const uploadProof = async (file?: File) => {
    if (!file) return;
    setUploadingProof(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("scope", "delivery-proof");
      const response = await fetch("/api/upload", {
        method: "POST",
        body: form,
      });
      const json = await response.json();
      if (!response.ok || !json.publicUrl)
        throw new Error(json.error || "Proof upload failed");
      setDelivery((current) => ({ ...current, proofUrl: json.publicUrl }));
    } finally {
      setUploadingProof(false);
    }
  };

  function pickFor(job: any) {
    return picks.find(
      (pick: any) =>
        pick.salesOrderId === job.salesOrderId &&
        !["cancelled", "dispatched"].includes(pick.status),
    );
  }

  async function actPick(pick: any, action: string) {
    let input: any = undefined;
    if (action === "pick")
      input = {
        lines: JSON.stringify(
          pick.lines.map((line: any) => ({
            pickLineId: line.id,
            pickedQuantity: line.requestedQuantity,
          })),
        ),
      };
    if (action === "pack")
      input = {
        lines: JSON.stringify(
          pick.lines.map((line: any) => ({
            pickLineId: line.id,
            packedQuantity: Number(packQty[line.id] ?? line.requestedQuantity),
          })),
        ),
      };
    await transitionPick({ variables: { id: pick.id, action, input } });
  }

  return (
    <div className="space-y-5 pb-10">
      {[
        error,
        createPickState.error,
        pickState.error,
        challanState.error,
        updateState.error,
        deliveryState.error,
      ]
        .filter(Boolean)
        .map((item: any, index) => (
          <QueryErrorBanner key={index} error={item} />
        ))}
      <header className="flex flex-col justify-between gap-4 border-b border-[var(--line)] pb-5 pt-2 lg:flex-row lg:items-end">
        <div>
          <p className="text-xs font-semibold uppercase text-[var(--ink-4)]">
            Warehouse fulfilment
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold text-[var(--ink)]">
            Pick, pack and partial dispatch
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-3)]">
            Each batch starts from reserved stock and names the exact inward lot
            and location. Pack less than requested to dispatch a partial batch;
            the balance stays reserved for the next pick.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/dashboard/pending-inward">
              <PackageSearch className="mr-2 h-4 w-4" />
              Pending inward
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard/inventory/labels">
              <Package className="mr-2 h-4 w-4" />
              Scan labels
            </Link>
          </Button>
        </div>
      </header>
      <section className="mp-panel overflow-hidden">
        <div className="flex flex-col justify-between gap-4 border-b border-[var(--line)] p-5 xl:flex-row xl:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--brand-700)]">Reserved dispatch register</p>
            <h2 className="mt-1 text-2xl font-bold text-[var(--ink)]">What is ready, blocked or still owed</h2>
            <p className="mt-1 max-w-3xl text-sm font-semibold leading-6 text-[var(--ink-4)]">This register is line-level and paginated. It reconciles each sales-order line to its reservation, inward demand, pick and dispatch quantities.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-black uppercase tracking-wider text-[var(--ink-4)]">
            <span className="rounded-xl bg-emerald-50 px-3 py-2 text-emerald-800">Ready {reservedRegister.summary?.readyToPick || 0}</span>
            <span className="rounded-xl bg-amber-50 px-3 py-2 text-amber-900">Inward {reservedRegister.summary?.pendingInward || 0}</span>
            <span className="rounded-xl bg-blue-50 px-3 py-2 text-blue-800">Left {reservedRegister.summary?.leftToDispatch || 0}</span>
          </div>
        </div>
        <div className="grid gap-2 border-b border-[var(--line)] bg-[var(--muted)] p-4 sm:grid-cols-2 xl:grid-cols-7">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search reserved dispatch lines</span>
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-5)]" />
            <Input value={registerSearch} onChange={(event) => { setRegisterSearch(event.target.value); setRegisterCursor(""); }} placeholder="Search order, customer, SKU or brand" className="h-10 rounded-xl bg-[var(--surface)] pl-10" />
          </label>
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-[var(--ink-5)]" />
            <select value={registerStatus} onChange={(event) => { setRegisterStatus(event.target.value); setRegisterCursor(""); }} aria-label="Filter reserved dispatch status" className="h-10 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--ink)]">
              <option value="">All line states</option>
              <option value="ready_to_pick">Ready to pick</option>
              <option value="pending_inward">Pending inward</option>
              <option value="partial_dispatch">Partially dispatched</option>
              <option value="needs_reservation">Needs reservation</option>
              <option value="dispatched">Dispatched</option>
              <option value="delivered">Delivered</option>
            </select>
          </div>
          <select value={registerBrand} onChange={(event) => { setRegisterBrand(event.target.value); setRegisterCursor(''); }} aria-label="Filter dispatch by brand" className="h-10 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-bold"><option value="">All brands</option>{registerBrands.map((value) => <option key={value}>{value}</option>)}</select>
          <select value={registerCategory} onChange={(event) => { setRegisterCategory(event.target.value); setRegisterCursor(''); }} aria-label="Filter dispatch by category" className="h-10 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-bold"><option value="">All categories</option>{registerCategories.map((value) => <option key={value}>{value}</option>)}</select>
          <select value={registerLocation} onChange={(event) => { setRegisterLocation(event.target.value); setRegisterCursor(''); }} aria-label="Filter dispatch by location" className="h-10 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-bold"><option value="">All locations</option>{locations.map((row: any) => <option key={row.id} value={row.id}>{row.name || row.code}</option>)}</select>
          <select value={registerSort} onChange={(event) => { setRegisterSort(event.target.value); setRegisterCursor(''); }} aria-label="Sort dispatch lines" className="h-10 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-bold"><option value="inward_first">Exceptions first</option><option value="oldest">Oldest first</option><option value="newest">Newest first</option><option value="quantity_desc">Quantity high-low</option></select>
          <button type="button" onClick={saveRegisterView} className="inline-flex h-10 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface)] text-xs font-black uppercase"><Bookmark className="mr-2 h-4 w-4" />Save view</button>
          <button type="button" onClick={exportRegister} className="inline-flex h-10 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface)] text-xs font-black uppercase"><Download className="mr-2 h-4 w-4" />CSV</button>
        </div>
        <div className="divide-y divide-[var(--line)]">
          {reservedRows.length ? reservedRows.map((row: any) => <article key={row.id} className="p-4 lg:p-5"><div className="grid gap-4 lg:grid-cols-[1fr_1.3fr_1fr_1.2fr_auto] lg:items-center"><div><p className="font-black text-[var(--ink)]">{row.order?.orderNumber || row.salesOrderId}</p><p className="text-xs font-semibold text-[var(--ink-4)]">{row.customer?.name || 'Customer'}{row.customer?.city ? ` · ${row.customer.city}` : ''}</p></div><div><p className="truncate font-bold text-[var(--ink)]">{row.name}</p><p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">{row.sku} · {row.brand || 'Unbranded'}</p></div><div className="grid grid-cols-3 gap-2 text-center"><div><p className="font-black">{row.orderedQuantity}</p><p className="text-[9px] font-black uppercase text-[var(--ink-5)]">Ordered</p></div><div><p className="font-black text-blue-700">{row.reservedQuantity}</p><p className="text-[9px] font-black uppercase text-[var(--ink-5)]">Reserved</p></div><div><p className="font-black text-amber-800">{row.leftToDispatch}</p><p className="text-[9px] font-black uppercase text-[var(--ink-5)]">Left</p></div></div><div><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${row.status === 'ready_to_pick' ? 'bg-emerald-50 text-emerald-800' : row.status === 'pending_inward' ? 'bg-amber-50 text-amber-900' : 'bg-[var(--muted)] text-[var(--ink-3)]'}`}>{String(row.nextAction || row.status).replaceAll('_', ' ')}</span></div><div className="flex gap-2"><Button asChild size="sm"><Link href={row.nextActionHref || '/dashboard/dispatch'}><ExternalLink className="mr-2 h-3.5 w-3.5" />Act</Link></Button><button type="button" aria-expanded={Boolean(expandedLine[row.id])} onClick={() => setExpandedLine((current) => ({ ...current, [row.id]: !current[row.id] }))} className="rounded-lg border border-[var(--line)] px-2"><ChevronDown className={`h-4 w-4 ${expandedLine[row.id] ? 'rotate-180' : ''}`} /></button></div></div>{expandedLine[row.id] ? <div className="mt-4 grid gap-3 border-t border-[var(--line)] pt-4 md:grid-cols-3"><div><p className="text-[10px] font-black uppercase text-[var(--ink-5)]">Lot reservations</p>{(row.lotAllocations || []).map((lot: any) => <p key={lot.id} className="mt-1 text-xs font-bold">{lot.lot?.lotNumber || lot.lotId} · {lot.location?.name || lot.locationId} · {lot.quantity}</p>)}</div><div><p className="text-[10px] font-black uppercase text-[var(--ink-5)]">Open picks</p><p className="mt-1 text-xs font-bold">{(row.openPickLines || []).length} active pick line(s)</p></div><div><p className="text-[10px] font-black uppercase text-[var(--ink-5)]">Dispatch history</p><p className="mt-1 text-xs font-bold">{(row.dispatchLines || []).length} dispatch line(s) · {row.dispatchedQuantity} sent</p></div></div> : null}</article>) : <div className="px-5 py-12 text-center text-sm font-semibold text-[var(--ink-4)]">No reserved or outstanding lines match this view.</div>}
        </div>
        {reservedRegister.nextCursor ? <div className="border-t border-[var(--line)] p-3 text-center"><button type="button" onClick={() => setRegisterCursor(reservedRegister.nextCursor)} className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-xs font-black uppercase tracking-wider text-[var(--brand-700)]">Load more lines</button></div> : null}
      </section>
      <div className="grid gap-4 xl:grid-cols-2">
        {activeJobs.map((job: any) => {
          const pick = pickFor(job);
          const locationId = locationByJob[job.id] || defaultLocation;
          const remaining =
            job.lines?.filter((line: any) => Number(line.remainingQty) > 0) ||
            [];
          const ready = remaining.filter(
            (line: any) => line.status === "ready",
          );
          const pending = remaining.filter(
            (line: any) => line.status === "pending_inward",
          );
          return (
            <article key={job.id} className="mp-panel overflow-hidden">
              <div className="flex flex-col justify-between gap-3 border-b border-[var(--line)] p-4 sm:flex-row sm:items-start">
                <div>
                  <p className="text-xs font-semibold text-[var(--ink-4)]">
                    {job.salesOrder?.orderNumber || job.quote?.quoteNumber}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-[var(--ink)]">
                    {job.customer?.name || "Customer"}
                  </h2>
                  <p className="mt-1 text-xs text-[var(--ink-4)]">
                    {job.siteAddress || "Delivery address pending"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <span className="rounded bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                    {ready.length} ready
                  </span>
                  {pending.length ? (
                    <span className="rounded bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
                      {pending.length} inward pending
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="border-b border-[var(--line)] p-4">
                <div className="flex items-center gap-1 overflow-x-auto pb-1">
                  {stages.slice(0, 6).map((stage, index) => {
                    const current = pick ? stages.indexOf(pick.status) : -1;
                    return (
                      <div key={stage} className="flex min-w-fit items-center">
                        <span
                          className={`grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold ${current >= index ? "bg-[var(--brand-700)] text-white" : "bg-[var(--bg-soft)] text-[var(--ink-4)]"}`}
                        >
                          {index + 1}
                        </span>
                        <span
                          className={`ml-1 text-[10px] font-semibold ${current >= index ? "text-[var(--ink)]" : "text-[var(--ink-5)]"}`}
                        >
                          {stage.replace("_", " ")}
                        </span>
                        {index < 5 ? (
                          <span className="mx-2 h-px w-4 bg-[var(--line)]" />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="p-4">
                {!pick ? (
                  <div className="space-y-3">
                    <div className="divide-y divide-[var(--line)] rounded-md border border-[var(--line)]">
                      {remaining.map((line: any) => (
                        <div
                          key={line.lineKey || line.productId}
                          className="flex items-center justify-between gap-3 p-3 text-sm"
                        >
                          <div>
                            <p className="font-semibold text-[var(--ink)]">
                              {line.name}
                            </p>
                            <p className="text-xs text-[var(--ink-4)]">
                              Ordered {line.orderedQty} · remaining{" "}
                              {line.remainingQty}
                            </p>
                          </div>
                          <span
                            className={
                              line.status === "ready"
                                ? "text-xs font-semibold text-emerald-700"
                                : "text-xs font-semibold text-amber-700"
                            }
                          >
                            {line.status.replace("_", " ")}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <select
                        value={locationId}
                        onChange={(event) =>
                          setLocationByJob({
                            ...locationByJob,
                            [job.id]: event.target.value,
                          })
                        }
                        className="h-10 flex-1 rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-3 text-sm"
                      >
                        {locations.map((location: any) => (
                          <option key={location.id} value={location.id}>
                            {location.code} · {location.name}
                          </option>
                        ))}
                      </select>
                      <Button
                        disabled={busy || !ready.length || !job.salesOrderId}
                        onClick={() =>
                          createPick({
                            variables: {
                              input: {
                                salesOrderId: job.salesOrderId,
                                locationId,
                              },
                            },
                          })
                        }
                      >
                        <ClipboardList className="mr-2 h-4 w-4" />
                        Create pick list
                      </Button>
                    </div>
                    {pending.length ? (
                      <p className="text-xs text-amber-700">
                        Pending-inward lines remain outside this pick list and
                        will become available after PO/GRN receipt.
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div>
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                      <div>
                        <p className="font-semibold text-[var(--ink)]">
                          {pick.pickNumber}
                        </p>
                        <p className="text-xs text-[var(--ink-4)]">
                          {pick.location?.code} ·{" "}
                          {pick.status.replace("_", " ")}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {pick.status === "ready" ? (
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => actPick(pick, "start")}
                          >
                            <Send className="mr-2 h-4 w-4" />
                            Start
                          </Button>
                        ) : null}
                        {pick.status === "picking" ? (
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => actPick(pick, "pick")}
                          >
                            <Check className="mr-2 h-4 w-4" />
                            Confirm picked
                          </Button>
                        ) : null}
                        {pick.status === "picked" ? (
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => actPick(pick, "pack")}
                          >
                            <PackageCheck className="mr-2 h-4 w-4" />
                            Pack quantities
                          </Button>
                        ) : null}
                        {["packed", "partial_packed"].includes(pick.status) ? (
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => actPick(pick, "complete")}
                          >
                            <Check className="mr-2 h-4 w-4" />
                            Complete batch
                          </Button>
                        ) : null}
                        {pick.status === "completed" ? (
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              createChallan({
                                variables: {
                                  input: {
                                    jobId: job.id,
                                    pickListId: pick.id,
                                    transporter: "Store vehicle",
                                    vehicleNo: "PENDING",
                                    driverName: "Dispatch desk",
                                    driverPhone:
                                      job.customer?.mobile || "0000000000",
                                    packages: 1,
                                  },
                                },
                              })
                            }
                          >
                            <Package className="mr-2 h-4 w-4" />
                            Create challan
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-3 divide-y divide-[var(--line)] rounded-md border border-[var(--line)]">
                      {pick.lines.map((line: any) => (
                        <div
                          key={line.id}
                          className="grid gap-2 p-3 text-sm sm:grid-cols-[1fr_auto_auto] sm:items-center"
                        >
                          <div>
                            <p className="font-semibold text-[var(--ink)]">
                              {line.product?.internalCode || line.product?.sku}{" "}
                              · {line.lot?.lotNumber}
                            </p>
                            <p className="text-xs text-[var(--ink-4)]">
                              Requested {line.requestedQuantity} · picked{" "}
                              {line.pickedQuantity} · packed{" "}
                              {line.packedQuantity}
                            </p>
                          </div>
                          {pick.status === "picked" ? (
                            <label className="flex items-center gap-2 text-xs text-[var(--ink-4)]">
                              Pack
                              <Input
                                className="h-9 w-20"
                                type="number"
                                min={0}
                                max={line.pickedQuantity}
                                value={packQty[line.id] ?? line.pickedQuantity}
                                onChange={(event) =>
                                  setPackQty({
                                    ...packQty,
                                    [line.id]: Number(event.target.value),
                                  })
                                }
                              />
                            </label>
                          ) : (
                            <span className="text-xs text-[var(--ink-4)]">
                              {line.status}
                            </span>
                          )}
                          <span className="text-xs text-[var(--ink-4)]">
                            {line.location?.code}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {job.challans?.length ? (
                <div className="border-t border-[var(--line)] bg-[var(--bg-soft)] p-3">
                  {job.challans.map((challan: any) => (
                    <div
                      key={challan.id}
                      className="border-b border-[var(--line)] py-2 last:border-0"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[var(--ink)]">
                          {challan.challanNumber} · {challan.status}
                        </span>
                        <div className="flex flex-wrap gap-2">
                        <Button asChild size="sm" variant="outline"><a href={`/api/pdf/dispatch/${challan.id}`} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4" />Open slip</a></Button>
                        <Button asChild size="sm" variant="ghost"><a href={`/api/pdf/dispatch/${challan.id}`} download><Download className="mr-2 h-4 w-4" />PDF</a></Button>
                        {challan.status === "pending" ? (
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              updateChallan({
                                variables: {
                                  id: challan.id,
                                  status: "dispatched",
                                },
                              })
                            }
                          >
                            <Truck className="mr-2 h-4 w-4" />
                            Dispatch
                          </Button>
                        ) : challan.status === "dispatched" ? (
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              setDeliveryId(
                                deliveryId === challan.id ? "" : challan.id,
                              )
                            }
                          >
                            <UserCheck className="mr-2 h-4 w-4" />
                            Confirm delivery
                          </Button>
                        ) : (
                          <span className="text-xs font-semibold text-emerald-700">
                            Delivered
                          </span>
                        )}
                        </div>
                      </div>
                      {deliveryId === challan.id ? (
                        <div className="mt-3 rounded-md border border-[var(--line)] bg-[var(--surface)] p-3">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold text-[var(--ink)]">
                              Recipient proof
                            </p>
                            <button
                              title="Close delivery form"
                              onClick={() => setDeliveryId("")}
                              className="grid h-8 w-8 place-items-center rounded-md text-[var(--ink-4)] hover:bg-[var(--bg-soft)]"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            <Input
                              value={delivery.receivedByName}
                              onChange={(event) =>
                                setDelivery({
                                  ...delivery,
                                  receivedByName: event.target.value,
                                })
                              }
                              placeholder="Recipient name"
                            />
                            <Input
                              value={delivery.receivedByPhone}
                              onChange={(event) =>
                                setDelivery({
                                  ...delivery,
                                  receivedByPhone: event.target.value,
                                })
                              }
                              placeholder="Recipient phone"
                            />
                            <select
                              value={delivery.proofType}
                              onChange={(event) =>
                                setDelivery({
                                  ...delivery,
                                  proofType: event.target.value,
                                })
                              }
                              className="h-10 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"
                            >
                              <option value="manual">
                                Recipient acknowledgement
                              </option>
                              <option value="otp">OTP verified</option>
                              <option value="photo">Delivery photo</option>
                              <option value="signature">Signature image</option>
                            </select>
                            {["photo", "signature"].includes(
                              delivery.proofType,
                            ) ? (
                              <label className="flex h-10 cursor-pointer items-center rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--ink-3)]">
                                <Camera className="mr-2 h-4 w-4" />
                                {uploadingProof
                                  ? "Uploading proof..."
                                  : delivery.proofUrl
                                    ? "Proof uploaded"
                                    : "Capture or choose image"}
                                <input
                                  className="sr-only"
                                  type="file"
                                  accept="image/jpeg,image/png,image/webp"
                                  capture="environment"
                                  disabled={uploadingProof}
                                  onChange={(event) =>
                                    uploadProof(event.target.files?.[0])
                                  }
                                />
                              </label>
                            ) : (
                              <Input
                                value={delivery.notes}
                                onChange={(event) =>
                                  setDelivery({
                                    ...delivery,
                                    notes: event.target.value,
                                  })
                                }
                                placeholder="Delivery note"
                              />
                            )}
                          </div>
                          <div className="mt-3 flex justify-end">
                            <Button
                              size="sm"
                              disabled={
                                busy ||
                                uploadingProof ||
                                !delivery.receivedByName.trim() ||
                                (["photo", "signature"].includes(
                                  delivery.proofType,
                                ) &&
                                  !delivery.proofUrl.trim())
                              }
                              onClick={() =>
                                confirmDelivery({
                                  variables: {
                                    id: challan.id,
                                    input: delivery,
                                  },
                                })
                              }
                            >
                              <Check className="mr-2 h-4 w-4" />
                              Record proof and deliver
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </article>
          );
        })}
        {!activeJobs.length ? (
          <div className="mp-panel col-span-full grid min-h-64 place-items-center text-center">
            <div>
              <PackageCheck className="mx-auto h-8 w-8 text-emerald-700" />
              <p className="mt-3 font-semibold text-[var(--ink)]">
                No open fulfilment work
              </p>
              <p className="mt-1 text-sm text-[var(--ink-4)]">
                Converted sales orders will appear here.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
