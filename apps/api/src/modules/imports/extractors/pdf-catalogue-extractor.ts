/**
 * Coordinate-aware catalogue extractor.
 *
 * The previous implementation extracted ALL images then re-attached them to
 * products via `hash(sku) % imagePool` — i.e. random, unverifiable mapping.
 * That broke the catalogue UX (wrong images on every product).
 *
 * This module:
 *   1. Walks each PDF page collecting:
 *        a. text items with their (x, y) baseline + font-size, and
 *        b. images with their bounding rectangle derived by accumulating
 *           the operator-list transform stack (paintImage(Inline|XObject)
 *           draws the image into the unit square; the current CTM tells
 *           you where on the page that square ended up).
 *   2. Detects SKUs via brand-aware regex.
 *   3. For each SKU, finds the *nearest* image by Euclidean distance —
 *      the image whose center is closest to the SKU baseline. This is
 *      how the human eye reads catalogue layouts (image at top of card,
 *      SKU underneath, OR image to one side and SKU to the other).
 *   4. Assembles each product's metadata (name, brand/series, MRP) from
 *      text items in the SKU's neighbourhood (within a vertical band).
 *   5. Returns rows + image PNG buffers ready to stage into ImportRow +
 *      product.media.
 *
 * Designed to be callable from BOTH the NestJS service and a CLI script.
 */

// pdfjs-dist & pngjs are CommonJS-flavoured, so we use require() at runtime
// and avoid pinning their types here (they ship limited ambient types).
/* eslint-disable @typescript-eslint/no-var-requires */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ExtractorOptions {
  filePath: string;
  /** Where to dump extracted PNGs. Created if missing. */
  imageOutputDir: string;
  /** Public URL prefix the saved PNGs will be served under. */
  publicBaseUrl: string;
  /** Cap on pages to walk (defaults to whole PDF). */
  maxPages?: number;
  /** Brand override; if not set we sniff from text. */
  brandOverride?: string | null;
  /** Per-page progress hook for long catalogues. */
  onPage?: (pageNumber: number, totalPages: number) => void;
}

export interface ExtractedRow {
  sku: string;
  name: string;
  brand: string;
  category: string;
  series?: string;
  finish?: string;
  mrp: number;
  pageNumber: number;
  /** Distance (px) from SKU text to nearest image center. Lower = better. */
  imageDistance: number;
  /** Confidence score 0..1 based on field completeness + image proximity. */
  confidence: number;
  imagePath?: string | null;
  imageUrl?: string | null;
  imageWidth?: number;
  imageHeight?: number;
  rawText: string[];
}

export interface ExtractorResult {
  filePath: string;
  totalPages: number;
  scannedPages: number;
  rows: ExtractedRow[];
  /** Anonymous "saw an image but couldn't pin it to a SKU" tasks for review UI. */
  orphanImages: Array<{ pageNumber: number; imagePath: string; imageUrl: string; width: number; height: number; hash: string }>;
  brand: string;
}

const SKU_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  // American Standard: CL3229B-6DACTCB, FFAS0401-151500BA0, BTAS6722-2020403C5
  { name: 'us-style', regex: /^(?:CL|FFAS|FFAST|BTAS|CCAS[A-Z]?|B)\d{3,5}[A-Z]?(?:-\d{1,8}[A-Z0-9]*)?$/ },
  // Generic alphanumeric: AQT-1234, RAK-2024-XYZ, B70280-6DACTPW
  { name: 'generic-coded', regex: /^[A-Z]{2,5}[\-]?\d{3,6}[A-Z0-9\-]{0,16}$/ },
  // Numeric-prefixed: 103836A001, 100023B
  { name: 'numeric-prefix', regex: /^\d{6}[A-Z]\d{3}$/ },
];

