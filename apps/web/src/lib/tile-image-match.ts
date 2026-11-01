// File-name rules for the tile bulk image ZIP upload. Pure functions so the
// rules shown to users and the matching that runs are the same code.

export const ZIP_LIMITS = {
  maxZipBytes: 500 * 1024 * 1024,
  maxFiles: 2000,
  maxSourceBytes: 25 * 1024 * 1024,
  maxImagesPerItem: 8,
  extensions: ['jpg', 'jpeg', 'png', 'webp'],
} as const;

export type ExistingImageMode = 'skip' | 'replace' | 'append';

export type MatchDesign = { id: string; designCode: string; name: string; brand?: string; hasImage: boolean; imageCount: number; variantCount: number };
export type MatchVariant = { id: string; sku: string; internalCode?: string | null; name: string; tileDesignId?: string | null; hasOwnImage: boolean };
export type MatchIndex = { designs: MatchDesign[]; variants: MatchVariant[] };

export type ZipEntryInfo = { path: string; size: number };

export type PlanStatus =
  | 'ready-design'
  | 'ready-variant'
  | 'skip-existing'
  | 'unmatched'
  | 'ambiguous'
  | 'duplicate'
  | 'unsupported'
  | 'too-large'
  | 'too-many';

export type PlanRow = {
  path: string;
  fileName: string;
  size: number;
  slot: number;
  status: PlanStatus;
  message: string;
  target?: { kind: 'design' | 'variant'; id: string; code: string; name: string };
};

export type PlanGroup = { key: string; kind: 'design' | 'variant'; id: string; code: string; name: string; rows: PlanRow[] };

export const STATUS_LABELS: Record<PlanStatus, string> = {
  'ready-design': 'Ready · design',
  'ready-variant': 'Ready · variant only',
  'skip-existing': 'Skipped · already has image',
  unmatched: 'No matching code',
  ambiguous: 'Matches more than one code',
  duplicate: 'Duplicate file',
  unsupported: 'Not an image',
  'too-large': 'Over 25 MB',
  'too-many': 'Over 8 images',
};

export const READY_STATUSES: PlanStatus[] = ['ready-design', 'ready-variant'];

const IGNORED_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

/** System files and folders that are silently left out (not reported). */
export function isIgnoredEntry(path: string) {
  const parts = path.split('/').filter(Boolean);
  const name = (parts[parts.length - 1] || '').toLowerCase();
  return !name || parts.some((part) => part === '__MACOSX' || part.startsWith('.')) || IGNORED_NAMES.has(name);
}

/** "Folder/MP-D-1206@2.JPG" -> { base: "MP-D-1206", slot: 2, extension: "jpg" } */
export function parseImageName(path: string) {
  const fileName = path.split('/').pop() || path;
  const dot = fileName.lastIndexOf('.');
  const extension = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
  let base = dot > 0 ? fileName.slice(0, dot) : fileName;
  let slot = 1;
  const extra = base.match(/^(.*?)\s*@\s*(\d{1,3})$/);
  if (extra) {
    base = extra[1];
    slot = Number(extra[2]);
  }
  return { fileName, base: base.trim(), slot, extension };
}

/** Same rule as Product Master codes: trimmed, upper case, spaces become hyphens. */
export function exactKey(value: string) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '-');
}

/** File names cannot contain "/", so "_" and "/" are both read as "-". */
export function looseKey(value: string) {
  return exactKey(value).replace(/[_/]+/g, '-').replace(/-+/g, '-');
}

type Target = { kind: 'design' | 'variant'; id: string; code: string; name: string; hasImage: boolean; imageCount: number };

function addTo(map: Map<string, Target[]>, key: string, target: Target) {
  if (!key) return;
  const list = map.get(key) || [];
  if (!list.some((item) => item.kind === target.kind && item.id === target.id)) list.push(target);
  map.set(key, list);
}

