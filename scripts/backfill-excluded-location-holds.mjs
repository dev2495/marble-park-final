#!/usr/bin/env node
// Stock sitting at a location flagged "exclude from available stock" (other than the
// in-transit location) before that rule was enforced has no hold. It cannot be reserved,
// but product and lot "available" still count it. This puts the hold on, the same way a
// posting at such a location does today (lot posting through the shared code).
//
// Dry run (default): prints what it would hold, changes nothing.
//   node scripts/backfill-excluded-location-holds.mjs
// Apply (build the API first so the shared posting code is up to date):
//   npm run build -w apps/api && node scripts/backfill-excluded-location-holds.mjs --apply
//
// Safe to run again: lots that already carry their hold are skipped.
import { createRequire } from 'node:module';
import path from 'node:path';
import url from 'node:url';
import fs from 'node:fs';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const apiRequire = createRequire(path.join(root, 'apps/api/package.json'));
const { PrismaClient } = apiRequire('@prisma/client');
const apply = process.argv.includes('--apply');
const prisma = new PrismaClient();

function isExcluded(location) {
  if (String(location.type || '').toLowerCase() === 'transit') return false;
  if (String(location.code || '').toUpperCase() === 'IN-TRANSIT') return false;
  const metadata = location.metadata && typeof location.metadata === 'object' ? location.metadata : {};
  return metadata.excludeFromAvailableStock === true;
}

function loadSync() {
  const candidates = [
    path.join(root, 'apps/api/dist/src/modules/common/lot-stock-posting.js'),
    path.join(root, 'apps/api/dist/modules/common/lot-stock-posting.js'),
  ];
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) throw new Error('Build the API first (npm run build -w apps/api): the shared lot posting code was not found in apps/api/dist.');
  const mod = apiRequire(file);
  if (typeof mod.syncExcludedLocationHoldsTx !== 'function') throw new Error(`syncExcludedLocationHoldsTx not found in ${file}: rebuild the API.`);
  return mod.syncExcludedLocationHoldsTx;
}

async function main() {
  const locations = (await prisma.stockLocation.findMany()).filter(isExcluded);
  if (!locations.length) {
    console.log('No location is flagged "exclude from available stock". Nothing to do.');
    return;
  }
  const sync = apply ? loadSync() : null;
  let total = 0;
  for (const location of locations) {
    const balances = await prisma.inventoryLotBalance.findMany({ where: { locationId: location.id }, include: { lot: true } });
    const missing = balances
      .map((b) => ({ b, qty: Math.max(0, Number(b.onHand) - Number(b.reserved) - Number(b.damaged) - Number(b.hold)) }))
      .filter((row) => row.qty > 0);
    if (!missing.length) {
      console.log(`${location.name} (${location.code}): every lot already held.`);
      continue;
    }
    if (location.status !== 'active') {
      console.log(`  SKIP ${location.name} (${location.code}): location is inactive, ${missing.length} lot(s) without hold; reactivate it first.`);
      continue;
    }
    for (const row of missing) {
      console.log(`  ${apply ? 'HOLD' : 'WOULD HOLD'} ${location.code} lot ${row.b.lot?.lotNumber || row.b.lotId}: ${row.qty}`);
    }
    total += missing.length;
    if (apply) {
      await prisma.$transaction((tx) => sync(tx, location.id, 'system', 'excluded-location-hold-backfill'), { isolationLevel: 'Serializable', timeout: 60000 });
    }
  }
  console.log(apply ? `Done: ${total} lot balance(s) held.` : `Dry run only (${total} lot balance(s)). Run again with --apply to hold them.`);
}

main()
  .catch((error) => { console.error(error?.message || error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
