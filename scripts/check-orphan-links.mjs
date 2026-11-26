#!/usr/bin/env node
/**
 * Reports, for every id column that has no database foreign key, how many rows
 * point at nothing (the id is not found in the table it should link to).
 * Read only: it never changes data. Run it before adding foreign keys.
 *
 *   DATABASE_URL=... node scripts/check-orphan-links.mjs            (prints a table)
 *   DATABASE_URL=... node scripts/check-orphan-links.mjs --json
 *
 * Columns that can point at many kinds of rows (entityId, sourceId, referenceId,
 * scopeId) are listed as "skipped (points at several tables)".
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'apps/api/package.json'));
const { PrismaClient } = require('@prisma/client');

const schema = readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8');
const models = new Map();
for (const match of schema.matchAll(/^model (\w+) \{\n([\s\S]*?)^\}/gm)) models.set(match[1], match[2]);
const byLower = new Map([...models.keys()].map((name) => [name.toLowerCase(), name]));

const USER_COLUMNS = /^(createdBy|updatedBy|\w+By|actorUserId|ownerId|targetUserId|assignedUserId|collectionOwnerId|\w+ById|handledBy)$/;
const MANY_TARGETS = new Set(['entityId', 'sourceId', 'referenceId', 'scopeId', 'sourceLineId', 'legacyReceiptId']);
const EXPLICIT = {
  'PurchaseDemand.sourceOrderId': 'SalesOrder',
  'PurchaseDemand.sourceQuoteId': 'Quote',
  'PurchaseDemand.sourceReservationId': 'Reservation',
  'PurchaseDemand.preferredVendorId': 'Vendor',
  'ReorderPolicy.preferredVendorId': 'Vendor',
  'InventoryMovement.relatedQuoteId': 'Quote',
  'InventoryMovement.relatedChallanId': 'DispatchChallan',
  'LeadIntent.referencesQuoteId': 'Quote',
  'Quote.intentId': 'LeadIntent',
  'Quote.supersedesQuoteId': 'Quote',
  'Quote.supersededByQuoteId': 'Quote',
  'DisplaySample.sourceLotId': 'InventoryLot',
  'StockLedgerEntry.lotId': 'InventoryLot',
  'InternalLabelJob.labelTemplateId': 'InternalLabelTemplate',
  'InventoryPeriodClose.countSessionId': 'StockCountSession',
  'ReportPreset.reportId': null,
  'ReportingTarget.supersededById': 'ReportingTarget',
  'CustomerPayment.legacyReceiptId': 'PaymentReceipt',
};

function findModel(name) {
  return byLower.get(String(name).toLowerCase()) || null;
}

const checks = [];
for (const [model, body] of models) {
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    const m = line.match(/^(\w*[iI]d|\w+By)\s+String(\?)?(\s|$)/);
    if (!m || /^id\s/.test(line) || line.includes('@id')) continue;
    const column = m[1];
    if (new RegExp(`fields:\\s*\\[\\s*${column}\\s*\\]`).test(body)) continue; // has a real foreign key
    const key = `${model}.${column}`;
    let target;
    if (key in EXPLICIT) target = EXPLICIT[key];
    else if (MANY_TARGETS.has(column)) target = undefined;
    else if (USER_COLUMNS.test(column)) target = 'User';
    else target = findModel(column.replace(/Id$/, ''));
    checks.push({ model, column, target });
  }
}

const prisma = new PrismaClient();
const results = [];
try {
  for (const check of checks) {
    const base = { table: check.model, column: check.column, target: check.target || null };
    if (check.target === undefined) {
      results.push({ ...base, status: 'skipped (points at several tables)' });
      continue;
    }
    if (check.target === null || !models.has(check.target)) {
      results.push({ ...base, status: 'skipped (target table unknown, check by hand)' });
      continue;
    }
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT count(*)::int AS orphans, (SELECT count(*)::int FROM "${check.model}" WHERE "${check.column}" IS NOT NULL) AS linked
         FROM "${check.model}" t
         WHERE t."${check.column}" IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM "${check.target}" x WHERE x.id = t."${check.column}")`,
      );
      results.push({ ...base, status: 'checked', orphans: rows[0].orphans, linked: rows[0].linked });
    } catch (error) {
      results.push({ ...base, status: `error: ${String(error.message).split('\n')[0]}` });
    }
  }
} finally {
  await prisma.$disconnect();
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const pad = (v, n) => String(v).padEnd(n);
  console.log(`${pad('Table.column', 44)}${pad('Points at', 24)}${pad('Rows with id', 14)}Rows pointing at nothing`);
  for (const r of results) {
    const name = `${r.table}.${r.column}`;
    if (r.status === 'checked') console.log(`${pad(name, 44)}${pad(r.target, 24)}${pad(r.linked, 14)}${r.orphans}${r.orphans ? '   <-- fix before adding a foreign key' : ''}`);
    else console.log(`${pad(name, 44)}${pad(r.target || '-', 24)}${r.status}`);
  }
  const bad = results.filter((r) => r.orphans > 0);
  console.log(`\n${results.filter((r) => r.status === 'checked').length} columns checked, ${bad.length} have rows pointing at nothing.`);
}
process.exitCode = results.some((r) => r.orphans > 0) ? 2 : 0;
