"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { gql, useMutation, useQuery } from "@apollo/client";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Download,
  FileClock,
  History,
  PackageCheck,
  PencilLine,
  Plus,
  Printer,
  Search,
  ShoppingCart,
  Store,
  Trash2,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QueryErrorBanner } from "@/components/query-state";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { SearchableSelect } from "@/components/ui/searchable-select";

const DATA = gql`
  query ProcurementSuite(
    $dSearch: String
    $dStatus: String
    $dSort: String
    $dSkip: Int
    $poSearch: String
    $poStatus: String
    $poSort: String
    $poSkip: Int
    $poDateFrom: String
    $poDateTo: String
    $hPoSearch: String
    $hPoStatus: String
    $hPoSort: String
    $hPoSkip: Int
    $hPoDateFrom: String
    $hPoDateTo: String
    $gSearch: String
    $gSource: String
    $gSort: String
    $gSkip: Int
    $gDateFrom: String
    $gDateTo: String
  ) {
    procurementSummary
    purchaseDemandPage(
      search: $dSearch
      status: $dStatus
      sort: $dSort
      skip: $dSkip
      take: 30
    )
    purchaseOrderPage(
      search: $poSearch
      status: $poStatus
      sort: $poSort
      skip: $poSkip
      take: 25
      dateFrom: $poDateFrom
      dateTo: $poDateTo
    )
    purchaseOrderHistoryPage: purchaseOrderPage(
      search: $hPoSearch
      status: $hPoStatus
      sort: $hPoSort
      skip: $hPoSkip
      take: 25
      dateFrom: $hPoDateFrom
      dateTo: $hPoDateTo
    )
    goodsReceiptPage(
      search: $gSearch
      source: $gSource
      sort: $gSort
      skip: $gSkip
      take: 25
      dateFrom: $gDateFrom
      dateTo: $gDateTo
    )
    vendors(status: "active", take: 250)
    stockLocations(status: "active")
    me { id role effectivePermissions }
  }
`;
const SEARCH_PRODUCTS = gql`
  query ProcurementProductSearch($query: String!) {
    globalSearch(query: $query) {
      products
    }
  }
`;
const CREATE_PO = gql`
  mutation CreatePo($input: CreatePurchaseOrderInput!) {
    createPurchaseOrder(input: $input)
  }
`;
const RECEIVE_PO = gql`
  mutation ReceivePo($input: ReceivePurchaseOrderInput!) {
    receivePurchaseOrder(input: $input)
  }
`;
const MANUAL_GRN = gql`
  mutation ManualGrn($input: ManualGoodsReceiptInput!) {
    createManualGoodsReceipt(input: $input)
  }
`;
const CORRECT_GRN = gql`
  mutation CorrectGrn($input: CorrectGoodsReceiptInput!) {
    correctGoodsReceipt(input: $input)
  }
`;
const CANCEL_PO = gql`
  mutation CancelPo($id: ID!, $reason: String!) {
    cancelPurchaseOrder(id: $id, reason: $reason)
  }
`;