const MRP_RE = /^(?:[`₹]?\s*)?(\d{1,3}(?:,\d{2,3})+|\d{4,7})(?:\.\d{1,2})?$/;
const PURE_PRICE_RE = /(\d{1,3}(?:,\d{2,3})+|\d{5,7})/;
const NOISE_RE = /^(?:MRP|Price|Page|Note|Image|Description|Series|Range|Brand|`|₹|—|-{1,3})$/i;

function detectSkuStyle(input: string): string | null {
  const value = input.replace(/\s/g, '').toUpperCase();
  if (value.length < 4 || value.length > 30) return null;
  for (const { name, regex } of SKU_PATTERNS) {
    if (regex.test(value)) return name;
  }
  return null;
}

function detectBrand(filePath: string, headerText: string): string {
  const haystack = `${filePath} ${headerText}`.toLowerCase();
  if (haystack.includes('american standard')) return 'American Standard';
  if (haystack.includes('hansgrohe')) return 'Hansgrohe';
  if (/\bgrohe\b/.test(haystack)) return 'Grohe';
  if (haystack.includes('hindware')) return 'Hindware';
  if (haystack.includes('aquant')) return 'Aquant';
  if (haystack.includes('jaquar')) return 'Jaquar';
  if (haystack.includes('kohler')) return 'Kohler';
  if (haystack.includes('toto')) return 'TOTO';
  if (haystack.includes('roca')) return 'Roca';
  if (haystack.includes('cera')) return 'Cera';
  return 'Imported PDF';
}

function detectCategory(headerText: string, fallback = 'Catalogue Products'): string {
  const lower = headerText.toLowerCase();
  if (/\btiles?\b|\bsizes?\s*:|\bdesign\s*name/.test(lower)) return 'Tiles';
  if (/\b(toilets?|wc|water[- ]closet|cistern|bidet|urinal|seat\s*&?\s*cover)\b/.test(lower)) return 'Sanitaryware';
  if (/\b(bath\s*tubs?|bathtubs?|drop[- ]?in\s*tubs?)\b/.test(lower)) return 'Bathtubs';
  if (/\b(basins?|wash[- ]basins?|counter[- ]?tops?|pedestals?|lavator(?:y|ies))\b/.test(lower)) return 'Basins';
  if (/\b(thermostat|showers?|faucets?|mixers?|taps?|spouts?|diverters?|hand[- ]?showers?|rain[- ]?showers?|stop[- ]?valves?|wall[- ]?outlets?|shower\s+arm)\b/.test(lower)) return 'Faucets & Showers';
  if (/\b(sinks?|kitchen|chimney)\b/.test(lower)) return 'Kitchen Sinks';
  if (/\b(robe[- ]?hooks?|towel[- ]?(rods?|rails?|holders?|rings?)|tissue[- ]?holders?|soap[- ]?dish|grab[- ]?bars?|accessor(?:y|ies)|holders?|glass[- ]?shelves?)\b/.test(lower)) return 'Accessories';
  return fallback;
}

function detectFinish(text: string): string {
  const lower = text.toLowerCase();
  if (/\b(matte black|matt black|black matt|matt-black)\b/.test(lower)) return 'Matte Black';
  if (/\b(brushed|brush)\s*(graphite|nickel|gold|steel)\b/.test(lower)) return 'Brushed';
  if (/\b(polished|cool sunrise|warm sunset)\b/.test(lower)) return 'Polished';
  if (/\b(gold|rose gold|brass)\b/.test(lower)) return 'Gold';
  if (/\b(chrome|cp|stainless|steel)\b/.test(lower)) return 'Chrome';
  if (/\b(white|wt|wh)\b/.test(lower)) return 'White';
  if (/\bdécor|\bdecor\b/.test(lower)) return 'Decor';
  if (/\bglossy|glossy\b|gloss\b/.test(lower)) return 'Glossy';
  return 'Standard';
}

function safeParsePrice(input: string): number {
  const m = String(input || '').match(PURE_PRICE_RE);
  if (!m) return 0;
  return Number(m[1].replace(/,/g, '')) || 0;
}

interface PageItem {
  str: string;
  x: number;
  y: number;
  fontSize: number;
}

interface PageImage {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

function multiplyMatrix(a: number[], b: number[]): number[] {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

async function readImageObject(page: any, id: string, timeoutMs = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`image-fetch-timeout:${id}`)), timeoutMs);
    page.objs.get(id, (img: any) => {
      clearTimeout(t);
      resolve(img);
    });
  });
}

