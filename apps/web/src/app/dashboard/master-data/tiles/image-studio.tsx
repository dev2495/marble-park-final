"use client";

import { gql, useApolloClient, useMutation, useQuery } from "@apollo/client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  FileArchive,
  ImageOff,
  ImagePlus,
  Image as ImageIcon,
  Info,
  Layers3,
  Loader2,
  RefreshCw,
  Search,
  StopCircle,
  Upload,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toMedia } from "@/lib/media";
import { UPLOAD_IMAGE_ASSET, uploadCompressedImage } from "@/lib/image-upload";
import {
  READY_STATUSES,
  STATUS_LABELS,
  ZIP_LIMITS,
  buildMatchPlan,
  downloadCsv,
  type ExistingImageMode,
  type MatchIndex,
  type PlanGroup,
  type PlanRow,
  type PlanStatus,
  type ZipEntryInfo,
} from "@/lib/tile-image-match";

const QUEUE = gql`
  query TileImageQueue($search: String, $filter: String, $skip: Int, $take: Int) {
    tileImageQueue(search: $search, filter: $filter, skip: $skip, take: $take)
  }
`;
const MATCH_INDEX = gql`
  query TileImageMatchIndex {
    tileImageMatchIndex
  }
`;
const SET_DESIGN_MEDIA = gql`
  mutation SetTileDesignMedia($designId: ID!, $media: JSON!, $mode: String) {
    setTileDesignMedia(designId: $designId, media: $media, mode: $mode)
  }
`;
const SET_VARIANT_MEDIA = gql`
  mutation SetTileVariantMediaFromStudio($productId: ID!, $media: JSON) {
    setTileVariantMedia(productId: $productId, media: $media)
  }
`;

const PAGE = 25;
const PREVIEW_PAGE = 50;
const CONCURRENCY = 2;

type RowResult = { state: "done" | "failed"; message: string };

function errorText(error: any) {
  return error?.graphQLErrors?.[0]?.message || error?.message || "Upload failed";
}

function suggestedFileName(code: string) {
  return `${code.replace(/\//g, "_")}.jpg`;
}

function mimeFor(path: string) {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
}

function StatusChip({ status, result }: { status: PlanStatus; result?: RowResult }) {
  if (result?.state === "done") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800"><CheckCircle2 className="h-3 w-3" />Uploaded</span>;
  }
  if (result?.state === "failed") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800"><XCircle className="h-3 w-3" />Failed</span>;
  }
  const ready = READY_STATUSES.includes(status);
  const skipped = status === "skip-existing";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${ready ? "bg-sky-100 text-sky-800" : skipped ? "bg-zinc-100 text-zinc-700" : "bg-amber-100 text-amber-900"}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

// Falls back to the "no photo" icon if a stored file cannot be loaded.
function QueueThumb({ url, alt }: { url?: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!url || failed) return <ImageOff className="h-5 w-5 text-[var(--ink-5)]" aria-label={failed ? "Photo file missing" : "No photo"} />;
  return <img src={url} alt={alt} className="h-full w-full object-cover" loading="lazy" onError={() => setFailed(true)} />;
}

