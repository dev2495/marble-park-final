"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { gql, useMutation, useQuery } from "@apollo/client";
import {
  ArrowLeft,
  Barcode,
  Boxes,
  Check,
  ChevronLeft,
  ChevronRight,
  HelpCircle as CircleHelp,
  ImageOff,
  MapPin,
  PackageCheck,
  RotateCcw,
  Search,
  Store,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProductImageFrame } from "@/components/product-image-frame";
import { QueryErrorBanner } from "@/components/query-state";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

const DATA = gql`
  query DisplayAssetDesk(
    $productSearch: String
    $lotSearch: String
    $productId: String
    $displaySearch: String
    $displayStatus: String
    $skip: Int
    $take: Int
  ) {
    products(search: $productSearch, take: 50) {
      id
      sku
      internalCode
      name
      category
      brand
      finish
      dimensions
      media
      purchaseUom
      piecesPerPack
    }
    inventoryLots(
      productId: $productId
      status: "active"
      search: $lotSearch
      take: 100
    )
    stockLocations(status: "active")
    displaySamplesPage(
      search: $displaySearch
      status: $displayStatus
      sort: "updated"
      skip: $skip
      take: $take
    )
  }
`;
const PRODUCT = gql`
  query DisplayAssetProduct($id: ID!) {
    product(id: $id) {
      id
      sku
      internalCode
      name
      category
      brand
      finish
      dimensions
      media
      purchaseUom
      piecesPerPack
    }
  }
`;
const CREATE = gql`
  mutation CreateDisplayAsset($input: DisplaySampleInput!) {
    createDisplaySample(input: $input)
  }
`;
const UPDATE = gql`
  mutation UpdateDisplayAsset($id: ID!, $input: UpdateDisplaySampleInput!) {
    updateDisplaySample(id: $id, input: $input)
  }
`;
const TRANSITION = gql`
  mutation TransitionDisplayAsset(
    $id: ID!
    $input: DisplaySampleTransitionInput!
  ) {
    transitionDisplaySample(id: $id, input: $input)
  }
`;
const LABEL = gql`
  mutation LabelDisplayAsset($input: InternalLabelJobInput!) {
    createInternalLabelJob(input: $input)
  }
`;

type SourceMode = "inventory" | "vendor";
const blank = {
  id: "",
  productId: "",
  internalCode: "",
  locationId: "",
  displayZone: "",
  imageUrl: "",
  sourceLotId: "",
  issuedQuantity: "1",
  condition: "good",
  nextInspectionAt: "",
  status: "active",
};

function imageOf(value: any) {
  const media = value?.media || value?.product?.media || {};
  return (
    value?.imageUrl ||
    media.primaryUrl ||
    media.primary ||
    media.images?.[0]?.url ||
    media.images?.[0] ||
    media.gallery?.[0]?.url ||
    media.gallery?.[0] ||
    ""
  );
}
function available(lot: any) {
  return (lot?.balances || []).reduce(
    (sum: number, row: any) => sum + Number(row.available || 0),
    0,
  );
}
function receiptOf(lot: any) {
  return lot?.goodsReceiptLines?.[0]?.goodsReceiptNote || null;
}
function dateOf(value: any) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : date.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
}

