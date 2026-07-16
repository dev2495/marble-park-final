"use client";

import { gql, useApolloClient, useMutation, useQuery } from "@apollo/client";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  Hammer,
  Lock,
  Save,
  Search,
  Send,
  Sparkles,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QueryErrorBanner } from "@/components/query-state";

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

function intentStatusBadge(status: string) {
  switch (status) {
    case "draft":
      return { bg: "bg-slate-100 text-slate-700", label: "Draft" };
    case "pending_quote":
      return { bg: "bg-amber-100 text-amber-800", label: "Pending quote" };
    case "in_quote":
      return {
        bg: "bg-blue-100 text-blue-800",
        label: "Office building quote",
      };
    case "converted":
      return { bg: "bg-emerald-100 text-emerald-800", label: "Converted" };
    case "cancelled":
      return { bg: "bg-rose-100 text-rose-700", label: "Cancelled" };
    case "quoted":
      return { bg: "bg-emerald-100 text-emerald-800", label: "Quote built" };
    default:
      return { bg: "bg-slate-100 text-slate-700", label: status };
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
  useEffect(() => {
    if (!intent) return;
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
        wastagePercent: Number(r.wastagePercent || 0),
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
        setDirty(false);
        refetch();
      },
    },
  );
  const [submitIntent, { loading: submitting, error: submitError }] =
    useMutation(SUBMIT_INTENT, { onCompleted: () => refetch() });
  const [cancelIntent, { loading: cancelling }] = useMutation(CANCEL_INTENT, {
    onCompleted: () => refetch(),
  });
  const [pickUp] = useMutation(PICK_UP, { onCompleted: () => refetch() });
  const [release] = useMutation(RELEASE, { onCompleted: () => refetch() });
  const [requestChanges] = useMutation(REQUEST_CHANGES);
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

  // Product search panel for adding rows
  const [searchTerm, setSearchTerm] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
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
  ].includes(role);
  const grouped = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const row of rows) {
      const key = row.area || "General Selection";
      map.set(key, [...(map.get(key) || []), row]);
    }
    return Array.from(map.entries());
  }, [rows]);

  if (loading && !intent)
    return (
      <div className="p-10 text-sm text-[var(--ink-3)]">Loading intent…</div>
    );
  if (error && !intent)
    return (
      <div className="p-6">
        <QueryErrorBanner error={error} onRetry={() => refetch()} />
      </div>
    );
  if (!intent)
    return (
      <div className="p-10 text-sm text-[var(--ink-3)]">Intent not found.</div>
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
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== idx) return row;
        const updated = { ...row, ...patch };
        if (
          isAreaPriced(updated) &&
          ("requestedArea" in patch || "wastagePercent" in patch)
        ) {
          const required =
            Number(updated.requestedArea || 0) *
            (1 + Number(updated.wastagePercent || 0) / 100);
          updated.qty = Math.max(
            1,
            Math.ceil(required / Number(updated.coveragePerPack || 1)),
          );
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
    setRows((prev) => [
      ...prev,
      {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        category: product.category,
        brand: product.brand,
        finish: product.finish,
        qty: 1,
        price: Number(product.sellPrice || 0),
        unit: product.unit || "PC",
        area: "General Selection",
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
        rateBasis: ["SQFT", "SQM", "M2"].includes(
          String(product.salesUom || "").toUpperCase(),
        )
          ? "AREA"
          : "PACK",
        coveragePerPack: Number(product.coveragePerPack || 0),
        piecesPerPack: Number(product.piecesPerPack || 1),
        requestedArea: Number(product.coveragePerPack || 0),
        wastagePercent:
          String(product.category || "").toLowerCase() === "tiles" ? 10 : 0,
      },
    ]);
    setDirty(true);
    setSearchTerm("");
    setSearchOpen(false);
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
    await submitIntent({ variables: { id } });
  };

  const mutationError = saveError || submitError || generateError;

  return (
    <div className="space-y-5 pb-12">
      {mutationError ? <QueryErrorBanner error={mutationError} /> : null}

      {/* Sticky header */}
      <section className="sticky top-[64px] z-10 -mx-4 lg:-mx-8 border-b border-[var(--line)] bg-[var(--surface)]/95 px-4 py-4 backdrop-blur lg:px-8">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <Link
              href={`/dashboard/leads/${intent.leadId}`}
              className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-3)] hover:bg-[var(--bg-soft)]"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--ink-5)]">
                  Intent
                </p>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${badge.bg}`}
                >
                  {badge.label}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--ink-5)]">
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
              onClick={() =>
                requestChanges({
                  variables: {
                    id,
                    message: "Customer asked for further edits",
                  },
                })
              }
              className="ml-auto rounded-full bg-blue-700 px-3 py-1 text-xs font-bold text-white hover:bg-blue-800"
            >
              Request edit
            </button>
          ) : null}
          {myLock || isManager ? (
            <button
              type="button"
              onClick={() => release({ variables: { id, force: !myLock } })}
              className="rounded-full bg-white px-3 py-1 text-xs font-bold text-blue-800 ring-1 ring-blue-200 hover:bg-blue-50"
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
          Draft — only you can see this. Submit when ready for office to price.
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
                        <p className="truncate text-[10px] font-mono text-[var(--ink-3)]">
                          {p.sku} · {p.brand} · {p.category}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-bold text-[var(--ink)]">
                        {money(p.sellPrice)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
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
          <p className="mt-4 rounded-r4 border border-dashed border-[var(--line)] p-8 text-center text-sm text-[var(--ink-4)]">
            No items yet. {editable ? "Search above to add products." : ""}
          </p>
        ) : null}

        <div className="mt-4 space-y-4">
          {grouped.map(([area, areaRows]) => (
            <div key={area}>
              <p className="px-1 pb-2 text-[10px] font-bold uppercase tracking-widest text-[var(--ink-4)]">
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
                          <p className="mt-1 text-[10px] font-mono text-[var(--ink-4)]">
                            {row.sku ||
                              (row.productId
                                ? `id:${row.productId.slice(-6)}`
                                : "custom")}
                            {row.brand ? ` · ${row.brand}` : ""}
                            {row.finish ? ` · ${row.finish}` : ""}
                          </p>
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
                              placeholder="Optional customer-facing image URL"
                            />
                          ) : null}
                        </div>
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--ink-5)]">
                            Qty
                          </label>
                          {isAreaPriced(row) ? (
                            <div className="space-y-1">
                              <Input
                                type="number"
                                min="0"
                                value={row.requestedArea || 0}
                                onChange={(e) =>
                                  updateRow(flatIdx, {
                                    requestedArea: Number(e.target.value || 0),
                                  })
                                }
                                disabled={!editable}
                              />
                              <div className="flex items-center gap-1 text-[10px] text-[var(--ink-4)]">
                                <span>Waste</span>
                                <input
                                  className="h-6 w-10 rounded border border-[var(--line)] text-center"
                                  type="number"
                                  min={0}
                                  max={100}
                                  value={row.wastagePercent || 0}
                                  onChange={(e) =>
                                    updateRow(flatIdx, {
                                      wastagePercent: Number(
                                        e.target.value || 0,
                                      ),
                                    })
                                  }
                                  disabled={!editable}
                                />
                                <span>
                                  % · {row.qty} {row.inventoryUom}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <Input
                              type="number"
                              min="1"
                              value={row.qty}
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
                          <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--ink-5)]">
                            Unit
                          </label>
                          <Input
                            value={
                              isAreaPriced(row)
                                ? `${row.pricingUom} rate / ${row.inventoryUom} stock`
                                : row.unit || "PC"
                            }
                            disabled
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--ink-5)]">
                            Price ₹
                          </label>
                          <Input
                            type="number"
                            min="0"
                            value={row.price}
                            onChange={(e) =>
                              updateRow(flatIdx, {
                                price: Number(e.target.value || 0),
                              })
                            }
                            disabled={!editable}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--ink-5)]">
                            Area
                          </label>
                          <Input
                            value={row.area || "General Selection"}
                            onChange={(e) =>
                              updateRow(flatIdx, { area: e.target.value })
                            }
                            disabled={!editable}
                          />
                        </div>
                        <div className="self-end">
                          {editable ? (
                            <button
                              type="button"
                              onClick={() => removeRow(flatIdx)}
                              className="grid h-9 w-9 place-items-center rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
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
        <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--ink-5)]">
          Notes for office
        </label>
        <textarea
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
                  onClick={saveDraft}
                  disabled={saving || !dirty}
                >
                  <Save className="mr-1.5 h-3.5 w-3.5" />{" "}
                  {saving ? "Saving…" : "Save"}
                </Button>
                {isDraft || isPending ? (
                  <Button
                    size="sm"
                    onClick={saveAndSubmit}
                    disabled={submitting || saving || rows.length === 0}
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
              <Button size="sm" onClick={() => pickUp({ variables: { id } })}>
                <Hammer className="mr-1.5 h-3.5 w-3.5" /> Pick up
              </Button>
            ) : null}
            {isOfficeOrManager && isLocked && (myLock || isManager) ? (
              <Button
                size="sm"
                onClick={() =>
                  generate({
                    variables: {
                      intentId: id,
                      note: "Generated from intent editor",
                    },
                  })
                }
                disabled={generating}
              >
                <Check className="mr-1.5 h-3.5 w-3.5" />{" "}
                {generating ? "Generating…" : "Build quote"}
              </Button>
            ) : null}
            {!isConverted && !isCancelled ? (
              <button
                type="button"
                onClick={() =>
                  cancelIntent({
                    variables: { id, reason: "Cancelled from editor" },
                  })
                }
                disabled={cancelling}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-3 text-xs font-bold uppercase tracking-widest text-rose-700 hover:bg-rose-100"
              >
                <X className="h-3.5 w-3.5" /> Cancel intent
              </button>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
