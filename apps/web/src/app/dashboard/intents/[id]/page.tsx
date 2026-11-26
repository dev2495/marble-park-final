"use client";

import { gql, useApolloClient, useMutation, useQuery } from "@apollo/client";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { tileStockUnitGeometry } from "@/lib/tile-rate";
import {
  ArrowLeft,
  Camera,
  Check,
  CheckCircle2,
  Hammer,
  Lock,
  Save,
  Search,
  Send,
  Sparkles,
  Trash2,
  Unlock,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QueryErrorBanner } from "@/components/query-state";
import { PhysicalQrScanner } from "@/components/physical-qr-scanner";
import { ScanProductSelector } from "@/components/scan-product-selector";
import { useBusyAction } from "@/hooks/use-busy-action";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/textarea";

const INTENT = gql`
  query Intent($id: ID!) {
    intent(id: $id)
  }
`;

const PRODUCT_SEARCH = gql`
  query SearchProducts($query: String!) {
    globalSearch(query: $query) {
      products
    }
  }
`;

const UPDATE_INTENT = gql`
  mutation UpdateIntent($id: ID!, $input: UpdateIntentInputDto!) {
    updateIntent(id: $id, input: $input)
  }
`;

const SUBMIT_INTENT = gql`
  mutation SubmitIntentDetail($id: ID!) {
    submitIntent(id: $id)
  }
`;

const CANCEL_INTENT = gql`
  mutation CancelIntentDetail($id: ID!, $reason: String) {
    cancelIntent(id: $id, reason: $reason)
  }
`;

const PICK_UP = gql`
  mutation PickUpDetail($id: ID!) {
    pickUpIntent(id: $id)
  }
`;

const RELEASE = gql`
  mutation ReleaseDetail($id: ID!, $force: Boolean) {
    releaseIntent(id: $id, force: $force)
  }
`;

const REQUEST_CHANGES = gql`
  mutation ReqChangesDetail($id: ID!, $message: String) {
    requestIntentChanges(id: $id, message: $message)
  }
`;

const GENERATE = gql`
  mutation GenDetail($intentId: String!, $note: String, $displayMode: String) {
    generateQuoteFromIntent(
      intentId: $intentId
      note: $note
      displayMode: $displayMode
    )
  }
`;
const SCAN_LABEL = gql`mutation IntentScanLabel($labelCode:String!,$input:InternalLabelScanInput){scanInternalLabel(labelCode:$labelCode,input:$input)}`;

type Row = {
  productId?: string;
  sku?: string;
  name?: string;
  category?: string;
  brand?: string;
  finish?: string;
  qty: number;
  price: number;
  unit?: string;
  area?: string;
  notes?: string;
  media?: any;
  type?: string;
  tileCode?: string;
  tileSize?: string;
  pcsPerBox?: number;
  uom?: string;
  quoteImage?: string;
  inventoryUom?: string;
  pricingUom?: string;
  rateBasis?: string;
  coveragePerPack?: number;
  piecesPerPack?: number;
  requestedArea?: number;
  wastagePercent?: number;
};

const AREA_SUGGESTIONS = [
  "General Selection",
  "Master Bedroom Bathroom",
  "1st Floor Guest Bathroom",
  "2nd Floor Powder Bathroom",
  "Steam Shower Bathroom",
  "Terrace Powder",
  "Balcony",
  "Living Room",
  "Kitchen",
  "Powder Room",
  "Drying Yard",
];

function emptyWhenZero(value: unknown) {
  return value === "" || value == null || Number(value) === 0 ? "" : (value as any);
}

