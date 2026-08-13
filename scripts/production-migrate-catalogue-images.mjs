import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const { ulid } = require('ulid');

const prisma = new PrismaClient();
const apply = process.env.APPLY_CATALOGUE_IMAGE_MIGRATION === 'yes';
const actorUserId = String(process.env.CATALOGUE_IMAGE_MIGRATION_ACTOR || 'system');
const origin = String(process.env.PUBLIC_CATALOGUE_IMAGE_BASE_URL || process.env.APP_ORIGIN || '').replace(/\/+$/, '');
const storageRoot = process.env.CATALOGUE_IMAGE_STORAGE_DIR || path.resolve(process.cwd(), 'apps/web/public/catalogue-images');
const manualDir = path.join(storageRoot, 'manual');
const concurrency = Math.min(Math.max(Number(process.env.CATALOGUE_IMAGE_MIGRATION_CONCURRENCY || 2), 1), 8);
const MAX_BYTES = 5 * 1024 * 1024;
const SOURCE_REPLACEMENTS = new Map([
  [
    'https://www.jaquar.com/images/thumbs/0009491_hand-shower-round-shape-multi-flow_960.jpeg',
    'https://www.jaquar.com/images/thumbs/0070773_hand-shower-round-shape-multi-flow_960.jpeg',
  ],
]);

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function mediaUrls(media) {
  const value = media && typeof media === 'object' ? media : {};
  const gallery = Array.isArray(value.gallery) ? value.gallery : [];
  return [...new Set([value.primaryUrl, value.primaryImage, value.primary, ...gallery.map((entry) => typeof entry === 'string' ? entry : entry?.url)].filter(Boolean).map(String))];
}

function isPrivateAddress(address) {
  const normalized = String(address).toLowerCase().split('%')[0];
  if (normalized.startsWith('::ffff:')) return isPrivateAddress(normalized.slice(7));
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19));
  }
  return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized);
}

async function assertPublic(url) {
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true }).catch(() => []);
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) throw new Error('image host is not public');
}

