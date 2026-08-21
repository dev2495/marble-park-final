"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { gql, useLazyQuery, useMutation, useQuery } from "@apollo/client";
import {
  Boxes,
  ChevronLeft,
  ChevronRight,
  ImageOff,
  ImagePlus,
  Layers3,
  MapPin,
  PackagePlus,
  Printer,
  RotateCcw,
  Search,
  Store,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QueryErrorBanner } from "@/components/query-state";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

const WORKSPACE = gql`
  query TileWorkspace(
    $designSearch: String
    $designSkip: Int
    $designStatus: String
    $designSort: String
    $variantSearch: String
    $variantSkip: Int
    $variantStatus: String
    $variantSort: String
    $displaySearch: String
    $displaySkip: Int
    $displayStatus: String
  ) {
    tileDesignsPage(
      search: $designSearch
      skip: $designSkip
      take: 30
      status: $designStatus
      sort: $designSort
    )
    tileVariantsPage(
      search: $variantSearch
      skip: $variantSkip
      take: 40
      status: $variantStatus
      sort: $variantSort
    )
    displaySamplesPage(
      search: $displaySearch
      skip: $displaySkip
      take: 30
      status: $displayStatus
      sort: "updated"
    )
    tileSizes(status: "active")
    masterProductBrands(status: "active")
    masterProductFinishes(status: "active")
    stockLocations(status: "active")
    tileDesignStats
  }
`;
const LOTS = gql`
  query TileDisplayLots($search: String) {
    inventoryLots(status: "active", search: $search, take: 80)
  }
`;
const SAVE_DESIGN = gql`
  mutation SaveTileDesign($input: TileDesignInput!) {
    saveTileDesign(input: $input)
  }
`;
const SAVE_VARIANT = gql`
  mutation SaveTileVariant($input: TileVariantInput!) {
    saveTileVariant(input: $input) {
      id
      sku
      internalCode
      name
    }
  }
`;
const SAVE_ALIAS = gql`
  mutation SaveVariantAlias($input: ProductAliasInput!) {
    saveProductAlias(input: $input)
  }
`;
const CREATE_DISPLAY = gql`
  mutation CreateDisplay($input: DisplaySampleInput!) {
    createDisplaySample(input: $input)
  }
`;
const UPDATE_DISPLAY = gql`
  mutation UpdateDisplay($id: ID!, $input: UpdateDisplaySampleInput!) {
    updateDisplaySample(id: $id, input: $input)
  }
`;
const TRANSITION_DISPLAY = gql`
  mutation TransitionDisplay($id: ID!, $input: DisplaySampleTransitionInput!) {
    transitionDisplaySample(id: $id, input: $input)
  }
`;
const CREATE_LABEL = gql`
  mutation CreateDisplayLabel($input: InternalLabelJobInput!) {
    createInternalLabelJob(input: $input)
  }
`;
const UPLOAD_ASSET = gql`
  mutation UploadTileImage(
    $filename: String!
    $contentBase64: String!
    $scope: String!
  ) {
    uploadStoredAsset(
      filename: $filename
      contentBase64: $contentBase64
      scope: $scope
    ) {
      result
    }
  }
`;
const DESIGN_IMPORT_TEMPLATE = gql`
  query TileDesignImportTemplate {
    tileDesignImportTemplate
  }
`;
const PREVIEW_DESIGN_IMPORT = gql`
  mutation PreviewTileDesignImport(
    $filename: String!
    $contentBase64: String!
  ) {
    previewTileDesignImport(
      filename: $filename
      contentBase64: $contentBase64
    ) {
      result
    }
  }
`;
const APPLY_DESIGN_IMPORT = gql`
  mutation ApplyTileDesignImport(
    $filename: String!
    $contentBase64: String!
    $confirmationToken: String!
  ) {
    applyTileDesignImport(
      filename: $filename
      contentBase64: $contentBase64
      confirmationToken: $confirmationToken
    ) {
      result
    }
  }
`;

const emptyDesign: any = {
  id: "",
  designCode: "",
  name: "",
  brand: "",
  images: [],
  status: "active",
};
const emptyVariant: any = {
  id: "",
  tileDesignId: "",
  tileSizeId: "",
  sku: "",
  internalCode: "",
  finish: "",
  piecesPerPack: "",
  purchaseUom: "BOX",
  salesUom: "BOX",
  allowLoose: true,
  hsnCode: "",
  sellPrice: "",
  floorPrice: "",
  costPrice: "",
  status: "active",
  alias: "",
};
const emptyDisplay: any = {
  id: "",
  productId: "",
  internalCode: "",
  locationId: "",
  displayZone: "",
  imageUrl: "",
  sourceLotId: "",
  issuedQuantity: "",
  condition: "good",
  nextInspectionAt: "",
  status: "active",
};