function RulesPanel() {
  const [open, setOpen] = useState(true);
  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--bg-soft)]/60">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between gap-3 p-4 text-left" aria-expanded={open}>
        <span className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]"><Info className="h-4 w-4 text-[var(--brand-700)]" />File naming rules for the ZIP</span>
        <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="space-y-4 border-t border-[var(--line)] p-4 text-sm text-[var(--ink-2)]">
          <ol className="list-decimal space-y-2 pl-5">
            <li><b>Name each photo exactly as the design code.</b> Upper or lower case does not matter. The image is shown on every size and finish of that design.</li>
            <li><b>More photos of the same design:</b> add <code className="rounded bg-white px-1">@2</code>, <code className="rounded bg-white px-1">@3</code> … up to <code className="rounded bg-white px-1">@8</code> before the extension. The file without a number is the main photo used in quotes.</li>
            <li><b>A photo for one variant only</b> (for example a glossy finish that looks different): name it with that variant&apos;s SKU or display code. It overrides the design photo for that variant only.</li>
            <li><b>Codes containing &quot;/&quot;</b> cannot be used in file names. Write the &quot;/&quot; as <code className="rounded bg-white px-1">_</code> or <code className="rounded bg-white px-1">-</code>. Spaces are read as hyphens.</li>
            <li><b>Folders are fine.</b> Only the file name is used. Mac/Windows system files (<code>__MACOSX</code>, <code>.DS_Store</code>, <code>Thumbs.db</code>) are ignored automatically.</li>
            <li><b>Formats:</b> JPG, JPEG, PNG or WebP, up to 25 MB per photo, up to {ZIP_LIMITS.maxFiles.toLocaleString("en-IN")} photos and 500 MB per ZIP. Split bigger folders into several ZIPs.</li>
            <li><b>Nothing is uploaded until you review the preview.</b> Every photo is resized to 1600 px and compressed (typically 150–400 KB) before upload.</li>
          </ol>
          <div className="overflow-x-auto rounded-md border border-[var(--line)] bg-white">
            <table className="w-full min-w-[34rem] text-left text-xs">
              <thead className="bg-[var(--bg-soft)] text-[var(--ink-4)]">
                <tr><th className="px-3 py-2 font-semibold">File in ZIP</th><th className="px-3 py-2 font-semibold">What happens</th></tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)] font-mono">
                {[
                  ["MP-D-1206.jpg", "Main photo of design MP-D-1206 (all its variants)"],
                  ["mp-d-1206@2.png", "2nd photo of design MP-D-1206"],
                  ["Felis White/MP-D-1206@3.webp", "3rd photo (folder name ignored)"],
                  ["CAL_GOLD.jpg", "Design CAL/GOLD (\"/\" written as \"_\")"],
                  ["MP-D-1206-1200X600-GLOSSY.jpg", "Only variant MP-D-1206-1200X600-GLOSSY"],
                  ["IMG_4021.jpg", "Not matched; listed in the report, nothing uploaded"],
                ].map(([file, effect]) => (
                  <tr key={file}><td className="px-3 py-2 text-[var(--ink)]">{file}</td><td className="px-3 py-2 font-sans text-[var(--ink-3)]">{effect}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[var(--ink-4)]">Tip: use <b>Download missing list</b> below to get every design code without a photo and the exact file name to use. Share it with whoever takes the photos.</p>
        </div>
      ) : null}
    </section>
  );
}