type Tab = "overview" | "demand" | "orders" | "receiving" | "history";
const emptyCommercial = {
  vendorId: "",
  vendorName: "",
  expectedDate: "",
  notes: "",
  discount: "",
  tax: "",
};
const emptyReceipt = {
  supplierChallan: "",
  supplierBill: "",
  receivedDate: "",
  locationId: "",
  notes: "",
};
function money(value: any) {
  return `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
function hasPendingPoRate(po: any) {
  return Boolean((po?.lines || []).some(isPendingPoLineRate));
}
function isPendingPoLineRate(line: any) {
  return !["complete", "captured"].includes(String(line?.costStatus || "")) || Number(line?.unitCost || 0) <= 0 || Number(line?.netUnitCost || 0) <= 0;
}
function statusClass(status: string) {
  return status === "received" || status === "allocated"
    ? "bg-emerald-50 text-emerald-700"
    : status === "partial_received"
      ? "bg-blue-50 text-blue-700"
      : status === "cancelled"
        ? "bg-red-50 text-red-700"
        : "bg-amber-50 text-amber-800";
}
function uuid() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}
function indiaDate(value: Date | string = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const pick = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}
function inwardDateIso(value: string) {
  return value ? `${value}T12:00:00+05:30` : undefined;
}

export default function ProcurementSuitePage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [dSearch, setDSearch] = useState("");
  const [dStatus, setDStatus] = useState("open");
  const [dSort, setDSort] = useState("priority");
  const [dPage, setDPage] = useState(0);
  const [selectedDemand, setSelectedDemand] = useState<string[]>([]);
  const [poSearch, setPoSearch] = useState("");
  const [poStatus, setPoStatus] = useState("open");
  const [poSort, setPoSort] = useState("newest");
  const [poPage, setPoPage] = useState(0);
  const [poDateFrom, setPoDateFrom] = useState("");
  const [poDateTo, setPoDateTo] = useState("");
  const [historyView, setHistoryView] = useState<"po" | "grn">("grn");
  const [hPoSearch, setHPoSearch] = useState("");
  const [hPoStatus, setHPoStatus] = useState("all");
  const [hPoSort, setHPoSort] = useState("newest");
  const [hPoPage, setHPoPage] = useState(0);
  const [hPoDateFrom, setHPoDateFrom] = useState("");
  const [hPoDateTo, setHPoDateTo] = useState("");
  const [activePoId, setActivePoId] = useState("");
  const [gSearch, setGSearch] = useState("");
  const [gSource, setGSource] = useState("all");
  const [gSort, setGSort] = useState("newest");
  const [gPage, setGPage] = useState(0);
  const [gDateFrom, setGDateFrom] = useState("");
  const [gDateTo, setGDateTo] = useState("");
  const [commercial, setCommercial] = useState<any>(emptyCommercial);
  const [productSearch, setProductSearch] = useState("");
  const [directLines, setDirectLines] = useState<any[]>([]);
  const [demandCosts, setDemandCosts] = useState<Record<string, string>>({});
  const [demandRateUoms, setDemandRateUoms] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState<any>(emptyReceipt);
  const [receiveRows, setReceiveRows] = useState<Record<string, any>>({});
  const [receiptKey, setReceiptKey] = useState(uuid());
  const [manualLines, setManualLines] = useState<any[]>([]);
  const [manualReason, setManualReason] = useState(
    "Supplier delivery received without a prior PO",
  );
  const [manualKey, setManualKey] = useState(uuid());
  const [grnCorrection, setGrnCorrection] = useState<any>(null);
  const [notice, setNotice] = useState("");
  const poComposerRef = useRef<HTMLDivElement>(null);
  const poProductInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const search = new URLSearchParams(window.location.search).get('search') || '';
    setPoSearch(search); setDSearch(search);
    const requested = new URLSearchParams(window.location.search).get(
      "view",
    ) as Tab | null;
    if (
      requested &&
      ["overview", "demand", "orders", "receiving", "history"].includes(
        requested,
      )
    )
      setTab(requested);
  }, []);
  const variables = {
    dSearch: useDebouncedValue(dSearch, 250) || undefined,
    dStatus,
    dSort,
    dSkip: dPage * 30,
    poSearch: useDebouncedValue(poSearch, 250) || undefined,
    poStatus,
    poSort,
    poSkip: poPage * 25,
    poDateFrom: poDateFrom || undefined,
    poDateTo: poDateTo || undefined,
    hPoSearch: useDebouncedValue(hPoSearch, 250) || undefined,
    hPoStatus,
    hPoSort,
    hPoSkip: hPoPage * 25,
    hPoDateFrom: hPoDateFrom || undefined,
    hPoDateTo: hPoDateTo || undefined,
    gSearch: useDebouncedValue(gSearch, 250) || undefined,
    gSource,
    gSort,
    gSkip: gPage * 25,
    gDateFrom: gDateFrom || undefined,
    gDateTo: gDateTo || undefined,
  };
  const { data, loading, error, refetch } = useQuery(DATA, {
    variables,
    fetchPolicy: "cache-and-network",
    pollInterval: 120000,
    skipPollAttempt: () => typeof document !== "undefined" && document.hidden,
  });
  const { data: searchData, error: searchError } = useQuery(SEARCH_PRODUCTS, {
    variables: { query: productSearch },
    skip: productSearch.trim().length < 2,
    fetchPolicy: "network-only",
  });
  const [createPo, createState] = useMutation(CREATE_PO);
  const [receivePo, receiveState] = useMutation(RECEIVE_PO);
  const [manualGrn, manualState] = useMutation(MANUAL_GRN);
  const [correctGrn, correctState] = useMutation(CORRECT_GRN);
  const [cancelPo, cancelState] = useMutation(CANCEL_PO);
  const demands = useMemo(
    () => data?.purchaseDemandPage?.items || [],
    [data?.purchaseDemandPage?.items],
  );
  const orders = data?.purchaseOrderPage?.items || [];
  const historicOrders = data?.purchaseOrderHistoryPage?.items || [];
  const grns = data?.goodsReceiptPage?.items || [];
  const vendors = data?.vendors || [];
  const locations = data?.stockLocations || [];
  const products = searchData?.globalSearch?.products || [];
  const summary = data?.procurementSummary || {};
  const activePo = orders.find((po: any) => po.id === activePoId);
  const chosenDemands = demands.filter((row: any) =>
    selectedDemand.includes(row.id),
  );
  useEffect(() => {
    if (commercial.vendorId || !selectedDemand.length) return;
    const selectedRowsOnPage = demands.filter((row: any) =>
      selectedDemand.includes(row.id),
    );
    const preferredVendorIds = selectedRowsOnPage
      .map((row: any) => row.preferredVendorId)
      .filter(Boolean);
    if (
      selectedRowsOnPage.length === selectedDemand.length &&
      preferredVendorIds.length === selectedDemand.length &&
      new Set(preferredVendorIds).size === 1
    ) {
      setCommercial((current: any) => ({
        ...current,
        vendorId: preferredVendorIds[0],
      }));
    }
  }, [commercial.vendorId, demands, selectedDemand]);
  const canCancel = ["owner", "admin"].includes(data?.me?.role);
  const canCorrectGrn = ["owner", "admin"].includes(data?.me?.role);
  const canViewCost = ["owner", "admin"].includes(data?.me?.role);
  const canEnterPoRate = Boolean(data?.me?.effectivePermissions?.includes("procurement.manage"));
  const canEnterManualRate = Boolean(data?.me?.effectivePermissions?.includes("goods_receipts.manage"));
  const canEnterReceiptRate = canEnterManualRate;
  const actionableDemandIds = demands
    .filter((row: any) =>
      ["open", "ordered", "partial_received"].includes(row.status),
    )
    .map((row: any) => row.id);
  const directLinesReady =
    directLines.length > 0 &&
    directLines.every((line: any) => enteredBaseQuantity(line) > 0);
  const manualLinesReady =
    manualLines.length > 0 &&
    manualLines.every((line: any) => enteredBaseQuantity(line) > 0);
  const demandLinesReady = selectedDemand.length > 0;
  const selectedReceiptLines = (activePo?.lines || []).filter(
    (line: any) => receivedBaseQuantity(line, receiveRows[line.id] || {}) > 0,
  );
  const receiptLinesReady = Boolean(selectedReceiptLines.length);
  const errors = [
    error,
    searchError,
    createState.error,
    receiveState.error,
    manualState.error,
    correctState.error,
    cancelState.error,
  ].filter(Boolean);

  function resetPo() {
    setCommercial(emptyCommercial);
    setDirectLines([]);
    setSelectedDemand([]);
    setDemandCosts({});
    setDemandRateUoms({});
    setProductSearch("");
  }
  function beginNewPo() {
    setTab("orders");
    setNotice("");
    window.setTimeout(() => {
      poComposerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      poProductInputRef.current?.focus({ preventScroll: true });
    }, 80);
  }
  function addProduct(product: any, target: "po" | "manual") {
    const base = {
      productId: product.id,
      sku: product.sku,
      internalCode: product.internalCode,
      name: product.name,
      category: product.category,
      baseUom: product.baseUom || "PC",
      piecesPerPack: Number(product.piecesPerPack || 1),
      purchaseUom: product.purchaseUom || product.unit || "PC",
      allowLoose: product.allowLoose !== false,
      boxes: "",
      loosePieces: "",
      quantity: "1",
      enteredUnitCost: "",
      rateUom: product.purchaseUom || product.unit || "PC",
      damagedQuantity: "",
      supplierBatch: "",
      shade: "",
      caliber: "",
      grade: "",
    };
    if (target === "po")
      setDirectLines((rows) =>
        rows.some((x) => x.productId === product.id) ? rows : [...rows, base],
      );
    else
      setManualLines((rows) =>
        rows.some((x) => x.productId === product.id) ? rows : [...rows, base],
      );
    setProductSearch("");
  }
  function updateLine(setter: any, id: string, patch: any) {
    setter((rows: any[]) =>
      rows.map((row) => (row.productId === id ? { ...row, ...patch } : row)),
    );
  }
  function linePayload(line: any, canEnterRate: boolean) {
    const tile = String(line.category || "").toLowerCase() === "tiles";
    const cost = canEnterRate && line.enteredUnitCost !== "" ? {
      enteredUnitCost: Number(line.enteredUnitCost),
      rateUom: line.rateUom || line.purchaseUom || line.baseUom || "PC",
    } : {};
    return tile
      ? {
          productId: line.productId,
          boxes: Number(line.boxes || 0),
          loosePieces: Number(line.loosePieces || 0),
          piecesPerPack: line.piecesPerPack,
          ...cost,
          damagedQuantity: Number(line.damagedQuantity || 0),
          supplierBatch: line.supplierBatch || undefined,
          shade: line.shade || undefined,
          caliber: line.caliber || undefined,
          grade: line.grade || undefined,
        }
      : {
          productId: line.productId,
          quantity: Number(line.quantity || 0),
          receivedQuantity: Number(line.quantity || 0),
          ...cost,
          damagedQuantity: Number(line.damagedQuantity || 0),
          supplierBatch: line.supplierBatch || undefined,
        };
  }
  async function submitPo(mode: "demand" | "direct") {
    const lines =
      mode === "demand"
        ? chosenDemands.map((row: any) => ({
            purchaseDemandId: row.id,
            ...(canEnterPoRate && demandCosts[row.id] !== undefined && demandCosts[row.id] !== "" ? {
              enteredUnitCost: Number(demandCosts[row.id]),
              rateUom: demandRateUoms[row.id] || row.product?.purchaseUom || row.product?.baseUom || row.unit || "PC",
            } : {}),
          }))
        : directLines.map((line: any) => linePayload(line, canEnterPoRate));
    const response = await createPo({
      variables: {
        input: {
          demandIds: mode === "demand" ? selectedDemand : [],
          lines: JSON.stringify(lines),
          vendorId: commercial.vendorId || undefined,
          vendorName:
            commercial.vendorName ||
            vendors.find((v: any) => v.id === commercial.vendorId)?.name ||
            chosenDemands[0]?.vendorName,
          expectedDate: commercial.expectedDate
            ? new Date(commercial.expectedDate).toISOString()
            : undefined,
          notes: commercial.notes || undefined,
          discountPercent:
            commercial.discount === ""
              ? undefined
              : Number(commercial.discount),
          taxRate: commercial.tax === "" ? undefined : Number(commercial.tax),
        },
      },
    });
    const po = response.data?.createPurchaseOrder;
    const pendingRates = Number(po?.metadata?.commercial?.missingLineCount || 0);
    setNotice(`${po?.poNumber || "Purchase order"} created${pendingRates ? ` with ${pendingRates} supplier cost(s) pending` : " with supplier rates locked"}. Missing costs remain in the permanent delayed-cost queue before or after inward.`);
    resetPo();
    setActivePoId(po?.id || "");
    setTab("receiving");
    await refetch();
  }
  async function submitReceipt() {
    if (!activePo) return;
    const lines = (activePo.lines || [])
      .map((line: any) => {
        const row = receiveRows[line.id] || {};
        const tile =
          String(
            line.product?.category || line.category || "",
          ).toLowerCase() === "tiles";
        return tile
          ? {
              purchaseOrderLineId: line.id,
              boxes: Number(row.boxes || 0),
              loosePieces: Number(row.loosePieces || 0),
              piecesPerPack: line.product?.piecesPerPack || 1,
              damagedQuantity: Number(row.damagedQuantity || 0),
              supplierBatch: row.supplierBatch || undefined,
              shade: row.shade || undefined,
              caliber: row.caliber || undefined,
              grade: row.grade || undefined,
              ...(isPendingPoLineRate(line) && Number(row.enteredUnitCost || 0) > 0 ? {
                enteredUnitCost: Number(row.enteredUnitCost || 0),
                rateUom: row.rateUom || line.product?.purchaseUom || line.product?.baseUom || line.unit || "PC",
              } : {}),
            }
          : {
              purchaseOrderLineId: line.id,
              receivedQuantity: Number(row.receivedQuantity || 0),
              damagedQuantity: Number(row.damagedQuantity || 0),
              supplierBatch: row.supplierBatch || undefined,
              ...(isPendingPoLineRate(line) && Number(row.enteredUnitCost || 0) > 0 ? {
                enteredUnitCost: Number(row.enteredUnitCost || 0),
                rateUom: row.rateUom || line.product?.purchaseUom || line.product?.baseUom || line.unit || "PC",
              } : {}),
            };
      })
      .filter(
        (row: any) =>
          Number(row.receivedQuantity || 0) > 0 ||
          Number(row.boxes || 0) > 0 ||
          Number(row.loosePieces || 0) > 0,
      );
    if (!lines.length) return;
    const response = await receivePo({
      variables: {
        input: {
          purchaseOrderId: activePo.id,
          ...receipt,
          receivedDate: inwardDateIso(receipt.receivedDate),
          locationId: receipt.locationId || undefined,
          lines: JSON.stringify(lines),
          idempotencyKey: receiptKey,
        },
      },
    });
    setNotice(
      `${response.data?.receivePurchaseOrder?.grnNumber || "GRN"} posted. Quantity, lot ledger and backorder allocation are reconciled; any unknown supplier cost remains visibly pending.`,
    );
    setReceipt(emptyReceipt);
    setReceiveRows({});
    setReceiptKey(uuid());
    await refetch();
  }
  async function submitManual() {
    if (!manualLines.length || (!commercial.vendorId && !commercial.vendorName))
      return;
    const response = await manualGrn({
      variables: {
        input: {
          vendorId: commercial.vendorId || undefined,
          vendorName:
            commercial.vendorName ||
            vendors.find((v: any) => v.id === commercial.vendorId)?.name,
          ...receipt,
          receivedDate: inwardDateIso(receipt.receivedDate),
          locationId: receipt.locationId || undefined,
          reason: manualReason,
          lines: JSON.stringify(manualLines.map((line: any) => linePayload(line, canEnterManualRate))),
          idempotencyKey: manualKey,
        },
      },
    });
    setNotice(
      `${response.data?.createManualGoodsReceipt?.grnNumber || "Manual GRN"} posted. The form is blank and ready for the next inward.`,
    );
    setManualLines([]);
    setCommercial(emptyCommercial);
    setReceipt(emptyReceipt);
    setManualReason("Supplier delivery received without a prior PO");
    setManualKey(uuid());
    setProductSearch("");
    await refetch();
  }
  async function cancel(po: any) {
    const reason = window.prompt(
      `Cancellation reason for ${po.poNumber}. History and receipts remain preserved.`,
    );
    if (!reason?.trim()) return;
    await cancelPo({ variables: { id: po.id, reason: reason.trim() } });
    setNotice(`${po.poNumber} cancelled with audit history preserved.`);
    await refetch();
  }
  function beginGrnCorrection(grn: any) {
    setGrnCorrection({
      id: grn.id,
      grnNumber: grn.grnNumber,
      purchaseOrderId: grn.purchaseOrderId || "",
      vendorId: grn.vendorId || "",
      vendorName: grn.vendorName || "",
      receivedDate: indiaDate(grn.receivedDate),
      supplierChallan: grn.supplierChallan || "",
      supplierBill: grn.supplierBill || "",
      notes: grn.notes || "",
      reason: "",
      expectedUpdatedAt: grn.updatedAt,
    });
  }
  async function submitGrnCorrection() {
    if (!grnCorrection) return;
    const response = await correctGrn({ variables: { input: {
      goodsReceiptNoteId: grnCorrection.id,
      receivedDate: inwardDateIso(grnCorrection.receivedDate),
      vendorId: grnCorrection.purchaseOrderId ? undefined : grnCorrection.vendorId || undefined,
      vendorName: grnCorrection.purchaseOrderId || grnCorrection.vendorId ? undefined : grnCorrection.vendorName,
      supplierChallan: grnCorrection.supplierChallan,
      supplierBill: grnCorrection.supplierBill,
      notes: grnCorrection.notes,
      reason: grnCorrection.reason,
      expectedUpdatedAt: grnCorrection.expectedUpdatedAt,
    } } });
    setNotice(`${response.data?.correctGoodsReceipt?.grnNumber || grnCorrection.grnNumber} header corrected. The reason and before/after values are in the audit trail; stock quantities were not rewritten.`);
    setGrnCorrection(null);
    await refetch();
  }

  return (
    <div className="space-y-5 pb-10">
      {errors.map((item: any, index) => (
        <QueryErrorBanner key={index} error={item} />
      ))}
      <header className="relative overflow-hidden rounded-[1.4rem] bg-[linear-gradient(128deg,#241f1e_0%,#3e2826_54%,#9b2f2a_100%)] px-5 py-6 text-white shadow-[0_22px_60px_-32px_rgba(87,30,26,.65)] sm:px-7 sm:py-8">
        <div
          aria-hidden="true"
          className="absolute -right-14 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="absolute -bottom-28 left-1/3 h-56 w-56 rounded-full bg-amber-300/10 blur-3xl"
        />
        <div className="relative flex flex-col justify-between gap-6 xl:flex-row xl:items-end">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.2em] text-rose-100/80">
              Procurement command workspace
            </p>
            <h1 className="mt-2 max-w-3xl font-display text-3xl font-bold leading-[1.08] text-white sm:text-4xl">
              Buy, receive and trace—without losing the queue.
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-rose-50/75">
              One governed daily workspace from demand and supplier commitment
              through GRN, lot creation and stock allocation.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canViewCost ? (
              <Button asChild className="border border-white/25 bg-white/10 text-white hover:bg-white/20">
                <Link href="/dashboard/procurement/cost-readiness">
                  <CircleDollarSign className="mr-2 h-4 w-4" />
                  Complete legacy PO rates
                </Link>
              </Button>
            ) : null}
            <Button
              onClick={beginNewPo}
              className="border border-white/15 bg-white text-[#612421] hover:bg-rose-50"
            >
              <Plus className="mr-2 h-4 w-4" />
              New purchase order
            </Button>
            <Button
              onClick={() => setTab("receiving")}
              className="border border-white/25 bg-white/10 text-white hover:bg-white/20"
            >
              <PackageCheck className="mr-2 h-4 w-4" />
              Receive goods
            </Button>
          </div>
        </div>
      </header>
      <nav
        className="grid overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1 shadow-sm sm:grid-cols-5"
        aria-label="Procurement sections"
      >
        {(
          [
            ["overview", "Overview", ClipboardList, undefined],
            ["demand", "Demand", ShoppingCart, summary.openDemand],
            ["orders", "Purchase orders", Truck, summary.activePurchaseOrders],
            [
              "receiving",
              "Receiving",
              PackageCheck,
              summary.dueTodayPurchaseOrders,
            ],
            ["history", "History", History, summary.recentGrn],
          ] as any[]
        ).map(([id, label, Icon, count]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`relative h-12 rounded-lg px-3 text-sm font-semibold transition-all duration-200 ${tab === id ? "bg-[#9f2d29] text-white shadow-[0_7px_18px_-10px_rgba(159,45,41,.9)]" : "text-[var(--ink-3)] hover:bg-rose-50 hover:text-[#8d2926]"}`}
          >
            <Icon className="mr-2 inline h-4 w-4" />
            {label}
            {count !== undefined ? (
              <span
                className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] ${tab === id ? "bg-white/20 text-white" : "bg-[var(--bg-soft)] text-[var(--ink-4)]"}`}
              >
                {Number(count || 0).toLocaleString("en-IN")}
              </span>
            ) : null}
          </button>
        ))}
      </nav>
      {notice ? (
        <div
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800"
        >
          {notice}
        </div>
      ) : null}
      {["receiving", "history"].includes(tab) ? (
        <div className="flex flex-col justify-between gap-3 rounded-xl border border-[#e8cfc5] bg-[#fff8f5] p-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-bold text-[var(--ink)]">
              Is a received item going onto the showroom floor?
            </p>
            <p className="mt-1 text-xs leading-5 text-[var(--ink-4)]">
              Post the GRN first, then move the exact accepted lot to a
              non-sellable display asset. A free vendor sample uses the direct
              non-stock path.
            </p>
          </div>
          <Button asChild variant="outline" className="shrink-0">
            <Link href="/dashboard/inventory/display-assets">
              <Store className="mr-2 h-4 w-4" />
              Open Display Assets
            </Link>
          </Button>
        </div>
      ) : null}

      {tab === "overview" ? (
        <ProcurementOverview
          summary={summary}
          loading={loading}
          onTab={setTab}
        />
      ) : null}

      {tab === "demand" ? (
        <section className="space-y-5">
          <div className="mp-panel overflow-hidden">
            <ListToolbar
              search={dSearch}
              setSearch={(v: string) => {
                setDSearch(v);
                setDPage(0);
              }}
              status={dStatus}
              setStatus={(v: string) => {
                setDStatus(v);
                setDPage(0);
              }}
              sort={dSort}
              setSort={setDSort}
              statuses={[
                ["all", "All"],
                ["open", "Open"],
                ["ordered", "Ordered"],
                ["partial_received", "Partial"],
                ["received", "Received"],
              ]}
              sorts={[
                ["priority", "Priority"],
                ["oldest", "Oldest"],
                ["sku_asc", "SKU A–Z"],
                ["shortage_desc", "Quantity high–low"],
                ["eta_asc", "ETA soonest"],
              ]}
            />
            <div className="flex flex-col gap-3 border-b border-[var(--line)] bg-[linear-gradient(90deg,#fff8f5,#fffdf9)] p-4 lg:flex-row lg:items-center">
              <label className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                <input
                  type="checkbox"
                  checked={
                    actionableDemandIds.length > 0 &&
                    actionableDemandIds.every((id: string) =>
                      selectedDemand.includes(id),
                    )
                  }
                  onChange={(event) =>
                    setSelectedDemand((current) =>
                      event.target.checked
                        ? Array.from(
                            new Set([...current, ...actionableDemandIds]),
                          )
                        : current.filter(
                            (id) => !actionableDemandIds.includes(id),
                          ),
                    )
                  }
                />
                Select all {actionableDemandIds.length} visible lines
              </label>
              <span className="text-xs font-semibold text-[var(--ink-4)] lg:ml-auto">
                {selectedDemand.length
                  ? `${selectedDemand.length} selected for one governed PO`
                  : "Select one or many demand lines"}
              </span>
            </div>
            {selectedDemand.length ? (
              <div className="sticky top-[4.5rem] z-10 border-b border-[#edc7bd] bg-[#fff8f5]/95 p-4 shadow-sm backdrop-blur">
                <div className="grid gap-3 lg:grid-cols-[1fr_160px_130px_130px_auto] lg:items-end">
                  <Field label="Supplier for selected lines">
                    <SearchableSelect
                      value={commercial.vendorId}
                      onValueChange={(value) =>
                        setCommercial({
                          ...commercial,
                          vendorId: value,
                          vendorName: "",
                        })
                      }
                      options={vendors.map((vendor: any) => ({
                        value: vendor.id,
                        label: vendor.name,
                        description: [vendor.code, vendor.city].filter(Boolean).join(" · "),
                        keywords: [vendor.code, vendor.phone, vendor.email].filter(Boolean).join(" "),
                      }))}
                      placeholder="Select supplier"
                      searchPlaceholder="Search supplier, code or city"
                    />
                  </Field>
                  <Field label="Expected date">
                    <Input
                      type="date"
                      value={commercial.expectedDate}
                      onChange={(event) =>
                        setCommercial({
                          ...commercial,
                          expectedDate: event.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="PO discount %">
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      value={commercial.discount}
                      onChange={(event) =>
                        setCommercial({ ...commercial, discount: event.target.value })
                      }
                      placeholder="0"
                    />
                  </Field>
                  <Field label="GST % (optional)">
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      value={commercial.tax}
                      onChange={(event) =>
                        setCommercial({
                          ...commercial,
                          tax: event.target.value,
                        })
                      }
                      placeholder="0"
                    />
                  </Field>
                  <Button
                    disabled={createState.loading || !commercial.vendorId || !demandLinesReady || !canEnterPoRate}
                    onClick={() => submitPo("demand")}
                    className="min-w-44"
                  >
                    {createState.loading
                      ? "Creating…"
                      : `Create PO (${selectedDemand.length})`}
                  </Button>
                </div>
                {!canEnterPoRate ? (
                  <p className="mt-2 text-xs font-semibold text-amber-800">
                    Purchase rates are private. You can issue the PO without a rate; only authorized users can add or later complete supplier cost.
                  </p>
                ) : !commercial.vendorId ? (
                  <p className="mt-2 text-xs font-semibold text-amber-800">
                    Choose the supplier. Supplier rates may be added now or completed later from the delayed-cost queue.
                  </p>
                ) : !demandLinesReady ? (
                  <p className="mt-2 text-xs font-semibold text-amber-800">
                    Select at least one valid pending item. Supplier rates remain optional.
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead className="bg-[var(--bg-soft)] text-[10px] uppercase tracking-wider text-[var(--ink-4)]">
                  <tr>
                    <th className="p-3">Select</th>
                    <th>SKU / item</th>
                    <th>Customer / order</th>
                    <th>Required</th>
                    <th>Status / ETA</th>
                    {canEnterPoRate ? <th className="pr-4">Supplier rate / UOM</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {demands.map((row: any) => (
                    <tr key={row.id} className="hover:bg-[var(--bg-soft)]">
                      <td className="p-3">
                        <input
                          type="checkbox"
                          disabled={
                            !["open", "ordered", "partial_received"].includes(
                              row.status,
                            )
                          }
                          checked={selectedDemand.includes(row.id)}
                          onChange={(e) =>
                            setSelectedDemand((ids) =>
                              e.target.checked
                                ? [...ids, row.id]
                                : ids.filter((id) => id !== row.id),
                            )
                          }
                        />
                      </td>
                      <td>
                        <b>{row.sku}</b>
                        <p className="text-xs text-[var(--ink-4)]">
                          {row.name} · {row.brand}
                        </p>
                      </td>
                      <td>
                        {row.customer?.name || "Replenishment"}
                        <p className="text-xs text-[var(--ink-4)]">
                          {row.salesOrder?.orderNumber || row.sourceLineKey}
                        </p>
                      </td>
                      <td>
                        {row.quantity} {row.unit}
                        <p className="text-xs text-[var(--ink-4)]">
                          Received {row.receivedQuantity || 0}
                        </p>
                      </td>
                      <td>
                        <span
                          className={`rounded px-2 py-1 text-xs font-semibold ${statusClass(row.status)}`}
                        >
                          {row.status.replaceAll("_", " ")}
                        </span>
                        <p className="mt-1 text-xs">
                          {row.expectedDate
                            ? new Date(row.expectedDate).toLocaleDateString(
                                "en-IN",
                              )
                            : "No ETA"}
                        </p>
                      </td>
                      {canEnterPoRate ? <td className="pr-4">
                        <div className="flex min-w-[220px] gap-2">
                          <Input
                            className="w-28"
                            type="number"
                            min="0.0001"
                            step="0.01"
                            value={demandCosts[row.id] || ""}
                            onChange={(e) =>
                              setDemandCosts({ ...demandCosts, [row.id]: e.target.value })
                            }
                            placeholder="Optional"
                          />
                          <SearchableSelect
                            className="w-24"
                            value={demandRateUoms[row.id] || row.product?.purchaseUom || row.product?.baseUom || row.unit || "PC"}
                            onValueChange={(value) => setDemandRateUoms({ ...demandRateUoms, [row.id]: value })}
                            options={Array.from(new Set([row.product?.purchaseUom, row.product?.baseUom, row.unit].filter(Boolean))).map((uom: any) => ({ value: String(uom), label: String(uom) }))}
                            placeholder="UOM"
                            searchPlaceholder="Find UOM"
                          />
                        </div>
                        {Number(row.product?.piecesPerPack || 1) > 1 ? (
                          <small className="mt-1 block text-[10px] text-[var(--ink-4)]">
                            {row.product.piecesPerPack} {row.product.baseUom || "PC"} per {row.product.purchaseUom || "BOX"}
                          </small>
                        ) : null}
                      </td> : null}
                    </tr>
                  ))}
                  {!loading && !demands.length ? (
                    <tr>
                      <td colSpan={6}>
                        <Empty text="No purchase demand matches these filters." />
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <Pager
              page={dPage}
              hasNext={Boolean(data?.purchaseDemandPage?.hasNext)}
              onPage={setDPage}
            />
          </div>
        </section>
      ) : null}

      {tab === "orders" ? (
        <section className="space-y-5">
          <div
            ref={poComposerRef}
            className="mp-panel scroll-mt-24 overflow-hidden border-[#e7c8bf]"
          >
            <div className="bg-[linear-gradient(102deg,#fff7f3,#fffdf8)] p-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-semibold">
                  Create planned / replenishment PO
                </h2>
                <p className="mt-1 text-xs text-[var(--ink-4)]">
                  Search Product Master or a tile variant code. Tile quantities
                  accept boxes plus loose pieces. Supplier rate is optional on
                  the PO and at inward; unknown cost remains in the permanent
                  delayed-cost queue until the supplier confirms it.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={!directLines.length && !commercial.vendorId}
                onClick={resetPo}
              >
                Clear draft
              </Button>
            </div>
            <ProductPicker
              inputRef={poProductInputRef}
              value={productSearch}
              setValue={setProductSearch}
              products={products}
              onAdd={(p: any) => addProduct(p, "po")}
            />
            <LineEditor rows={directLines} setRows={setDirectLines} mode="po" canViewCost={canEnterPoRate} />
            {!directLines.length ? (
              <div className="mt-4 rounded-xl border border-dashed border-[#dfb8ad] bg-white/70 p-5 text-center">
                <ShoppingCart className="mx-auto h-6 w-6 text-[#9f2d29]" />
                <p className="mt-2 text-sm font-semibold text-[var(--ink)]">
                  Start by searching a SKU, tile design, alias or item name
                </p>
                <p className="mt-1 text-xs text-[var(--ink-4)]">
                  Add multiple lines, confirm supplier and terms, then create one
                  auditable PO.
                </p>
              </div>
            ) : null}
            </div>
          </div>
          {directLines.length ? (
            <PoCommercial
              form={commercial}
              setForm={setCommercial}
              vendors={vendors}
              onSubmit={() => submitPo("direct")}
              disabled={
                createState.loading || !commercial.vendorId || !directLinesReady || !canEnterPoRate
              }
              title="Supplier and commercial terms"
            />
          ) : null}
          <div className="mp-panel overflow-hidden">
            <ListToolbar
              search={poSearch}
              setSearch={(v: string) => {
                setPoSearch(v);
                setPoPage(0);
              }}
              status={poStatus}
              setStatus={(v: string) => {
                setPoStatus(v);
                setPoPage(0);
              }}
              sort={poSort}
              setSort={setPoSort}
              statuses={[
                ["open", "All open"],
                ["ordered", "Ordered"],
                ["partial_received", "Partial"],
              ]}
              sorts={[
                ["newest", "Newest"],
                ["oldest", "Oldest"],
                ["po_asc", "PO number"],
                ["vendor_asc", "Vendor"],
                ["value_desc", "Value high–low"],
                ["eta_asc", "ETA soonest"],
              ]}
              dateFrom={poDateFrom}
              setDateFrom={(value: string) => {
                setPoDateFrom(value);
                setPoPage(0);
              }}
              dateTo={poDateTo}
              setDateTo={(value: string) => {
                setPoDateTo(value);
                setPoPage(0);
              }}
            />
            <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3 text-xs text-[var(--ink-4)]">
              <span>
                {Number(data?.purchaseOrderPage?.total || 0).toLocaleString(
                  "en-IN",
                )} open purchase order(s)
              </span>
              <button
                type="button"
                className="font-semibold text-[#922b27] hover:underline"
                onClick={() => {
                  setHistoryView("po");
                  setTab("history");
                }}
              >
                Open complete PO history
              </button>
            </div>
            {orders.map((po: any) => (
              <article
                key={po.id}
                className="grid gap-3 border-b border-[var(--line)] p-4 md:grid-cols-[1.4fr_1fr_1fr_auto] md:items-center"
              >
                <div>
                  <p className="font-semibold">
                    {po.poNumber} · {po.vendorName}
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-4)]">
                    {po.lines?.length || 0} lines ·{" "}
                    {new Date(po.createdAt).toLocaleString("en-IN")}
                  </p>
                </div>
                <div>
                  <span
                    className={`rounded px-2 py-1 text-xs font-semibold ${statusClass(po.status)}`}
                  >
                    {po.status.replaceAll("_", " ")}
                  </span>
                  <p className="mt-1 text-xs">
                    ETA{" "}
                    {po.expectedDate
                      ? new Date(po.expectedDate).toLocaleDateString("en-IN")
                      : "not set"}
                  </p>
                </div>
                <div className="font-semibold">
                  {hasPendingPoRate(po) ? "Rate pending" : money(po.grandTotal)}
                  <p className="text-xs font-normal text-[var(--ink-4)]">
                    {hasPendingPoRate(po) ? `${money(po.grandTotal)} known value` : `Tax ${money(po.taxAmount)}`}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button asChild size="sm" variant="outline">
                    <a
                      href={`/api/pdf/purchase-order/${po.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Download className="mr-2 h-4 w-4" />
                      PDF
                    </a>
                  </Button>
                  {["ordered", "partial_received"].includes(po.status) ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        setActivePoId(po.id);
                        setTab("receiving");
                      }}
                    >
                      Receive
                    </Button>
                  ) : null}
                  {canCancel &&
                  ["ordered", "partial_received", "draft"].includes(
                    po.status,
                  ) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={cancelState.loading}
                      onClick={() => cancel(po)}
                    >
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
            {!loading && !orders.length ? (
              <Empty text="No purchase orders match these filters." />
            ) : null}
            <Pager
              page={poPage}
              hasNext={Boolean(data?.purchaseOrderPage?.hasNext)}
              onPage={setPoPage}
            />
          </div>
        </section>
      ) : null}

      {tab === "receiving" ? (
        <section className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-2">
            <div className="mp-panel p-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--brand-700)]">
                  Against purchase order
                </p>
                <h2 className="mt-1 text-xl font-semibold">
                  Post a controlled PO GRN
                </h2>
                <p className="mt-1 text-xs text-[var(--ink-4)]">
                  Every line starts blank. Enter only what is physically
                  present.
                </p>
              </div>
              <label className="mt-4 block text-xs font-semibold text-[var(--ink-4)]">
                Find open PO
                <Input
                  className="mt-1"
                  value={poSearch}
                  onChange={(e) => {
                    setPoSearch(e.target.value);
                    setPoPage(0);
                    setActivePoId("");
                  }}
                  placeholder="Search PO number, supplier, SKU or item"
                />
              </label>
              <label className="mt-3 block text-xs font-semibold text-[var(--ink-4)]">
                Open PO
                <SearchableSelect
                  value={activePo?.id || ""}
                  onValueChange={(value) => {
                    setActivePoId(value);
                    setReceiveRows({});
                  }}
                  className="mt-1 h-11"
                  options={orders
                    .filter((po: any) =>
                      ["ordered", "partial_received"].includes(po.status),
                    )
                    .map((po: any) => ({
                      value: po.id,
                      label: `${po.poNumber} · ${po.vendorName}`,
                      description: `${po.lines?.length || 0} lines · ${po.lines?.some(isPendingPoLineRate) ? "rate captured when received" : "rate locked"}`,
                      keywords: (po.lines || []).map((line: any) => `${line.sku} ${line.name}`).join(" "),
                    }))}
                  placeholder="Select PO from matching results"
                  searchPlaceholder="Search PO, supplier, SKU or item"
                  emptyText="No open PO matches this search"
                />
              </label>
              {activePo ? (
                <div className="mt-4 space-y-3">
                  {(activePo.lines || []).some(isPendingPoLineRate) ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      <b>Supplier rate is optional at inward.</b> Add it now if known, or post the quantities and let the linked GRN/lot remain cost-pending in the permanent delayed-cost queue. Existing rated lines remain locked.
                    </div>
                  ) : null}
                  {(activePo.lines || [])
                    .filter(
                      (line: any) =>
                        Number(line.orderedQuantity) >
                        Number(line.receivedQuantity),
                    )
                    .map((line: any) => (
                      <ReceiveLine
                        key={line.id}
                        line={line}
                        value={receiveRows[line.id] || {}}
                        canEnterRate={canEnterReceiptRate}
                        onChange={(patch: any) =>
                          setReceiveRows({
                            ...receiveRows,
                            [line.id]: {
                              ...(receiveRows[line.id] || {}),
                              ...patch,
                            },
                          })
                        }
                      />
                    ))}
                </div>
              ) : (
                <Empty text="Search and choose an open PO to receive." />
              )}
              <ReceiptHeader
                form={receipt}
                setForm={setReceipt}
                locations={locations}
              />
              <Button
                className="mt-4 w-full"
                disabled={
                  !activePo || !receiptLinesReady || receiveState.loading || !canEnterReceiptRate
                }
                onClick={submitReceipt}
              >
                {receiveState.loading
                  ? "Posting…"
                  : "Post selected quantities and clear"}
              </Button>
            </div>
            <div className="mp-panel p-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--brand-700)]">
                  Without purchase order
                </p>
                <h2 className="mt-1 text-xl font-semibold">
                  Manual multi-line GRN
                </h2>
                <p className="mt-1 text-xs text-[var(--ink-4)]">
                  Use only for a real supplier delivery without a prior PO.
                  Reason, actor and lot source are audited.
                </p>
              </div>
              <ProductPicker
                value={productSearch}
                setValue={setProductSearch}
                products={products}
                onAdd={(p: any) => addProduct(p, "manual")}
              />
              <LineEditor
                rows={manualLines}
                setRows={setManualLines}
                mode="manual"
                canViewCost={canEnterManualRate}
              />
              <div className="mt-4">
                <PoCommercial
                  form={commercial}
                  setForm={setCommercial}
                  vendors={vendors}
                  compact
                  title="Supplier"
                />
                <ReceiptHeader
                  form={receipt}
                  setForm={setReceipt}
                  locations={locations}
                />
                <label className="mt-3 block text-xs font-semibold text-[var(--ink-4)]">
                  Mandatory manual reason
                  <Input
                    className="mt-1"
                    value={manualReason}
                    onChange={(e) => setManualReason(e.target.value)}
                  />
                </label>
                <Button
                  className="mt-4 w-full"
                  disabled={
                    !manualLinesReady ||
                    manualState.loading ||
                    !manualReason.trim() ||
                    !commercial.vendorId ||
                    !canEnterManualRate
                  }
                  onClick={submitManual}
                >
                  {manualState.loading
                    ? "Posting…"
                    : "Post manual GRN and clear"}
                </Button>
                {!commercial.vendorId && manualLines.length ? (
                  <p className="mt-2 text-xs font-semibold text-amber-700">
                    Select the supplier before posting.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {tab === "history" ? (
        <section className="mp-panel overflow-hidden">
          <div className="grid grid-cols-2 border-b border-[var(--line)] bg-[var(--bg-soft)] p-1">
            <button
              type="button"
              onClick={() => setHistoryView("grn")}
              className={`h-11 rounded-lg text-sm font-semibold transition ${historyView === "grn" ? "bg-white text-[#922b27] shadow-sm" : "text-[var(--ink-4)] hover:text-[var(--ink)]"}`}
            >
              GRN / inward history
            </button>
            <button
              type="button"
              onClick={() => setHistoryView("po")}
              className={`h-11 rounded-lg text-sm font-semibold transition ${historyView === "po" ? "bg-white text-[#922b27] shadow-sm" : "text-[var(--ink-4)] hover:text-[var(--ink)]"}`}
            >
              Purchase order history
            </button>
          </div>
          {historyView === "grn" ? (
            <>
              <ListToolbar
                search={gSearch}
                setSearch={(v: string) => {
                  setGSearch(v);
                  setGPage(0);
                }}
                status={gSource}
                setStatus={(v: string) => {
                  setGSource(v);
                  setGPage(0);
                }}
                sort={gSort}
                setSort={setGSort}
                statuses={[
                  ["all", "All sources"],
                  ["po", "Against PO"],
                  ["manual", "Manual"],
                ]}
                sorts={[
                  ["newest", "Newest"],
                  ["oldest", "Oldest"],
                  ["grn_asc", "GRN number"],
                  ["vendor_asc", "Vendor"],
                ]}
                dateFrom={gDateFrom}
                setDateFrom={(value: string) => {
                  setGDateFrom(value);
                  setGPage(0);
                }}
                dateTo={gDateTo}
                setDateTo={(value: string) => {
                  setGDateTo(value);
                  setGPage(0);
                }}
              />
              <div className="border-b border-[var(--line)] px-4 py-3 text-xs text-[var(--ink-4)]">
                {Number(data?.goodsReceiptPage?.total || 0).toLocaleString(
                  "en-IN",
                )} goods receipt(s) match these filters
              </div>
          {grns.map((grn: any) => (
            <article key={grn.id} className="border-b border-[var(--line)] p-4">
              <div className="flex flex-col justify-between gap-3 md:flex-row">
                <div>
                  <p className="font-semibold">
                    {grn.grnNumber} · {grn.vendorName}
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-4)]">
                    {grn.purchaseOrderId ? "PO receipt" : "Manual GRN"} ·{" "}
                    {new Date(grn.receivedDate).toLocaleString("en-IN")} ·
                    challan {grn.supplierChallan || "not captured"} · bill{" "}
                    {grn.supplierBill || "not captured"}
                  </p>
                  {Array.isArray(grn.metadata?.corrections) && grn.metadata.corrections.length ? (
                    <p className="mt-1 text-[11px] font-semibold text-amber-700">
                      {grn.metadata.corrections.length} audited header correction{grn.metadata.corrections.length === 1 ? "" : "s"}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 self-start">
                  <span className="rounded bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                    {grn.status}
                  </span>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/dashboard/inventory/labels?grn=${grn.id}`}>
                      <Printer className="mr-2 h-3.5 w-3.5" />
                      Create labels
                    </Link>
                  </Button>
                  {canCorrectGrn ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => grnCorrection?.id === grn.id ? setGrnCorrection(null) : beginGrnCorrection(grn)}
                    >
                      <PencilLine className="mr-2 h-3.5 w-3.5" />
                      {grnCorrection?.id === grn.id ? "Close" : "Correct header"}
                    </Button>
                  ) : null}
                </div>
              </div>
              {grnCorrection?.id === grn.id ? (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                  <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                    <div>
                      <p className="font-semibold text-amber-950">Controlled GRN header correction</p>
                      <p className="mt-1 text-xs leading-5 text-amber-900">
                        Owner/admin only. The original and corrected values, actor and reason are retained. Item quantities and stock ledgers are deliberately immutable; use Inventory Control for a quantity correction.
                      </p>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-800">No stock rewrite</span>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {!grn.purchaseOrderId ? (
                      <Field label="Governed supplier (optional)">
                        <SearchableSelect
                          value={grnCorrection.vendorId}
                          onValueChange={(value) => {
                            const vendor = vendors.find((row: any) => row.id === value);
                            setGrnCorrection({ ...grnCorrection, vendorId: value, vendorName: vendor?.name || grnCorrection.vendorName });
                          }}
                          options={vendors.map((vendor: any) => ({
                            value: vendor.id,
                            label: vendor.name,
                            description: [vendor.code, vendor.city].filter(Boolean).join(" · "),
                            keywords: [vendor.code, vendor.phone, vendor.email].filter(Boolean).join(" "),
                          }))}
                          placeholder={grnCorrection.vendorName || "Select supplier"}
                          searchPlaceholder="Search supplier, code or city"
                        />
                      </Field>
                    ) : (
                      <Field label="Supplier from PO">
                        <Input value={grn.vendorName} disabled />
                      </Field>
                    )}
                    {!grn.purchaseOrderId ? (
                      <Field label="Supplier name">
                        <Input
                          value={grnCorrection.vendorName}
                          onChange={(event) => setGrnCorrection({ ...grnCorrection, vendorId: "", vendorName: event.target.value })}
                          placeholder="Supplier shown on this GRN"
                        />
                      </Field>
                    ) : null}
                    <Field label="Inward date">
                      <Input
                        type="date"
                        max={indiaDate()}
                        value={grnCorrection.receivedDate}
                        onChange={(event) => setGrnCorrection({ ...grnCorrection, receivedDate: event.target.value })}
                      />
                    </Field>
                    <Field label="Supplier challan">
                      <Input value={grnCorrection.supplierChallan} onChange={(event) => setGrnCorrection({ ...grnCorrection, supplierChallan: event.target.value })} />
                    </Field>
                    <Field label="Supplier bill">
                      <Input value={grnCorrection.supplierBill} onChange={(event) => setGrnCorrection({ ...grnCorrection, supplierBill: event.target.value })} />
                    </Field>
                    <Field label="Notes">
                      <Input value={grnCorrection.notes} onChange={(event) => setGrnCorrection({ ...grnCorrection, notes: event.target.value })} />
                    </Field>
                    <Field label="Correction reason (required)">
                      <Input value={grnCorrection.reason} onChange={(event) => setGrnCorrection({ ...grnCorrection, reason: event.target.value })} placeholder="What was entered incorrectly?" />
                    </Field>
                  </div>
                  <div className="mt-4 flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setGrnCorrection(null)}>Cancel</Button>
                    <Button disabled={correctState.loading || !grnCorrection.receivedDate || grnCorrection.reason.trim().length < 8} onClick={submitGrnCorrection}>
                      {correctState.loading ? "Saving…" : "Save audited correction"}
                    </Button>
                  </div>
                </div>
              ) : null}
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[880px] text-left text-xs">
                  <thead className="text-[var(--ink-4)]">
                    <tr>
                      <th>SKU / item</th>
                      <th>Received</th>
                      <th>Accepted</th>
                      <th>Damaged</th>
                      <th>Lot</th>
                      <th>Location</th>
                      {canViewCost ? <th>Cost</th> : null}
                      <th className="text-right">Display</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(grn.lines || []).map((line: any) => {
                      const displayBalance = line.lot?.balances?.find(
                        (row: any) => Number(row.available || 0) > 0,
                      );
                      return (
                      <tr key={line.id}>
                        <td className="py-2">
                          <b>{line.product?.internalCode || line.sku}</b> ·{" "}
                          {line.name}
                        </td>
                        <td>{line.receivedQuantity}</td>
                        <td>{line.acceptedQuantity}</td>
                        <td>{line.damagedQuantity}</td>
                        <td>{line.lot?.lotNumber || line.lotId || "—"}</td>
                        <td>
                          {line.lot?.balances
                            ?.map(
                              (row: any) =>
                                row.location?.code || row.locationId,
                            )
                            .join(", ") ||
                            line.location ||
                            "—"}
                        </td>
                        {canViewCost ? <td>{money(line.unitCost)}</td> : null}
                        <td className="py-2 text-right">
                          {line.product?.id && line.lot?.id && displayBalance ? (
                            <Button asChild size="sm" variant="outline">
                              <Link
                                href={`/dashboard/inventory/display-assets?product=${encodeURIComponent(line.product.id)}&lot=${encodeURIComponent(line.lot.id)}&location=${encodeURIComponent(displayBalance.locationId)}`}
                              >
                                <Store className="mr-2 h-3.5 w-3.5" />
                                Move to display
                              </Link>
                            </Button>
                          ) : (
                            <span className="text-[var(--ink-4)]">
                              No available stock
                            </span>
                          )}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </article>
          ))}
          {!loading && !grns.length ? (
            <Empty text="No goods receipts match these filters." />
          ) : null}
          <Pager
            page={gPage}
            hasNext={Boolean(data?.goodsReceiptPage?.hasNext)}
            onPage={setGPage}
          />
            </>
          ) : (
            <>
              <ListToolbar
                search={hPoSearch}
                setSearch={(value: string) => {
                  setHPoSearch(value);
                  setHPoPage(0);
                }}
                status={hPoStatus}
                setStatus={(value: string) => {
                  setHPoStatus(value);
                  setHPoPage(0);
                }}
                sort={hPoSort}
                setSort={setHPoSort}
                statuses={[
                  ["all", "All statuses"],
                  ["open", "Open"],
                  ["received", "Received"],
                  ["closed", "Closed"],
                  ["cancelled", "Cancelled"],
                ]}
                sorts={[
                  ["newest", "Newest"],
                  ["oldest", "Oldest"],
                  ["po_asc", "PO number"],
                  ["vendor_asc", "Vendor"],
                  ["value_desc", "Value high–low"],
                  ["eta_asc", "ETA soonest"],
                ]}
                dateFrom={hPoDateFrom}
                setDateFrom={(value: string) => {
                  setHPoDateFrom(value);
                  setHPoPage(0);
                }}
                dateTo={hPoDateTo}
                setDateTo={(value: string) => {
                  setHPoDateTo(value);
                  setHPoPage(0);
                }}
              />
              <div className="border-b border-[var(--line)] px-4 py-3 text-xs text-[var(--ink-4)]">
                {Number(
                  data?.purchaseOrderHistoryPage?.total || 0,
                ).toLocaleString("en-IN")} purchase order(s) match these filters
              </div>
              {historicOrders.map((po: any) => (
                <PurchaseOrderRow
                  key={po.id}
                  po={po}
                  canCancel={canCancel}
                  cancelling={cancelState.loading}
                  onCancel={cancel}
                  onReceive={() => {
                    setActivePoId(po.id);
                    setTab("receiving");
                  }}
                />
              ))}
              {!loading && !historicOrders.length ? (
                <Empty text="No purchase orders match these history filters." />
              ) : null}
              <Pager
                page={hPoPage}
                hasNext={Boolean(data?.purchaseOrderHistoryPage?.hasNext)}
                onPage={setHPoPage}
              />
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}

function ProcurementOverview({ summary, loading, onTab }: any) {
  const expected = summary.expectedReceipts || [];
  const work = [
    {
      label: "Demand ready",
      value: Number(summary.openDemand || 0),
      color: "bg-gradient-to-r from-rose-600 to-rose-400",
    },
    {
      label: "Draft purchase orders",
      value: Number(summary.draftPurchaseOrders || 0),
      color: "bg-gradient-to-r from-amber-600 to-amber-400",
    },
    {
      label: "Sent / in motion",
      value:
        Number(summary.orderedPurchaseOrders || 0) +
        Number(summary.partialPurchaseOrders || 0),
      color: "bg-gradient-to-r from-blue-600 to-cyan-400",
    },
    {
      label: "Due for receipt today",
      value: Number(summary.dueTodayPurchaseOrders || 0),
      color: "bg-gradient-to-r from-emerald-700 to-emerald-400",
    },
    {
      label: "Completed today",
      value: Number(summary.receiptsToday || 0),
      color: "bg-gradient-to-r from-teal-700 to-teal-400",
    },
  ];
  const maxWork = Math.max(1, ...work.map((row) => row.value));
  const kpis = [
    {
      label: "Actionable demand",
      value: summary.openDemand || 0,
      detail: `${summary.orderedDemand || 0} already ordered`,
      tone: "rose",
      icon: ShoppingCart,
    },
    {
      label: "POs in motion",
      value: summary.activePurchaseOrders || 0,
      detail: `${summary.draftPurchaseOrders || 0} draft · ${summary.partialPurchaseOrders || 0} partial`,
      tone: "amber",
      icon: Truck,
    },
    {
      label: "Purchase commitment",
      value:
        Number(summary.valuedPurchaseOrders || 0) > 0
          ? money(summary.activePurchaseOrderValue)
          : "Needs cost",
      detail: `${summary.valuedPurchaseOrders || 0} of ${summary.activePurchaseOrders || 0} active POs valued`,
      tone: "blue",
      icon: CircleDollarSign,
    },
    {
      label: "Receiving today",
      value: summary.receiptsToday || 0,
      detail: `${Number(summary.acceptedUnitsToday || 0).toLocaleString("en-IN")} units accepted`,
      tone: "emerald",
      icon: PackageCheck,
    },
    {
      label: "Supplier exceptions",
      value:
        Number(summary.overduePurchaseOrders || 0) +
        Number(summary.purchaseOrdersWithoutEta || 0),
      detail: `${summary.overduePurchaseOrders || 0} overdue · ${summary.purchaseOrdersWithoutEta || 0} no ETA`,
      tone: "red",
      icon: AlertTriangle,
    },
  ];
  const priorities = [
    {
      value: summary.overduePurchaseOrders || 0,
      title: "Overdue purchase orders",
      text: "Supplier receipt date has passed",
      tone: "red",
      tab: "orders",
    },
    {
      value: summary.purchaseOrdersWithoutEta || 0,
      title: "POs missing an ETA",
      text: "Add supplier commitment date",
      tone: "amber",
      tab: "orders",
    },
    {
      value: summary.documentExceptionsToday || 0,
      title: "Receipt document gaps today",
      text: "Challan or supplier bill is missing",
      tone: "amber",
      tab: "history",
    },
    {
      value: summary.damagedUnitsToday || 0,
      title: "Damaged units received today",
      text: "Review exact GRN and lot line",
      tone: "emerald",
      tab: "history",
    },
  ];
  return (
    <section className="space-y-5 animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#a2322e]">
            Live operating overview
          </p>
          <h2 className="mt-1 font-display text-2xl font-bold">
            Today’s procurement control
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-4)]">
            Source-backed queues, receipts and supplier commitments. Business
            date {summary.businessDate || "—"}.
          </p>
        </div>
        <p className="text-xs text-[var(--ink-4)]">
          {summary.asOf
            ? `Refreshed ${new Date(summary.asOf).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`
            : loading
              ? "Refreshing…"
              : "Live source"}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {kpis.map((item: any) => (
          <KpiCard key={item.label} {...item} />
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.58fr_1fr]">
        <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-[0_18px_50px_-38px_rgba(30,20,18,.55)]">
          <div className="flex items-start justify-between border-b border-[var(--line)] p-5">
            <div>
              <h3 className="font-display text-lg font-bold">
                Today’s procurement flow
              </h3>
              <p className="mt-1 text-xs text-[var(--ink-4)]">
                Counts open the relevant operating queue
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => onTab("demand")}>
              Open register
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-5 p-5">
            {work.map((row, index) => (
              <button
                key={row.label}
                onClick={() =>
                  onTab(
                    index === 0
                      ? "demand"
                      : index === 4
                        ? "history"
                        : index === 3
                          ? "receiving"
                          : "orders",
                  )
                }
                className="grid w-full grid-cols-[140px_1fr_44px] items-center gap-3 text-left text-sm sm:grid-cols-[170px_1fr_50px]"
              >
                <span className="font-semibold text-[var(--ink-3)]">
                  {row.label}
                </span>
                <span className="h-2.5 overflow-hidden rounded-full bg-[var(--bg-soft)]">
                  <span
                    className={`block h-full rounded-full ${row.color} transition-all duration-700`}
                    style={{
                      width: `${Math.max(row.value ? 8 : 0, (row.value / maxWork) * 100)}%`,
                    }}
                  />
                </span>
                <b className="text-right tabular-nums">
                  {row.value.toLocaleString("en-IN")}
                </b>
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-[0_18px_50px_-38px_rgba(30,20,18,.55)]">
          <div className="border-b border-[var(--line)] p-5">
            <h3 className="font-display text-lg font-bold">Priority work</h3>
            <p className="mt-1 text-xs text-[var(--ink-4)]">
              Ordered by operational risk
            </p>
          </div>
          <div className="space-y-2.5 p-4">
            {priorities.map((item: any) => (
              <button
                key={item.title}
                onClick={() => onTab(item.tab)}
                className="group flex w-full items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--bg-soft)]/50 p-3 text-left transition hover:-translate-y-0.5 hover:border-rose-200 hover:bg-rose-50/50"
              >
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${item.tone === "red" ? "bg-red-500" : item.tone === "amber" ? "bg-amber-500" : "bg-emerald-500"}`}
                />
                <span className="min-w-0 flex-1">
                  <b className="block text-sm">
                    {Number(item.value).toLocaleString("en-IN")} {item.title}
                  </b>
                  <small className="text-[var(--ink-4)]">{item.text}</small>
                </span>
                <ChevronRight className="h-4 w-4 text-[var(--ink-4)] transition group-hover:translate-x-0.5 group-hover:text-[#9f2d29]" />
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-[0_18px_50px_-38px_rgba(30,20,18,.55)]">
        <div className="flex flex-col justify-between gap-3 border-b border-[var(--line)] p-5 sm:flex-row sm:items-center">
          <div>
            <h3 className="font-display text-lg font-bold">
              Expected inward schedule
            </h3>
            <p className="mt-1 text-xs text-[var(--ink-4)]">
              Earliest supplier commitments with remaining base quantity and
              demand context
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onTab("receiving")}
          >
            <CalendarClock className="mr-2 h-4 w-4" />
            Open receiving
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-[var(--bg-soft)] text-[10px] font-bold uppercase tracking-[.13em] text-[var(--ink-4)]">
              <tr>
                <th className="px-5 py-3">Due</th>
                <th>PO / supplier</th>
                <th>Lines</th>
                <th>Remaining</th>
                <th>Sales-linked</th>
                <th className="pr-5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {expected.map((po: any) => (
                <tr key={po.id} className="transition hover:bg-rose-50/35">
                  <td className="px-5 py-4 font-semibold">
                    {formatDue(po.expectedDate)}
                  </td>
                  <td className="py-4">
                    <b>{po.poNumber}</b>
                    <p className="mt-0.5 text-xs text-[var(--ink-4)]">
                      {po.vendorName}
                    </p>
                  </td>
                  <td>{po.lineCount}</td>
                  <td>
                    {Number(po.remainingQuantity || 0).toLocaleString("en-IN")}{" "}
                    pc
                  </td>
                  <td>
                    {po.demandLineCount
                      ? `${po.demandLineCount} demand line${po.demandLineCount === 1 ? "" : "s"}`
                      : "Replenishment"}
                  </td>
                  <td className="pr-5">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${po.status === "partial_received" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-800"}`}
                    >
                      {String(po.status).replaceAll("_", " ")}
                    </span>
                  </td>
                </tr>
              ))}
              {!loading && !expected.length ? (
                <tr>
                  <td colSpan={6}>
                    <Empty text="No supplier receipt is currently scheduled." />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
      <div className="grid gap-3 rounded-2xl border border-rose-100 bg-[linear-gradient(100deg,#fff8f5,#fffdf8)] p-4 text-xs text-[var(--ink-3)] sm:grid-cols-3">
        <p>
          <b className="text-[var(--ink)]">Quantity truth</b>
          <br />
          PO and GRN quantities are stored in base pieces; tile box conversions
          are snapshotted.
        </p>
        <p>
          <b className="text-[var(--ink)]">Inventory truth</b>
          <br />
          Posting a GRN creates the exact lot and one reconciled stock-ledger
          movement.
        </p>
        <p>
          <b className="text-[var(--ink)]">No silent receipt</b>
          <br />
          Receiving starts blank and posts only explicitly entered physical
          quantities.
        </p>
      </div>
    </section>
  );
}
function KpiCard({ label, value, detail, tone, icon: Icon }: any) {
  const styles: any = {
    rose: [
      "border-rose-100 bg-gradient-to-br from-white to-rose-50/80",
      "bg-rose-100 text-rose-700",
    ],
    amber: [
      "border-amber-100 bg-gradient-to-br from-white to-amber-50/80",
      "bg-amber-100 text-amber-700",
    ],
    emerald: [
      "border-emerald-100 bg-gradient-to-br from-white to-emerald-50/70",
      "bg-emerald-100 text-emerald-700",
    ],
    red: [
      "border-red-100 bg-gradient-to-br from-white to-red-50/70",
      "bg-red-100 text-red-700",
    ],
    blue: [
      "border-blue-100 bg-gradient-to-br from-white to-blue-50/70",
      "bg-blue-100 text-blue-700",
    ],
  };
  const display =
    typeof value === "number"
      ? value.toLocaleString("en-IN")
      : String(value || 0);
  return (
    <div
      className={`rounded-2xl border p-4 shadow-[0_14px_36px_-30px_rgba(30,20,18,.65)] transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${styles[tone][0]}`}
    >
      <div className="flex items-start justify-between">
        <p className="text-xs font-bold leading-5 text-[var(--ink-4)]">
          {label}
        </p>
        <span className={`rounded-xl p-2 ${styles[tone][1]}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p
        className={`mt-3 font-bold tabular-nums text-[var(--ink)] ${display.length > 9 ? "text-xl" : "text-3xl"}`}
      >
        {display}
      </p>
      <p className="mt-1 min-h-8 text-[11px] leading-4 text-[var(--ink-4)]">
        {detail}
      </p>
    </div>
  );
}
function formatDue(value: any) {
  if (!value) return "ETA not set";
  const date = new Date(value);
  const today = new Date();
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const key = day.format(date);
  const todayKey = day.format(today);
  const tomorrowKey = day.format(new Date(today.getTime() + 86400000));
  if (key === todayKey) return "Today";
  if (key === tomorrowKey) return "Tomorrow";
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
function ListToolbar({
  search,
  setSearch,
  status,
  setStatus,
  sort,
  setSort,
  statuses,
  sorts,
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
}: any) {
  return (
    <div className="flex flex-col gap-3 border-b border-[var(--line)] p-4 lg:flex-row lg:items-center">
      <label className="relative min-w-0 flex-1">
        <Search className="absolute left-3 top-3 h-4 w-4 text-[var(--ink-4)]" />
        <Input
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search code, supplier, SKU or document"
        />
      </label>
      <select
        aria-label="Filter status"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        className="h-10 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"
      >
        {statuses.map((x: any) => (
          <option key={x[0]} value={x[0]}>
            {x[1]}
          </option>
        ))}
      </select>
      <select
        aria-label="Sort list"
        value={sort}
        onChange={(e) => setSort(e.target.value)}
        className="h-10 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"
      >
        {sorts.map((x: any) => (
          <option key={x[0]} value={x[0]}>
            {x[1]}
          </option>
        ))}
      </select>
      {setDateFrom ? (
        <label className="flex items-center gap-2 text-xs font-semibold text-[var(--ink-4)]">
          From
          <Input
            aria-label="Filter from date"
            type="date"
            className="w-36"
            value={dateFrom || ""}
            onChange={(event) => setDateFrom(event.target.value)}
          />
        </label>
      ) : null}
      {setDateTo ? (
        <label className="flex items-center gap-2 text-xs font-semibold text-[var(--ink-4)]">
          To
          <Input
            aria-label="Filter to date"
            type="date"
            className="w-36"
            value={dateTo || ""}
            onChange={(event) => setDateTo(event.target.value)}
          />
        </label>
      ) : null}
    </div>
  );
}
function PurchaseOrderRow({
  po,
  canCancel,
  cancelling,
  onCancel,
  onReceive,
}: any) {
  return (
    <article className="grid gap-3 border-b border-[var(--line)] p-4 md:grid-cols-[1.4fr_1fr_1fr_auto] md:items-center">
      <div>
        <p className="font-semibold">
          {po.poNumber} · {po.vendorName}
        </p>
        <p className="mt-1 text-xs text-[var(--ink-4)]">
          {po.lines?.length || 0} lines ·{" "}
          {new Date(po.createdAt).toLocaleString("en-IN")}
        </p>
      </div>
      <div>
        <span
          className={`rounded px-2 py-1 text-xs font-semibold ${statusClass(po.status)}`}
        >
          {String(po.status || "unknown").replaceAll("_", " ")}
        </span>
        <p className="mt-1 text-xs">
          ETA{" "}
          {po.expectedDate
            ? new Date(po.expectedDate).toLocaleDateString("en-IN")
            : "not set"}
        </p>
      </div>
      <div className="font-semibold">
        {hasPendingPoRate(po) ? "Rate pending" : money(po.grandTotal)}
        <p className="text-xs font-normal text-[var(--ink-4)]">
          {hasPendingPoRate(po) ? `${money(po.grandTotal)} known value` : `Tax ${money(po.taxAmount)}`}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline">
          <a
            href={`/api/pdf/purchase-order/${po.id}`}
            target="_blank"
            rel="noreferrer"
          >
            <Download className="mr-2 h-4 w-4" />
            PDF
          </a>
        </Button>
        {["ordered", "partial_received"].includes(po.status) ? (
          <Button size="sm" onClick={onReceive}>
            Receive
          </Button>
        ) : null}
        {canCancel &&
        ["ordered", "partial_received", "draft"].includes(po.status) ? (
          <Button
            size="sm"
            variant="outline"
            disabled={cancelling}
            onClick={() => onCancel(po)}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </article>
  );
}
function Pager({ page, hasNext, onPage }: any) {
  return (
    <div className="flex items-center justify-between border-t border-[var(--line)] p-4">
      <span className="text-xs text-[var(--ink-4)]">Page {page + 1}</span>
      <div className="flex gap-2">
        <Button
          size="icon"
          variant="outline"
          disabled={!page}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="outline"
          disabled={!hasNext}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
function Empty({ text }: any) {
  return (
    <div className="grid min-h-36 place-items-center p-8 text-center">
      <div>
        <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-600" />
        <p className="mt-3 text-sm font-semibold">{text}</p>
      </div>
    </div>
  );
}
function ProductPicker({ value, setValue, products, onAdd, inputRef }: any) {
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [value, products.length]);
  return (
    <div className="relative mt-4">
      <Search className="absolute left-3 top-3 h-4 w-4 text-[var(--ink-4)]" />
      <Input
        ref={inputRef}
        className="pl-9"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => Math.min(products.length - 1, index + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
          } else if (event.key === "Enter" && products[active]) {
            event.preventDefault();
            onAdd(products[active]);
          } else if (event.key === "Escape") {
            setValue("");
          }
        }}
        aria-expanded={value.trim().length >= 2}
        aria-controls="procurement-product-results"
        placeholder="Search SKU, design, alias or product"
      />
      {value.trim().length >= 2 && products.length ? (
        <div id="procurement-product-results" role="listbox" className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-[#ead8d2] bg-white p-1.5 shadow-[0_24px_70px_-22px_rgba(64,31,27,.42)]">
          {products.map((p: any, index: number) => (
            <button
              type="button"
              role="option"
              aria-selected={index === active}
              key={p.id}
              onMouseEnter={() => setActive(index)}
              onClick={() => onAdd(p)}
              className={`flex w-full items-center justify-between rounded-lg p-3 text-left transition ${index === active ? "bg-[#fff0eb] text-[#6f211e]" : "hover:bg-[#fff7f4]"}`}
            >
              <span>
                <b>{p.internalCode || p.sku}</b> · {p.name}
                <small className="block text-[var(--ink-4)]">
                  {p.sku} · {p.category} · {p.piecesPerPack || 1} pc/
                  {p.purchaseUom || p.unit}
                </small>
              </span>
              <Plus className="h-4 w-4" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
function LineEditor({ rows, setRows, mode, canViewCost }: any) {
  return rows.length ? (
    <div className="mt-4 space-y-3">
      {rows.map((row: any) => (
        <div
          key={row.productId}
          className="rounded-md border border-[var(--line)] p-3"
        >
          <div className="flex items-start justify-between">
            <div>
              <b className="text-sm">
                {row.internalCode || row.sku} · {row.name}
              </b>
              <p className="text-xs text-[var(--ink-4)]">
                {row.category} · {row.piecesPerPack} pc/{row.purchaseUom}
              </p>
            </div>
            <button
              type="button"
              aria-label={`Remove ${row.sku}`}
              onClick={() =>
                setRows((all: any[]) =>
                  all.filter((x) => x.productId !== row.productId),
                )
              }
              className="p-2 text-red-700"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {String(row.category).toLowerCase() === "tiles" ? (
              <>
                <Field label="Boxes">
                  <Input
                    type="number"
                    min="0"
                    value={row.boxes}
                    onChange={(e) =>
                      updateRows(setRows, row.productId, {
                        boxes: e.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Loose pieces">
                  <Input
                    type="number"
                    min="0"
                    disabled={!row.allowLoose}
                    value={row.loosePieces}
                    onChange={(e) =>
                      updateRows(setRows, row.productId, {
                        loosePieces: e.target.value,
                      })
                    }
                  />
                </Field>
              </>
            ) : (
              <Field label="Quantity">
                <Input
                  type="number"
                  min="1"
                  value={row.quantity}
                  onChange={(e) =>
                    updateRows(setRows, row.productId, {
                      quantity: e.target.value,
                    })
                  }
                />
              </Field>
            )}
            {canViewCost ? (
              <>
                <Field label={mode === "manual" ? "Inward supplier rate ₹" : "PO supplier rate ₹ (optional)"}>
                  <Input
                    type="number"
                    min="0.0001"
                    step="0.01"
                    value={row.enteredUnitCost}
                    onChange={(e) =>
                      updateRows(setRows, row.productId, {
                        enteredUnitCost: e.target.value,
                      })
                    }
                    placeholder={mode === "manual" ? "Required" : "Can be added at inward"}
                  />
                </Field>
                <Field label="Rate UOM">
                  <SearchableSelect
                    value={row.rateUom || row.purchaseUom || row.baseUom || "PC"}
                    onValueChange={(value) => updateRows(setRows, row.productId, { rateUom: value })}
                    options={Array.from(new Set([row.purchaseUom, row.baseUom].filter(Boolean))).map((uom: any) => ({
                      value: String(uom),
                      label: String(uom),
                      description: String(uom) === String(row.purchaseUom) && Number(row.piecesPerPack || 1) > 1
                        ? `${row.piecesPerPack} ${row.baseUom || "PC"} per ${row.purchaseUom}`
                        : "Base stock unit",
                    }))}
                    placeholder="Select rate UOM"
                    searchPlaceholder="Search UOM"
                  />
                </Field>
              </>
            ) : null}
            {mode === "manual" ? (
              <>
                <Field label="Damaged pc">
                  <Input
                    type="number"
                    min="0"
                    value={row.damagedQuantity}
                    onChange={(e) =>
                      updateRows(setRows, row.productId, {
                        damagedQuantity: e.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="Batch / shade">
                  <Input
                    value={row.supplierBatch}
                    onChange={(e) =>
                      updateRows(setRows, row.productId, {
                        supplierBatch: e.target.value,
                      })
                    }
                  />
                </Field>
              </>
            ) : null}
          </div>
          {mode === "manual" &&
          String(row.category).toLowerCase() === "tiles" ? (
            <div className="mt-2 grid grid-cols-3 gap-2">
              <Field label="Shade">
                <Input
                  value={row.shade}
                  onChange={(e) =>
                    updateRows(setRows, row.productId, {
                      shade: e.target.value,
                    })
                  }
                />
              </Field>
              <Field label="Caliber">
                <Input
                  value={row.caliber}
                  onChange={(e) =>
                    updateRows(setRows, row.productId, {
                      caliber: e.target.value,
                    })
                  }
                />
              </Field>
              <Field label="Grade">
                <Input
                  value={row.grade}
                  onChange={(e) =>
                    updateRows(setRows, row.productId, {
                      grade: e.target.value,
                    })
                  }
                />
              </Field>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  ) : null;
}
function updateRows(setRows: any, id: string, patch: any) {
  setRows((rows: any[]) =>
    rows.map((row) => (row.productId === id ? { ...row, ...patch } : row)),
  );
}
function enteredBaseQuantity(line: any) {
  return String(line.category || "").toLowerCase() === "tiles"
    ? Number(line.boxes || 0) * Math.max(1, Number(line.piecesPerPack || 1)) +
        Number(line.loosePieces || 0)
    : Number(line.quantity || 0);
}
function receivedBaseQuantity(line: any, row: any) {
  return String(line.product?.category || line.category || "").toLowerCase() ===
    "tiles"
    ? Number(row.boxes || 0) *
        Math.max(1, Number(line.product?.piecesPerPack || 1)) +
        Number(row.loosePieces || 0)
    : Number(row.receivedQuantity || 0);
}
function Field({ label, children }: any) {
  return (
    <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--ink-4)]">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}
function PoCommercial({
  form,
  setForm,
  vendors,
  onSubmit,
  disabled,
  title,
  compact = false,
}: any) {
  return (
    <div className={compact ? "" : "mp-panel p-5"}>
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Supplier">
          <SearchableSelect
            value={form.vendorId}
            onValueChange={(value) =>
              setForm({ ...form, vendorId: value, vendorName: "" })
            }
            options={vendors.map((vendor: any) => ({
              value: vendor.id,
              label: vendor.name,
              description: [vendor.code, vendor.city].filter(Boolean).join(" · "),
              keywords: [vendor.code, vendor.phone, vendor.email].filter(Boolean).join(" "),
            }))}
            placeholder="Select supplier"
            searchPlaceholder="Search supplier, code or city"
          />
        </Field>
        <Field label="Expected date">
          <Input
            type="date"
            value={form.expectedDate}
            onChange={(e) => setForm({ ...form, expectedDate: e.target.value })}
          />
        </Field>
        {!compact ? (
          <>
            <Field label="Discount %">
              <Input
                type="number"
                min="0"
                max="100"
                value={form.discount}
                onChange={(e) => setForm({ ...form, discount: e.target.value })}
              />
            </Field>
            <Field label="GST %">
              <Input
                type="number"
                min="0"
                max="100"
                value={form.tax}
                onChange={(e) => setForm({ ...form, tax: e.target.value })}
              />
            </Field>
            <Field label="Notes">
              <Input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </Field>
            <div className="flex items-end">
              <Button
                className="w-full"
                disabled={disabled || !form.vendorId}
                onClick={onSubmit}
              >
                Create PO and clear
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
function ReceiptHeader({ form, setForm, locations }: any) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-2">
      <Field label="Supplier challan">
        <Input
          value={form.supplierChallan}
          onChange={(e) =>
            setForm({ ...form, supplierChallan: e.target.value })
          }
        />
      </Field>
      <Field label="Supplier bill">
        <Input
          value={form.supplierBill}
          onChange={(e) => setForm({ ...form, supplierBill: e.target.value })}
        />
      </Field>
      <Field label="Receipt date">
        <Input
          type="date"
          max={indiaDate()}
          value={form.receivedDate}
          onChange={(e) => setForm({ ...form, receivedDate: e.target.value })}
        />
      </Field>
      <Field label="Stock location">
        <SearchableSelect
          value={form.locationId}
          onValueChange={(value) => setForm({ ...form, locationId: value })}
          options={[
            { value: "", label: "Default stock location", description: "Uses the governed warehouse default" },
            ...locations.map((location: any) => ({
              value: location.id,
              label: `${location.code} · ${location.name}`,
              description: [location.type, location.zone].filter(Boolean).join(" · "),
              keywords: [location.code, location.name, location.type, location.zone].filter(Boolean).join(" "),
            })),
          ]}
          placeholder="Default stock location"
          searchPlaceholder="Search code, location or zone"
        />
      </Field>
    </div>
  );
}
function ReceiveLine({ line, value, onChange, canEnterRate }: any) {
  const tile =
    String(line.product?.category || line.category || "").toLowerCase() ===
    "tiles";
  const remaining = Math.max(
    0,
    Number(line.orderedQuantity || 0) - Number(line.receivedQuantity || 0),
  );
  return (
    <div className="rounded-md border border-[var(--line)] p-3">
      <p className="text-sm font-semibold">
        {line.product?.internalCode || line.sku} · {line.name}
      </p>
      <p className="text-xs text-[var(--ink-4)]">
        Remaining {remaining} base pc
        {tile ? ` · ${line.product?.piecesPerPack || 1} pc/box` : ""}
        {isPendingPoLineRate(line) ? " · supplier rate pending" : " · PO rate locked"}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {tile ? (
          <>
            <Field label="Boxes received">
              <Input
                type="number"
                min="0"
                value={value.boxes || ""}
                onChange={(e) => onChange({ boxes: e.target.value })}
              />
            </Field>
            <Field label="Loose pieces">
              <Input
                type="number"
                min="0"
                disabled={line.product?.allowLoose === false}
                value={value.loosePieces || ""}
                onChange={(e) => onChange({ loosePieces: e.target.value })}
              />
            </Field>
          </>
        ) : (
          <Field label="Quantity received">
            <Input
              type="number"
              min="0"
              max={remaining}
              value={value.receivedQuantity || ""}
              onChange={(e) => onChange({ receivedQuantity: e.target.value })}
            />
          </Field>
        )}
        <Field label="Damaged pc">
          <Input
            type="number"
            min="0"
            value={value.damagedQuantity || ""}
            onChange={(e) => onChange({ damagedQuantity: e.target.value })}
          />
        </Field>
        <Field label="Batch">
          <Input
            value={value.supplierBatch || ""}
            onChange={(e) => onChange({ supplierBatch: e.target.value })}
          />
        </Field>
        {isPendingPoLineRate(line) && canEnterRate ? (
          <>
            <Field label="Supplier rate ₹ (optional)">
              <Input
                type="number"
                min="0.0001"
                step="0.01"
                value={value.enteredUnitCost || ""}
                onChange={(e) => onChange({ enteredUnitCost: e.target.value })}
                placeholder="Add now or 10–20 days later"
              />
            </Field>
            <Field label="Rate UOM">
              <SearchableSelect
                value={value.rateUom || line.product?.purchaseUom || line.product?.baseUom || line.unit || "PC"}
                onValueChange={(rateUom) => onChange({ rateUom })}
                options={Array.from(new Set([line.product?.purchaseUom, line.product?.baseUom, line.unit].filter(Boolean))).map((uom: any) => ({
                  value: String(uom),
                  label: String(uom),
                  description: String(uom) === String(line.product?.purchaseUom) && Number(line.product?.piecesPerPack || 1) > 1
                    ? `${line.product.piecesPerPack} ${line.product?.baseUom || "PC"} per ${uom}`
                    : "Base stock unit",
                }))}
                placeholder="Select rate UOM"
                searchPlaceholder="Search UOM"
              />
            </Field>
          </>
        ) : null}
        {tile ? (
          <>
            <Field label="Shade">
              <Input
                value={value.shade || ""}
                onChange={(e) => onChange({ shade: e.target.value })}
              />
            </Field>
            <Field label="Caliber">
              <Input
                value={value.caliber || ""}
                onChange={(e) => onChange({ caliber: e.target.value })}
              />
            </Field>
            <Field label="Grade">
              <Input
                value={value.grade || ""}
                onChange={(e) => onChange({ grade: e.target.value })}
              />
            </Field>
          </>
        ) : null}
      </div>
    </div>
  );
}