function imageOf(value: any) {
  return (
    value?.media?.primaryUrl ||
    value?.media?.images?.[0]?.url ||
    value?.media?.images?.[0] ||
    value?.imageUrl ||
    ""
  );
}
function toMedia(images: string[]) {
  return {
    primaryUrl: images[0] || null,
    images: images.map((url) => ({ url })),
  };
}
async function fileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
function downloadBase64(
  filename: string,
  mimeType: string,
  contentBase64: string,
) {
  const bytes = atob(contentBase64);
  const data = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) data[i] = bytes.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([data], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
function Pager({
  page,
  hasNext,
  onPage,
}: {
  page: number;
  hasNext: boolean;
  onPage: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-between border-t border-[var(--line)] p-4">
      <span className="text-xs font-semibold text-[var(--ink-4)]">
        Page {page + 1}
      </span>
      <div className="flex gap-2">
        <Button
          size="icon"
          variant="outline"
          aria-label="Previous page"
          disabled={!page}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="outline"
          aria-label="Next page"
          disabled={!hasNext}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export default function TileWorkspacePage() {
  const [tab, setTab] = useState<"designs" | "variants" | "display">("designs");
  const [designSearch, setDesignSearch] = useState("");
  const [designPage, setDesignPage] = useState(0);
  const [designStatus, setDesignStatus] = useState("all");
  const [designSort, setDesignSort] = useState("updated");
  const [design, setDesign] = useState<any>(emptyDesign);
  const [variantSearch, setVariantSearch] = useState("");
  const [variantPage, setVariantPage] = useState(0);
  const [variantStatus, setVariantStatus] = useState("all");
  const [variantSort, setVariantSort] = useState("updated");
  const [variant, setVariant] = useState<any>(emptyVariant);
  const [displaySearch, setDisplaySearch] = useState("");
  const [displayPage, setDisplayPage] = useState(0);
  const [displayStatus, setDisplayStatus] = useState("all");
  const [display, setDisplay] = useState<any>(emptyDisplay);
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState(false);
  const [transitionReason, setTransitionReason] = useState(
    "Scheduled showroom lifecycle update",
  );
  const [designImport, setDesignImport] = useState<{
    filename: string;
    contentBase64: string;
  } | null>(null);
  const [designImportPlan, setDesignImportPlan] = useState<any>(null);
  const designImportInput = useRef<HTMLInputElement>(null);
  const variables = {
    designSearch: useDebouncedValue(designSearch, 250) || undefined,
    designSkip: designPage * 30,
    designStatus,
    designSort,
    variantSearch: useDebouncedValue(variantSearch, 250) || undefined,
    variantSkip: variantPage * 40,
    variantStatus,
    variantSort,
    displaySearch: useDebouncedValue(displaySearch, 250) || undefined,
    displaySkip: displayPage * 30,
    displayStatus,
  };
  const { data, loading, error, refetch } = useQuery(WORKSPACE, {
    variables,
    fetchPolicy: "cache-and-network",
  });
  const selectedVariant = (data?.tileVariantsPage?.items || []).find(
    (row: any) => row.id === display.productId,
  );
  const { data: lotData } = useQuery(LOTS, {
    variables: { search: selectedVariant?.sku || undefined },
    skip: !selectedVariant?.id,
    fetchPolicy: "cache-and-network",
  });
  const [saveDesign, designState] = useMutation(SAVE_DESIGN, {
    onCompleted: async () => {
      setDesign(emptyDesign);
      setNotice(
        "Design saved. The form is blank and ready for the next design.",
      );
      await refetch();
    },
  });
  const [saveVariant, variantState] = useMutation(SAVE_VARIANT, {
    onCompleted: async () => {
      setVariant(emptyVariant);
      setNotice(
        "Variant saved with a permanent warehouse SKU. The form is ready for the next size/finish.",
      );
      await refetch();
    },
  });
  const [saveAlias, aliasState] = useMutation(SAVE_ALIAS);
  const [createDisplay, createDisplayState] = useMutation(CREATE_DISPLAY);
  const [updateDisplay, updateDisplayState] = useMutation(UPDATE_DISPLAY);
  const [transition, transitionState] = useMutation(TRANSITION_DISPLAY);
  const [createLabel] = useMutation(CREATE_LABEL);
  const [uploadAsset] = useMutation(UPLOAD_ASSET);
  const [loadDesignTemplate, designTemplateState] = useLazyQuery(
    DESIGN_IMPORT_TEMPLATE,
    { fetchPolicy: "network-only" },
  );
  const [previewDesignImport, designImportPreviewState] = useMutation(
    PREVIEW_DESIGN_IMPORT,
  );
  const [applyDesignImport, designImportApplyState] =
    useMutation(APPLY_DESIGN_IMPORT);
  const designs = data?.tileDesignsPage?.items || [];
  const variants = data?.tileVariantsPage?.items || [];
  const displays = data?.displaySamplesPage?.items || [];
  const sizes = data?.tileSizes || [];
  const brands = data?.masterProductBrands || [];
  const finishes = data?.masterProductFinishes || [];
  const locations = data?.stockLocations || [];
  const lots = useMemo(
    () =>
      (lotData?.inventoryLots || []).filter(
        (lot: any) =>
          lot.productId === display.productId ||
          lot.product?.id === display.productId,
      ),
    [lotData, display.productId],
  );
  const errors = [
    error,
    designState.error,
    variantState.error,
    aliasState.error,
    createDisplayState.error,
    updateDisplayState.error,
    transitionState.error,
    designTemplateState.error,
    designImportPreviewState.error,
    designImportApplyState.error,
  ].filter(Boolean);

  async function uploadImages(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const urls = [...design.images];
      for (const file of Array.from(files).slice(0, 8 - urls.length)) {
        const response = await uploadAsset({
          variables: {
            filename: file.name,
            contentBase64: await fileBase64(file),
            scope: "tile-design-image",
          },
        });
        const url = response.data?.uploadStoredAsset?.result?.publicUrl;
        if (url) urls.push(url);
      }
      setDesign({ ...design, images: urls });
    } finally {
      setUploading(false);
    }
  }
  function editDesign(row: any) {
    setDesign({
      ...emptyDesign,
      ...row,
      images: [
        imageOf(row),
        ...(row.media?.images || []).map((x: any) => x?.url || x),
      ]
        .filter(Boolean)
        .filter((x: string, i: number, a: string[]) => a.indexOf(x) === i),
      usage: Array.isArray(row.usage) ? row.usage : [],
    });
  }
  function editVariant(row: any) {
    setVariant({
      ...emptyVariant,
      ...row,
      piecesPerPack: String(row.piecesPerPack || ""),
      sellPrice: String(row.sellPrice || ""),
      floorPrice: String(row.floorPrice || ""),
      costPrice: String(row.costPrice || ""),
    });
  }
  async function submitVariant(event: any) {
    event.preventDefault();
    const response = await saveVariant({
      variables: {
        input: {
          ...variant,
          id: variant.id || undefined,
          sku: variant.id ? undefined : variant.sku || undefined,
          internalCode: variant.internalCode || undefined,
          piecesPerPack: Number(variant.piecesPerPack || 1),
          sellPrice: Number(variant.sellPrice || 0),
          floorPrice: Number(variant.floorPrice || 0),
          costPrice: Number(variant.costPrice || 0),
        },
      },
    });
    const saved = response.data?.saveTileVariant;
    if (saved?.id && variant.alias.trim())
      await saveAlias({
        variables: {
          input: {
            productId: saved.id,
            type: "supplier_sku",
            value: variant.alias.trim(),
          },
        },
      });
  }
  async function submitDisplay(event: any) {
    event.preventDefault();
    const input: any = {
      internalCode: display.internalCode,
      locationId: display.locationId || undefined,
      displayZone: display.displayZone || undefined,
      imageUrl: display.imageUrl || undefined,
      condition: display.condition,
      nextInspectionAt: display.nextInspectionAt || undefined,
    };
    let saved: any;
    if (display.id) {
      saved = (
        await updateDisplay({
          variables: {
            id: display.id,
            input: { ...input, status: display.status },
          },
        })
      ).data?.updateDisplaySample;
    } else {
      saved = (
        await createDisplay({
          variables: {
            input: {
              ...input,
              productId: display.productId,
              sourceLotId: display.sourceLotId || undefined,
              issuedQuantity: display.sourceLotId
                ? Number(display.issuedQuantity || 0)
                : undefined,
            },
          },
        })
      ).data?.createDisplaySample;
      if (saved?.id)
        await createLabel({
          variables: {
            input: {
              displaySampleId: saved.id,
              quantity: 1,
              template: "display_sample",
              newJob: true,
            },
          },
        });
    }
    setDisplay(emptyDisplay);
    setNotice(
      display.id
        ? "Display updated. The form is blank."
        : "Display asset registered, stock issue posted when selected, and its QR label job is ready.",
    );
    await refetch();
  }
  async function runTransition(action: string) {
    if (!display.id || !transitionReason.trim()) return;
    await transition({
      variables: {
        id: display.id,
        input: {
          action,
          reason: transitionReason,
          condition: display.condition,
          returnQuantity:
            action === "return_to_stock"
              ? Number(display.issuedQuantity || 0)
              : undefined,
          nextInspectionAt: display.nextInspectionAt || undefined,
        },
      },
    });
    setDisplay(emptyDisplay);
    setNotice(
      `Display ${action.replaceAll("_", " ")} posted with an audit event.`,
    );
    await refetch();
  }
  async function downloadDesignTemplate() {
    const response = await loadDesignTemplate();
    const template = response.data?.tileDesignImportTemplate;
    if (template?.contentBase64)
      downloadBase64(
        template.filename,
        template.mimeType,
        template.contentBase64,
      );
  }
  async function previewDesignFile(file: File | null) {
    if (!file) return;
    const payload = {
      filename: file.name,
      contentBase64: await fileBase64(file),
    };
    setDesignImport(payload);
    const response = await previewDesignImport({ variables: payload });
    setDesignImportPlan(response.data?.previewTileDesignImport?.result || null);
    if (designImportInput.current) designImportInput.current.value = "";
  }
  async function applyDesignFile() {
    if (!designImport || !designImportPlan?.confirmationToken) return;
    const response = await applyDesignImport({
      variables: {
        ...designImport,
        confirmationToken: designImportPlan.confirmationToken,
      },
    });
    const result = response.data?.applyTileDesignImport?.result;
    setNotice(result?.message || "Tile designs imported.");
    setDesignImport(null);
    setDesignImportPlan(null);
    setDesignPage(0);
    await refetch();
  }

  return (
    <div className="space-y-5 pb-10">
      {errors.map((item: any, index) => (
        <QueryErrorBanner key={index} error={item} />
      ))}
      <header className="border-b border-[var(--line)] pb-5 pt-2">
        <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-[var(--ink-4)]">
              Catalogue → stock identity → physical trace
            </p>
            <h1 className="mt-1 font-display text-3xl font-bold text-[var(--ink)]">
              Tile design, variant and display workspace
            </h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--ink-3)]">
              Design owns code, name, governed brand and imagery. Size owns
              geometry. Variant owns finish, immutable warehouse SKU and
              packing. Every inward posts to a variant lot; every display is a
              separately audited asset.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={downloadDesignTemplate}
              disabled={designTemplateState.loading}
            >
              <Upload className="mr-2 h-4 w-4" />
              {designTemplateState.loading
                ? "Preparing…"
                : "Design Excel sample"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => designImportInput.current?.click()}
              disabled={designImportPreviewState.loading}
            >
              <Upload className="mr-2 h-4 w-4" />
              {designImportPreviewState.loading
                ? "Validating…"
                : "Import designs"}
            </Button>
            <input
              ref={designImportInput}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(event) =>
                previewDesignFile(event.target.files?.[0] || null)
              }
            />
            <Button asChild variant="outline">
              <Link href="/dashboard/master-data/imports">
                Product SKU import
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/dashboard/master-data/tile-sizes">Size Master</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/dashboard/inventory/inwards">
                <PackagePlus className="mr-2 h-4 w-4" />
                Inward
              </Link>
            </Button>
            <Button asChild>
              <Link href="/dashboard/inventory/labels">
                <Printer className="mr-2 h-4 w-4" />
                Labels
              </Link>
            </Button>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-[var(--line)] pt-4 sm:grid-cols-4">
          {[
            ["Designs", data?.tileDesignsPage?.total || 0],
            ["Variants", data?.tileVariantsPage?.total || 0],
            ["On display", data?.tileDesignStats?.displaySamples || 0],
            ["Missing images", data?.tileDesignStats?.missingImages || 0],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <p className="text-2xl font-semibold tabular-nums text-[var(--ink)]">
                {Number(value).toLocaleString("en-IN")}
              </p>
              <p className="text-xs text-[var(--ink-4)]">{label}</p>
            </div>
          ))}
        </div>
      </header>
      <nav
        className="grid max-w-2xl grid-cols-3 rounded-md border border-[var(--line)] bg-[var(--surface)] p-1"
        aria-label="Tile workspace sections"
      >
        {(
          [
            ["designs", "Design registry", Layers3],
            ["variants", "Variant registry", Boxes],
            ["display", "Display assets ↗", Store],
          ] as any[]
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() =>
              id === "display"
                ? window.location.assign("/dashboard/inventory/display-assets")
                : setTab(id)
            }
            className={`h-11 rounded px-3 text-sm font-semibold ${tab === id ? "bg-[var(--ink)] text-white" : "text-[var(--ink-3)] hover:bg-[var(--bg-soft)]"}`}
          >
            <Icon className="mr-2 inline h-4 w-4" />
            {label}
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
      {designImportPlan ? (
        <section
          className={`rounded-xl border p-4 ${designImportPlan.failed ? "border-amber-300 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}
          aria-live="polite"
        >
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div>
              <p className="font-semibold">
                Design Excel preview · {designImportPlan.ready || 0} ready ·{" "}
                {designImportPlan.failed || 0} need correction
              </p>
              <p className="mt-1 text-xs leading-5 text-[var(--ink-3)]">
                {designImportPlan.message}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setDesignImport(null);
                  setDesignImportPlan(null);
                }}
              >
                Discard
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={applyDesignFile}
                disabled={
                  !designImportPlan.confirmationToken ||
                  designImportApplyState.loading
                }
              >
                {designImportApplyState.loading
                  ? "Importing…"
                  : "Confirm import"}
              </Button>
            </div>
          </div>
          {designImportPlan.failed ? (
            <div className="mt-3 max-h-44 overflow-y-auto rounded-lg border border-amber-200 bg-white/75 p-3 text-xs">
              {(designImportPlan.rows || [])
                .filter((row: any) => row.errors?.length)
                .map((row: any) => (
                  <p key={row.rowNumber} className="py-1">
                    <b>
                      Row {row.rowNumber} · {row.designCode || "No code"}:
                    </b>{" "}
                    {row.errors.join(" · ")}
                  </p>
                ))}
            </div>
          ) : null}
        </section>
      ) : null}
      {tab === "designs" ? (
        <div className="flex flex-col gap-3 rounded-md border border-[var(--line)] bg-[var(--surface)] p-3 sm:flex-row">
          <select
            aria-label="Filter designs"
            value={designStatus}
            onChange={(e) => {
              setDesignStatus(e.target.value);
              setDesignPage(0);
            }}
            className="h-10 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"
          >
            <option value="all">All design statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="archived">Archived</option>
          </select>
          <select
            aria-label="Sort designs"
            value={designSort}
            onChange={(e) => {
              setDesignSort(e.target.value);
              setDesignPage(0);
            }}
            className="h-10 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"
          >
            <option value="updated">Recently updated</option>
            <option value="code_asc">Code A–Z</option>
            <option value="brand_asc">Brand A–Z</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>
      ) : null}
      {tab === "variants" ? (
        <div className="grid gap-3 rounded-md border border-[var(--line)] bg-[var(--surface)] p-3 md:grid-cols-[1fr_auto_auto]">
          <label className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-[var(--ink-4)]" />
            <Input
              className="pl-9"
              value={designSearch}
              onChange={(e) => {
                setDesignSearch(e.target.value);
                setDesignPage(0);
              }}
              placeholder="Find design for the variant form"
            />
          </label>
          <select
            aria-label="Filter variants"
            value={variantStatus}
            onChange={(e) => {
              setVariantStatus(e.target.value);
              setVariantPage(0);
            }}
            className="h-10 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"
          >
            <option value="all">All variant statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="archived">Archived</option>
          </select>
          <select
            aria-label="Sort variants"
            value={variantSort}
            onChange={(e) => {
              setVariantSort(e.target.value);
              setVariantPage(0);
            }}
            className="h-10 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"
          >
            <option value="updated">Recently updated</option>
            <option value="sku_asc">SKU A–Z</option>
            <option value="size_asc">Size A–Z</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>
      ) : null}
      {tab === "display" ? (
        <div className="rounded-md border border-[var(--line)] bg-[var(--surface)] p-3">
          <label className="relative block">
            <Search className="absolute left-3 top-3 h-4 w-4 text-[var(--ink-4)]" />
            <Input
              className="pl-9"
              value={variantSearch}
              onChange={(e) => {
                setVariantSearch(e.target.value);
                setVariantPage(0);
              }}
              placeholder="Find tile variant by SKU, display code, design or alias"
            />
          </label>
        </div>
      ) : null}
      {tab === "display" ? (
        <section className="grid gap-3 rounded-2xl border border-[#e5cfc7] bg-[linear-gradient(115deg,#fff8f4,#fff)] p-4 md:grid-cols-[1fr_1fr_auto]">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">
              Received-stock display
            </p>
            <p className="mt-2 text-sm font-semibold text-emerald-950">
              Choose the exact GRN lot and issued pieces. The lot ledger posts
              one audited display issue.
            </p>
          </div>
          <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-sky-700">
              Vendor display sample
            </p>
            <p className="mt-2 text-sm font-semibold text-sky-950">
              Leave source lot blank. The asset and label are registered, but
              saleable stock never changes.
            </p>
          </div>
          <div className="flex flex-row gap-2 md:flex-col md:justify-center">
            <Button asChild size="sm" variant="outline">
              <Link href="/dashboard/procurement?view=history">Find GRN</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/dashboard/inventory/labels">Print labels</Link>
            </Button>
          </div>
        </section>
      ) : null}

      {tab === "designs" ? (
        <section className="grid gap-5 xl:grid-cols-[25rem_1fr]">
          <form
            className="mp-panel self-start p-5 xl:sticky xl:top-4"
            onSubmit={(e) => {
              e.preventDefault();
              saveDesign({
                variables: {
                  input: {
                    id: design.id || undefined,
                    designCode: design.designCode,
                    name: design.name,
                    brand: design.brand,
                    media: toMedia(design.images),
                    status: design.status,
                  },
                },
              });
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold">
                  {design.id ? "Edit design" : "Add design"}
                </h2>
                <p className="mt-1 text-xs leading-5 text-[var(--ink-4)]">
                  A design is only its permanent code, name, Brand Master value
                  and imagery.
                </p>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Clear design form"
                onClick={() => setDesign(emptyDesign)}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-4 space-y-3">
              <label className="block text-xs font-semibold text-[var(--ink-4)]">
                Permanent design code
                <Input
                  className="mt-1"
                  required
                  disabled={Boolean(design.id)}
                  value={design.designCode}
                  onChange={(e) =>
                    setDesign({
                      ...design,
                      designCode: e.target.value.toUpperCase(),
                    })
                  }
                  placeholder="CALACATTA-GOLD"
                />
              </label>
              <label className="block text-xs font-semibold text-[var(--ink-4)]">
                Design name
                <Input
                  className="mt-1"
                  required
                  value={design.name}
                  onChange={(e) =>
                    setDesign({ ...design, name: e.target.value })
                  }
                  placeholder="Calacatta Gold"
                />
              </label>
              <label className="block text-xs font-semibold text-[var(--ink-4)]">
                Brand
                <select
                  required
                  value={design.brand}
                  onChange={(e) =>
                    setDesign({ ...design, brand: e.target.value })
                  }
                  className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-3"
                >
                  <option value="">Select from Brand Master</option>
                  {brands.map((brand: any) => (
                    <option key={brand.id} value={brand.name}>
                      {brand.code ? `${brand.code} · ` : ""}
                      {brand.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="rounded-md border border-dashed border-[var(--line)] p-3">
                <label className="flex cursor-pointer items-center justify-between text-xs font-semibold">
                  <span>
                    <ImagePlus className="mr-2 inline h-4 w-4" />
                    Design images ({design.images.length}/8)
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    className="hidden"
                    onChange={(e) => uploadImages(e.target.files)}
                  />
                  <span className="rounded bg-[var(--ink)] px-3 py-2 text-white">
                    {uploading ? "Uploading…" : "Add"}
                  </span>
                </label>
                {design.images.length ? (
                  <div className="mt-3 grid grid-cols-4 gap-2">
                    {design.images.map((url: string, i: number) => (
                      <button
                        type="button"
                        key={url}
                        title="Remove image"
                        onClick={() =>
                          setDesign({
                            ...design,
                            images: design.images.filter(
                              (_: string, index: number) => index !== i,
                            ),
                          })
                        }
                      >
                        <img
                          src={url}
                          alt=""
                          className="h-16 w-full rounded object-cover"
                        />
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {design.id ? (
                <label className="block text-xs font-semibold text-[var(--ink-4)]">
                  Status
                  <select
                    value={design.status}
                    onChange={(e) =>
                      setDesign({ ...design, status: e.target.value })
                    }
                    className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-3"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="archived">Archived</option>
                  </select>
                </label>
              ) : null}
              <Button
                className="w-full"
                type="submit"
                disabled={
                  designState.loading ||
                  uploading ||
                  !design.designCode.trim() ||
                  !design.name.trim() ||
                  !design.brand
                }
              >
                {designState.loading ? "Saving…" : "Save and clear design"}
              </Button>
            </div>
          </form>
          <RegisterHeader
            title="Design register"
            search={designSearch}
            setSearch={(v: string) => {
              setDesignSearch(v);
              setDesignPage(0);
            }}
          >
            {designs.map((row: any) => (
              <button
                key={row.id}
                onClick={() => editDesign(row)}
                className="grid w-full gap-3 border-b border-[var(--line)] p-4 text-left hover:bg-[var(--bg-soft)] md:grid-cols-[4rem_1.4fr_1fr_auto] md:items-center"
              >
                <div className="grid h-16 w-16 place-items-center overflow-hidden rounded bg-[var(--bg-soft)]">
                  {imageOf(row) ? (
                    <img
                      src={imageOf(row)}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ImageOff className="h-5 w-5 text-[var(--ink-5)]" />
                  )}
                </div>
                <div>
                  <p className="font-semibold">
                    {row.designCode} · {row.name}
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-4)]">
                    {row.brand || "Brand master required"}
                  </p>
                </div>
                <div className="text-xs text-[var(--ink-3)]">
                  <p>{row.variants?.length || 0} inwardable variant(s)</p>
                  <p className="mt-1">
                    Sizes and finishes live in Variant Registry
                  </p>
                </div>
                <span className="rounded bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                  {row.status}
                </span>
              </button>
            ))}
            {!loading && !designs.length ? (
              <Empty text="No matching tile designs." />
            ) : null}
            <Pager
              page={designPage}
              hasNext={Boolean(data?.tileDesignsPage?.hasNext)}
              onPage={setDesignPage}
            />
          </RegisterHeader>
        </section>
      ) : null}

      {tab === "variants" ? (
        <section className="grid gap-5 xl:grid-cols-[25rem_1fr]">
          <form
            className="mp-panel self-start p-5 xl:sticky xl:top-4"
            onSubmit={submitVariant}
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold">
                  {variant.id ? "Edit variant" : "Create inwardable variant"}
                </h2>
                <p className="mt-1 text-xs text-[var(--ink-4)]">
                  Design × size × finish = one permanent warehouse SKU.
                </p>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Clear variant form"
                onClick={() => setVariant(emptyVariant)}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-4 space-y-3">
              <label className="block text-xs font-semibold text-[var(--ink-4)]">
                Design
                <select
                  disabled={Boolean(variant.id)}
                  value={variant.tileDesignId}
                  onChange={(e) =>
                    setVariant({ ...variant, tileDesignId: e.target.value })
                  }
                  className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-3"
                >
                  <option value="">Select design</option>
                  {designs.map((x: any) => (
                    <option key={x.id} value={x.id}>
                      {x.designCode} · {x.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-semibold text-[var(--ink-4)]">
                Size
                <select
                  disabled={Boolean(variant.id)}
                  value={variant.tileSizeId}
                  onChange={(e) => {
                    const size = sizes.find(
                      (x: any) => x.id === e.target.value,
                    );
                    setVariant({
                      ...variant,
                      tileSizeId: e.target.value,
                      piecesPerPack:
                        variant.piecesPerPack || String(size?.pcsPerBox || ""),
                    });
                  }}
                  className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-3"
                >
                  <option value="">Select governed size</option>
                  {sizes.map((x: any) => (
                    <option key={x.id} value={x.id}>
                      {x.code} · {x.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-semibold text-[var(--ink-4)]">
                Finish
                <select
                  required
                  value={variant.finish}
                  onChange={(e) =>
                    setVariant({ ...variant, finish: e.target.value })
                  }
                  className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-3"
                >
                  <option value="">Select from Finish Master</option>
                  {finishes.map((finish: any) => (
                    <option key={finish.id} value={finish.name}>
                      {finish.code ? `${finish.code} · ` : ""}
                      {finish.name}
                    </option>
                  ))}
                </select>
              </label>
              {!variant.id ? (
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-xs font-semibold text-[var(--ink-4)]">
                    Warehouse SKU (optional)
                    <Input
                      className="mt-1"
                      value={variant.sku}
                      onChange={(e) =>
                        setVariant({
                          ...variant,
                          sku: e.target.value.toUpperCase(),
                        })
                      }
                      placeholder="Auto-generated"
                    />
                  </label>
                  <label className="block text-xs font-semibold text-[var(--ink-4)]">
                    Display code (optional)
                    <Input
                      className="mt-1"
                      value={variant.internalCode}
                      onChange={(e) =>
                        setVariant({
                          ...variant,
                          internalCode: e.target.value.toUpperCase(),
                        })
                      }
                    />
                  </label>
                </div>
              ) : (
                <div className="rounded-md border border-[var(--line)] bg-[var(--bg-soft)] p-3 text-xs">
                  <b>{variant.sku}</b>
                  <br />
                  Warehouse SKU is immutable.
                </div>
              )}
              <div className="grid grid-cols-3 gap-3">
                <label className="block text-xs font-semibold text-[var(--ink-4)]">
                  Pc / box
                  <Input
                    className="mt-1"
                    type="number"
                    min="1"
                    value={variant.piecesPerPack}
                    onChange={(e) =>
                      setVariant({ ...variant, piecesPerPack: e.target.value })
                    }
                  />
                </label>
                <label className="block text-xs font-semibold text-[var(--ink-4)]">
                  Purchase UOM
                  <select
                    className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-2"
                    value={variant.purchaseUom}
                    onChange={(e) =>
                      setVariant({ ...variant, purchaseUom: e.target.value })
                    }
                  >
                    <option>BOX</option>
                    <option>PC</option>
                  </select>
                </label>
                <label className="block text-xs font-semibold text-[var(--ink-4)]">
                  Sales UOM
                  <select
                    className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-2"
                    value={variant.salesUom}
                    onChange={(e) =>
                      setVariant({ ...variant, salesUom: e.target.value })
                    }
                  >
                    <option>BOX</option>
                    <option>PC</option>
                  </select>
                </label>
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold text-[var(--ink-3)]">
                <input
                  type="checkbox"
                  checked={variant.allowLoose}
                  onChange={(e) =>
                    setVariant({ ...variant, allowLoose: e.target.checked })
                  }
                />
                Allow loose-piece inward and sale
              </label>
              <div className="grid grid-cols-3 gap-3">
                <label className="block text-xs font-semibold text-[var(--ink-4)]">
                  Sell ₹
                  <Input
                    className="mt-1"
                    type="number"
                    min="0"
                    value={variant.sellPrice}
                    onChange={(e) =>
                      setVariant({ ...variant, sellPrice: e.target.value })
                    }
                  />
                </label>
                <label className="block text-xs font-semibold text-[var(--ink-4)]">
                  Floor ₹
                  <Input
                    className="mt-1"
                    type="number"
                    min="0"
                    value={variant.floorPrice}
                    onChange={(e) =>
                      setVariant({ ...variant, floorPrice: e.target.value })
                    }
                  />
                </label>
                <label className="block text-xs font-semibold text-[var(--ink-4)]">
                  Cost ₹
                  <Input
                    className="mt-1"
                    type="number"
                    min="0"
                    value={variant.costPrice}
                    onChange={(e) =>
                      setVariant({ ...variant, costPrice: e.target.value })
                    }
                  />
                </label>
              </div>
              <label className="block text-xs font-semibold text-[var(--ink-4)]">
                Supplier / old code alias
                <Input
                  className="mt-1"
                  value={variant.alias}
                  onChange={(e) =>
                    setVariant({
                      ...variant,
                      alias: e.target.value.toUpperCase(),
                    })
                  }
                />
              </label>
              <Button
                className="w-full"
                type="submit"
                disabled={
                  variantState.loading ||
                  !variant.tileDesignId ||
                  !variant.tileSizeId ||
                  !variant.finish
                }
              >
                {variantState.loading ? "Saving…" : "Save and clear variant"}
              </Button>
            </div>
          </form>
          <RegisterHeader
            title="Variant registry"
            search={variantSearch}
            setSearch={(v: string) => {
              setVariantSearch(v);
              setVariantPage(0);
            }}
          >
            {variants.map((row: any) => (
              <button
                key={row.id}
                onClick={() => editVariant(row)}
                className="grid w-full gap-3 border-b border-[var(--line)] p-4 text-left hover:bg-[var(--bg-soft)] md:grid-cols-[1.5fr_1fr_1fr_auto] md:items-center"
              >
                <div>
                  <p className="font-semibold">
                    {row.internalCode || row.sku} ·{" "}
                    {row.tileDesignMaster?.name || row.name}
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-4)]">
                    {row.sku} · immutable stock identity
                  </p>
                </div>
                <div className="text-sm">
                  {row.tileSizeMaster?.name || row.dimensions}
                  <p className="text-xs text-[var(--ink-4)]">{row.finish}</p>
                </div>
                <div className="text-sm">
                  {row.piecesPerPack} pc / {row.purchaseUom}
                  <p className="text-xs text-[var(--ink-4)]">
                    Loose {row.allowLoose ? "allowed" : "blocked"}
                  </p>
                </div>
                <span className="rounded bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                  {row.status}
                </span>
              </button>
            ))}
            {!loading && !variants.length ? (
              <Empty text="No matching tile variants." />
            ) : null}
            <Pager
              page={variantPage}
              hasNext={Boolean(data?.tileVariantsPage?.hasNext)}
              onPage={setVariantPage}
            />
          </RegisterHeader>
        </section>
      ) : null}

      {tab === "display" ? (
        <section className="grid gap-5 xl:grid-cols-[25rem_1fr]">
          <form
            className="mp-panel self-start p-5 xl:sticky xl:top-4"
            onSubmit={submitDisplay}
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold">
                  {display.id
                    ? "Manage display asset"
                    : "Register display asset"}
                </h2>
                <p className="mt-1 text-xs text-[var(--ink-4)]">
                  Stock is consumed only when a source lot is chosen.
                </p>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Clear display form"
                onClick={() => setDisplay(emptyDisplay)}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-4 space-y-3">
              <label className="block text-xs font-semibold text-[var(--ink-4)]">
                Tile variant
                <select
                  disabled={Boolean(display.id)}
                  value={display.productId}
                  onChange={(e) => {
                    const row = variants.find(
                      (x: any) => x.id === e.target.value,
                    );
                    setDisplay({
                      ...emptyDisplay,
                      productId: e.target.value,
                      internalCode: row?.internalCode || row?.sku || "",
                      imageUrl: imageOf(row?.tileDesignMaster) || imageOf(row),
                      locationId: locations[0]?.id || "",
                    });
                  }}
                  className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-3"
                >
                  <option value="">
                    Select variant from current result page
                  </option>
                  {variants.map((x: any) => (
                    <option key={x.id} value={x.id}>
                      {x.internalCode || x.sku} · {x.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-semibold text-[var(--ink-4)]">
                Display code
                <Input
                  className="mt-1"
                  value={display.internalCode}
                  onChange={(e) =>
                    setDisplay({
                      ...display,
                      internalCode: e.target.value.toUpperCase(),
                    })
                  }
                />
              </label>
              <label className="block text-xs font-semibold text-[var(--ink-4)]">
                Location
                <select
                  value={display.locationId}
                  onChange={(e) =>
                    setDisplay({ ...display, locationId: e.target.value })
                  }
                  className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-3"
                >
                  <option value="">Select location</option>
                  {locations.map((x: any) => (
                    <option key={x.id} value={x.id}>
                      {x.code} · {x.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-semibold text-[var(--ink-4)]">
                Zone
                <Input
                  className="mt-1"
                  value={display.displayZone}
                  onChange={(e) =>
                    setDisplay({ ...display, displayZone: e.target.value })
                  }
                />
              </label>
              {!display.id ? (
                <>
                  <label className="block text-xs font-semibold text-[var(--ink-4)]">
                    Optional source lot
                    <select
                      value={display.sourceLotId}
                      onChange={(e) =>
                        setDisplay({ ...display, sourceLotId: e.target.value })
                      }
                      className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-3"
                    >
                      <option value="">Non-stock vendor sample</option>
                      {lots.map((lot: any) => (
                        <option key={lot.id} value={lot.id}>
                          {lot.lotNumber} · available{" "}
                          {lot.available ??
                            lot.balances?.reduce(
                              (s: number, b: any) =>
                                s + Number(b.available || 0),
                              0,
                            ) ??
                            0}
                        </option>
                      ))}
                    </select>
                  </label>
                  {display.sourceLotId ? (
                    <label className="block text-xs font-semibold text-[var(--ink-4)]">
                      Pieces issued to display
                      <Input
                        className="mt-1"
                        type="number"
                        min="1"
                        value={display.issuedQuantity}
                        onChange={(e) =>
                          setDisplay({
                            ...display,
                            issuedQuantity: e.target.value,
                          })
                        }
                      />
                    </label>
                  ) : null}
                </>
              ) : null}
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-semibold text-[var(--ink-4)]">
                  Condition
                  <select
                    value={display.condition}
                    onChange={(e) =>
                      setDisplay({ ...display, condition: e.target.value })
                    }
                    className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-[var(--bg-soft)] px-3"
                  >
                    <option value="new">New</option>
                    <option value="good">Good</option>
                    <option value="worn">Worn</option>
                    <option value="damaged">Damaged</option>
                  </select>
                </label>
                <label className="block text-xs font-semibold text-[var(--ink-4)]">
                  Next inspection
                  <Input
                    className="mt-1"
                    type="date"
                    value={
                      display.nextInspectionAt?.slice?.(0, 10) ||
                      display.nextInspectionAt
                    }
                    onChange={(e) =>
                      setDisplay({
                        ...display,
                        nextInspectionAt: e.target.value,
                      })
                    }
                  />
                </label>
              </div>
              <Button
                className="w-full"
                type="submit"
                disabled={
                  !display.productId ||
                  !display.internalCode ||
                  createDisplayState.loading ||
                  updateDisplayState.loading
                }
              >
                {display.id
                  ? "Save and clear"
                  : "Register, post issue and label"}
              </Button>
              {display.id ? (
                <div className="border-t border-[var(--line)] pt-3">
                  <label className="block text-xs font-semibold text-[var(--ink-4)]">
                    Lifecycle reason
                    <Input
                      className="mt-1"
                      value={transitionReason}
                      onChange={(e) => setTransitionReason(e.target.value)}
                    />
                  </label>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => runTransition("inspect")}
                    >
                      Record inspection
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => runTransition("maintenance")}
                    >
                      Maintenance
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => runTransition("remove")}
                    >
                      Remove asset
                    </Button>
                    {display.sourceLotId &&
                    Number(display.issuedQuantity) > 0 ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => runTransition("return_to_stock")}
                      >
                        Return to lot
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </form>
          <div className="mp-panel overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-[var(--line)] p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="font-semibold">Display asset register</h2>
                <p className="mt-1 text-xs text-[var(--ink-4)]">
                  Searchable, inspectable and label-linked; never mixed with
                  saleable stock.
                </p>
              </div>
              <div className="flex gap-2">
                <Input
                  className="md:w-64"
                  value={displaySearch}
                  onChange={(e) => {
                    setDisplaySearch(e.target.value);
                    setDisplayPage(0);
                  }}
                  placeholder="Code, sample, zone or SKU"
                />
                <select
                  value={displayStatus}
                  onChange={(e) => {
                    setDisplayStatus(e.target.value);
                    setDisplayPage(0);
                  }}
                  className="h-10 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"
                >
                  <option value="all">All</option>
                  <option value="active">Active</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="removed">Removed</option>
                </select>
              </div>
            </div>
            <div className="grid gap-px bg-[var(--line)] sm:grid-cols-2 2xl:grid-cols-3">
              {displays.map((row: any) => (
                <button
                  key={row.id}
                  onClick={() =>
                    setDisplay({
                      ...emptyDisplay,
                      ...row,
                      nextInspectionAt:
                        row.nextInspectionAt?.slice?.(0, 10) || "",
                    })
                  }
                  className="bg-[var(--surface)] p-4 text-left hover:bg-[var(--bg-soft)]"
                >
                  <div className="flex gap-3">
                    <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded bg-[var(--bg-soft)]">
                      {row.imageUrl || imageOf(row.product) ? (
                        <img
                          src={row.imageUrl || imageOf(row.product)}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <ImageOff className="h-5 w-5" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold">{row.internalCode}</p>
                      <p className="truncate text-xs text-[var(--ink-4)]">
                        {row.product?.name}
                      </p>
                      <p className="mt-2 flex items-center gap-1 text-xs">
                        <MapPin className="h-3.5 w-3.5" />
                        {row.displayZone || "Zone pending"}
                      </p>
                      <p className="mt-1 text-xs text-[var(--ink-4)]">
                        {row.condition} · {row.status} ·{" "}
                        {row.issuedQuantity || 0} stock pc
                      </p>
                    </div>
                  </div>
                </button>
              ))}
              {!loading && !displays.length ? (
                <div className="col-span-full">
                  <Empty text="No matching display assets." />
                </div>
              ) : null}
            </div>
            <Pager
              page={displayPage}
              hasNext={Boolean(data?.displaySamplesPage?.hasNext)}
              onPage={setDisplayPage}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}

function RegisterHeader({
  title,
  search,
  setSearch,
  children,
}: {
  title: string;
  search: string;
  setSearch: (value: string) => void;
  children: any;
}) {
  return (
    <div className="mp-panel overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-[var(--line)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="mt-1 text-xs text-[var(--ink-4)]">
            Server-paged and indexed for long-term scale.
          </p>
        </div>
        <label className="relative sm:w-80">
          <Search className="absolute left-3 top-3 h-4 w-4 text-[var(--ink-4)]" />
          <Input
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${title.toLowerCase()}`}
          />
        </label>
      </div>
      {children}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="grid min-h-44 place-items-center p-8 text-center">
      <div>
        <Boxes className="mx-auto h-7 w-7 text-[var(--ink-5)]" />
        <p className="mt-3 text-sm font-semibold">{text}</p>
      </div>
    </div>
  );
}