export function TileImageStudio({ onChanged }: { onChanged?: () => void }) {
  const client = useApolloClient();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filter, setFilter] = useState<"missing" | "has" | "all">("missing");
  const [skip, setSkip] = useState(0);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  useEffect(() => {
    const handle = setTimeout(() => { setDebounced(search.trim()); setSkip(0); }, 300);
    return () => clearTimeout(handle);
  }, [search]);
  const { data, loading, error, refetch } = useQuery(QUEUE, { variables: { search: debounced || undefined, filter, skip, take: PAGE }, fetchPolicy: "cache-and-network" });
  const queue = data?.tileImageQueue;
  const summary = queue?.summary || {};
  const [upload] = useMutation(UPLOAD_IMAGE_ASSET);
  const [setDesignMedia] = useMutation(SET_DESIGN_MEDIA);
  const [setVariantMedia] = useMutation(SET_VARIANT_MEDIA);

  // ---- bulk ZIP ----
  const zipRef = useRef<any>(null);
  const stopRef = useRef(false);
  const [zipName, setZipName] = useState("");
  const [zipError, setZipError] = useState("");
  const [reading, setReading] = useState(false);
  const [entries, setEntries] = useState<ZipEntryInfo[]>([]);
  const [index, setIndex] = useState<MatchIndex | null>(null);
  const [mode, setMode] = useState<ExistingImageMode>("skip");
  const [statusFilter, setStatusFilter] = useState<"all" | "ready" | "problems" | "skipped">("all");
  const [previewPage, setPreviewPage] = useState(0);
  const [results, setResults] = useState<Record<string, RowResult>>({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, current: "" });
  const [dragging, setDragging] = useState(false);

  const plan = useMemo(() => (index ? buildMatchPlan(entries, index, mode) : null), [entries, index, mode]);
  const problems = plan ? plan.rows.filter((row) => !READY_STATUSES.includes(row.status) && row.status !== "skip-existing") : [];
  const readyCount = plan ? plan.rows.filter((row) => READY_STATUSES.includes(row.status)).length : 0;
  const doneCount = Object.values(results).filter((r) => r.state === "done").length;
  const failedCount = Object.values(results).filter((r) => r.state === "failed").length;
  const visibleRows = useMemo(() => {
    const rows = plan?.rows || [];
    if (statusFilter === "ready") return rows.filter((row) => READY_STATUSES.includes(row.status));
    if (statusFilter === "skipped") return rows.filter((row) => row.status === "skip-existing");
    if (statusFilter === "problems") return rows.filter((row) => (!READY_STATUSES.includes(row.status) && row.status !== "skip-existing") || results[row.path]?.state === "failed");
    return rows;
  }, [plan, statusFilter, results]);
  const pagedRows = visibleRows.slice(previewPage * PREVIEW_PAGE, (previewPage + 1) * PREVIEW_PAGE);

  async function readZip(file: File | undefined) {
    if (!file) return;
    setZipError("");
    setResults({});
    setPreviewPage(0);
    setStatusFilter("all");
    setNotice(null);
    if (!file.name.toLowerCase().endsWith(".zip")) { setZipError("Choose a .zip file. To upload one photo, use the queue below."); return; }
    if (file.size > ZIP_LIMITS.maxZipBytes) { setZipError(`This ZIP is ${(file.size / 1048576).toFixed(0)} MB. The limit is 500 MB; split the photos into smaller ZIPs.`); return; }
    setReading(true);
    try {
      const { default: JSZip } = await import("jszip");
      const zip = await JSZip.loadAsync(file);
      const list: ZipEntryInfo[] = [];
      zip.forEach((path: string, entry: any) => { if (!entry.dir) list.push({ path, size: Number(entry?._data?.uncompressedSize || 0) }); });
      const files = list.filter((entry) => !entry.path.split("/").some((part) => part === "__MACOSX" || part.startsWith(".")));
      if (!files.length) throw new Error("The ZIP has no files.");
      if (files.length > ZIP_LIMITS.maxFiles) throw new Error(`The ZIP has ${files.length.toLocaleString("en-IN")} files; the limit is ${ZIP_LIMITS.maxFiles.toLocaleString("en-IN")}. Split it into smaller ZIPs.`);
      const response = await client.query({ query: MATCH_INDEX, fetchPolicy: "network-only" });
      zipRef.current = zip;
      setIndex(response.data?.tileImageMatchIndex || { designs: [], variants: [] });
      setEntries(list);
      setZipName(file.name);
    } catch (err: any) {
      zipRef.current = null;
      setEntries([]);
      setIndex(null);
      setZipName("");
      setZipError(err?.message?.includes("Corrupted zip") || err?.message?.includes("End of data") ? "This file is not a valid ZIP (it may be damaged or still downloading)." : errorText(err));
    } finally {
      setReading(false);
    }
  }

  function resetZip() {
    zipRef.current = null;
    setEntries([]);
    setIndex(null);
    setZipName("");
    setResults({});
    setZipError("");
  }

  async function uploadGroup(group: PlanGroup) {
    const urls: string[] = [];
    let thumbnail: string | null = null;
    for (const row of group.rows) {
      if (stopRef.current) throw new Error("Stopped before upload");
      setProgress((value) => ({ ...value, current: row.fileName }));
      const raw = await zipRef.current.file(row.path).async("blob");
      const uploaded = await uploadCompressedImage(upload as any, new Blob([raw], { type: mimeFor(row.path) }), `${group.code}-${row.slot}`);
      urls.push(uploaded.url);
      if (!thumbnail) thumbnail = uploaded.thumbnailUrl;
    }
    const media = toMedia(urls, thumbnail);
    if (group.kind === "design") {
      await setDesignMedia({ variables: { designId: group.id, media, mode: mode === "append" ? "append" : "replace" } });
    } else {
      await setVariantMedia({ variables: { productId: group.id, media } });
    }
  }

  async function runUpload(onlyFailed = false) {
    if (!plan) return;
    const groups = plan.groups.filter((group) => (onlyFailed ? group.rows.some((row) => results[row.path]?.state === "failed") : group.rows.some((row) => !results[row.path] || results[row.path].state === "failed")));
    if (!groups.length) return;
    stopRef.current = false;
    setRunning(true);
    setNotice(null);
    const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
    setProgress({ done: 0, total, current: "" });
    let cursor = 0;
    const worker = async () => {
      while (cursor < groups.length && !stopRef.current) {
        const group = groups[cursor++];
        let outcome: RowResult;
        try {
          await uploadGroup(group);
          outcome = { state: "done", message: group.kind === "design" ? `Saved to design ${group.code}` : `Saved to variant ${group.code}` };
        } catch (err) {
          outcome = { state: "failed", message: errorText(err) };
        }
        setResults((current) => {
          const next = { ...current };
          for (const row of group.rows) next[row.path] = outcome;
          return next;
        });
        setProgress((value) => ({ ...value, done: value.done + group.rows.length }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, groups.length) }, worker));
    setRunning(false);
    setProgress((value) => ({ ...value, current: "" }));
    await refetch();
    onChanged?.();
  }

  function downloadReport() {
    if (!plan) return;
    downloadCsv(`tile-image-upload-${new Date().toISOString().slice(0, 10)}.csv`, ["File", "Status", "Matched to", "Code", "Position", "Details"], plan.rows.map((row) => [
      row.path,
      results[row.path]?.state === "done" ? "Uploaded" : results[row.path]?.state === "failed" ? "Failed" : STATUS_LABELS[row.status],
      row.target ? (row.target.kind === "design" ? "Design" : "Variant") : "",
      row.target?.code || "",
      row.slot,
      results[row.path]?.message || row.message,
    ]));
  }

  async function downloadMissingList() {
    const response = await client.query({ query: MATCH_INDEX, fetchPolicy: "network-only" });
    const designs = (response.data?.tileImageMatchIndex?.designs || []).filter((design: any) => !design.hasImage);
    downloadCsv(`tile-designs-missing-images-${new Date().toISOString().slice(0, 10)}.csv`, ["Design code", "Design name", "Brand", "Variants", "Name the photo"], designs.map((design: any) => [design.designCode, design.name, design.brand || "", design.variantCount, suggestedFileName(design.designCode)]));
  }

  // ---- single design upload from the queue ----
  const [rowBusy, setRowBusy] = useState<string>("");
  async function uploadForDesign(row: any, files: FileList | null, replace: boolean) {
    const list = Array.from(files || []).slice(0, ZIP_LIMITS.maxImagesPerItem);
    if (!list.length) return;
    setRowBusy(row.id);
    setNotice(null);
    try {
      const urls: string[] = [];
      let thumbnail: string | null = null;
      for (const [i, file] of list.entries()) {
        const uploaded = await uploadCompressedImage(upload as any, file, `${row.designCode}-${i + 1}`);
        urls.push(uploaded.url);
        if (!thumbnail) thumbnail = uploaded.thumbnailUrl;
      }
      const result = await setDesignMedia({ variables: { designId: row.id, media: toMedia(urls, thumbnail), mode: replace || !row.hasImage ? "replace" : "append" } });
      const synced = result.data?.setTileDesignMedia?.syncedVariants ?? 0;
      setNotice({ tone: "ok", text: `${row.designCode}: ${urls.length} photo${urls.length === 1 ? "" : "s"} saved${synced ? ` and shown on ${synced} variant${synced === 1 ? "" : "s"}` : ""}.` });
      await refetch();
      onChanged?.();
    } catch (err) {
      setNotice({ tone: "error", text: `${row.designCode}: ${errorText(err)}` });
    } finally {
      setRowBusy("");
    }
  }

  const coverage = summary.designs ? Math.round((Number(summary.withImage || 0) / Number(summary.designs)) * 100) : 0;
  const items: any[] = queue?.items || [];

  return (
    <div className="space-y-5">
      <section className="mp-panel p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <h2 className="flex items-center gap-2 text-lg font-semibold"><ImageIcon className="h-5 w-5 text-[var(--brand-700)]" />Tile images</h2>
            <p className="mt-1 text-sm text-[var(--ink-3)]">
              Add photos once per <b>design</b>. Every size and finish of that design shows the photo in search, quotes, PDFs and labels. Changing a design photo updates all of them. Give a variant its own photo only when it looks different.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={downloadMissingList}><Download className="mr-2 h-4 w-4" />Download missing list</Button>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Designs", summary.designs, "text-[var(--ink)]"],
            ["With photo", summary.withImage, "text-emerald-700"],
            ["Missing photo", summary.missing, "text-amber-700"],
            ["Variants with own photo", summary.variantOverrides, "text-[var(--ink)]"],
          ].map(([label, value, tone]) => (
            <div key={String(label)} className="rounded-md border border-[var(--line)] bg-[var(--surface)] p-3">
              <p className={`text-2xl font-semibold tabular-nums ${tone}`}>{value == null ? "—" : Number(value).toLocaleString("en-IN")}</p>
              <p className="text-xs text-[var(--ink-4)]">{label}</p>
            </div>
          ))}
        </div>
        <div className="mt-4">
          <div className="flex justify-between text-xs text-[var(--ink-4)]"><span>Design photo coverage</span><span className="font-semibold text-[var(--ink)]">{coverage}%</span></div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--bg-soft)]"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${coverage}%` }} /></div>
        </div>
      </section>

      {notice ? (
        <div role="status" className={`flex items-center gap-2 rounded-md border p-3 text-sm font-semibold ${notice.tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>
          {notice.tone === "ok" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}{notice.text}
        </div>
      ) : null}

      <section className="mp-panel space-y-4 p-5">
        <div>
          <h3 className="flex items-center gap-2 font-semibold"><FileArchive className="h-5 w-5 text-[var(--brand-700)]" />Bulk upload from a ZIP</h3>
          <p className="mt-1 text-sm text-[var(--ink-3)]">Put the photos in one ZIP, named by design code. You will see exactly what matches before anything is uploaded.</p>
        </div>
        <RulesPanel />

        {!plan ? (
          <label
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); void readZip(event.dataTransfer.files?.[0]); }}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition ${dragging ? "border-[var(--brand-600)] bg-[var(--brand-50)]" : "border-[var(--line)] hover:border-[var(--brand-400)] hover:bg-[var(--bg-soft)]"}`}
          >
            {reading ? <Loader2 className="h-8 w-8 animate-spin text-[var(--brand-700)]" /> : <Upload className="h-8 w-8 text-[var(--brand-700)]" />}
            <span className="text-sm font-semibold text-[var(--ink)]">{reading ? "Reading ZIP and matching codes…" : "Drop a ZIP here or click to choose"}</span>
            <span className="text-xs text-[var(--ink-4)]">JPG, PNG or WebP inside · up to {ZIP_LIMITS.maxFiles.toLocaleString("en-IN")} photos · 500 MB</span>
            <input type="file" accept=".zip,application/zip,application/x-zip-compressed" className="sr-only" disabled={reading} onChange={(event) => { void readZip(event.target.files?.[0]); event.target.value = ""; }} />
          </label>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--line)] bg-[var(--surface)] p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[var(--ink)]"><FileArchive className="mr-1 inline h-4 w-4" />{zipName}</p>
                <p className="text-xs text-[var(--ink-4)]">{plan.rows.length.toLocaleString("en-IN")} files checked · {plan.groups.length.toLocaleString("en-IN")} designs/variants will be updated</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={downloadReport}><Download className="mr-1.5 h-4 w-4" />Match report (CSV)</Button>
                <Button type="button" variant="ghost" size="sm" disabled={running} onClick={resetZip}>Choose another ZIP</Button>
              </div>
            </div>

            <fieldset className="rounded-md border border-[var(--line)] p-3" disabled={running}>
              <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-[var(--ink-4)]">When a design or variant already has a photo</legend>
              <div className="mt-1 grid gap-2 sm:grid-cols-3">
                {([
                  ["skip", "Skip it", "Only fill missing photos (safest)."],
                  ["replace", "Replace", "ZIP photos replace the current ones."],
                  ["append", "Add to it", "Keep current photos, add new (max 8)."],
                ] as const).map(([value, label, hint]) => (
                  <label key={value} className={`flex cursor-pointer gap-2 rounded-md border p-3 text-sm ${mode === value ? "border-[var(--ink)] bg-[var(--bg-soft)]" : "border-[var(--line)]"}`}>
                    <input type="radio" name="existing-mode" value={value} checked={mode === value} onChange={() => { setMode(value); setResults({}); }} className="mt-0.5" />
                    <span><b className="block">{label}</b><span className="text-xs text-[var(--ink-4)]">{hint}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([
                ["all", "All files", plan.rows.length, "text-[var(--ink)]"],
                ["ready", "Ready to upload", readyCount, "text-sky-700"],
                ["skipped", "Skipped (has photo)", plan.counts["skip-existing"] || 0, "text-zinc-600"],
                ["problems", "Need attention", problems.length + failedCount, "text-amber-700"],
              ] as const).map(([value, label, count, tone]) => (
                <button key={value} type="button" onClick={() => { setStatusFilter(value); setPreviewPage(0); }} className={`rounded-md border p-3 text-left transition ${statusFilter === value ? "border-[var(--ink)] bg-[var(--bg-soft)]" : "border-[var(--line)] hover:bg-[var(--bg-soft)]"}`}>
                  <p className={`text-xl font-semibold tabular-nums ${tone}`}>{Number(count).toLocaleString("en-IN")}</p>
                  <p className="text-xs text-[var(--ink-4)]">{label}</p>
                </button>
              ))}
            </div>

            <div className="overflow-x-auto rounded-md border border-[var(--line)]">
              <table className="w-full min-w-[46rem] text-left text-sm">
                <thead className="bg-[var(--bg-soft)] text-xs text-[var(--ink-4)]">
                  <tr><th className="px-3 py-2 font-semibold">File</th><th className="px-3 py-2 font-semibold">Status</th><th className="px-3 py-2 font-semibold">Matched to</th><th className="px-3 py-2 font-semibold">Details</th></tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {pagedRows.map((row: PlanRow) => (
                    <tr key={row.path} className="align-top">
                      <td className="max-w-[16rem] px-3 py-2"><p className="truncate font-mono text-xs text-[var(--ink)]" title={row.path}>{row.fileName}</p>{row.path !== row.fileName ? <p className="truncate text-[11px] text-[var(--ink-5)]">{row.path}</p> : null}</td>
                      <td className="px-3 py-2"><StatusChip status={row.status} result={results[row.path]} /></td>
                      <td className="px-3 py-2 text-xs">{row.target ? <><b className="font-mono">{row.target.code}</b><span className="block text-[var(--ink-4)]">{row.target.kind === "design" ? "Design" : "Variant"} · {row.target.name}</span></> : <span className="text-[var(--ink-5)]">—</span>}</td>
                      <td className="px-3 py-2 text-xs text-[var(--ink-3)]">{results[row.path]?.message || row.message}</td>
                    </tr>
                  ))}
                  {!pagedRows.length ? <tr><td colSpan={4} className="px-3 py-6 text-center text-sm text-[var(--ink-4)]">No files in this view.</td></tr> : null}
                </tbody>
              </table>
            </div>
            {visibleRows.length > PREVIEW_PAGE ? (
              <div className="flex items-center justify-between text-xs text-[var(--ink-4)]">
                <span>{previewPage * PREVIEW_PAGE + 1}–{Math.min(visibleRows.length, (previewPage + 1) * PREVIEW_PAGE)} of {visibleRows.length.toLocaleString("en-IN")}</span>
                <div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={previewPage === 0} onClick={() => setPreviewPage((p) => p - 1)}>Previous</Button><Button type="button" variant="outline" size="sm" disabled={(previewPage + 1) * PREVIEW_PAGE >= visibleRows.length} onClick={() => setPreviewPage((p) => p + 1)}>Next</Button></div>
              </div>
            ) : null}

            {running || progress.total ? (
              <div className="rounded-md border border-[var(--line)] bg-[var(--surface)] p-3" role="status" aria-live="polite">
                <div className="flex justify-between text-xs text-[var(--ink-3)]"><span>{running ? `Compressing and uploading… ${progress.current}` : "Upload finished"}</span><span className="font-semibold tabular-nums">{progress.done}/{progress.total}</span></div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--bg-soft)]"><div className="h-full rounded-full bg-[var(--brand-600)] transition-all" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} /></div>
                {!running ? <p className="mt-2 text-xs"><span className="font-semibold text-emerald-700">{doneCount} uploaded</span>{failedCount ? <span className="ml-3 font-semibold text-red-700">{failedCount} failed — see “Need attention”</span> : null}</p> : null}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {running ? (
                <Button type="button" variant="outline" onClick={() => { stopRef.current = true; }}><StopCircle className="mr-2 h-4 w-4" />Stop after current photo</Button>
              ) : (
                <>
                  <Button type="button" disabled={!readyCount || readyCount === doneCount} onClick={() => void runUpload(false)}>
                    <Upload className="mr-2 h-4 w-4" />{doneCount && readyCount === doneCount ? "All ready photos uploaded" : `Upload ${Math.max(0, readyCount - doneCount).toLocaleString("en-IN")} photo${readyCount - doneCount === 1 ? "" : "s"}`}
                  </Button>
                  {failedCount ? <Button type="button" variant="outline" onClick={() => void runUpload(true)}><RefreshCw className="mr-2 h-4 w-4" />Retry {failedCount} failed</Button> : null}
                </>
              )}
              {problems.length ? <p className="text-xs text-amber-800"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />{problems.length} file{problems.length === 1 ? "" : "s"} will be left out. Fix the names (see “Need attention”) and upload them in a new ZIP.</p> : null}
            </div>
          </div>
        )}
        {zipError ? <p role="alert" className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800"><AlertTriangle className="h-4 w-4 shrink-0" />{zipError}</p> : null}
      </section>

      <section className="mp-panel p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="flex items-center gap-2 font-semibold"><Layers3 className="h-5 w-5 text-[var(--brand-700)]" />Design photo queue</h3>
            <p className="mt-1 text-sm text-[var(--ink-3)]">Work through designs one at a time. Uploading here is the same as adding the photo in the design form.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-[var(--ink-4)]" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search code, name or brand" className="pl-9 sm:w-72" /></div>
            <div className="grid grid-cols-3 rounded-md border border-[var(--line)] bg-[var(--surface)] p-1 text-xs font-semibold">
              {([["missing", "Missing"], ["has", "Has photo"], ["all", "All"]] as const).map(([value, label]) => (
                <button key={value} type="button" onClick={() => { setFilter(value); setSkip(0); }} className={`rounded px-3 py-1.5 ${filter === value ? "bg-[var(--ink)] text-[var(--surface)]" : "text-[var(--ink-3)] hover:bg-[var(--bg-soft)]"}`}>{label}</button>
              ))}
            </div>
          </div>
        </div>
        {error ? <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{errorText(error)}</p> : null}
        <ul className="mt-4 divide-y divide-[var(--line)] rounded-md border border-[var(--line)]">
          {items.map((row) => (
            <li key={row.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
              <div className="grid h-16 w-20 shrink-0 place-items-center overflow-hidden rounded-md border border-[var(--line)] bg-[var(--bg-soft)]">
                <QueueThumb url={row.thumbnailUrl} alt={`${row.designCode} photo`} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                  <span className="font-mono">{row.designCode}</span>
                  <button type="button" title="Copy suggested file name" onClick={() => void navigator.clipboard?.writeText(suggestedFileName(row.designCode))} className="rounded p-1 text-[var(--ink-4)] hover:bg-[var(--bg-soft)]"><Copy className="h-3.5 w-3.5" /></button>
                  {row.status !== "active" ? <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs uppercase text-zinc-600">{row.status}</span> : null}
                </p>
                <p className="truncate text-xs text-[var(--ink-3)]">{row.name}{row.brand ? ` · ${row.brand}` : ""}</p>
                <p className="mt-0.5 text-[11px] text-[var(--ink-4)]">{row.variantCount} variant{row.variantCount === 1 ? "" : "s"}{row.variantOverrides ? ` · ${row.variantOverrides} with own photo` : ""}{row.hasImage ? ` · ${row.imageCount} photo${row.imageCount === 1 ? "" : "s"}` : ""} · file name <span className="font-mono">{suggestedFileName(row.designCode)}</span></p>
              </div>
              <div className="flex shrink-0 gap-2">
                <label className={`inline-flex h-9 cursor-pointer items-center rounded-md px-3 text-sm font-semibold ${row.hasImage ? "border border-[var(--line)] bg-white text-[var(--ink)] hover:bg-[var(--bg-soft)]" : "bg-[var(--ink)] text-[var(--surface)] hover:opacity-90"} ${rowBusy === row.id ? "pointer-events-none opacity-60" : ""}`}>
                  {rowBusy === row.id ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-1.5 h-4 w-4" />}
                  {row.hasImage ? "Add photos" : "Upload photo"}
                  <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(event) => { void uploadForDesign(row, event.target.files, false); event.target.value = ""; }} />
                </label>
                {row.hasImage ? (
                  <label className={`inline-flex h-9 cursor-pointer items-center rounded-md border border-[var(--line)] bg-white px-3 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--bg-soft)] ${rowBusy === row.id ? "pointer-events-none opacity-60" : ""}`}>
                    Replace
                    <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(event) => { void uploadForDesign(row, event.target.files, true); event.target.value = ""; }} />
                  </label>
                ) : null}
              </div>
            </li>
          ))}
          {!items.length ? (
            <li className="p-8 text-center text-sm text-[var(--ink-4)]">
              {loading ? "Loading designs…" : filter === "missing" ? <><CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-emerald-600" />Every design{debounced ? " matching this search" : ""} has a photo.</> : "No designs match this search."}
            </li>
          ) : null}
        </ul>
        {queue?.total > PAGE ? (
          <div className="mt-3 flex items-center justify-between text-xs text-[var(--ink-4)]">
            <span>{skip + 1}–{Math.min(queue.total, skip + PAGE)} of {Number(queue.total).toLocaleString("en-IN")}</span>
            <div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={skip === 0} onClick={() => setSkip((s) => Math.max(0, s - PAGE))}>Previous</Button><Button type="button" variant="outline" size="sm" disabled={!queue?.hasNext} onClick={() => setSkip((s) => s + PAGE)}>Next</Button></div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
