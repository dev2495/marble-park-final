"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { gql, useLazyQuery, useMutation, useQuery } from "@apollo/client";
import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  AlertCircle as CircleAlert,
  FileSpreadsheet,
  FilterX,
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
import { SearchableSelect } from "@/components/ui/searchable-select";
import { QueryErrorBanner } from "@/components/query-state";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

const WORKSPACE = gql`
  query TileWorkspace(
    $designSearch: String
    $designSkip: Int
    $designStatus: String
    $designReadiness: String
    $designSource: String
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
      readiness: $designReadiness
      source: $designSource
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
const DESIGN_PICKER = gql`
  query TileDesignPicker($search: String) {
    tileDesignsPage(
      search: $search
      skip: 0
      take: 50
      status: "active"
      sort: "code_asc"
    )
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
  defaultMrpInclusive: "",
  defaultNrpInclusive: "",
  floorPriceInclusive: "",
  priceRateBasis: "AREA",
  priceUom: "SQFT",
  mrpSource: "MANUAL",
  mrpChangeReason: "",
  originalMrp: "",
  pricingEffectiveFrom: "",
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
  const [designReadiness, setDesignReadiness] = useState("all");
  const [designSource, setDesignSource] = useState("all");
  const [designSort, setDesignSort] = useState("updated");
  const [design, setDesign] = useState<any>(emptyDesign);
  const [designPickerSearch, setDesignPickerSearch] = useState("");
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
  const [designImportReviewPage, setDesignImportReviewPage] = useState(0);
  const [recentDesignImport, setRecentDesignImport] = useState<any>(null);
  const designImportInput = useRef<HTMLInputElement>(null);
  const variantFormRef = useRef<HTMLFormElement>(null);
  const debouncedDesignSearch = useDebouncedValue(designSearch, 250);
  const debouncedVariantSearch = useDebouncedValue(variantSearch, 250);
  const debouncedDisplaySearch = useDebouncedValue(displaySearch, 250);
  const debouncedDesignPickerSearch = useDebouncedValue(
    designPickerSearch,
    200,
  );
  const variables = {
    designSearch: debouncedDesignSearch || undefined,
    designSkip: designPage * 30,
    designStatus,
    designReadiness,
    designSource,
    designSort,
    variantSearch: debouncedVariantSearch || undefined,
    variantSkip: variantPage * 40,
    variantStatus,
    variantSort,
    displaySearch: debouncedDisplaySearch || undefined,
    displaySkip: displayPage * 30,
    displayStatus,
  };
  const { data, loading, error, refetch } = useQuery(WORKSPACE, {
    variables,
    fetchPolicy: "cache-and-network",
  });
  const {
    data: designPickerData,
    loading: designPickerLoading,
    error: designPickerError,
  } = useQuery(DESIGN_PICKER, {
    variables: { search: debouncedDesignPickerSearch || undefined },
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
  const designs = useMemo(
    () => data?.tileDesignsPage?.items || [],
    [data?.tileDesignsPage?.items],
  );
  const designPickerRows = useMemo(
    () => designPickerData?.tileDesignsPage?.items || [],
    [designPickerData?.tileDesignsPage?.items],
  );
  const variants = data?.tileVariantsPage?.items || [];
  const displays = data?.displaySamplesPage?.items || [];
  const sizes = data?.tileSizes || [];
  const brands = data?.masterProductBrands || [];
  const finishes = data?.masterProductFinishes || [];
  const locations = data?.stockLocations || [];
  const selectableDesigns = useMemo(() => {
    const selected = variant.tileDesignMaster?.id
      ? variant.tileDesignMaster
      : designs.find((row: any) => row.id === variant.tileDesignId) ||
        recentDesignImport?.created?.find(
          (row: any) => row.id === variant.tileDesignId,
        );
    const rows = [selected, ...designPickerRows].filter(Boolean);
    return rows.filter(
      (row: any, index: number) =>
        rows.findIndex((candidate: any) => candidate.id === row.id) === index,
    );
  }, [designPickerRows, designs, recentDesignImport, variant.tileDesignId, variant.tileDesignMaster]);
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
    designPickerError,
    designState.error,
    variantState.error,
    createDisplayState.error,
    updateDisplayState.error,
    transitionState.error,
    designTemplateState.error,
    designImportPreviewState.error,
    designImportApplyState.error,
  ].filter(Boolean);
  const designImportRows = designImportPlan?.rows || [];
  const designImportPageSize = 25;
  const designImportPageCount = Math.max(
    1,
    Math.ceil(designImportRows.length / designImportPageSize),
  );
  const visibleDesignImportRows = designImportRows.slice(
    designImportReviewPage * designImportPageSize,
    (designImportReviewPage + 1) * designImportPageSize,
  );

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
  function startVariantForDesign(row: any) {
    if (row.status !== "active") {
      editDesign(row);
      setNotice(
        `Design ${row.designCode} must be active before a new inwardable variant can be created. Review its status in the design form.`,
      );
      return;
    }
    setVariant({
      ...emptyVariant,
      tileDesignId: row.id,
      tileDesignMaster: row,
    });
    setDesignPickerSearch("");
    setTab("variants");
    setNotice(
      `Design ${row.designCode} is selected. Complete size, finish, packing and MRP to create its first inwardable SKU.`,
    );
    window.setTimeout(
      () =>
        variantFormRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      0,
    );
  }
  function resetDesignFilters() {
    setDesignSearch("");
    setDesignStatus("all");
    setDesignReadiness("all");
    setDesignSource("all");
    setDesignSort("updated");
    setDesignPage(0);
  }
  function editVariant(row: any) {
    setVariant({
      ...emptyVariant,
      ...row,
      piecesPerPack: String(row.piecesPerPack || ""),
      defaultMrpInclusive: row.defaultMrpInclusive == null ? "" : String(row.defaultMrpInclusive),
      originalMrp: row.defaultMrpInclusive == null ? "" : String(row.defaultMrpInclusive),
      mrpChangeReason: "",
      defaultNrpInclusive: row.defaultNrpInclusive == null ? "" : String(row.defaultNrpInclusive),
      floorPriceInclusive: row.floorPriceInclusive == null ? "" : String(row.floorPriceInclusive),
      priceRateBasis: "AREA",
      priceUom: "SQFT",
      pricingEffectiveFrom: row.pricingEffectiveFrom ? String(row.pricingEffectiveFrom).slice(0, 10) : "",
    });
  }
  async function submitVariant(event: any) {
    event.preventDefault();
    const mrpChanged = Boolean(variant.id && variant.originalMrp !== "" && Math.abs(Number(variant.defaultMrpInclusive) - Number(variant.originalMrp)) > 0.0001);
    const response = await saveVariant({
      variables: {
        input: {
          id: variant.id || undefined,
          tileDesignId: variant.tileDesignId,
          tileSizeId: variant.tileSizeId,
          sku: variant.id ? undefined : variant.sku || undefined,
          internalCode: variant.internalCode || undefined,
          finish: variant.finish,
          piecesPerPack: Number(variant.piecesPerPack || 1),
          purchaseUom: variant.purchaseUom,
          salesUom: variant.salesUom,
          allowLoose: Boolean(variant.allowLoose),
          hsnCode: variant.hsnCode || undefined,
          defaultMrpInclusive: variant.defaultMrpInclusive === "" ? undefined : Number(variant.defaultMrpInclusive),
          defaultNrpInclusive: variant.defaultNrpInclusive === "" ? undefined : Number(variant.defaultNrpInclusive),
          floorPriceInclusive: variant.floorPriceInclusive === "" ? null : Number(variant.floorPriceInclusive),
          priceRateBasis: "AREA",
          priceUom: "SQFT",
          mrpSource: variant.defaultMrpInclusive !== "" ? variant.mrpSource : undefined,
          mrpChangeReason: mrpChanged ? variant.mrpChangeReason.trim() : undefined,
          pricingEffectiveFrom: variant.pricingEffectiveFrom || undefined,
          status: variant.status,
          alias: variant.alias || undefined,
          expectedUpdatedAt: variant.id ? variant.updatedAt : undefined,
        },
      },
    });
    return response.data?.saveTileVariant;
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
    setDesignImportReviewPage(0);
    setRecentDesignImport(null);
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
    const created = Array.isArray(result?.created) ? result.created : [];
    setRecentDesignImport({ ...result, created });
    setNotice(
      `${created.length.toLocaleString("en-IN")} design ${created.length === 1 ? "was" : "were"} added. Select Create variant to make each design inwardable and quote-ready.`,
    );
    setDesignImport(null);
    setDesignImportPlan(null);
    setDesignImportReviewPage(0);
    setTab("designs");
    setDesignSearch("");
    setDesignStatus("active");
    setDesignReadiness("awaiting_variant");
    setDesignSource("excel");
    setDesignSort("updated");
    setDesignPage(0);
    await refetch({
      ...variables,
      designSearch: undefined,
      designSkip: 0,
      designStatus: "active",
      designReadiness: "awaiting_variant",
      designSource: "excel",
      designSort: "updated",
    });
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
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-[var(--line)] pt-4 sm:grid-cols-5">
          {[
            ["Design families", data?.tileDesignStats?.designs || 0],
            ["Inwardable SKUs", data?.tileDesignStats?.variants || 0],
            ["Need first variant", data?.tileDesignStats?.awaitingFirstVariant || 0],
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
          className="overflow-hidden rounded-2xl border border-[#dccbc5] bg-white shadow-[0_16px_45px_-34px_rgba(73,35,31,.55)]"
          aria-live="polite"
        >
          <div className="flex flex-col justify-between gap-4 border-b border-[#eaded9] bg-[linear-gradient(120deg,#fff8f4,#fff)] p-5 lg:flex-row lg:items-start">
            <div className="flex gap-3">
              <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${designImportPlan.failed ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
                {designImportPlan.failed ? (
                  <CircleAlert className="h-5 w-5" />
                ) : (
                  <FileSpreadsheet className="h-5 w-5" />
                )}
              </div>
              <div>
                <p className="font-semibold text-[var(--ink)]">
                  Review before adding {designImportPlan.total || 0} design
                  {designImportPlan.total === 1 ? "" : "s"}
                </p>
                <p className="mt-1 text-xs leading-5 text-[var(--ink-3)]">
                  {designImport?.filename} · {designImportPlan.ready || 0} ready ·{" "}
                  {designImportPlan.failed || 0} need correction. Nothing is
                  written until you confirm.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => designImportInput.current?.click()}
              >
                Choose another file
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDesignImport(null);
                  setDesignImportPlan(null);
                  setDesignImportReviewPage(0);
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
                  Boolean(designImportPlan.failed) ||
                  designImportApplyState.loading
                }
              >
                {designImportApplyState.loading
                  ? "Adding designs…"
                  : `Confirm and add ${designImportPlan.ready || 0}`}
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-left text-sm">
              <thead className="bg-[#f7f3f1] text-[10px] font-bold uppercase tracking-[.12em] text-[var(--ink-4)]">
                <tr>
                  <th className="px-5 py-3">Excel row</th>
                  <th className="px-5 py-3">Design identity</th>
                  <th className="px-5 py-3">Brand Master</th>
                  <th className="px-5 py-3">Image</th>
                  <th className="px-5 py-3">Validation</th>
                </tr>
              </thead>
              <tbody>
                {visibleDesignImportRows.map((row: any) => (
                  <tr key={row.rowNumber} className="border-t border-[#eee5e1] align-top">
                    <td className="px-5 py-3 font-mono text-xs text-[var(--ink-4)]">
                      {row.rowNumber}
                    </td>
                    <td className="px-5 py-3">
                      <b className="block text-[var(--ink)]">
                        {row.designCode || "Code missing"}
                      </b>
                      <span className="mt-0.5 block text-xs text-[var(--ink-3)]">
                        {row.name || "Design name missing"}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-medium text-[var(--ink-2)]">
                      {row.brand || "—"}
                    </td>
                    <td className="px-5 py-3 text-xs text-[var(--ink-3)]">
                      {row.imageUrl ? "Linked" : "Add later"}
                    </td>
                    <td className="px-5 py-3">
                      {row.errors?.length ? (
                        <div className="max-w-sm text-xs font-medium leading-5 text-amber-800">
                          <span className="inline-flex items-center gap-1 font-bold">
                            <CircleAlert className="h-3.5 w-3.5" /> Fix row
                          </span>
                          <span className="mt-1 block">{row.errors.join(" · ")}</span>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Ready
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t border-[#eaded9] bg-[#fffdfc] px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-[var(--ink-4)]">
              Rows {designImportRows.length ? designImportReviewPage * designImportPageSize + 1 : 0}–
              {Math.min((designImportReviewPage + 1) * designImportPageSize, designImportRows.length)} of {designImportRows.length}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={designImportReviewPage === 0}
                onClick={() => setDesignImportReviewPage((page) => Math.max(0, page - 1))}
              >
                Previous rows
              </Button>
              <span className="min-w-16 text-center text-xs font-semibold text-[var(--ink-3)]">
                {designImportReviewPage + 1} / {designImportPageCount}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={designImportReviewPage + 1 >= designImportPageCount}
                onClick={() => setDesignImportReviewPage((page) => Math.min(designImportPageCount - 1, page + 1))}
              >
                Next rows
              </Button>
            </div>
          </div>
        </section>
      ) : null}
      {recentDesignImport?.created?.length ? (
        <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-[linear-gradient(120deg,#effcf5,#fff)]">
          <div className="flex flex-col justify-between gap-4 p-5 lg:flex-row lg:items-center">
            <div className="flex gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-800">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-emerald-950">
                  {recentDesignImport.created.length.toLocaleString("en-IN")} design {recentDesignImport.created.length === 1 ? "family" : "families"} added
                </p>
                <p className="mt-1 text-xs leading-5 text-emerald-900/70">
                  They are in Design Registry now. A design becomes inwardable only after its first size × finish variant is created.
                </p>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setTab("designs");
                setDesignSearch("");
                setDesignStatus("active");
                setDesignReadiness("awaiting_variant");
                setDesignSource("excel");
                setDesignSort("updated");
                setDesignPage(0);
              }}
            >
              Show imported designs
            </Button>
          </div>
          <div className="grid gap-px border-t border-emerald-200 bg-emerald-200 sm:grid-cols-2 xl:grid-cols-3">
            {recentDesignImport.created.slice(0, 6).map((row: any) => (
              <div key={row.id} className="flex items-center justify-between gap-3 bg-white/90 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--ink)]">{row.designCode}</p>
                  <p className="truncate text-xs text-[var(--ink-4)]">{row.name} · {row.brand}</p>
                </div>
                <Button type="button" size="sm" onClick={() => startVariantForDesign(row)}>
                  Create variant <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {tab === "designs" ? (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 shadow-[0_8px_24px_-24px_rgba(46,25,22,.6)]">
          <div className="grid gap-3 lg:grid-cols-[minmax(18rem,1fr)_auto_auto_auto_auto]">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[var(--ink-4)]" />
              <Input
                className="pl-9"
                value={designSearch}
                onChange={(e) => {
                  setDesignSearch(e.target.value);
                  setDesignPage(0);
                }}
                placeholder="Search code, design, brand, SKU, size, finish or alias"
                aria-label="Search the complete design registry"
              />
            </label>
          <select
            aria-label="Filter designs by status"
            value={designStatus}
            onChange={(e) => {
              const nextStatus = e.target.value;
              setDesignStatus(nextStatus);
              if (nextStatus !== "active") setDesignReadiness("all");
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
            aria-label="Filter designs by variant readiness"
            value={designReadiness}
            onChange={(e) => {
              const nextReadiness = e.target.value;
              setDesignReadiness(nextReadiness);
              if (nextReadiness !== "all") setDesignStatus("active");
              setDesignPage(0);
            }}
            className="h-10 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"
          >
            <option value="all">All readiness</option>
            <option value="awaiting_variant">Needs first variant</option>
            <option value="variant_ready">Variant-ready</option>
          </select>
          <select
            aria-label="Filter designs by origin"
            value={designSource}
            onChange={(e) => {
              setDesignSource(e.target.value);
              setDesignPage(0);
            }}
            className="h-10 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"
          >
            <option value="all">All origins</option>
            <option value="excel">Excel imported</option>
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
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-3">
            <p className="text-xs font-medium text-[var(--ink-4)]">
              {Number(data?.tileDesignsPage?.total || 0).toLocaleString("en-IN")} matching design families · searches the complete registry
            </p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={resetDesignFilters}
              disabled={
                !designSearch &&
                designStatus === "all" &&
                designReadiness === "all" &&
                designSource === "all" &&
                designSort === "updated"
              }
            >
              <FilterX className="mr-1.5 h-3.5 w-3.5" />
              Reset filters
            </Button>
          </div>
        </div>
      ) : null}
      {tab === "variants" ? (
        <div className="grid gap-3 rounded-md border border-[var(--line)] bg-[var(--surface)] p-3 md:grid-cols-[1fr_auto_auto]">
          <label className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-[var(--ink-4)]" />
            <Input
              className="pl-9"
              value={variantSearch}
              onChange={(e) => {
                setVariantSearch(e.target.value);
                setVariantPage(0);
              }}
              placeholder="Search SKU, design code/name, brand, size, finish or alias"
              aria-label="Search the complete variant registry"
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
                <SearchableSelect
                  className="mt-1"
                  value={design.brand}
                  onValueChange={(brand) => setDesign({ ...design, brand })}
                  options={brands.map((brand: any) => ({ value: brand.name, label: brand.name, description: brand.code ? `Brand code ${brand.code}` : undefined, keywords: brand.code }))}
                  placeholder="Select from Brand Master"
                  searchPlaceholder="Search brand name or code…"
                />
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
            subtitle="Every design family is visible here. Create its first size × finish variant to make it inwardable and quote-ready."
            count={data?.tileDesignsPage?.total}
          >
            {designs.map((row: any) => {
              const variantCount = row.variants?.length || 0;
              const activeDesign = row.status === "active";
              const importedFromExcel = row.metadata?.source === "tile-design-excel-import";
              return (
              <div
                key={row.id}
                className="grid gap-4 border-b border-[var(--line)] p-4 transition hover:bg-[var(--bg-soft)] md:grid-cols-[4rem_minmax(0,1.5fr)_minmax(12rem,1fr)_auto] md:items-center"
              >
                <button
                  type="button"
                  onClick={() => editDesign(row)}
                  aria-label={`Edit ${row.designCode}`}
                  className="grid h-16 w-16 place-items-center overflow-hidden rounded-lg bg-[var(--bg-soft)] outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-[#a3312d]"
                >
                  {imageOf(row) ? (
                    <img
                      src={imageOf(row)}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ImageOff className="h-5 w-5 text-[var(--ink-5)]" />
                  )}
                </button>
                <div className="min-w-0">
                  <button type="button" onClick={() => editDesign(row)} className="max-w-full text-left outline-none focus-visible:underline">
                  <p className="truncate font-semibold">
                    {row.designCode} · {row.name}
                  </p>
                  </button>
                  <p className="mt-1 text-xs text-[var(--ink-4)]">
                    {row.brand || "Brand master required"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {importedFromExcel ? (
                      <span className="rounded-full bg-sky-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-sky-700">
                        Excel import
                      </span>
                    ) : null}
                    <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${variantCount ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                      {variantCount ? "Variant-ready" : "Needs first variant"}
                    </span>
                    {!activeDesign ? (
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-700">
                        {row.status}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="text-xs text-[var(--ink-3)]">
                  <p className="font-semibold text-[var(--ink-2)]">
                    {variantCount} inwardable variant{variantCount === 1 ? "" : "s"}
                  </p>
                  <p className="mt-1">
                    {variantCount
                      ? row.variants
                          .slice(0, 2)
                          .map((item: any) => `${item.tileSizeMaster?.code || item.dimensions || "Size"} · ${item.finish || "Finish"}`)
                          .join("  |  ")
                      : "Add size, finish, packing and MRP next"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 md:justify-end">
                  <Button type="button" size="sm" variant="outline" onClick={() => editDesign(row)}>
                    Edit design
                  </Button>
                  <Button type="button" size="sm" disabled={!activeDesign} onClick={() => startVariantForDesign(row)}>
                    {!activeDesign ? "Activate to add variant" : variantCount ? "Add variant" : "Create first variant"}
                    <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              );
            })}
            {!loading && !designs.length ? (
              <div className="grid min-h-52 place-items-center p-8 text-center">
                <div>
                  <Boxes className="mx-auto h-7 w-7 text-[var(--ink-5)]" />
                  <p className="mt-3 text-sm font-semibold">No design matches these filters.</p>
                  <p className="mt-1 text-xs text-[var(--ink-4)]">Clear the filters to return to the complete Design Registry.</p>
                  <Button type="button" size="sm" variant="outline" className="mt-4" onClick={resetDesignFilters}>
                    <FilterX className="mr-1.5 h-3.5 w-3.5" /> Reset filters
                  </Button>
                </div>
              </div>
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
            ref={variantFormRef}
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
                <SearchableSelect
                  className="mt-1"
                  disabled={Boolean(variant.id)}
                  value={variant.tileDesignId}
                  onValueChange={(tileDesignId) => {
                    const tileDesignMaster = selectableDesigns.find((row: any) => row.id === tileDesignId);
                    setVariant((current: any) => ({ ...current, tileDesignId, tileDesignMaster }));
                  }}
                  options={selectableDesigns.map((x: any) => ({
                    value: x.id,
                    label: `${x.designCode} · ${x.name}`,
                    description: `${x.brand || "Brand Master required"} · ${x.variants?.length || 0} existing variant${x.variants?.length === 1 ? "" : "s"}`,
                    keywords: [
                      x.brand,
                      x.designCode,
                      x.name,
                      ...(x.variants || []).flatMap((item: any) => [
                        item.sku,
                        item.internalCode,
                        item.finish,
                        item.dimensions,
                        item.tileSizeMaster?.code,
                        item.tileSizeMaster?.name,
                      ]),
                    ].filter(Boolean).join(" "),
                  }))}
                  placeholder="Select design"
                  searchPlaceholder="Search any design, brand, SKU, size or alias…"
                  emptyText={designPickerSearch.trim() ? "No active design matches this search" : "Type a design code, name or brand to search all active designs"}
                  loading={designPickerLoading}
                  onSearchChange={setDesignPickerSearch}
                />
                <span className="mt-1.5 block text-[10px] font-medium leading-4 text-[var(--ink-4)]">
                  Searches all {Number(data?.tileDesignStats?.designs || 0).toLocaleString("en-IN")} active design families, including Excel imports.
                </span>
              </label>
              <label className="block text-xs font-semibold text-[var(--ink-4)]">
                Size
                <SearchableSelect
                  className="mt-1"
                  disabled={Boolean(variant.id)}
                  value={variant.tileSizeId}
                  onValueChange={(tileSizeId) => {
                    const size = sizes.find(
                      (x: any) => x.id === tileSizeId,
                    );
                    setVariant({
                      ...variant,
                      tileSizeId,
                      piecesPerPack:
                        variant.piecesPerPack || String(size?.pcsPerBox || ""),
                    });
                  }}
                  options={sizes.map((x: any) => ({ value: x.id, label: `${x.code} · ${x.name}`, description: x.pcsPerBox ? `${x.pcsPerBox} pc / box` : undefined, keywords: `${x.widthMm || ""} ${x.heightMm || ""}` }))}
                  placeholder="Select governed size"
                  searchPlaceholder="Search size or dimensions…"
                />
              </label>
              <label className="block text-xs font-semibold text-[var(--ink-4)]">
                Finish
                <SearchableSelect
                  className="mt-1"
                  value={variant.finish}
                  onValueChange={(finish) => setVariant({ ...variant, finish })}
                  options={finishes.map((finish: any) => ({ value: finish.name, label: finish.name, description: finish.code ? `Finish code ${finish.code}` : undefined, keywords: finish.code }))}
                  placeholder="Select from Finish Master"
                  searchPlaceholder="Search finish name or code…"
                />
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
                  <SearchableSelect className="mt-1" value={variant.purchaseUom} onValueChange={(purchaseUom) => setVariant({ ...variant, purchaseUom })} options={[{ value: "BOX", label: "BOX · full box" }, { value: "PC", label: "PC · individual piece" }]} searchPlaceholder="Search UOM…" />
                </label>
                <label className="block text-xs font-semibold text-[var(--ink-4)]">
                  Sales UOM
                  <SearchableSelect className="mt-1" value={variant.salesUom} onValueChange={(salesUom) => setVariant({ ...variant, salesUom })} options={[{ value: "BOX", label: "BOX · full box" }, { value: "PC", label: "PC · individual piece" }]} searchPlaceholder="Search UOM…" />
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
              <div className="rounded-xl bg-[#f8f4ef] p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#9f342d]">Governed tile selling policy</p>
                <p className="mt-1 text-xs text-[var(--ink-4)]">MRP is required and always entered per sq ft. NRP and floor are optional. Actual cost comes from PO → GRN → inventory lot.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-semibold text-[var(--ink-4)]">
                  MRP ₹ incl. GST / sq ft *
                  <Input
                    className="mt-1"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={variant.defaultMrpInclusive}
                    onChange={(e) =>
                      setVariant({ ...variant, defaultMrpInclusive: e.target.value })
                    }
                  />
                </label>
                <label className="block text-xs font-semibold text-[var(--ink-4)]">
                  Default NRP ₹ incl. GST
                  <Input
                    className="mt-1"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={variant.defaultNrpInclusive}
                    onChange={(e) =>
                      setVariant({ ...variant, defaultNrpInclusive: e.target.value })
                    }
                  />
                </label>
                <label className="block text-xs font-semibold text-[var(--ink-4)]">
                  Floor price ₹ incl. GST / sq ft
                  <Input className="mt-1" type="number" min="0.01" step="0.01" value={variant.floorPriceInclusive} onChange={(e) => setVariant({ ...variant, floorPriceInclusive: e.target.value })} placeholder="Optional · owner approval below floor" />
                </label>
                <label className="block text-xs font-semibold text-[var(--ink-4)]">
                  Price basis
                  <Input className="mt-1" value="Area" disabled />
                </label>
                <label className="block text-xs font-semibold text-[var(--ink-4)]">Price UOM<Input className="mt-1" value="SQFT" disabled /></label>
                <label className="block text-xs font-semibold text-[var(--ink-4)]">MRP source<select className="mt-1 h-10 w-full rounded-md border border-[var(--line)] bg-white px-2" value={variant.mrpSource} onChange={(e) => setVariant({ ...variant, mrpSource: e.target.value })}><option value="MANUAL">Verified manually</option><option value="PACKAGE">Printed package</option><option value="BRAND_LIST">Brand price list</option></select></label>
                <label className="block text-xs font-semibold text-[var(--ink-4)]">Effective from<Input className="mt-1" type="date" value={variant.pricingEffectiveFrom} onChange={(e) => setVariant({ ...variant, pricingEffectiveFrom: e.target.value })}/></label>
                {variant.id && variant.originalMrp !== "" && Math.abs(Number(variant.defaultMrpInclusive) - Number(variant.originalMrp)) > 0.0001 ? <label className="block text-xs font-semibold text-[#9f342d] sm:col-span-2">MRP change reason *<Input className="mt-1" value={variant.mrpChangeReason} onChange={(e) => setVariant({ ...variant, mrpChangeReason: e.target.value })} placeholder="Example: Revised brand price list"/><span className="mt-1 block text-[10px] font-medium text-[var(--ink-4)]">Old and new MRP, user, source and effective date will be added to this tile SKU history.</span></label> : null}
                </div>
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
                  !variant.finish ||
                  Number(variant.defaultMrpInclusive) <= 0 ||
                  (variant.id && variant.originalMrp !== "" && Math.abs(Number(variant.defaultMrpInclusive) - Number(variant.originalMrp)) > 0.0001 && variant.mrpChangeReason.trim().length < 3)
                }
              >
                {variantState.loading ? "Saving…" : "Save and clear variant"}
              </Button>
            </div>
          </form>
          <RegisterHeader
            title="Variant registry"
            subtitle="Permanent inwardable SKUs. Use the search and status controls above to find any design, size, finish or alias."
            count={data?.tileVariantsPage?.total}
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
  subtitle,
  count,
  children,
}: {
  title: string;
  search?: string;
  setSearch?: (value: string) => void;
  subtitle?: string;
  count?: number;
  children: any;
}) {
  return (
    <div className="mp-panel overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-[var(--line)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">{title}</h2>
            {typeof count === "number" ? (
              <span className="rounded-full bg-[var(--bg-soft)] px-2 py-0.5 text-[10px] font-bold tabular-nums text-[var(--ink-3)]">
                {count.toLocaleString("en-IN")}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-[var(--ink-4)]">
            {subtitle || "Server-paged and indexed for long-term scale."}
          </p>
        </div>
        {setSearch && search !== undefined ? <label className="relative sm:w-80">
          <Search className="absolute left-3 top-3 h-4 w-4 text-[var(--ink-4)]" />
          <Input
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${title.toLowerCase()}`}
          />
        </label> : null}
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