function imageToPng(image: any, pdfjs: any): Buffer | null {
  const { PNG } = require('pngjs');
  if (!image?.data || !image.width || !image.height) return null;
  if (image.width < 80 || image.height < 60) return null;
  if (image.width > 3500 || image.height > 3500) return null;
  const png = new PNG({ width: image.width, height: image.height });
  const src = image.data;
  if (image.kind === pdfjs.ImageKind.RGBA_32BPP) {
    Buffer.from(src).copy(png.data);
  } else if (image.kind === pdfjs.ImageKind.RGB_24BPP) {
    for (let i = 0, j = 0; i < src.length; i += 3, j += 4) {
      png.data[j] = src[i];
      png.data[j + 1] = src[i + 1];
      png.data[j + 2] = src[i + 2];
      png.data[j + 3] = 255;
    }
  } else {
    // Grayscale fallback (1 byte per pixel).
    if (src.length !== image.width * image.height) return null;
    for (let i = 0, j = 0; i < src.length; i += 1, j += 4) {
      const v = src[i];
      png.data[j] = v;
      png.data[j + 1] = v;
      png.data[j + 2] = v;
      png.data[j + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

async function collectPageImagesAndPositions(page: any, pdfjs: any): Promise<PageImage[]> {
  const ops = await page.getOperatorList();
  const images: PageImage[] = [];
  const stack: number[][] = [];
  let ctm: number[] = [1, 0, 0, 1, 0, 0];
  for (let i = 0; i < ops.fnArray.length; i += 1) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === pdfjs.OPS.save) stack.push(ctm.slice());
    else if (fn === pdfjs.OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === pdfjs.OPS.transform) ctm = multiplyMatrix(ctm, args);
    else if (
      fn === pdfjs.OPS.paintImageXObject ||
      fn === pdfjs.OPS.paintInlineImageXObject ||
      fn === pdfjs.OPS.paintJpegXObject
    ) {
      const [a, b, c, d, e, f] = ctm;
      const w = Math.hypot(a, b);
      const h = Math.hypot(c, d);
      // Discard tiny 1x1 fill / spot images (decorative).
      if (w < 30 || h < 30) continue;
      const id = typeof args?.[0] === 'string' ? args[0] : `inline_p_${i}`;
      images.push({
        id,
        x: e,
        y: f,
        w,
        h,
        cx: e + (a + c) / 2,
        cy: f + (b + d) / 2,
      });
    }
  }
  return images;
}

function collectPageTextItems(textContent: any): PageItem[] {
  const out: PageItem[] = [];
  for (const item of textContent.items) {
    const str = (item as any).str;
    if (!str || !String(str).trim()) continue;
    const tx = (item as any).transform;
    if (!Array.isArray(tx) || tx.length < 6) continue;
    out.push({ str: String(str).trim(), x: tx[4], y: tx[5], fontSize: Math.hypot(tx[0], tx[1]) });
  }
  return out;
}

/**
 * Group text items that sit on roughly the same horizontal line into a single
 * line of text. Useful because pdfjs returns text fragmented into individual
 * runs ("Acacia E", " Vortex ", "BTW 3/4.5") and we need the assembled string.
 */
function groupTextLines(items: PageItem[], tolerance = 4): Array<{ y: number; items: PageItem[]; text: string }> {
  const lines: Array<{ y: number; items: PageItem[] }> = [];
  for (const item of items) {
    const found = lines.find((line) => Math.abs(line.y - item.y) <= tolerance);
    if (found) found.items.push(item);
    else lines.push({ y: item.y, items: [item] });
  }
  for (const line of lines) line.items.sort((a, b) => a.x - b.x);
  return lines
    .sort((a, b) => b.y - a.y) // top-down
    .map((line) => ({ ...line, text: line.items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim() }));
}

interface NeighborhoodMeta {
  name: string;
  series: string;
  mrp: number;
  rawText: string[];
}

function deriveProductMeta(
  skuItem: PageItem,
  lines: Array<{ y: number; text: string; items: PageItem[] }>,
  pageHeaders: string[],
): NeighborhoodMeta & { sectionHeader: string } {
  // Look at lines within ±90px vertical of the SKU's baseline. That's the
  // typical "card" radius in price catalogues at 72 dpi (a 4-up grid on A4).
  const radius = 90;
  const window = lines.filter((line) => Math.abs(line.y - skuItem.y) <= radius);
  const skuText = skuItem.str.toUpperCase();

  // Order by vertical proximity (closest first), excluding the SKU line itself.
  const ordered = window
    .filter((line) => !line.text.toUpperCase().includes(skuText))
    .map((line) => ({ ...line, dy: Math.abs(line.y - skuItem.y) }))
    .sort((a, b) => a.dy - b.dy);

  const rawText: string[] = [];
  let mrp = 0;
  let name = '';
  let series = '';
  let sectionHeader = '';

  // Scan for the most recent ALL-CAPS section header above the SKU within
  // the page (e.g. "BACK TO WALL TOILETS", "ONE PIECE TOILETS"). These
  // typically sit ABOVE the SKU, so y > skuItem.y.
  const allCapsHeaders = lines.filter(
    (line) =>
      line.text.length >= 5 &&
      line.text.length <= 60 &&
      /^[A-Z][A-Z\s&\-\/]+$/.test(line.text) &&
      !/^MRP\b/.test(line.text),
  );
  const aboveSku = allCapsHeaders.filter((line) => line.y > skuItem.y).sort((a, b) => a.y - b.y);
  if (aboveSku.length) sectionHeader = aboveSku[0].text;
  if (!sectionHeader && pageHeaders.length) sectionHeader = pageHeaders[0];

  for (const line of ordered) {
    const text = line.text;
    rawText.push(text);
    if (NOISE_RE.test(text)) continue;
    // Skip parenthetical helper lines like "(S Trap M11453 set to be ordered separately)"
    // — they are NOT prices despite containing 5-digit numbers.
    if (/^[\(\[]/.test(text)) continue;

    // MRP-as-line: prefer the *exact* "MRP ` <num>" pattern. This filters
    // out helper text like "(S Trap M11453 set ...)" that happens to
    // contain a 5-digit number.
    if (!mrp && /\bMRP\b/i.test(text)) {
      const m = text.match(/MRP[`\s₹]*(\d{1,3}(?:,\d{2,3})+|\d{4,7})/i);
      if (m) {
        mrp = safeParsePrice(m[1]);
        continue;
      }
      // Fall back to the next line.
      const idx = ordered.indexOf(line);
      if (idx >= 0 && idx + 1 < ordered.length) {
        const next = ordered[idx + 1].text;
        if (MRP_RE.test(next)) mrp = safeParsePrice(next);
      }
      continue;
    }
    if (!mrp && /^[`₹]\s*\d/.test(text.trim())) {
      mrp = safeParsePrice(text);
      continue;
    }

    if (!name && text.length >= 4 && /[a-zA-Z]/.test(text) && !/^[A-Z\s\-]+$/.test(text) && !/^MRP/.test(text)) {
      // First descriptive line: usually the product name.
      name = text;
      continue;
    }
    if (!series && /^[A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+){0,2}$/.test(text) && text !== name) {
      series = text;
    }
  }
  return { name, series, mrp, rawText, sectionHeader };
}

function findNearestImage(skuItem: PageItem, images: PageImage[]): { image: PageImage | null; distance: number } {
  let best: PageImage | null = null;
  let bestD = Infinity;
  for (const img of images) {
    const dx = skuItem.x - img.cx;
    const dy = skuItem.y - img.cy;
    const d = Math.hypot(dx, dy);
    if (d < bestD) {
      bestD = d;
      best = img;
    }
  }
  return { image: best, distance: bestD };
}

function calcConfidence(row: Pick<ExtractedRow, 'name' | 'mrp' | 'imageDistance' | 'imagePath' | 'brand'>): number {
  let score = 0;
  if (row.name && row.name.length >= 5) score += 0.3;
  if (row.mrp && row.mrp > 0) score += 0.3;
  if (row.imagePath) score += 0.25;
  if (row.brand && row.brand !== 'Imported PDF') score += 0.05;
  // Image distance penalty (0 if very close, drops to 0 at 220px).
  const proximity = Math.max(0, 1 - row.imageDistance / 220);
  score += proximity * 0.1;
  return Math.min(1, Math.max(0, score));
}

/**
 * Dynamic ESM import that survives TypeScript's CommonJS down-compile.
 *
 * `await import('pdfjs-dist/legacy/build/pdf.mjs')` is rewritten by tsc to
 * `__importStar(require(...))`, which then fails because pdfjs is an ESM
 * module with top-level `await`. Wrapping the import in a `new Function`
 * keeps it as a *real* dynamic import at runtime.
 */
const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<any>;

export async function extractCataloguePdf(opts: ExtractorOptions): Promise<ExtractorResult> {
  const pdfjs: any = await dynamicImport('pdfjs-dist/legacy/build/pdf.mjs');
  const fileBytes = new Uint8Array(fs.readFileSync(opts.filePath));
  const pdf = await pdfjs.getDocument({ data: fileBytes, verbosity: 0, disableWorker: true }).promise;

  fs.mkdirSync(opts.imageOutputDir, { recursive: true });
  const baseUrl = opts.publicBaseUrl.replace(/\/+$/, '');

  const totalPages = pdf.numPages;
  const scanLimit = Math.min(opts.maxPages || totalPages, totalPages);

  // First pass: gather a sample of header text from the first few pages so we
  // can sniff the brand once for the whole catalogue.
  let headerSample = '';
  for (let i = 1; i <= Math.min(5, scanLimit); i += 1) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    headerSample += ' ' + tc.items.map((it: any) => it.str || '').join(' ');
  }
  const brand = opts.brandOverride || detectBrand(opts.filePath, headerSample);

  const rows: ExtractedRow[] = [];
  const orphanImages: ExtractorResult['orphanImages'] = [];
  const seenImageHashes = new Set<string>();
  const claimedImages = new Set<string>(); // pageNumber:imageId so we don't re-emit orphans
  // pageNumber:imageId -> resolved file/url, so subsequent SKUs nearest the
  // same image on the same page can share it (e.g. seat covers under the
  // main toilet bowl image).
  const imageIdToUrl = new Map<string, { path: string; url: string; width: number; height: number }>();

  for (let pageNumber = 1; pageNumber <= scanLimit; pageNumber += 1) {
    if (opts.onPage) opts.onPage(pageNumber, scanLimit);
    let page;
    try {
      page = await pdf.getPage(pageNumber);
    } catch {
      continue;
    }

    let pageImages: PageImage[] = [];
    let textItems: PageItem[] = [];
    try {
      pageImages = await collectPageImagesAndPositions(page, pdfjs);
      const tc = await page.getTextContent();
      textItems = collectPageTextItems(tc);
    } catch {
      continue;
    }
    if (textItems.length === 0 && pageImages.length === 0) continue;

    const lines = groupTextLines(textItems);
    const headerText = lines.slice(0, 3).map((line) => line.text).join(' ');
    const pageCategory = detectCategory(headerText);
    // ALL-CAPS section headers used as fallback category context for SKUs
    // when the precise section header above each SKU isn't found.
    const allCapsLines = lines
      .filter((line) => line.text.length >= 5 && /^[A-Z][A-Z\s&\-\/]+$/.test(line.text))
      .map((line) => line.text);

    // SKU candidates: from the *original* per-item array (not joined lines)
    // so we keep the SKU-specific position. Catalogues print SKUs on their own
    // visual row, so single-item lines are typically what we want.
    const skuCandidates = textItems
      .filter((item) => !!detectSkuStyle(item.str))
      .filter((item) => item.str.length >= 5);

    const pageRows: ExtractedRow[] = [];
    const seenSkuOnPage = new Set<string>();

    for (const skuItem of skuCandidates) {
      const sku = skuItem.str.replace(/\s/g, '').toUpperCase();
      if (seenSkuOnPage.has(sku)) continue;
      seenSkuOnPage.add(sku);

      const meta = deriveProductMeta(skuItem, lines, allCapsLines);
      const sectionCategory = meta.sectionHeader ? detectCategory(meta.sectionHeader, pageCategory) : pageCategory;
      const { image, distance } = findNearestImage(skuItem, pageImages);

      // Only persist the image if it's "close enough". Beyond ~280px we're
      // probably picking up an unrelated image (catalogue cover/feature shot).
      const acceptImage = !!image && distance < 280;
      let imagePath: string | null = null;
      let imageUrl: string | null = null;
      let imageWidth: number | undefined;
      let imageHeight: number | undefined;

      if (acceptImage && image) {
        const claimKey = `${pageNumber}:${image.id}`;
        const previouslyClaimed = imageIdToUrl.get(claimKey);
        if (previouslyClaimed) {
          // Image already saved by an earlier (closer) SKU on this page —
          // share it. Catalogues commonly pair a "main item" + accessory
          // (e.g. toilet bowl + matching seat cover) under the same image.
          imagePath = previouslyClaimed.path;
          imageUrl = previouslyClaimed.url;
          imageWidth = previouslyClaimed.width;
          imageHeight = previouslyClaimed.height;
        } else {
          try {
            const obj = await readImageObject(page, image.id);
            const buf = imageToPng(obj, pdfjs);
            if (buf) {
              const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 14);
              const safeSku = sku.replace(/[^A-Z0-9-]/g, '_');
              const fileName = `${safeSku}-p${String(pageNumber).padStart(3, '0')}-${hash}.png`;
              const fullPath = path.join(opts.imageOutputDir, fileName);
              if (!seenImageHashes.has(hash)) {
                seenImageHashes.add(hash);
                fs.writeFileSync(fullPath, buf);
              }
              imagePath = fullPath;
              imageUrl = `${baseUrl}/${fileName}`;
              imageWidth = (obj as any).width;
              imageHeight = (obj as any).height;
              imageIdToUrl.set(claimKey, { path: fullPath, url: imageUrl, width: imageWidth || 0, height: imageHeight || 0 });
              claimedImages.add(claimKey);
            }
          } catch {
            // Image extraction failed (e.g. unsupported colourspace).
          }
        }
      }

      const row: ExtractedRow = {
        sku,
        name: meta.name || sku,
        brand,
        category: sectionCategory,
        series: meta.series || undefined,
        finish: detectFinish(`${meta.name} ${meta.series} ${meta.sectionHeader}`),
        mrp: meta.mrp,
        pageNumber,
        imageDistance: distance,
        confidence: 0,
        imagePath,
        imageUrl,
        imageWidth,
        imageHeight,
        rawText: [meta.sectionHeader, ...meta.rawText].filter(Boolean).slice(0, 6),
      };
      row.confidence = calcConfidence(row);
      pageRows.push(row);
    }

    rows.push(...pageRows);

    // Orphan images: paint operators we saw but never bound to a SKU. Save
    // these for the manual-review queue (CatalogReviewTask).
    const claimedThisPage = new Set(
      pageRows.filter((r) => r.imagePath).map((r) => path.basename(r.imagePath as string)),
    );
    for (const img of pageImages) {
      const claimKey = `${pageNumber}:${img.id}`;
      if (claimedImages.has(claimKey)) continue;
      try {
        const obj = await readImageObject(page, img.id);
        const buf = imageToPng(obj, pdfjs);
        if (!buf) continue;
        const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 14);
        if (seenImageHashes.has(hash)) continue;
        seenImageHashes.add(hash);
        const fileName = `orphan-p${String(pageNumber).padStart(3, '0')}-${hash}.png`;
        if (claimedThisPage.has(fileName)) continue;
        const fullPath = path.join(opts.imageOutputDir, fileName);
        fs.writeFileSync(fullPath, buf);
        orphanImages.push({
          pageNumber,
          imagePath: fullPath,
          imageUrl: `${baseUrl}/${fileName}`,
          width: (obj as any).width,
          height: (obj as any).height,
          hash,
        });
      } catch {
        // ignore unreadable images
      }
    }
  }

  await pdf.destroy();

  return {
    filePath: opts.filePath,
    totalPages,
    scannedPages: scanLimit,
    rows,
    orphanImages,
    brand,
  };
}
