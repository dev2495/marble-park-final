import { Harness, Session } from '../harness';
import { createUser, isRefused, loginAs } from '../money-support';

/**
 * Who may call what, per seeded role, exactly as the resolvers' rules state today (D4, MENU, D9):
 *  ownerDashboard: admin, owner, sales_manager full; office_staff recent quotes only; others refused
 *  inventoryDashboard: admin, owner, inventory_manager
 *  audit queries: admin, owner (or audit.view switched on)
 *  approveQuote / rejectQuote: admin, owner (or approvals.manage switched on; switched off removes it)
 *  voidSalesInvoice: admin, owner (same as voiding a receipt; review fix)
 *  cancelSalesOrder: admin, owner, sales_manager
 *  reopenInventoryPeriod: admin, owner
 * "Allowed" is checked with an id that does not exist: the call must get past the access check
 * (a "not found" style error is fine), never "restricted".
 */
const ROLES = ['admin', 'owner', 'sales_manager', 'sales', 'inventory_manager', 'dispatch_ops', 'office_staff'];
const NONE = 'HT-NOT-A-REAL-ID';

const OPS: Array<{ name: string; allowed: string[]; query: string; vars?: Record<string, any> }> = [
  { name: 'ownerDashboard', allowed: ['admin', 'owner', 'sales_manager', 'office_staff'], query: `query { ownerDashboard { stats recentQuotes } }` },
  { name: 'inventoryDashboard', allowed: ['admin', 'owner', 'inventory_manager'], query: `query { inventoryDashboard { stats } }` },
  { name: 'auditEvents', allowed: ['admin', 'owner'], query: `query { auditEvents(take: 1) { __typename } }` },
  { name: 'auditStats', allowed: ['admin', 'owner'], query: `query { auditStats }` },
  { name: 'auditFacets', allowed: ['admin', 'owner'], query: `query { auditFacets }` },
  { name: 'auditEventsCsv', allowed: ['admin', 'owner'], query: `query { auditEventsCsv(take: 1) }` },
  { name: 'approveQuote', allowed: ['admin', 'owner'], query: `mutation($id: ID!) { approveQuote(id: $id, note: "harness") { id } }`, vars: { id: NONE } },
  { name: 'rejectQuote', allowed: ['admin', 'owner'], query: `mutation($id: ID!) { rejectQuote(id: $id, note: "harness reject") { id } }`, vars: { id: NONE } },
  { name: 'voidSalesInvoice', allowed: ['admin', 'owner'], query: `mutation($id: ID!) { voidSalesInvoice(id: $id, reason: "harness void") }`, vars: { id: NONE } },
  { name: 'cancelSalesOrder', allowed: ['admin', 'owner', 'sales_manager'], query: `mutation($id: ID!) { cancelSalesOrder(id: $id, reason: "harness cancel") }`, vars: { id: NONE } },
  { name: 'reopenInventoryPeriod', allowed: ['admin', 'owner'], query: `mutation($id: ID!) { reopenInventoryPeriod(id: $id, reason: "harness reopen") }`, vars: { id: NONE } },
];

describe('access: role rules for owner screens and risky actions', () => {
  let h: Harness; const sessions: Record<string, Session> = {};
  beforeAll(async () => {
    h = await Harness.boot();
    for (const role of ROLES) sessions[role] = await h.as(role);
  });
  afterAll(async () => { await h.close(); });

  it('every role gets exactly the access the rules state', async () => {
    const wrong: string[] = [];
    for (const op of OPS) {
      for (const role of ROLES) {
        const r = await sessions[role].gqlRaw(op.query, op.vars || {});
        const refused = isRefused(r.errors);
        const shouldPass = op.allowed.includes(role);
        if (shouldPass && refused) wrong.push(`${role} was refused ${op.name}: ${r.errors?.[0]?.message}`);
        if (!shouldPass && !refused) wrong.push(`${role} was let through ${op.name}${r.errors?.length ? ` (error: ${r.errors[0].message})` : ''}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('office staff get only the recent quotes from ownerDashboard; a sales manager gets the full figures', async () => {
    const office = (await sessions.office_staff.gql(`query { ownerDashboard { stats recentQuotes userPerformance } }`)).ownerDashboard;
    expect(office.stats).toEqual({});
    expect(office.userPerformance).toEqual([]);
    expect(Array.isArray(office.recentQuotes)).toBe(true);
    const manager = (await sessions.sales_manager.gql(`query { ownerDashboard { stats userPerformance } }`)).ownerDashboard;
    expect(typeof manager.stats.totalQuoteValue).toBe('number');
  });

  it('a right switched on for one user opens approvals and audit; switched off on an admin closes approvals', async () => {
    const admin = sessions.admin;
    const seller = await createUser(h, admin, 'sales');
    await admin.gql(`mutation($id: ID!, $input: UpdateUserInput!) { updateUser(id: $id, input: $input) { id } }`, { id: seller.id, input: { permissionOverrides: { 'approvals.manage': true, 'audit.view': true } } });
    const s = await loginAs(h, seller.email, seller.password);
    expect(isRefused((await s.gqlRaw(OPS[6].query, OPS[6].vars)).errors)).toBe(false);
    expect(isRefused((await s.gqlRaw(`query { auditStats }`)).errors)).toBe(false);

    const second = await createUser(h, admin, 'admin');
    await admin.gql(`mutation($id: ID!, $input: UpdateUserInput!) { updateUser(id: $id, input: $input) { id } }`, { id: second.id, input: { permissionOverrides: { 'approvals.manage': false } } });
    const a = await loginAs(h, second.email, second.password);
    expect(isRefused((await a.gqlRaw(OPS[6].query, OPS[6].vars)).errors)).toBe(true);
    expect(isRefused((await a.gqlRaw(OPS[7].query, OPS[7].vars)).errors)).toBe(true);
    await admin.gql(`mutation($id: ID!) { deleteUser(id: $id) { id } }`, { id: second.id });
    await admin.gql(`mutation($id: ID!) { deleteUser(id: $id) { id } }`, { id: seller.id });
  });
});
