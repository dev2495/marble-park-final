// One-time cleanup: save every customer phone as its clean 10 digits, the same
// rule the app now uses (apps/api/src/modules/common/phone.ts).
//
//   DATABASE_URL=... node scripts/normalise-customer-mobiles.mjs           # dry run: report only
//   DATABASE_URL=... node scripts/normalise-customer-mobiles.mjs --apply   # write the clean numbers
//
// It never merges or deletes customers. It lists:
//   - numbers it would rewrite (e.g. "+91 98250 12345" -> "9825012345")
//   - numbers it cannot clean (fewer than 10 digits, blank) — left as they are
//   - phones shared by more than one customer — for people to resolve
// Take a database backup before --apply on production.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

function mobileKey(input) {
  const digits = String(input ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

const customers = await prisma.customer.findMany({ select: { id: true, name: true, mobile: true, city: true, createdAt: true }, orderBy: { createdAt: 'asc' } });
const rewrites = [];
const unclean = [];
const byKey = new Map();
for (const customer of customers) {
  const key = mobileKey(customer.mobile);
  if (!key) { unclean.push(customer); continue; }
  if (customer.mobile !== key) rewrites.push({ ...customer, next: key });
  byKey.set(key, [...(byKey.get(key) || []), customer]);
}
const shared = [...byKey.entries()].filter(([, rows]) => rows.length > 1);

console.log(`Customers: ${customers.length}`);
console.log(`\nWould rewrite ${rewrites.length} number(s) to 10 digits:`);
for (const row of rewrites) console.log(`  ${row.id}  ${row.name} (${row.city || '-'}): "${row.mobile}" -> ${row.next}`);
console.log(`\nCannot clean ${unclean.length} number(s) (left unchanged):`);
for (const row of unclean) console.log(`  ${row.id}  ${row.name} (${row.city || '-'}): "${row.mobile}"`);
console.log(`\nPhones shared by more than one customer: ${shared.length}`);
for (const [key, rows] of shared) console.log(`  ${key}: ${rows.map((row) => `${row.name} (${row.city || '-'}, ${row.id})`).join(' | ')}`);

if (!apply) {
  console.log('\nDry run only. Nothing was changed. Re-run with --apply to write the clean numbers.');
} else {
  let changed = 0;
  for (const row of rewrites) {
    await prisma.customer.update({ where: { id: row.id }, data: { mobile: row.next, updatedAt: new Date() } });
    changed += 1;
  }
  await prisma.auditEvent.create({ data: {
    id: `mobile-cleanup-${Date.now()}`, actorUserId: 'system', action: 'customer.mobile_normalise', entityType: 'Customer', entityId: 'bulk',
    summary: `Saved ${changed} customer phone number(s) as 10 digits`, metadata: { changed, unclean: unclean.length, shared: shared.length },
  } }).catch((error) => console.warn(`Audit entry not written: ${error.message}`));
  console.log(`\nApplied: ${changed} number(s) rewritten. Shared phones above still need a person to resolve them.`);
}
await prisma.$disconnect();