export default function DisplayAssetsPage() {
  const pageSize = 24;
  const [sourceMode, setSourceMode] = useState<SourceMode>("inventory");
  const [productSearch, setProductSearch] = useState("");
  const [lotSearch, setLotSearch] = useState("");
  const [displaySearch, setDisplaySearch] = useState("");
  const [displayStatus, setDisplayStatus] = useState("all");
  const [page, setPage] = useState(0);
  const [form, setForm] = useState<any>(blank);
  const [notice, setNotice] = useState("");
  const [reason, setReason] = useState(
    "Routine showroom display lifecycle update",
  );
  const dProduct = useDebouncedValue(productSearch.trim(), 250);
  const dLot = useDebouncedValue(lotSearch.trim(), 250);
  const dDisplay = useDebouncedValue(displaySearch.trim(), 250);
  const { data, loading, error, refetch } = useQuery(DATA, {
    variables: {
      productSearch: dProduct || undefined,
      lotSearch: dLot || undefined,
      productId: form.productId || undefined,
      displaySearch: dDisplay || undefined,
      displayStatus,
      skip: page * pageSize,
      take: pageSize,
    },
    fetchPolicy: "cache-and-network",
  });
  const { data: directProductData, error: directProductError } = useQuery(
    PRODUCT,
    { variables: { id: form.productId }, skip: !form.productId },
  );
  const [create, createState] = useMutation(CREATE);
  const [update, updateState] = useMutation(UPDATE);
  const [transition, transitionState] = useMutation(TRANSITION);
  const [label, labelState] = useMutation(LABEL);
  const products = data?.products || [];
  const lots = useMemo<any[]>(
    () => data?.inventoryLots || [],
    [data?.inventoryLots],
  );
  const locations = data?.stockLocations || [];
  const register = data?.displaySamplesPage?.items || [];
  const selectedProduct =
    directProductData?.product ||
    products.find((row: any) => row.id === form.productId);
  const selectedLot = lots.find((row: any) => row.id === form.sourceLotId);
  const locationOptions =
    sourceMode === "inventory" && selectedLot
      ? locations.filter((location: any) =>
          (selectedLot.balances || []).some(
            (balance: any) =>
              balance.locationId === location.id &&
              Number(balance.available || 0) > 0,
          ),
        )
      : locations;
  const errors = [
    error,
    directProductError,
    createState.error,
    updateState.error,
    transitionState.error,
    labelState.error,
  ].filter(Boolean);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const productId = query.get("product");
    const lotId = query.get("lot");
    if (productId || lotId) {
      setSourceMode("inventory");
      setForm((current: any) => ({
        ...current,
        productId: productId || current.productId,
        sourceLotId: lotId || current.sourceLotId,
        locationId: query.get("location") || current.locationId,
      }));
    }
  }, []);
  useEffect(() => {
    if (!form.sourceLotId || !lots.length) return;
    const lot = lots.find((row: any) => row.id === form.sourceLotId);
    if (!lot) return;
    const balance =
      (lot.balances || []).find(
        (row: any) => row.locationId === form.locationId,
      ) || (lot.balances || []).find((row: any) => Number(row.available) > 0);
    setForm((current: any) => {
      const productId = current.productId || lot.productId;
      const locationId = current.locationId || balance?.locationId || "";
      return productId === current.productId &&
        locationId === current.locationId
        ? current
        : { ...current, productId, locationId };
    });
  }, [form.locationId, form.sourceLotId, lots]);

  function chooseProduct(product: any) {
    setForm((current: any) => ({
      ...blank,
      productId: product.id,
      internalCode: `${product.internalCode || product.sku}-D`,
      imageUrl: imageOf(product),
      locationId: current.locationId || locations[0]?.id || "",
    }));
    setProductSearch("");
    setLotSearch("");
  }
  function clear() {
    setForm(blank);
    setProductSearch("");
    setLotSearch("");
    setReason("Routine showroom display lifecycle update");
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const common = {
      internalCode: form.internalCode,
      locationId: form.locationId || undefined,
      displayZone: form.displayZone || undefined,
      imageUrl: form.imageUrl || undefined,
      condition: form.condition,
      nextInspectionAt: form.nextInspectionAt || undefined,
    };
    if (form.id) {
      await update({
        variables: { id: form.id, input: { ...common, status: form.status } },
      });
      setNotice(`${form.internalCode} updated. The entry form is blank again.`);
    } else {
      const input: any = {
        ...common,
        productId: form.productId,
        metadata: {
          sourceMode:
            sourceMode === "inventory"
              ? "issued_from_inventory"
              : "direct_vendor_sample",
        },
      };
      if (sourceMode === "inventory") {
        input.sourceLotId = form.sourceLotId;
        input.issuedQuantity = Number(form.issuedQuantity || 0);
      }
      const saved = (await create({ variables: { input } })).data
        ?.createDisplaySample;
      if (saved?.id)
        await label({
          variables: {
            input: {
              displaySampleId: saved.id,
              quantity: 1,
              template: "display_sample",
              newJob: true,
            },
          },
        });
      setNotice(
        sourceMode === "inventory"
          ? `${saved?.sampleNumber || "Display"} created. ${form.issuedQuantity} unit(s) moved out of the exact saleable lot and a label job is ready.`
          : `${saved?.sampleNumber || "Display"} registered as a non-stock vendor sample. Saleable inventory was not changed and a label job is ready.`,
      );
    }
    clear();
    await refetch();
  }
  async function act(action: string) {
    if (!form.id || !reason.trim()) return;
    await transition({
      variables: {
        id: form.id,
        input: {
          action,
          reason,
          condition: form.condition,
          returnQuantity:
            action === "return_to_stock"
              ? Number(form.issuedQuantity || 0)
              : undefined,
          nextInspectionAt: form.nextInspectionAt || undefined,
        },
      },
    });
    setNotice(
      `${form.internalCode}: ${action.replaceAll("_", " ")} recorded with reason and audit history.`,
    );
    clear();
    await refetch();
  }
  const busy =
    createState.loading ||
    updateState.loading ||
    labelState.loading ||
    transitionState.loading;

  return (
    <div className="space-y-5 pb-12">
      {errors.map((item: any, index) => (
        <QueryErrorBanner key={index} error={item} />
      ))}
      <header className="relative overflow-hidden rounded-[1.75rem] border border-[#decac2] bg-[radial-gradient(circle_at_86%_10%,rgba(234,137,93,.26),transparent_28%),linear-gradient(125deg,#1e1a18,#4f2922_54%,#9a3b2f)] p-6 text-white shadow-[0_26px_70px_-42px_rgba(90,28,20,.85)] sm:p-8">
        <div className="flex flex-col justify-between gap-6 xl:flex-row xl:items-end">
          <div>
            <Link
              href="/dashboard/inventory"
              className="inline-flex items-center gap-2 text-xs font-semibold text-white/65"
            >
              <ArrowLeft className="h-4 w-4" />
              Inventory
            </Link>
            <p className="mt-5 text-[11px] font-bold uppercase tracking-[.18em] text-[#f2c6b7]">
              Showroom asset control
            </p>
            <h1 className="mt-2 max-w-3xl font-display text-3xl font-bold sm:text-4xl">
              Move exact stock to display—or register a true vendor sample.
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/72">
              Purchased goods must be posted through GRN first, then issued from
              their exact lot. Free vendor samples are registered directly and
              never inflate saleable inventory.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Metric
              value={data?.displaySamplesPage?.total || 0}
              label="assets"
            />
            <Metric
              value={
                register.filter((row: any) => row.status === "active").length
              }
              label="active here"
            />
            <Metric
              value={
                register.filter((row: any) => row.status === "maintenance")
                  .length
              }
              label="maintenance"
            />
          </div>
        </div>
      </header>
      {notice ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900"
        >
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          {notice}
          <Button
            asChild
            size="sm"
            variant="outline"
            className="ml-auto shrink-0"
          >
            <Link href="/dashboard/inventory/labels">Print label</Link>
          </Button>
        </div>
      ) : null}
      <section className="grid min-w-0 gap-5 xl:grid-cols-[27rem_1fr]">
        <form
          onSubmit={save}
          className="mp-panel min-w-0 self-start overflow-hidden xl:sticky xl:top-20"
        >
          <div className="border-b border-[var(--line)] bg-[var(--bg-soft)] p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-bold">
                  {form.id ? "Manage display asset" : "Create display asset"}
                </h2>
                <p className="mt-1 text-xs leading-5 text-[var(--ink-4)]">
                  One physical asset, one display code, one QR identity.
                </p>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Clear form"
                onClick={clear}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
            {!form.id ? (
              <div className="mt-4 grid grid-cols-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1">
                <button
                  type="button"
                  onClick={() => {
                    setSourceMode("inventory");
                    clear();
                  }}
                  className={`min-h-12 rounded-lg px-2 text-xs font-bold ${sourceMode === "inventory" ? "bg-[#9f302a] text-white" : "text-[var(--ink-3)]"}`}
                >
                  <Boxes className="mr-1.5 inline h-4 w-4" />
                  From inventory
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSourceMode("vendor");
                    clear();
                  }}
                  className={`min-h-12 rounded-lg px-2 text-xs font-bold ${sourceMode === "vendor" ? "bg-[#9f302a] text-white" : "text-[var(--ink-3)]"}`}
                >
                  <Truck className="mr-1.5 inline h-4 w-4" />
                  Vendor sample
                </button>
              </div>
            ) : null}
          </div>
          <div className="space-y-3 p-5">
            {!form.id ? (
              <>
                <label className="block text-xs font-semibold text-[var(--ink-4)]">
                  Product or tile variant
                  <Input
                    className="mt-1"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Search SKU, display code, design, brand or item"
                  />
                </label>
                {productSearch.trim().length >= 2 ? (
                  <div className="max-h-52 overflow-y-auto rounded-xl border border-[var(--line)]">
                    {products.map((product: any) => (
                      <button
                        type="button"
                        key={product.id}
                        onClick={() => chooseProduct(product)}
                        className="flex w-full items-center gap-3 border-b border-[var(--line)] p-3 text-left last:border-0 hover:bg-[var(--bg-soft)]"
                      >
                        <ProductImageFrame
                          src={imageOf(product)}
                          alt={product.name}
                          className="h-11 w-12 shrink-0 rounded-lg"
                        />
                        <span className="min-w-0">
                          <b className="block truncate text-xs">
                            {product.internalCode || product.sku} ·{" "}
                            {product.name}
                          </b>
                          <small className="block truncate text-[var(--ink-4)]">
                            {product.sku} · {product.brand} ·{" "}
                            {product.dimensions}
                          </small>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
                {selectedProduct ? (
                  <div className="flex gap-3 rounded-xl border border-[#e7cfc5] bg-[#fff8f5] p-3">
                    <ProductImageFrame
                      src={imageOf(selectedProduct)}
                      alt={selectedProduct.name}
                      className="h-14 w-14 shrink-0 rounded-lg"
                    />
                    <div className="min-w-0">
                      <b className="block truncate text-sm">
                        {selectedProduct.internalCode || selectedProduct.sku} ·{" "}
                        {selectedProduct.name}
                      </b>
                      <p className="mt-1 text-xs text-[var(--ink-4)]">
                        {selectedProduct.brand} · {selectedProduct.finish} ·{" "}
                        {selectedProduct.dimensions}
                      </p>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="rounded-xl bg-[var(--bg-soft)] p-3 text-xs">
                <b>{form.internalCode}</b>
                <br />
                {form.product?.name || "Registered product"} ·{" "}
                {form.sampleNumber}
              </div>
            )}
            <label className="block text-xs font-semibold text-[var(--ink-4)]">
              Unique display code
              <Input
                className="mt-1"
                required
                value={form.internalCode}
                onChange={(e) =>
                  setForm({
                    ...form,
                    internalCode: e.target.value.toUpperCase(),
                  })
                }
                placeholder="e.g. WALL-A12-D01"
              />
            </label>
            <label className="block text-xs font-semibold text-[var(--ink-4)]">
              Showroom / branch location
              <select
                required
                value={form.locationId}
                onChange={(e) =>
                  setForm({ ...form, locationId: e.target.value })
                }
                className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3"
              >
                <option value="">Select location</option>
                {locationOptions.map((location: any) => (
                  <option key={location.id} value={location.id}>
                    {location.code} · {location.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold text-[var(--ink-4)]">
              Zone
              <Input
                required
                className="mt-1"
                value={form.displayZone}
                onChange={(e) =>
                  setForm({ ...form, displayZone: e.target.value })
                }
                placeholder="e.g. Tile wall A or Bathroom bay 04"
              />
            </label>
            {!form.id && sourceMode === "inventory" ? (
              <>
                <label className="block text-xs font-semibold text-[var(--ink-4)]">
                  Find the exact received lot
                  <Input
                    className="mt-1"
                    value={lotSearch}
                    onChange={(e) => setLotSearch(e.target.value)}
                    placeholder="Search GRN, supplier, challan, bill, batch or lot"
                  />
                </label>
                <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--bg-soft)] p-2">
                  {lots
                    .filter((lot: any) => available(lot) > 0)
                    .map((lot: any) => {
                      const receipt = receiptOf(lot);
                      const selected = form.sourceLotId === lot.id;
                      const product = lot.product || selectedProduct;
                      return (
                        <button
                          type="button"
                          key={lot.id}
                          aria-pressed={selected}
                          onClick={() => {
                            const balance = (lot.balances || []).find(
                              (row: any) => Number(row.available) > 0,
                            );
                            setForm({
                              ...form,
                              sourceLotId: lot.id,
                              locationId:
                                balance?.locationId || form.locationId,
                            });
                          }}
                          className={`w-full rounded-lg border p-3 text-left transition ${
                            selected
                              ? "border-[#9f302a] bg-[#fff4ef] shadow-sm"
                              : "border-[var(--line)] bg-[var(--surface)] hover:border-[#d5aca0]"
                          }`}
                        >
                          <span className="flex items-start justify-between gap-3">
                            <span className="min-w-0">
                              <b className="block truncate text-xs">
                                {receipt?.grnNumber || lot.lotNumber} ·{" "}
                                {receipt?.vendorName ||
                                  "Opening stock / legacy lot"}
                              </b>
                              <small className="mt-1 block truncate text-[var(--ink-4)]">
                                {product?.internalCode || product?.sku} ·{" "}
                                {product?.tileDesignMaster?.name ||
                                  product?.name}
                              </small>
                              <small className="mt-1 block text-[var(--ink-4)]">
                                {product?.tileSizeMaster?.name ||
                                  product?.dimensions ||
                                  "Size not recorded"}
                                {product?.finish ? ` · ${product.finish}` : ""} ·{" "}
                                {dateOf(
                                  receipt?.receivedDate || lot.receivedAt,
                                )}
                              </small>
                            </span>
                            <span className="shrink-0 rounded-md bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-800">
                              {available(lot)} available
                            </span>
                          </span>
                          <span className="mt-2 block text-[11px] text-[var(--ink-4)]">
                            Lot {lot.lotNumber}
                            {lot.supplierBatch
                              ? ` · batch ${lot.supplierBatch}`
                              : ""}
                            {receipt?.supplierChallan
                              ? ` · challan ${receipt.supplierChallan}`
                              : ""}
                            {` · ${(lot.balances || [])
                              .filter((row: any) => Number(row.available) > 0)
                              .map(
                                (row: any) =>
                                  `${row.location?.code || row.locationId}: ${row.available}`,
                              )
                              .join(" · ")}`}
                          </span>
                        </button>
                      );
                    })}
                  {!loading &&
                  !lots.some((lot: any) => available(lot) > 0) ? (
                    <div className="p-4 text-center text-xs leading-5 text-[var(--ink-4)]">
                      No available received lot matches this product and search.
                      Post its GRN first or clear the lot search.
                    </div>
                  ) : null}
                </div>
                {selectedLot ? (
                  <div className="rounded-xl bg-emerald-50 p-3 text-xs leading-5 text-emerald-900">
                    <b>{selectedLot.lotNumber}</b> · {available(selectedLot)}{" "}
                    available
                    <br />
                    {(selectedLot.balances || [])
                      .map(
                        (row: any) =>
                          `${row.location?.code || row.locationId}: ${row.available}`,
                      )
                      .join(" · ")}
                  </div>
                ) : null}
                <label className="block text-xs font-semibold text-[var(--ink-4)]">
                  Quantity removed from saleable stock
                  <Input
                    className="mt-1"
                    type="number"
                    min={1}
                    max={Math.max(1, available(selectedLot))}
                    required
                    value={form.issuedQuantity}
                    onChange={(e) =>
                      setForm({ ...form, issuedQuantity: e.target.value })
                    }
                  />
                </label>
              </>
            ) : null}
            {!form.id && sourceMode === "vendor" ? (
              <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs leading-5 text-sky-900">
                <b>Direct display inward:</b> use this only for a free/non-stock
                vendor showroom sample. If it was purchased or should be
                saleable, post its GRN first and use “From inventory”.
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-semibold text-[var(--ink-4)]">
                Condition
                <select
                  value={form.condition}
                  onChange={(e) =>
                    setForm({ ...form, condition: e.target.value })
                  }
                  className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-3"
                >
                  <option value="new">New</option>
                  <option value="good">Good</option>
                  <option value="worn">Worn</option>
                  <option value="damaged">Damaged</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-[var(--ink-4)]">
                Next inspection
                <Input
                  className="mt-1"
                  type="date"
                  value={form.nextInspectionAt?.slice?.(0, 10) || ""}
                  onChange={(e) =>
                    setForm({ ...form, nextInspectionAt: e.target.value })
                  }
                />
              </label>
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={
                busy ||
                !form.productId ||
                !form.internalCode ||
                !form.locationId ||
                !form.displayZone.trim() ||
                (!form.id && sourceMode === "inventory" && !form.sourceLotId)
              }
            >
              {busy
                ? "Saving…"
                : form.id
                  ? "Save and clear"
                  : "Create asset + QR label"}
            </Button>
            {form.id ? (
              <div className="border-t border-[var(--line)] pt-3">
                <label className="block text-xs font-semibold text-[var(--ink-4)]">
                  Mandatory lifecycle reason
                  <Input
                    className="mt-1"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => act("inspect")}
                  >
                    Inspect
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      act(
                        form.status === "maintenance"
                          ? "reactivate"
                          : "maintenance",
                      )
                    }
                  >
                    {form.status === "maintenance"
                      ? "Reactivate"
                      : "Maintenance"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => act("remove")}
                  >
                    Remove
                  </Button>
                  {form.sourceLotId && Number(form.issuedQuantity) > 0 ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => act("return_to_stock")}
                    >
                      Return to lot
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </form>
        <div className="min-w-0 space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Guide
              icon={PackageCheck}
              title="Purchased display"
              text="Post GRN, then issue its exact lot here."
            />
            <Guide
              icon={Store}
              title="Free vendor sample"
              text="Register directly; no stock movement is created."
            />
            <Guide
              icon={Barcode}
              title="Physical identity"
              text="A QR label job is created for every new display."
            />
          </div>
          <section className="mp-panel overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-[var(--line)] p-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="font-bold">Display asset register</h2>
                <p className="mt-1 text-xs text-[var(--ink-4)]">
                  Searchable, paged, audited and kept separate from sellable
                  stock.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-[var(--ink-4)]" />
                  <Input
                    className="pl-9 sm:w-72"
                    value={displaySearch}
                    onChange={(e) => {
                      setDisplaySearch(e.target.value);
                      setPage(0);
                    }}
                    placeholder="Code, product, SKU or zone"
                  />
                </label>
                <select
                  value={displayStatus}
                  onChange={(e) => {
                    setDisplayStatus(e.target.value);
                    setPage(0);
                  }}
                  className="h-10 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"
                >
                  <option value="all">All states</option>
                  <option value="active">Active</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="removed">Removed</option>
                </select>
              </div>
            </div>
            <div className="grid gap-px bg-[var(--line)] sm:grid-cols-2 2xl:grid-cols-3">
              {register.map((row: any) => (
                <button
                  type="button"
                  key={row.id}
                  onClick={() =>
                    setForm({
                      ...blank,
                      ...row,
                      nextInspectionAt:
                        row.nextInspectionAt?.slice?.(0, 10) || "",
                    })
                  }
                  className="bg-[var(--surface)] p-4 text-left transition hover:bg-[var(--bg-soft)]"
                >
                  <div className="flex gap-3">
                    {imageOf(row) ? (
                      <ProductImageFrame
                        src={imageOf(row)}
                        alt={row.product?.name || row.internalCode}
                        className="h-16 w-16 shrink-0 rounded-xl"
                      />
                    ) : (
                      <span className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-[var(--bg-soft)]">
                        <ImageOff className="h-5 w-5" />
                      </span>
                    )}
                    <span className="min-w-0">
                      <b className="block truncate">{row.internalCode}</b>
                      <small className="block truncate text-[var(--ink-4)]">
                        {row.sampleNumber} · {row.product?.name}
                      </small>
                      <span className="mt-2 flex items-center gap-1 text-xs">
                        <MapPin className="h-3.5 w-3.5" />
                        {row.displayZone || "Zone pending"}
                      </span>
                      <small className="mt-1 block text-[var(--ink-4)]">
                        {row.status} · {row.condition} ·{" "}
                        {row.issuedQuantity || 0} stock units
                      </small>
                    </span>
                  </div>
                </button>
              ))}
              {!loading && !register.length ? (
                <div className="col-span-full grid min-h-48 place-items-center p-8 text-center">
                  <div>
                    <Store className="mx-auto h-7 w-7 text-[var(--ink-5)]" />
                    <p className="mt-3 font-semibold">
                      No matching display assets
                    </p>
                    <p className="mt-1 text-xs text-[var(--ink-4)]">
                      Create one from an exact lot or register a vendor sample.
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="flex items-center justify-between border-t border-[var(--line)] p-4">
              <span className="text-xs font-semibold text-[var(--ink-4)]">
                Page {page + 1} · {data?.displaySamplesPage?.total || 0} assets
              </span>
              <div className="flex gap-2">
                <Button
                  size="icon"
                  variant="outline"
                  disabled={!page}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  disabled={!data?.displaySamplesPage?.hasNext}
                  onClick={() => setPage(page + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </section>
          <Button asChild variant="outline" className="w-full">
            <Link href="/dashboard/help#display-assets">
              <CircleHelp className="mr-2 h-4 w-4" />
              Open display lifecycle help
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="min-w-24 rounded-2xl border border-white/10 bg-white/10 p-3 backdrop-blur">
      <b className="text-2xl tabular-nums">
        {Number(value || 0).toLocaleString("en-IN")}
      </b>
      <p className="mt-1 text-[10px] font-semibold uppercase text-white/55">
        {label}
      </p>
    </div>
  );
}
function Guide({
  icon: Icon,
  title,
  text,
}: {
  icon: any;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <Icon className="h-5 w-5 text-[#a33a30]" />
      <p className="mt-3 text-sm font-bold">{title}</p>
      <p className="mt-1 text-xs leading-5 text-[var(--ink-4)]">{text}</p>
    </div>
  );
}
