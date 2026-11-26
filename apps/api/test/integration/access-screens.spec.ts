import * as fs from 'fs';
import * as path from 'path';
import { parse, print, OperationDefinitionNode, TypeNode } from 'graphql';
import { Harness, Session } from '../harness';
import { effectivePermissionsForUser } from '../../src/modules/auth/rbac';
import { isRefused } from '../money-support';

/**
 * Every query a screen sends must work for every role that sees that screen in the menu.
 * Menu rule (apps/web/src/app/dashboard/layout.tsx): item.roles has the role, or the role's default
 * rights include item.permission / any of item.permissions. Command Center renders one dashboard per role.
 * Queries are read from the screen's own folder (not sub-screens) and the components it imports from
 * '@/components/...' or './...'. Each is sent with placeholder variables; only an access refusal counts
 * as a failure (a "not found" for a placeholder id is fine). Queries whose variables fail GraphQL
 * validation never reach the access check, so they are reported as unchecked, not passed.
 */
const WEB = path.resolve(__dirname, '../../../web/src');
const ROLES = ['admin', 'owner', 'sales_manager', 'sales', 'inventory_manager', 'dispatch_ops', 'office_staff'];
const DASHBOARD_BY_ROLE: Record<string, string> = {
  admin: 'admin-dashboard', owner: 'owner-dashboard', sales_manager: 'sales-manager-dashboard', sales: 'sales-rep-dashboard',
  inventory_manager: 'inventory-manager-dashboard', dispatch_ops: 'dispatch-ops-dashboard', office_staff: 'office-staff-dashboard',
};

/**
 * Known mismatches waiting for the owner's decision: the menu shows the screen to the role, but the
 * API refuses the screen's query. Every one of these already existed at commit bcca90c (same menu
 * entry, same query on the screen, same role check on the API), so access is left as it is until
 * the owner decides (narrow the menu, or let the role run the query). Format: "Screen | role | query".
 * The test fails on any NEW mismatch, and also when one listed here disappears (then delete its line).
 */
const KNOWN_MISMATCHES_WAITING_FOR_OWNER = [
  // Documents: the page's one query also asks for productionReadinessSummary (needs reports.view).
  'Documents | sales | DocumentVault',
  'Documents | dispatch_ops | DocumentVault',
  'Documents | office_staff | DocumentVault',
  // Dispatch: the page query asks for pickLists, which needs dispatch.manage (these roles lack it by default).
  'Dispatch | sales_manager | DispatchWorkbench',
  'Dispatch | office_staff | DispatchWorkbench',
  // Returns: the page query asks for returnableDispatchLines, which needs returns.manage.
  'Returns | sales_manager | ReturnsPage',
  'Returns | inventory_manager | ReturnsPage',
  // Labels & Scan: the page query asks for inventoryLots, which needs inventory.manage.
  'Labels & Scan | dispatch_ops | LabelSources',
  // Customer Accounts: the menu lists sales and office staff by role (as at bcca90c), but the account and
  // statement queries need payments.manage, which they do not have by default.
  'Customer Accounts | sales | CustomerAccountDesk',
  'Customer Accounts | sales | CustomerStatementDesk',
  'Customer Accounts | office_staff | CustomerAccountDesk',
  'Customer Accounts | office_staff | CustomerStatementDesk',
  // customerDuplicateCandidates is a side check (lazy, its error is ignored, no banner): on Customers it
  // only powers the "possible duplicate" hint in the add form; on Follow-ups it sits in the customer
  // picker of quick-add, which that page does not even show. The screens work without it.
  'Customers | dispatch_ops | CustomerDuplicateCandidates',
  'Follow-ups | inventory_manager | QuickCustomerCheck',
];

type MenuItem ={ name: string; href: string; roles: string[]; permission?: string; permissions?: string[] };

function menu(): MenuItem[] {
  const src = fs.readFileSync(path.join(WEB, 'app/dashboard/layout.tsx'), 'utf8');
  const items: MenuItem[] = [];
  const list = (text?: string) => (text ? Array.from(text.matchAll(/'([^']+)'/g)).map((m) => m[1]) : []);
  for (const m of src.matchAll(/\{\s*name:\s*'([^']+)',\s*href:\s*'([^']+)',\s*icon:\s*\w+,\s*roles:\s*\[([^\]]*)\](?:,\s*permission:\s*'([^']+)')?(?:,\s*permissions:\s*\[([^\]]*)\])?/g)) {
    items.push({ name: m[1], href: m[2], roles: list(m[3]), permission: m[4], permissions: list(m[5]) });
  }
  return items;
}

function sees(item: MenuItem, role: string) {
  const perms = effectivePermissionsForUser({ role, permissionOverrides: {} }) as string[];
  return item.roles.includes(role) || (!!item.permission && perms.includes(item.permission)) || !!item.permissions?.some((p) => perms.includes(p));
}

function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/components/') && !spec.startsWith('@/components/ui/')) base = path.join(WEB, spec.slice(2));
  else if (spec.startsWith('./')) base = path.join(path.dirname(fromFile), spec);
  else return null;
  for (const ext of ['.tsx', '.ts', '/index.tsx', '/index.ts']) if (fs.existsSync(base + ext)) return base + ext;
  return null;
}

