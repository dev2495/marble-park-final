#!/usr/bin/env node
// Stock already on the road (transfer "in transit") before the in-transit hold was
// added has no hold on the IN-TRANSIT location. Product-level "available" then counts
// it while lot reservation refuses it. This puts the missing hold on, the same way a
// transfer dispatched today does (lot posting with a hold on IN-TRANSIT).
//
// Dry run (default): prints what it would create, changes nothing.
//   node scripts/backfill-in-transit-holds.mjs
// Apply (build the API first so the shared posting code is up to date):
//   npm run build -w apps/api && node scripts/backfill-in-transit-holds.mjs --apply
//
// Safe to run again: each line gets one posting with a fixed key, and lines that
// already carry their hold are skipped.
import { createRequire } from 'node:module';
import path from 'node:path';
import url from 'node:url';
import fs from 'node:fs';

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const apiRequire = createRequire(path.join(root, 'apps/api/package.json'));
const { PrismaClient } = apiRequire('@prisma/client');
const apply = process.argv.includes('--apply');
const prisma = new PrismaClient();

function loadPosting() {
  const candidates = [
    path.join(root, 'apps/api/dist/src/modules/common/lot-stock-posting.js'),
    path.join(root, 'apps/api/dist/modules/common/lot-stock-posting.js'),
  ];
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) throw new Error('Build the API first (npm run build -w apps/api): the shared lot posting code was not found in apps/api/dist.');
  const mod = apiRequire(file);
  if (typeof mod.applyLotStockPostingTx !== 'function') throw new Error(`applyLotStockPostingTx not found in ${file}`);
  return mod.applyLotStockPostingTx;
}

async function main() {
  const transit = await prisma.stockLocation.findUnique({ where: { code: 'IN-TRANSIT' } });
  if (!transit) {
    console.log('No IN-TRANSIT location: nothing is on the road. Nothing to do.');
    return;
  }
  const transfers = await prisma.stockTransfer.findMany({
    where: { status: 'in_transit' },
    include: { lines: { include: { lot: true } } },
    orderBy: { dispatchedAt: 'asc' },
  });
  const plan = [];
  for (const transfer of transfers) {
    for (const line of transfer.lines) {
      const quantity = Number(line.dispatchedQuantity || 0);
      if (quantity <= 0) continue;
      const backfillKey = `transfer:${transfer.id}:${line.id}:transit-hold-backfill`;
      const [transitIn, backfilled] = await Promise.all([
        prisma.inventoryLotLedgerEntry.findUnique({ where: { idempotencyKey: `transfer:${transfer.id}:${line.id}:transit-in` } }),
        prisma.inventoryLotLedgerEntry.findUnique({ where: { idempotencyKey: backfillKey } }),
      ]);
      if (backfilled) continue;
      const alreadyHeld = Math.max(0, Number(transitIn?.holdDelta || 0));
      const missing = quantity - alreadyHeld;
      if (missing <= 0) continue;
      plan.push({ transfer, line, missing, backfillKey });
    }
  }

  if (!plan.length) {
    console.log(`Checked ${transfers.length} transfer(s) in transit: every line already has its hold. Nothing to do.`);
    return;
  }

  // Check what each lot can hold on IN-TRANSIT (hold cannot exceed on hand minus reserved and damaged).
  const room = new Map();
  for (const row of plan) {
    if (room.has(row.line.lotId)) continue;
    const balance = await prisma.inventoryLotBalance.findUnique({ where: { lotId_locationId: { lotId: row.line.lotId, locationId: transit.id } } });
    room.set(row.line.lotId, Math.max(0, Number(balance?.onHand || 0) - Number(balance?.reserved || 0) - Number(balance?.damaged || 0) - Number(balance?.hold || 0)));
  }

  console.log(`${apply ? 'Applying' : 'Dry run'}: ${plan.length} transfer line(s) on the road without a hold.`);
  const posting = apply ? loadPosting() : null;
  let created = 0;
  let skipped = 0;
  for (const row of plan) {
    const free = room.get(row.line.lotId) || 0;
    const quantity = Math.min(row.missing, free);
    const label = `${row.transfer.transferNumber} lot ${row.line.lot?.lotNumber || row.line.lotId}: hold ${quantity} of ${row.missing}`;
    if (quantity <= 0) {
      console.log(`  SKIP ${label} (IN-TRANSIT has no free quantity for this lot; check the lot balance by hand)`);
      skipped += 1;
      continue;
    }
    room.set(row.line.lotId, free - quantity);
    if (!apply) {
      console.log(`  WOULD CREATE ${label}${quantity < row.missing ? ' (only this much is free)' : ''}`);
      continue;
    }
    await prisma.$transaction((tx) => posting(tx, {
      productId: row.line.productId,
      lotId: row.line.lotId,
      locationId: transit.id,
      idempotencyKey: row.backfillKey,
      type: 'transfer_transit_hold',
      direction: 'hold',
      quantity,
      holdDelta: quantity,
      reason: `Transfer ${row.transfer.transferNumber} in transit (hold added for stock sent before holds existed)`,
      createdBy: 'system',
      referenceType: 'StockTransfer',
      referenceId: row.transfer.id,
      sourceDocumentNo: row.transfer.transferNumber,
      metadata: { backfill: 'in-transit-hold', transferLineId: row.line.id },
    }), { isolationLevel: 'Serializable', timeout: 30000 });
    console.log(`  CREATED ${label}`);
    created += 1;
  }
  console.log(apply ? `Done: ${created} hold(s) created, ${skipped} skipped.` : `Dry run only. Run again with --apply to create them (${skipped} would be skipped).`);
}

main()
  .catch((error) => { console.error(error?.message || error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
