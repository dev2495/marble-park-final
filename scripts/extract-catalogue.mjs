#!/usr/bin/env node
/**
 * Coordinate-aware catalogue extractor — CLI wrapper around
 * apps/api/src/modules/imports/extractors/pdf-catalogue-extractor.ts.
 *
 * Usage:
 *   node scripts/extract-catalogue.mjs <pdf-path> [--out=<dir>] [--limit=<N>] [--brand=<Name>] [--dry-run]
 *
 * Without --dry-run, it stages the result into Prisma:
 *   - Creates a SourceFile + ImportBatch
 *   - Inserts ImportRow per detected SKU (with imageUrl populated)
 *   - Inserts CatalogReviewTask per orphan image
 * With --dry-run it just prints the result to stdout (good for tuning).
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ulid } from 'ulid';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(
  args.filter((a) => a.startsWith('--')).map((a) => {
    const [key, value] = a.replace(/^--/, '').split('=');
    return [key, value === undefined ? true : value];
  }),
);

const pdfPath = positional[0];
if (!pdfPath) {
  console.error('Usage: extract-catalogue.mjs <pdf-path> [--out=<dir>] [--limit=<N>] [--brand=<Name>] [--dry-run]');
  process.exit(2);
}

const outDir = flags.out
  ? path.resolve(flags.out)
  : path.join(repoRoot, 'apps/web/public/catalogue-images/extracted');
const publicBaseUrl = '/catalogue-images/extracted';
const maxPages = flags.limit ? Number(flags.limit) : undefined;
const brandOverride = flags.brand || null;
const dryRun = !!flags['dry-run'];

// We need the compiled extractor. The repo doesn't ship a tsx loader for
// .mjs callers, so we rely on the dist build OR a tsx fallback.
async function loadExtractor() {
  const candidates = [
    path.join(repoRoot, 'apps/api/dist/src/modules/imports/extractors/pdf-catalogue-extractor.js'),
  ];
  for (const candidate of candidates) {
    try {
      const mod = await import(candidate);
      if (mod?.extractCataloguePdf) return mod.extractCataloguePdf;
    } catch {
      // try next
    }
  }
  // tsx fallback for dev: spawn a child process. We avoid that complexity by
  // requiring the user to build the API first when running outside dev.
  try {
    const { register } = await import('tsx/esm/api');
    register();
    const mod = await import(path.join(repoRoot, 'apps/api/src/modules/imports/extractors/pdf-catalogue-extractor.ts'));
    return mod.extractCataloguePdf;
  } catch (err) {
    throw new Error(
      'Extractor not found. Either run `npm run build:api` or install tsx in apps/api.\nUnderlying error: ' + (err?.message || err),
    );
  }
}

const extractCataloguePdf = await loadExtractor();
const result = await extractCataloguePdf({
  filePath: path.resolve(pdfPath),
  imageOutputDir: outDir,
  publicBaseUrl,
  maxPages,
  brandOverride,
  onPage: (page, total) => {
    if (page % 10 === 0 || page === total) {
      process.stderr.write(`...page ${page}/${total}\n`);
    }
  },
});

const summary = {
  file: result.filePath,
  brand: result.brand,
  totalPages: result.totalPages,
  scannedPages: result.scannedPages,
  rows: result.rows.length,
  orphanImages: result.orphanImages.length,
  rowsWithImages: result.rows.filter((r) => r.imagePath).length,
  rowsWithMrp: result.rows.filter((r) => r.mrp > 0).length,
  averageConfidence:
    result.rows.length === 0
      ? 0
      : Number((result.rows.reduce((s, r) => s + r.confidence, 0) / result.rows.length).toFixed(3)),
};

console.error(JSON.stringify(summary, null, 2));

if (dryRun) {
  // Print first 30 rows for inspection.
  console.log(JSON.stringify({
    summary,
    sampleRows: result.rows.slice(0, 30),
    sampleOrphans: result.orphanImages.slice(0, 10),
  }, null, 2));
  process.exit(0);
}

// Persist into Prisma.
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const { PrismaClient } = require(path.join(repoRoot, 'apps/api/node_modules/@prisma/client'));
const prisma = new PrismaClient();

try {
  const sourceFile = await prisma.sourceFile.upsert({
    where: { path: result.filePath },
    update: {
      status: 'parsed',
      updatedAt: new Date(),
      metadata: { kind: 'pdf-spatial', rowCount: result.rows.length, orphanImages: result.orphanImages.length },
    },
    create: {
      id: ulid(),
      kind: 'pdf-spatial',
      name: path.basename(result.filePath),
      path: result.filePath,
      uploadedBy: 'cli-extract',
      status: 'parsed',
      metadata: { rowCount: result.rows.length, orphanImages: result.orphanImages.length },
      updatedAt: new Date(),
    },
  });

  const batch = await prisma.importBatch.create({
    data: {
      id: ulid(),
      sourceFileId: sourceFile.id,
      brand: result.brand,
      rowCount: result.rows.length,
      status: 'pending_review',
      summary: {
        kind: 'pdf-spatial',
        scannedPages: result.scannedPages,
        averageConfidence: summary.averageConfidence,
        orphanImages: result.orphanImages.length,
      },
      updatedAt: new Date(),
    },
  });

  let needsReview = 0;
  let ready = 0;
  for (const row of result.rows) {
    const requireFields = !!(row.sku && row.name && row.category && row.brand && row.finish && row.mrp > 0);
    const status = requireFields ? 'pending' : 'needs_review';
    if (requireFields) ready += 1;
    else needsReview += 1;

    await prisma.importRow.create({
      data: {
        id: ulid(),
        sourceFileId: sourceFile.id,
        importBatchId: batch.id,
        brand: row.brand,
        range: row.series ?? null,
        categoryCode: row.category,
        sku: row.sku,
        description: row.name,
        newMrp: row.mrp,
        raw: { rawText: row.rawText, pageNumber: row.pageNumber, imageDistance: row.imageDistance, confidence: row.confidence },
        normalized: {
          sku: row.sku,
          name: row.name,
          brand: row.brand,
          category: row.category,
          finish: row.finish,
          range: row.series,
          sellPrice: row.mrp,
          mediaPrimary: row.imageUrl || null,
          mediaWidth: row.imageWidth,
          mediaHeight: row.imageHeight,
          confidence: row.confidence,
          page: row.pageNumber,
        },
        status,
        updatedAt: new Date(),
      },
    });
  }

  let orphanCreated = 0;
  for (const orphan of result.orphanImages) {
    await prisma.catalogReviewTask.create({
      data: {
        id: ulid(),
        sourceFileId: sourceFile.id,
        pageNumber: orphan.pageNumber,
        imagePath: orphan.imagePath,
        imageUrl: orphan.imageUrl,
        status: 'needs_mapping',
        confidence: 0.3,
        raw: { width: orphan.width, height: orphan.height, hash: orphan.hash },
        updatedAt: new Date(),
      },
    });
    orphanCreated += 1;
  }

  await prisma.importBatch.update({
    where: { id: batch.id },
    data: {
      summary: { ...summary, ready, needsReview, orphanCreated },
      updatedAt: new Date(),
    },
  });

  console.log(JSON.stringify({ importBatchId: batch.id, ready, needsReview, orphanCreated, ...summary }, null, 2));
} finally {
  await prisma.$disconnect();
}