function queriesIn(files: string[]) {
  const out = new Map<string, { doc: string; file: string }>();
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:const\s+(\w+)\s*=\s*)?gql`([\s\S]*?)`/g)) {
      if (m[2].includes('${')) continue;
      // A query the screen only sends behind its own switch (useQuery(X, { skip: ... })) is not sent for everyone.
      if (m[1] && new RegExp(`useQuery\\(${m[1]},\\s*\\{[^\\n]*\\bskip:`).test(src)) continue;
      let parsed;
      try { parsed = parse(m[2]); } catch { continue; }
      for (const def of parsed.definitions) {
        if (def.kind === 'OperationDefinition' && def.operation === 'query') {
          const name = def.name?.value || print(def).slice(0, 60);
          out.set(name, { doc: print(def), file: path.relative(WEB, file) });
        }
      }
    }
  }
  return out;
}

function screenFiles(entry: string[]): string[] {
  const seen = new Set<string>();
  const add = (file: string, depth: number) => {
    if (seen.has(file)) return;
    seen.add(file);
    if (depth >= 1) return;
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
      const target = resolveImport(file, m[1]);
      if (target) add(target, depth + 1);
    }
  };
  entry.forEach((f) => add(f, 0));
  return Array.from(seen);
}

function routeFiles(href: string): string[] {
  const dir = path.join(WEB, 'app', href);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => /\.(tsx|ts)$/.test(n)).map((n) => path.join(dir, n));
}

function placeholder(type: TypeNode): any {
  if (type.kind === 'NonNullType') return placeholder(type.type);
  if (type.kind === 'ListType') return [];
  switch (type.name.value) {
    case 'ID': case 'String': return 'HT-NOT-A-REAL-ID';
    case 'Int': case 'Float': return 1;
    case 'Boolean': return false;
    default: return {};
  }
}

function variablesFor(doc: string) {
  const def = parse(doc).definitions[0] as OperationDefinitionNode;
  const vars: Record<string, any> = {};
  for (const v of def.variableDefinitions || []) if (v.type.kind === 'NonNullType') vars[v.variable.name.value] = placeholder(v.type);
  return vars;
}

describe('access: every screen query works for the roles that see the screen', () => {
  let h: Harness; const sessions: Record<string, Session> = {};
  beforeAll(async () => {
    h = await Harness.boot();
    for (const role of ROLES) sessions[role] = await h.as(role);
  });
  afterAll(async () => { await h.close(); });

  it('the menu was read', () => {
    const items = menu();
    expect(items.length).toBeGreaterThan(25);
    expect(items.find((i) => i.href === '/dashboard/payments')).toBeTruthy();
  });

  it('no screen query is refused for a role that sees that screen', async () => {
    const refused: string[] = [];
    const refusedKeys = new Set<string>();
    const unchecked: string[] = [];
    let checked = 0;
    for (const item of menu()) {
      for (const role of ROLES) {
        if (!sees(item, role)) continue;
        const entry = item.href === '/dashboard'
          ? [path.join(WEB, `components/dashboard/${DASHBOARD_BY_ROLE[role]}.tsx`)]
          : routeFiles(item.href);
        const queries = queriesIn(screenFiles(entry));
        for (const [name, q] of queries) {
          const r = await sessions[role].gqlRaw(q.doc, variablesFor(q.doc));
          checked += 1;
          if (isRefused(r.errors)) refusedKeys.add(`${item.name} | ${role} | ${name}`);
          if (isRefused(r.errors)) refused.push(`${item.name} (${role}): ${name} in ${q.file} -> ${r.errors!.filter((e: any) => isRefused([e])).map((e: any) => `${(e.path || []).join('.')}: ${e.message}`).join('; ')}`);
          else if (r.status === 400 || r.errors?.some((e: any) => e?.extensions?.code === 'BAD_USER_INPUT' && /Variable|argument/i.test(e.message))) unchecked.push(`${item.name} (${role}): ${name}`);
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`screen queries checked: ${checked}; refused: ${refused.length} (known, waiting for the owner: ${KNOWN_MISMATCHES_WAITING_FOR_OWNER.length}); could not be checked with placeholders: ${unchecked.length}\n${refused.join('\n')}\n${unchecked.join('\n')}`);
    // New mismatches fail here; so does a known one that went away (update the list above).
    expect({ newMismatches: Array.from(refusedKeys).filter((k) => !KNOWN_MISMATCHES_WAITING_FOR_OWNER.includes(k)).sort() }).toEqual({ newMismatches: [] });
    expect({ noLongerMismatched: KNOWN_MISMATCHES_WAITING_FOR_OWNER.filter((k) => !refusedKeys.has(k)).sort() }).toEqual({ noLongerMismatched: [] });
  }, 600000);
});