// Rows are grouped by area, so committing on every keystroke would move the
// row (and drop focus) after one letter. Edit locally, commit on blur/Enter.
function AreaInput({ id, value, disabled, onCommit }: { id?: string; value: string; disabled: boolean; onCommit: (area: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = draft.trim() || "General Selection";
    setDraft(next);
    if (next !== value) onCommit(next);
  };
  return (
    <Input
      id={id}
      list="intent-area-list"
      value={draft}
      placeholder="Type or pick an area"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
      disabled={disabled}
    />
  );
}

function money(n: number) {
  return `₹${Math.round(Number(n || 0)).toLocaleString("en-IN")}`;
}

function isAreaPriced(row: Row) {
  return (
    ["SQFT", "SQM", "M2"].includes(
      String(row.pricingUom || "").toUpperCase(),
    ) && Number(row.coveragePerPack || 0) > 0
  );
}

function rowPricingQuantity(row: Row) {
  if (isAreaPriced(row))
    return Number(row.qty || 0) * Number(row.coveragePerPack || 0);
  if (row.rateBasis === "PIECE")
    return Number(row.qty || 0) * Number(row.piecesPerPack || 1);
  return Number(row.qty || 0);
}

function intentStatusBadge(status: string): { tone: "success" | "warning" | "danger" | "info" | "neutral"; label: string } {
  switch (status) {
    case "draft":
      return { tone: "neutral", label: "Draft" };
    case "pending_quote":
      return { tone: "warning", label: "Pending quote" };
    case "in_quote":
      return { tone: "info", label: "Office building quote" };
    case "converted":
      return { tone: "success", label: "Converted" };
    case "cancelled":
      return { tone: "danger", label: "Cancelled" };
    case "quoted":
      return { tone: "success", label: "Quote built" };
    default:
      return { tone: "neutral", label: status };
  }
}

export default function IntentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id || "";
  const router = useRouter();
  const apollo = useApolloClient();
  const { data, loading, error, refetch } = useQuery(INTENT, {
    variables: { id },
    fetchPolicy: "cache-and-network",
    skip: !id,
  });
  const intent = data?.intent;

  const [me, setMe] = useState<any>(null);
  useEffect(() => {
    try {
      setMe(JSON.parse(localStorage.getItem("user") || "null"));
    } catch {
      setMe(null);
    }
  }, []);

  const [rows, setRows] = useState<Row[]>([]);
  const [notes, setNotes] = useState("");
  const [dirty, setDirty] = useState(false);
  // A refresh in the background (pick up, release, another tab) must never replace rows the user is typing.
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const forceReload = useRef(false);
  useUnsavedChanges(dirty, "This intent has changes that are not saved. Leave and lose them?");
  useEffect(() => {
    if (!intent) return;
    if (dirtyRef.current && !forceReload.current) return;
    forceReload.current = false;
    const incoming = (Array.isArray(intent.rows) ? intent.rows : []).map(
      (r: any) => ({
        productId: r.productId,
        sku: r.sku,
        name: r.name,
        category: r.category,
        brand: r.brand,
        finish: r.finish,
        qty: Number(r.qty || r.quantity || 1),
        price: Number(r.price || r.sellPrice || 0),
        unit: r.unit || "PC",
        area: r.area || "General Selection",
        notes: r.notes || "",
        media: r.media,
        type: r.type,
        tileCode: r.tileCode,
        tileSize: r.tileSize,
        pcsPerBox: r.pcsPerBox,
        uom: r.uom,
        quoteImage: r.quoteImage || r.customImageUrl || "",
        inventoryUom: r.inventoryUom || r.purchaseUom || r.unit,
        pricingUom: r.pricingUom || r.salesUom || r.unit,
        rateBasis: r.rateBasis || "PACK",
        coveragePerPack: Number(r.coveragePerPack || 0),
        piecesPerPack: Number(r.piecesPerPack || r.pcsPerBox || 1),
        requestedArea: Number(r.requestedArea || 0),
        // Wastage is no longer counted on intents.
        wastagePercent: 0,
      }),
    );
    setRows(incoming);
    setNotes(intent.notes || "");
    setDirty(false);
  }, [intent]);

  const [updateIntent, { loading: saving, error: saveError }] = useMutation(
    UPDATE_INTENT,
    {
      onCompleted: () => {
        forceReload.current = true;
        setDirty(false);
        refetch();
      },
    },
  );
  const [submitIntent, { loading: submitting, error: submitError }] =
    useMutation(SUBMIT_INTENT, { onCompleted: () => refetch() });
  const [cancelIntent, { loading: cancelling, error: cancelError }] = useMutation(CANCEL_INTENT, {
    onCompleted: () => { forceReload.current = true; setDirty(false); refetch(); },
  });
  const [pickUp, { error: pickUpError }] = useMutation(PICK_UP, { onCompleted: () => refetch() });
  const [release, { error: releaseError }] = useMutation(RELEASE, { onCompleted: () => refetch() });
  const [requestChanges, { error: requestError }] = useMutation(REQUEST_CHANGES);
  // One button action at a time; a second tap while one runs does nothing.
  const busyAction = useBusyAction();
  const [confirm, setConfirm] = useState<"" | "cancel" | "release" | "build">("");
  const [cancelReason, setCancelReason] = useState("");
  const [notice, setNotice] = useState("");
  const [generate, { loading: generating, error: generateError }] = useMutation(
    GENERATE,
    {
      onCompleted: () => {
        // Move to the resulting quote when generation finishes.
        refetch().then(() => {
          // Re-read the freshest intent so the quoteId is in cache.
          apollo
            .query({
              query: INTENT,
              variables: { id },
              fetchPolicy: "network-only",
            })
            .then((r) => {
              const qid = r.data?.intent?.quoteId;
              if (qid) router.push(`/dashboard/quotes/${qid}`);
            });
        });
      },
    },
  );

  // Room that new rows go into. The same code may sit in several rooms,
  // but only once per room.
  const [targetRoom, setTargetRoom] = useState("General Selection");
  const [roomNotice, setRoomNotice] = useState("");
  const sameRoom = (a: unknown, b: unknown) => String(a || "General Selection").trim().toLowerCase() === String(b || "General Selection").trim().toLowerCase();
  const notifyRoom = (message: string) => { setRoomNotice(message); window.setTimeout(() => setRoomNotice((current) => (current === message ? "" : current)), 5000); };
  // Product search panel for adding rows
  const [searchTerm, setSearchTerm] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanMessage, setScanMessage] = useState("");
  const [scanPayload, setScanPayload] = useState("");
  const [scanResult, setScanResult] = useState<any>(null);
  const [scanLabel, scanState] = useMutation(SCAN_LABEL);
  const { data: searchData, loading: searching } = useQuery(PRODUCT_SEARCH, {
    variables: { query: searchTerm },
    skip: searchTerm.trim().length < 2,
  });
  const products = searchData?.globalSearch?.products || [];

  const role = me?.role || "";
  const isManager = ["admin", "owner", "sales_manager"].includes(role);
  const isOfficeOrManager = [
    "admin",
    "owner",
    "sales_manager",
    "office_staff",
  ].includes(role) || Boolean(me?.effectivePermissions?.includes("quotes.manage"));
  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; rows: Row[] }>();
    for (const row of rows) {
      const name = String(row.area || "General Selection").trim() || "General Selection";
      const key = name.toLowerCase();
      const entry = map.get(key) || { name, rows: [] };
      entry.rows.push(row);
      map.set(key, entry);
    }
    return Array.from(map.values()).map((entry) => [entry.name, entry.rows] as [string, Row[]]);
  }, [rows]);
  // Combined quantity of each code across rooms.
  const codeTotals = useMemo(() => {
    const map = new Map<string, { qty: number; rooms: string[]; unit: string }>();
    for (const row of rows) {
      if (!row.productId) continue;
      const entry = map.get(row.productId) || { qty: 0, rooms: [], unit: String(row.unit || "PC") };
      entry.qty += Number(row.qty || 0);
      entry.rooms.push(String(row.area || "General Selection"));
      map.set(row.productId, entry);
    }
    return map;
  }, [rows]);

  if (loading && !intent)
    return (
      <div role="status" aria-label="Loading intent" className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (error && !intent)
    return (
      <div className="p-6">
        <QueryErrorBanner error={error} onRetry={() => refetch()} />
      </div>
    );
  if (!intent)
    return (
      <EmptyState
        title="This intent was not found"
        description="It may have been removed, or the link is old."
        action={<Link href="/dashboard/intents" className="inline-flex h-10 items-center rounded-md border border-[var(--line)] px-4 text-sm font-semibold">Back to intents</Link>}
      />
    );

  const badge = intentStatusBadge(intent.status);
  const isOwner =
    me?.id && (intent.ownerId === me.id || intent.createdBy === me.id);
  const myLock = intent.lockedBy === me?.id;
  const isDraft = intent.status === "draft";
  const isPending = intent.status === "pending_quote";
  const isLocked = intent.status === "in_quote";
  const isConverted =
    intent.status === "converted" || intent.status === "quoted";
  const isCancelled = intent.status === "cancelled";
  const editable =
    !isConverted &&
    !isCancelled &&
    (isDraft || isPending ? isOwner || isOfficeOrManager : myLock || isManager);

  const total = rows.reduce(
    (s, r) => s + rowPricingQuantity(r) * Number(r.price || 0),
    0,
  );

  const updateRow = (idx: number, patch: Partial<Row>) => {
    if (patch.area !== undefined) {
      const moving = rows[idx];
      const clash = rows.find((row, i) => i !== idx && row.productId && row.productId === moving?.productId && sameRoom(row.area, patch.area));
      if (clash) { notifyRoom(`${moving?.sku || moving?.name} is already in ${clash.area}. Change the quantity there instead of moving this row.`); return; }
      const existingName = rows.find((row, i) => i !== idx && sameRoom(row.area, patch.area))?.area;
      if (existingName) patch = { ...patch, area: existingName };
    }
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== idx) return row;
        const updated = { ...row, ...patch };
        if (isAreaPriced(updated) && "requestedArea" in patch) {
          const required = Number(updated.requestedArea || 0);
          updated.wastagePercent = 0;
          updated.qty = required > 0
            ? Math.max(1, Math.ceil(required / Number(updated.coveragePerPack || 1) - 1e-9))
            : 0;
        }
        return updated;
      }),
    );
    setDirty(true);
  };
  const removeRow = (idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
    setDirty(true);
  };
  const addFromProduct = (product: any) => {
    const roomName = rows.find((row) => sameRoom(row.area, targetRoom))?.area || targetRoom.trim() || "General Selection";
    if (rows.some((row) => row.productId === product.id && sameRoom(row.area, roomName))) {
      notifyRoom(`${product.internalCode || product.sku} is already in ${roomName}. Change its quantity there, or pick another room in "Add to room" first.`);
      return;
    }
    setRows((prev) => {
      if (prev.some((row) => row.productId === product.id && sameRoom(row.area, roomName))) return prev;
      return [...prev, {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        category: product.category,
        brand: product.brand,
        finish: product.finish,
        // Area-priced rows start with no area and no boxes until the area is entered.
        qty: ["SQFT", "SQM", "M2"].includes(String(product.salesUom || "").toUpperCase()) && Number(product.coveragePerPack || 0) > 0 ? 0 : 1,
        price: Number(product.defaultNrpInclusive || 0),
        unit: product.unit || "PC",
        area: roomName,
        media: product.media,
        type:
          String(product.category || "").toLowerCase() === "tiles"
            ? "tile"
            : "product",
        tileCode: product.internalCode || product.sku,
        tileSize: product.dimensions || "",
        quoteImage: "",
        inventoryUom: product.purchaseUom || product.unit || "PC",
        pricingUom: product.salesUom || product.unit || "PC",
        // Product Master owns the price basis; derive it only when missing.
        rateBasis: ["AREA", "PIECE", "BOX"].includes(String(product.priceRateBasis || "").toUpperCase())
          ? String(product.priceRateBasis).toUpperCase()
          : ["SQFT", "SQM", "M2"].includes(String(product.priceUom || product.salesUom || "").toUpperCase())
            ? "AREA"
            : String(product.priceUom || product.salesUom || product.unit || "PC").toUpperCase() === "PC" ? "PIECE" : "BOX",
        // A tile stocked by the piece covers one piece's area, not a whole box.
        coveragePerPack: String(product.category || "").toLowerCase() === "tiles" ? tileStockUnitGeometry(product).coveragePerUnitSqFt : Number(product.coveragePerPack || 0),
        piecesPerPack: String(product.category || "").toLowerCase() === "tiles" ? tileStockUnitGeometry(product).piecesPerUnit : Number(product.piecesPerPack || 1),
        requestedArea: 0,
        wastagePercent: 0,
      }];
    });
    setDirty(true);
    setSearchTerm("");
    setSearchOpen(false);
  };
  const addFromScan = async (payload: string) => {
    setScanMessage("");
    setScanPayload(payload);
    setScanResult(null);
    const response = await scanLabel({ variables: { labelCode: payload, input: { action: "intent_similar_lookup", entityType: "Intent", entityId: id, metadata: { surface: "intent_detail" } } } });
    const result = response.data?.scanInternalLabel;
    if (result?.result !== "success" || !result?.label?.product) {
      setScanMessage(`Scan blocked: ${result?.message || "No active production label matched this code."} The intent was not changed.`);
      return;
    }
    setScanResult(result);
  };
  const addScannedProducts = async (products: any[]) => {
    await scanLabel({ variables: { labelCode: scanPayload, input: { action: "intent_similar_select", entityType: "Intent", entityId: id, metadata: { surface: "intent_detail", selectedProductIds: products.map((product) => product.id) } } } });
    products.forEach(addFromProduct);
    setScanMessage(`${products.length} selected item${products.length === 1 ? "" : "s"} added. Save or submit to persist the intent.`);
    setScanResult(null);
    setScanOpen(false);
  };

  const saveDraft = () => {
    updateIntent({
      variables: { id, input: { rows: JSON.stringify(rows), notes } },
    });
  };
  const saveAndSubmit = async () => {
    await updateIntent({
      variables: { id, input: { rows: JSON.stringify(rows), notes } },
    });
    // Already with the office: saving is enough, submitting again is refused.
    if (intent?.status === "pending_quote") return;
    await submitIntent({ variables: { id } });
  };

  // Each action runs through the busy guard and never throws into the page; failures show in the banner above.
  const guarded = (key: string, task: () => Promise<unknown>) => { void busyAction.run(key, task).catch(() => undefined); };
  const buildQuote = () => guarded("build", async () => {
    // Unsaved edits are saved first so the quote is built from what is on screen.
    if (dirty) await updateIntent({ variables: { id, input: { rows: JSON.stringify(rows), notes } } });
    await generate({ variables: { intentId: id, note: "Generated from intent editor" } });
  });
  const doCancel = () => guarded("cancel", async () => {
    await cancelIntent({ variables: { id, reason: cancelReason.trim() } });
    setConfirm("");
    setCancelReason("");
  });

  const mutationError = saveError || submitError || generateError || cancelError || pickUpError || releaseError || requestError;

  return (
    <div className="space-y-5 pb-12">
      {mutationError ? <QueryErrorBanner error={mutationError} /> : null}
      {notice ? <div role="status" className="rounded-r4 border border-[var(--info)]/25 bg-[var(--info-bg)] px-4 py-2.5 text-sm font-medium text-[var(--info)]">{notice}</div> : null}

      {/* Sticky header */}
      <section className="sticky top-[64px] z-10 -mx-4 lg:-mx-8 border-b border-[var(--line)] bg-[var(--surface)]/95 px-4 py-4 backdrop-blur lg:px-8">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <Link
              href={intent.leadId ? `/dashboard/leads/${intent.leadId}` : "/dashboard/intents"}
              aria-label={intent.leadId ? "Back to the lead" : "Back to intents"}
              className="mt-1 inline-flex h-11 w-11 shrink-0 sm:h-9 sm:w-9 items-center justify-center rounded-md border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-3)] hover:bg-[var(--bg-soft)]"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-[var(--ink-5)]">
                  Intent
                </p>
                <StatusPill tone={badge.tone}>{badge.label}</StatusPill>
                <span className="text-xs font-bold uppercase tracking-widest text-[var(--ink-5)]">
                  {intent.intentType === "revision"
                    ? "Revision"
                    : intent.intentType === "followup"
                      ? "Follow-up"
                      : intent.intentType === "initial"
                        ? "Initial"
                        : intent.intentType}
                </span>
              </div>
              <h1 className="mt-1 truncate text-xl font-bold text-[var(--ink)]">
                {intent.lead?.title || "Lead"}{" "}
                <span className="font-medium text-[var(--ink-3)]">
                  · {intent.customer?.name}
                </span>
              </h1>
              <p className="mt-0.5 text-xs text-[var(--ink-3)]">
                Submitted:{" "}
                {intent.submittedAt
                  ? new Date(intent.submittedAt).toLocaleString()
                  : "not yet"}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Status banners */}
      {isLocked ? (
        <div className="flex flex-wrap items-center gap-3 rounded-r4 border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-900">
          <Lock className="h-4 w-4" />
          <span>
            Office staff{intent.locker ? ` (${intent.locker.name})` : ""} is
            currently building the quote.
          </span>
          <span className="text-xs font-normal text-blue-900/80">
            Lock auto-releases after 30 min idle.
          </span>
          {!myLock && (isOwner || isManager) ? (
            <button
              type="button"
              disabled={busyAction.isBusy()}
              onClick={() => guarded("request", async () => {
                await requestChanges({ variables: { id, message: "Customer asked for further edits" } });
                setNotice("The office was asked to release this intent for edits.");
              })}
              className="ml-auto min-h-11 rounded-full bg-blue-700 px-4 py-1 text-xs font-bold text-white hover:bg-blue-800 disabled:opacity-60 sm:min-h-0 sm:px-3"
            >
              {busyAction.isBusy("request") ? "Asking…" : "Request edit"}
            </button>
          ) : null}
          {myLock || isManager ? (
            <button
              type="button"
              disabled={busyAction.isBusy()}
              onClick={() => setConfirm("release")}
              className="min-h-11 rounded-full bg-white px-4 py-1 text-xs font-bold text-blue-800 ring-1 ring-blue-200 hover:bg-blue-50 disabled:opacity-60 sm:min-h-0 sm:px-3"
            >
              <Unlock className="mr-1 inline h-3 w-3" /> Release lock
            </button>
          ) : null}
        </div>
      ) : null}
      {isPending ? (
        <div className="rounded-r4 border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
          Submitted to office for pricing.{" "}
          <span className="font-normal">
            Still editable until staff picks it up.
          </span>
        </div>
      ) : null}
      {isDraft ? (
        <div className="rounded-r4 border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700">
          Draft: only you can see this. Submit when ready for office to price.
        </div>
      ) : null}
      {isConverted ? (
        <div className="flex items-center justify-between gap-3 rounded-r4 border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">
          <span>
            <Sparkles className="mr-1.5 inline h-4 w-4" /> Quote was generated
            from this intent. Intent is frozen for audit.
          </span>
          {intent.quoteId ? (
            <Link
              href={`/dashboard/quotes/${intent.quoteId}`}
              className="rounded-full bg-emerald-700 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-800"
            >
              View quote →
            </Link>
          ) : null}
        </div>
      ) : null}
      {isCancelled ? (
        <div className="rounded-r4 border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">
          Cancelled intent. Frozen for audit.
        </div>
      ) : null}

      {/* Add row search */}
      {editable ? (
        <section className="rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm-soft">
          <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--ink-3)]">
            Add a product
          </h2>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <div className="flex h-10 items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3">
                <Search className="h-4 w-4 text-[var(--ink-4)]" />
                <input
                  type="search"
                  aria-label="Search products to add"
                  placeholder="Search showroom code, SKU, name or brand…"
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setSearchOpen(true);
                  }}
                  onFocus={() => setSearchOpen(true)}
                  className="w-full bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-5)]"
                />
                {searching ? (
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--brand-600)]" />
                ) : null}
              </div>
              {searchOpen &&
              searchTerm.trim().length >= 2 &&
              products.length > 0 ? (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-md border border-[var(--line)] bg-[var(--surface)] p-1 shadow-lg">
                  {products.map((p: any) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addFromProduct(p)}
                      className="flex w-full items-center justify-between gap-3 rounded-md p-2 text-left hover:bg-[var(--bg-soft)]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-[var(--ink)]">
                          {p.internalCode || p.sku} · {p.name}
                        </p>
                        <p className="truncate text-xs font-mono text-[var(--ink-3)]">
                          {p.sku} · {p.brand} · {p.category}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-bold text-[var(--ink)]">
                        {p.defaultNrpInclusive == null ? 'NRP not set' : money(p.defaultNrpInclusive)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <Button type="button" variant="outline" onClick={() => { setScanOpen((value) => !value); setScanResult(null); }}>
              <Camera className="mr-2 h-4 w-4" />{scanOpen ? "Close scanner" : "Scan showroom item"}
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <label htmlFor="intent-target-room" className="font-semibold text-[var(--ink-3)]">Add to room</label>
            <input id="intent-target-room" list="intent-area-list" value={targetRoom} onChange={(e) => setTargetRoom(e.target.value)} onBlur={() => setTargetRoom((value) => rows.find((row) => sameRoom(row.area, value))?.area || value.trim() || "General Selection")} className="h-9 w-60 rounded-md border-2 border-[var(--brand-500)] bg-[var(--brand-50)] px-2 text-sm font-semibold text-[var(--brand-800)]" />
            {grouped.map(([area]) => (
              <button key={area} type="button" onClick={() => setTargetRoom(area)} className={`rounded-full border px-2.5 py-1 font-semibold ${sameRoom(area, targetRoom) ? "border-[var(--brand-600)] bg-[var(--brand-600)] text-white" : "border-[var(--line)] text-[var(--ink-3)] hover:border-[var(--brand-400)]"}`}>{area}</button>
            ))}
            <span className="text-[var(--ink-4)]">The same code can be added to each room with its own quantity.</span>
          </div>
          {roomNotice ? <div role="status" className="mt-2 rounded-r4 bg-amber-50 p-2.5 text-xs font-semibold text-amber-900">{roomNotice}</div> : null}
          {scanOpen ? <div className="mt-3 rounded-r4 border border-emerald-200 bg-emerald-50 p-3"><PhysicalQrScanner compact busy={scanState.loading} onDetected={addFromScan}/></div> : null}
          {scanResult ? <div className="mt-3"><ScanProductSelector result={scanResult} busy={scanState.loading} existingProductIds={rows.filter((row) => sameRoom(row.area, targetRoom)).map((row) => row.productId || "")} primaryLabel="Add selected to intent" onPrimary={addScannedProducts} onDismiss={() => setScanResult(null)}/></div> : null}
          {scanMessage ? <div role="status" className={`mt-3 flex items-center gap-2 rounded-r4 p-3 text-xs font-semibold ${scanMessage.startsWith("Scan blocked") ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>{scanMessage.startsWith("Scan blocked") ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}{scanMessage}</div> : null}
          {scanState.error ? <div className="mt-3"><QueryErrorBanner error={scanState.error}/></div> : null}
        </section>
      ) : null}

      {/* Row groups */}
      <section className="rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm-soft">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--ink-3)]">
            Selection
          </h2>
          <p className="text-sm font-bold text-[var(--ink)]">
            {rows.length} rows · {money(total)}
          </p>
        </div>

        {rows.length === 0 ? (
          <EmptyState compact className="mt-4 rounded-r4 border border-dashed border-[var(--line)]" title="No items yet" description={editable ? "Search above to add products." : "Nothing was added to this intent."} />
        ) : null}

        <datalist id="intent-area-list">
          {AREA_SUGGESTIONS.map((area) => <option key={area} value={area} />)}
        </datalist>
        <div className="mt-4 space-y-4">
          {grouped.map(([area, areaRows]) => (
            <div key={area}>
              <p className="px-1 pb-2 text-xs font-bold uppercase tracking-widest text-[var(--ink-4)]">
                {area}
              </p>
              <ul className="space-y-2">
                {areaRows.map((row, i) => {
                  // Index in the flat rows array for editing
                  const flatIdx = rows.indexOf(row);
                  const isTile =
                    row.type === "tile" || row.category === "Tiles";
                  return (
                    <li
                      key={flatIdx}
                      className="rounded-r4 border border-[var(--line)] bg-[var(--bg-soft)]/40 p-3"
                    >
                      <div className="grid gap-2 sm:grid-cols-[1.5fr_repeat(4,minmax(0,1fr))_auto]">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[var(--ink)]">
                            {row.name || "Product Master item"}
                          </p>
                          <p className="mt-1 text-xs font-mono text-[var(--ink-4)]">
                            {row.sku ||
                              (row.productId
                                ? `id:${row.productId.slice(-6)}`
                                : "custom")}
                            {row.brand ? ` · ${row.brand}` : ""}
                            {row.finish ? ` · ${row.finish}` : ""}
                          </p>
                          {row.productId && (codeTotals.get(row.productId)?.rooms.length || 0) > 1 ? (
                            <p className="mt-1 inline-block rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-semibold text-blue-800">
                              Also in {codeTotals.get(row.productId)!.rooms.filter((room) => !sameRoom(room, row.area)).join(", ")} · {codeTotals.get(row.productId)!.qty} {codeTotals.get(row.productId)!.unit} in total
                            </p>
                          ) : null}
                          {isTile ? (
                            <p className="mt-1 text-xs font-semibold text-[var(--brand-700)]">
                              Display code {row.tileCode || row.sku} ·{" "}
                              {row.tileSize || "size pending"}
                            </p>
                          ) : null}
                          {editable ? (
                            <Input
                              className="mt-2"
                              value={row.quoteImage || ""}
                              onChange={(e) =>
                                updateRow(flatIdx, {
                                  quoteImage: e.target.value,
                                })
                              }
                              aria-label={`Customer-facing image link for ${row.name || "this item"}`}
                              placeholder="Optional customer-facing image URL"
                            />
                          ) : null}
                        </div>
                        <div>
                          <label htmlFor={`intent-qty-${flatIdx}`} className="text-xs font-bold uppercase tracking-widest text-[var(--ink-5)]">
                            Qty
                          </label>
                          {isAreaPriced(row) ? (
                            <div className="space-y-1">
                              <Input
                                id={`intent-qty-${flatIdx}`}
                                type="number"
                                min="0"
                                data-needs-value
                                placeholder={`Enter ${row.pricingUom || "area"}`}
                                value={emptyWhenZero(row.requestedArea)}
                                onChange={(e) =>
                                  updateRow(flatIdx, {
                                    requestedArea: Number(e.target.value || 0),
                                  })
                                }
                                disabled={!editable}
                              />
                              <div className="text-xs text-[var(--ink-4)]">
                                {row.qty || 0} {row.inventoryUom}
                              </div>
                            </div>
                          ) : (
                            <Input
                              id={`intent-qty-${flatIdx}`}
                              type="number"
                              min="1"
                              data-needs-value
                              placeholder="Enter qty"
                              value={emptyWhenZero(row.qty)}
                              onChange={(e) =>
                                updateRow(flatIdx, {
                                  qty: Number(e.target.value || 0),
                                })
                              }
                              disabled={!editable}
                            />
                          )}
                        </div>
                        <div>
                          <label htmlFor={`intent-unit-${flatIdx}`} className="text-xs font-bold uppercase tracking-widest text-[var(--ink-5)]">
                            Unit
                          </label>
                          <Input
                            id={`intent-unit-${flatIdx}`}
                            value={
                              isAreaPriced(row)
                                ? `${row.pricingUom} rate / ${row.inventoryUom} stock`
                                : row.unit || "PC"
                            }
                            disabled
                          />
                        </div>
                        <div>
                          <label htmlFor={`intent-price-${flatIdx}`} className="text-xs font-bold uppercase tracking-widest text-[var(--ink-5)]">
                            Price ₹
                          </label>
                          <Input
                            id={`intent-price-${flatIdx}`}
                            type="number"
                            min="0"
                            placeholder="Rate ₹ (optional)"
                            value={emptyWhenZero(row.price)}
                            onChange={(e) =>
                              updateRow(flatIdx, {
                                price: Number(e.target.value || 0),
                              })
                            }
                            disabled={!editable}
                          />
                        </div>
                        <div>
                          <label htmlFor={`intent-area-${flatIdx}`} className="text-xs font-bold uppercase tracking-widest text-[var(--ink-5)]">
                            Area
                          </label>
                          <AreaInput
                            id={`intent-area-${flatIdx}`}
                            value={row.area || "General Selection"}
                            onCommit={(area) => updateRow(flatIdx, { area })}
                            disabled={!editable}
                          />
                        </div>
                        <div className="self-end">
                          {editable ? (
                            <button
                              type="button"
                              onClick={() => removeRow(flatIdx)}
                              aria-label={`Remove ${row.name || "this item"}`}
                              className="grid h-11 w-11 place-items-center sm:h-9 sm:w-9 rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-end gap-2 text-xs">
                        <span className="font-bold text-[var(--ink)]">
                          Line total:{" "}
                          {money(
                            rowPricingQuantity(row) * Number(row.price || 0),
                          )}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Notes */}
      <section className="rounded-r5 border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm-soft">
        <label htmlFor="intent-notes" className="text-xs font-bold uppercase tracking-widest text-[var(--ink-5)]">
          Notes for office
        </label>
        <textarea
          id="intent-notes"
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setDirty(true);
          }}
          rows={3}
          disabled={!editable}
          placeholder="Customer prefers chrome finish. Master bath items need delivery by Friday."
          className="mt-2 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] p-3 text-sm text-[var(--ink)] disabled:opacity-60"
        />
      </section>

      {/* Sticky action bar */}
      <section className="sticky bottom-0 z-10 -mx-4 lg:-mx-8 border-t border-[var(--line)] bg-[var(--surface)]/95 px-4 py-3 backdrop-blur lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-[var(--ink-3)]">
            {dirty ? (
              <span className="font-bold text-amber-700">Unsaved changes</span>
            ) : (
              <span>All changes saved.</span>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {editable ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => guarded("save", async () => { await updateIntent({ variables: { id, input: { rows: JSON.stringify(rows), notes } } }); })}
                  disabled={saving || !dirty || busyAction.isBusy()}
                >
                  <Save className="mr-1.5 h-3.5 w-3.5" />{" "}
                  {saving ? "Saving…" : "Save"}
                </Button>
                {isDraft || isPending ? (
                  <Button
                    size="sm"
                    onClick={() => guarded("submit", saveAndSubmit)}
                    disabled={submitting || saving || rows.length === 0 || busyAction.isBusy()}
                  >
                    <Send className="mr-1.5 h-3.5 w-3.5" />{" "}
                    {submitting
                      ? "Submitting…"
                      : isPending
                        ? "Save changes"
                        : "Submit to office"}
                  </Button>
                ) : null}
              </>
            ) : null}
            {isOfficeOrManager && isPending ? (
              <Button size="sm" disabled={busyAction.isBusy()} loading={busyAction.isBusy("pickup")} onClick={() => guarded("pickup", async () => { await pickUp({ variables: { id } }); })}>
                <Hammer className="mr-1.5 h-3.5 w-3.5" /> Pick up
              </Button>
            ) : null}
            {isOfficeOrManager && isLocked && (myLock || isManager) ? (
              <Button
                size="sm"
                onClick={() => (dirty ? setConfirm("build") : buildQuote())}
                disabled={generating || busyAction.isBusy()}
              >
                <Check className="mr-1.5 h-3.5 w-3.5" />{" "}
                {generating ? "Generating…" : "Build quote"}
              </Button>
            ) : null}
            {!isConverted && !isCancelled ? (
              <button
                type="button"
                onClick={() => setConfirm("cancel")}
                disabled={cancelling || busyAction.isBusy()}
                className="inline-flex h-11 items-center sm:h-9 gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-3 text-xs font-bold uppercase tracking-widest text-rose-700 hover:bg-rose-100"
              >
                <X className="h-3.5 w-3.5" /> Cancel intent
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={confirm === "cancel"}
        onOpenChange={(open) => { if (!open) { setConfirm(""); setCancelReason(""); } }}
        title="Cancel this intent?"
        description="The intent is frozen for audit and cannot be edited or turned into a quote afterwards."
        confirmLabel="Cancel intent"
        cancelLabel="Keep intent"
        tone="danger"
        busy={busyAction.isBusy("cancel")}
        confirmDisabled={!cancelReason.trim()}
        onConfirm={doCancel}
      >
        <Field label="Reason for cancelling" htmlFor="intent-cancel-reason" required hint="Kept in the intent history.">
          <Textarea id="intent-cancel-reason" rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Why is this intent being cancelled?" />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "release"}
        onOpenChange={(open) => { if (!open) setConfirm(""); }}
        title="Release the lock?"
        description={myLock ? "You stop building this quote and the intent goes back to pending for the office." : "You take the lock away from the office staff who is building this quote. They can no longer build the quote from this intent until it is picked up again."}
        confirmLabel="Release lock"
        cancelLabel="Keep lock"
        tone="danger"
        busy={busyAction.isBusy("release")}
        onConfirm={() => guarded("release", async () => { await release({ variables: { id, force: !myLock } }); setConfirm(""); })}
      />
      <ConfirmDialog
        open={confirm === "build"}
        onOpenChange={(open) => { if (!open) setConfirm(""); }}
        title="Save your edits and build the quote?"
        description="You changed this intent and have not saved yet. Your edits are saved first, then the quote is built from what is on screen."
        confirmLabel="Save and build quote"
        cancelLabel="Not yet"
        busy={busyAction.isBusy("build")}
        onConfirm={() => { setConfirm(""); buildQuote(); }}
      />
    </div>
  );
}