function extensionFor(content) {
  if (content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return '.jpg';
  if (content.length >= 12 && content.subarray(0, 4).toString('ascii') === 'RIFF' && content.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp';
  return '';
}

async function body(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('empty image response');
  const chunks = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    bytes += chunk.length;
    if (bytes > MAX_BYTES) { await reader.cancel(); throw new Error('image exceeds 5 MB'); }
    chunks.push(chunk);
  }
  if (!bytes) throw new Error('empty image response');
  return Buffer.concat(chunks);
}

function existingManaged(raw) {
  try {
    const parsed = raw.startsWith('/') ? new URL(raw, origin || 'https://invalid.local') : new URL(raw);
    if (!/^\/catalogue-images\/manual\/[A-Za-z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(parsed.pathname)) return '';
    if (!raw.startsWith('/') && origin && parsed.origin !== new URL(origin).origin) return '';
    return parsed.pathname;
  } catch { return ''; }
}

async function persist(raw) {
  const managed = existingManaged(raw);
  if (managed) {
    const filename = new URL(managed, origin).pathname.split('/').pop();
    await fs.access(path.join(manualDir, filename));
    return managed;
  }
  let url = new URL(SOURCE_REPLACEMENTS.get(raw) || raw);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('image URL must be public HTTPS');
  let response;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    await assertPublic(url);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        response = await fetch(url, { redirect: 'manual', signal: controller.signal, headers: {
          Accept: 'image/webp,image/png,image/jpeg;q=0.9,*/*;q=0.1',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
          Referer: `${url.protocol}//${url.host}/`,
        }});
      } finally { clearTimeout(timer); }
      if (![429, 502, 503, 504].includes(response.status) || attempt === 4) break;
      const retryAfter = Number(response.headers.get('retry-after'));
      await pause(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : 1_000 * (2 ** attempt));
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    if (!location || redirects === 3) throw new Error('invalid image redirect');
    url = new URL(location, url);
  }
  if (!response?.ok) throw new Error(`image server returned HTTP ${response?.status || 'error'}`);
  const content = await body(response);
  const extension = extensionFor(content);
  if (!extension) throw new Error('response is not JPG, PNG or WebP');
  const digest = createHash('sha256').update(content).digest('hex');
  const filename = `remote-${digest.slice(0, 32)}${extension}`;
  await fs.mkdir(manualDir, { recursive: true });
  const target = path.join(manualDir, filename);
  try { await fs.access(target); } catch {
    const temporary = `${target}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, content, { mode: 0o640 });
    await fs.rename(temporary, target).catch(async (error) => { await fs.rm(temporary, { force: true }); if (error?.code !== 'EEXIST') throw error; });
  }
  return `/catalogue-images/manual/${filename}`;
}

function rewriteMedia(media, mapped) {
  const value = media && typeof media === 'object' ? media : {};
  const originalGallery = Array.isArray(value.gallery) ? value.gallery : [];
  const gallery = originalGallery.map((entry) => {
    const url = typeof entry === 'string' ? entry : entry?.url;
    const next = mapped.get(String(url));
    return typeof entry === 'string' ? { url: next } : { ...entry, url: next };
  });
  const primaryOriginal = value.primaryUrl || value.primaryImage || value.primary || (typeof originalGallery[0] === 'string' ? originalGallery[0] : originalGallery[0]?.url);
  return { ...value, gallery, primaryUrl: primaryOriginal ? mapped.get(String(primaryOriginal)) : gallery[0]?.url || null };
}

async function main() {
  if (!origin || !origin.startsWith('https://')) throw new Error('PUBLIC_CATALOGUE_IMAGE_BASE_URL or APP_ORIGIN must be HTTPS');
  const products = await prisma.product.findMany({ where: { NOT: { media: { equals: {} } } }, select: { id: true, sku: true, media: true } });
  const candidates = products.filter((product) => mediaUrls(product.media).length);
  if (!apply) {
    const external = candidates.filter((product) => mediaUrls(product.media).some((url) => !existingManaged(url)));
    console.log(JSON.stringify({ mode: 'dry-run', productsWithMedia: candidates.length, productsNeedingMigration: external.length, applyWith: 'APPLY_CATALOGUE_IMAGE_MIGRATION=yes' }, null, 2));
    return;
  }

  let cursor = 0;
  let migrated = 0;
  let unchanged = 0;
  const failures = [];
  const workers = Array.from({ length: Math.min(concurrency, candidates.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= candidates.length) return;
      const product = candidates[index];
      try {
        const mapped = new Map();
        for (const url of mediaUrls(product.media)) mapped.set(url, await persist(url));
        const nextMedia = rewriteMedia(product.media, mapped);
        if (JSON.stringify(nextMedia) === JSON.stringify(product.media)) { unchanged += 1; continue; }
        await prisma.$transaction([
          prisma.product.update({ where: { id: product.id }, data: { media: nextMedia, updatedAt: new Date() } }),
          prisma.auditEvent.create({ data: { id: ulid(), actorUserId, action: 'product.media.migrated', entityType: 'Product', entityId: product.id, summary: `Stored catalogue media for ${product.sku} in managed storage`, metadata: { sku: product.sku, imageCount: mapped.size, source: 'production-catalogue-image-hardening' } } }),
        ]);
        migrated += 1;
      } catch (error) {
        failures.push({ sku: product.sku, reason: String(error?.message || error).slice(0, 180) });
      }
    }
  });
  await Promise.all(workers);
  await prisma.auditEvent.create({ data: { id: ulid(), actorUserId, action: 'product.media.migration.completed', entityType: 'Product', entityId: 'catalogue-media', summary: `Catalogue media migration: ${migrated} migrated, ${unchanged} unchanged, ${failures.length} failed`, metadata: { migrated, unchanged, failed: failures.length, failures: failures.slice(0, 100) } } });
  console.log(JSON.stringify({ mode: 'applied', productsWithMedia: candidates.length, migrated, unchanged, failed: failures.length, failures: failures.slice(0, 100) }, null, 2));
  if (failures.length) process.exitCode = 2;
}

main().catch((error) => { console.error(error?.message || error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