export function buildMatchPlan(entries: ZipEntryInfo[], index: MatchIndex, mode: ExistingImageMode) {
  const designExact = new Map<string, Target[]>();
  const designLoose = new Map<string, Target[]>();
  const variantExact = new Map<string, Target[]>();
  const variantLoose = new Map<string, Target[]>();
  for (const design of index.designs) {
    const target: Target = { kind: 'design', id: design.id, code: design.designCode, name: design.name, hasImage: design.hasImage, imageCount: design.imageCount };
    addTo(designExact, exactKey(design.designCode), target);
    addTo(designLoose, looseKey(design.designCode), target);
  }
  for (const variant of index.variants) {
    const target: Target = { kind: 'variant', id: variant.id, code: variant.sku, name: variant.name, hasImage: variant.hasOwnImage, imageCount: variant.hasOwnImage ? 1 : 0 };
    for (const code of [variant.sku, variant.internalCode || '']) {
      addTo(variantExact, exactKey(code), target);
      addTo(variantLoose, looseKey(code), target);
    }
  }

  const rows: PlanRow[] = [];
  const claimed = new Map<string, PlanRow>();
  const perTarget = new Map<string, number>();
  for (const entry of entries) {
    if (isIgnoredEntry(entry.path)) continue;
    const { fileName, base, slot, extension } = parseImageName(entry.path);
    const row: PlanRow = { path: entry.path, fileName, size: entry.size, slot, status: 'unmatched', message: '' };
    rows.push(row);
    if (!ZIP_LIMITS.extensions.includes(extension as any)) {
      row.status = 'unsupported';
      row.message = 'Use JPG, PNG or WebP.';
      continue;
    }
    if (entry.size > ZIP_LIMITS.maxSourceBytes) {
      row.status = 'too-large';
      row.message = `${(entry.size / 1048576).toFixed(1)} MB; reduce below 25 MB.`;
      continue;
    }
    if (slot < 1 || slot > ZIP_LIMITS.maxImagesPerItem) {
      row.status = 'too-many';
      row.message = `@${slot} is outside @2–@${ZIP_LIMITS.maxImagesPerItem}.`;
      continue;
    }
    // Design codes win over variant codes; exact spelling wins over the loose "_ or /" reading.
    const candidates = designExact.get(exactKey(base)) || variantExact.get(exactKey(base))
      || designLoose.get(looseKey(base)) || variantLoose.get(looseKey(base)) || [];
    if (!candidates.length) {
      row.message = `"${base}" is not an active design code or variant SKU.`;
      continue;
    }
    if (candidates.length > 1) {
      row.status = 'ambiguous';
      row.message = `Could be ${candidates.map((item) => item.code).join(' or ')}. Rename the file to the exact code.`;
      continue;
    }
    const target = candidates[0];
    row.target = { kind: target.kind, id: target.id, code: target.code, name: target.name };
    const slotKey = `${target.kind}:${target.id}:${slot}`;
    const first = claimed.get(slotKey);
    if (first) {
      row.status = 'duplicate';
      row.message = `Same code and position as ${first.fileName}; only the first file is used.`;
      continue;
    }
    claimed.set(slotKey, row);
    if (target.hasImage && mode === 'skip') {
      row.status = 'skip-existing';
      row.message = `${target.code} already has an image. Choose "Replace" or "Add" to change it.`;
      continue;
    }
    const targetKey = `${target.kind}:${target.id}`;
    const count = (perTarget.get(targetKey) || 0) + 1;
    perTarget.set(targetKey, count);
    const existing = mode === 'append' ? target.imageCount : 0;
    if (existing + count > ZIP_LIMITS.maxImagesPerItem) {
      row.status = 'too-many';
      row.message = `${target.code} would have more than ${ZIP_LIMITS.maxImagesPerItem} images.`;
      continue;
    }
    row.status = target.kind === 'design' ? 'ready-design' : 'ready-variant';
    row.message = target.kind === 'design'
      ? `${slot === 1 ? 'Main' : `Extra #${slot}`} image for design ${target.code}${mode === 'replace' && target.hasImage ? ' (replaces current images)' : mode === 'append' && target.hasImage ? ' (added to current images)' : ''}.`
      : `Own image for variant ${target.code} only.`;
  }

  const groups = new Map<string, PlanGroup>();
  for (const row of rows) {
    if (!READY_STATUSES.includes(row.status) || !row.target) continue;
    const key = `${row.target.kind}:${row.target.id}`;
    const group = groups.get(key) || { key, kind: row.target.kind, id: row.target.id, code: row.target.code, name: row.target.name, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  const orderedGroups = Array.from(groups.values()).map((group) => ({ ...group, rows: [...group.rows].sort((a, b) => a.slot - b.slot) }));
  const counts = rows.reduce((acc, row) => ({ ...acc, [row.status]: (acc[row.status] || 0) + 1 }), {} as Record<PlanStatus, number>);
  return { rows, groups: orderedGroups, counts };
}

export function csvCell(value: unknown) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function downloadCsv(fileName: string, header: string[], rows: unknown[][]) {
  const body = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
  const blob = new Blob([`﻿${body}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
