export type PermissionKey =
  | 'users.manage'
  | 'settings.manage'
  | 'audit.view'
  | 'approvals.manage'
  | 'products.manage'
  | 'master_data.manage'
  | 'catalogue.import'
  | 'inventory.manage'
  | 'stock_locations.manage'
  | 'stock_counts.manage'
  | 'procurement.manage'
  | 'goods_receipts.manage'
  | 'dispatch.manage'
  | 'returns.manage'
  | 'payments.manage'
  | 'quotes.manage'
  | 'reports.view'
  | 'reports.executive'
  | 'reports.sales'
  | 'reports.inventory'
  | 'reports.procurement'
  | 'reports.finance'
  | 'reports.fulfilment'
  | 'reports.audit'
  | 'reports.export'
  | 'documents.view'
  | 'documents.manage'
  | 'documents.delete'
  | 'customers.force_create'
  | 'labels.manage'
  | 'transfers.manage'
  | 'display_assets.manage'
  | 'follow_ups.manage'
  | 'quick_add.sku'
  | 'quick_add.masters'
  | 'pricing.manage';

export const PERMISSION_KEYS: PermissionKey[] = [
  'users.manage',
  'settings.manage',
  'audit.view',
  'approvals.manage',
  'products.manage',
  'master_data.manage',
  'catalogue.import',
  'inventory.manage',
  'stock_locations.manage',
  'stock_counts.manage',
  'procurement.manage',
  'goods_receipts.manage',
  'dispatch.manage',
  'returns.manage',
  'payments.manage',
  'quotes.manage',
  'reports.view',
  'reports.executive',
  'reports.sales',
  'reports.inventory',
  'reports.procurement',
  'reports.finance',
  'reports.fulfilment',
  'reports.audit',
  'reports.export',
  'documents.view',
  'documents.manage',
  'documents.delete',
  'customers.force_create',
  'labels.manage',
  'transfers.manage',
  'display_assets.manage',
  'follow_ups.manage',
  'quick_add.sku',
  'quick_add.masters',
  'pricing.manage',
];

const ALL_PERMISSIONS = [...PERMISSION_KEYS];

export const ROLE_PERMISSIONS: Record<string, PermissionKey[]> = {
  admin: ALL_PERMISSIONS,
  owner: ALL_PERMISSIONS,
  sales_manager: [
    'approvals.manage',
    'payments.manage',
    'reports.view',
    'reports.sales',
    'reports.finance',
    'reports.export',
    'customers.force_create',
    'documents.view',
    'documents.manage',
    'quotes.manage',
  ],
  sales: ['documents.view', 'documents.manage', 'reports.sales'],
  inventory_manager: [
    'products.manage',
    'master_data.manage',
    'catalogue.import',
    'inventory.manage',
    'stock_locations.manage',
    'stock_counts.manage',
    'procurement.manage',
    'goods_receipts.manage',
    'reports.view',
    'reports.inventory',
    'reports.procurement',
    'reports.export',
    'documents.view',
  ],
  dispatch_ops: [
    'dispatch.manage',
    'returns.manage',
    'reports.fulfilment',
    'documents.view',
  ],
  office_staff: [
    'procurement.manage',
    'goods_receipts.manage',
    'reports.procurement',
    'reports.fulfilment',
    'documents.view',
    'documents.manage',
    'quotes.manage',
  ],
};

export function sanitizePermissionOverrides(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const allowed = new Set(PERMISSION_KEYS);
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, boolean>>((acc, [key, raw]) => {
    if (!allowed.has(key as PermissionKey)) return acc;
    if (raw === true || raw === false) acc[key] = raw;
    return acc;
  }, {});
}

// Finer rights split out of broader ones. Anyone holding the broader right
// gets the finer one by default, so nobody loses access; an explicit "deny"
// override still removes it for one user.
export const IMPLIED_PERMISSIONS: Partial<Record<PermissionKey, PermissionKey[]>> = {
  'labels.manage': ['inventory.manage'],
  'transfers.manage': ['inventory.manage'],
  'display_assets.manage': ['products.manage'],
  'follow_ups.manage': ['quotes.manage', 'master_data.manage', 'products.manage'],
  'quick_add.sku': ['quotes.manage', 'products.manage'],
  'quick_add.masters': ['master_data.manage'],
};

export type PermissionInfo = { key: PermissionKey; label: string; description: string; group: string; risk?: 'high' };
export const PERMISSION_GROUPS = ['Security & control', 'Sales & quotes', 'Catalogue & masters', 'Stock & labels', 'Buying & receiving', 'Fulfilment & money', 'Documents', 'Reports'] as const;
export const PERMISSION_CATALOG: PermissionInfo[] = [
  { key: 'users.manage', group: 'Security & control', label: 'Manage users and rights', description: 'Create users, change roles, reset passwords and set these overrides.', risk: 'high' },
  { key: 'settings.manage', group: 'Security & control', label: 'System settings', description: 'Company profile, quote branding, numbering and integrations.', risk: 'high' },
  { key: 'audit.view', group: 'Security & control', label: 'Audit trail', description: 'See who changed what across the system.' },
  { key: 'approvals.manage', group: 'Security & control', label: 'Price approvals', description: 'Approve below-floor quotes and other owner approvals.', risk: 'high' },
  { key: 'quotes.manage', group: 'Sales & quotes', label: 'Build and manage quotes', description: 'Create, revise, share and convert quotations; see the quote register.' },
  { key: 'customers.force_create', group: 'Sales & quotes', label: 'Override duplicate customer check', description: 'Create a customer even when a likely duplicate exists.' },
  { key: 'quick_add.sku', group: 'Sales & quotes', label: 'Quick add new SKUs', description: 'Add a new arrival with name and MRP from a quote. It is flagged for follow-up.' },
  { key: 'follow_ups.manage', group: 'Sales & quotes', label: 'Complete follow-ups', description: 'Fill in missing details of quick-added customers, SKUs and masters.' },
  { key: 'products.manage', group: 'Catalogue & masters', label: 'Create and edit SKUs', description: 'Full Product Master editing, including tile variants.' },
  { key: 'pricing.manage', group: 'Catalogue & masters', label: 'MRP Control Desk', description: 'Set and bulk-update MRP, NRP and floor prices.', risk: 'high' },
  { key: 'master_data.manage', group: 'Catalogue & masters', label: 'Edit masters', description: 'Categories, brands, finishes, tile sizes, vendors and architects.' },
  { key: 'quick_add.masters', group: 'Catalogue & masters', label: 'Quick add masters', description: 'Add a brand, category, finish, vendor or tile size by name only.' },
  { key: 'catalogue.import', group: 'Catalogue & masters', label: 'Excel Product Master import', description: 'Upload and apply catalogue workbooks.' },
  { key: 'inventory.manage', group: 'Stock & labels', label: 'Inventory and adjustments', description: 'Stock screens, opening stock and adjustments.' },
  { key: 'labels.manage', group: 'Stock & labels', label: 'Print and void labels', description: 'Create label jobs, print runs and void stock labels.' },
  { key: 'transfers.manage', group: 'Stock & labels', label: 'Stock transfers', description: 'Move stock between locations.' },
  { key: 'display_assets.manage', group: 'Stock & labels', label: 'Display samples', description: 'Register and move showroom display pieces.' },
  { key: 'stock_locations.manage', group: 'Stock & labels', label: 'Plants and locations', description: 'Create and edit stock locations.' },
  { key: 'stock_counts.manage', group: 'Stock & labels', label: 'Stock counts', description: 'Run and approve stock counts.' },
  { key: 'procurement.manage', group: 'Buying & receiving', label: 'Purchase orders', description: 'Raise and manage purchase orders and demands.' },
  { key: 'goods_receipts.manage', group: 'Buying & receiving', label: 'Goods receipts (GRN)', description: 'Receive stock against purchase orders.' },
  { key: 'dispatch.manage', group: 'Fulfilment & money', label: 'Dispatch and challans', description: 'Pick, pack and dispatch orders.' },
  { key: 'returns.manage', group: 'Fulfilment & money', label: 'Returns', description: 'Accept returns and issue credit notes.' },
  { key: 'payments.manage', group: 'Fulfilment & money', label: 'Payments and receivables', description: 'Record payments and manage customer accounts.', risk: 'high' },
  { key: 'documents.view', group: 'Documents', label: 'View document vault', description: 'Open files in the vault.' },
  { key: 'documents.manage', group: 'Documents', label: 'Upload and share files', description: 'Upload, edit and share vault files.' },
  { key: 'documents.delete', group: 'Documents', label: 'Delete archived files', description: 'Permanently delete archived vault files. Cannot be undone.', risk: 'high' },
  { key: 'reports.view', group: 'Reports', label: 'Management reports (legacy)', description: 'Older combined report access.' },
  { key: 'reports.executive', group: 'Reports', label: 'Executive reports', description: 'Business-wide summary reporting.' },
  { key: 'reports.sales', group: 'Reports', label: 'Sales reports', description: 'Sales, customer and product reports.' },
  { key: 'reports.inventory', group: 'Reports', label: 'Inventory reports', description: 'Stock and lot reports.' },
  { key: 'reports.procurement', group: 'Reports', label: 'Procurement reports', description: 'Vendor and purchase reports.' },
  { key: 'reports.finance', group: 'Reports', label: 'Finance reports', description: 'Receivables and credit reports.' },
  { key: 'reports.fulfilment', group: 'Reports', label: 'Fulfilment reports', description: 'Quote-to-delivery reports.' },
  { key: 'reports.audit', group: 'Reports', label: 'Data quality reports', description: 'Audit and data-quality reports.' },
  { key: 'reports.export', group: 'Reports', label: 'Export reports', description: 'Download report data.' },
];

export function roleDefaultPermissions(role?: string | null): PermissionKey[] {
  const base = new Set<PermissionKey>(ROLE_PERMISSIONS[role || ''] || []);
  for (const [key, sources] of Object.entries(IMPLIED_PERMISSIONS) as Array<[PermissionKey, PermissionKey[]]>) {
    if (sources.some((source) => base.has(source))) base.add(key);
  }
  return Array.from(base).sort();
}

export function effectivePermissionsForUser(user: { role?: string | null; permissionOverrides?: unknown }): PermissionKey[] {
  const permissions = new Set<PermissionKey>(ROLE_PERMISSIONS[user.role || ''] || []);
  const preOverrides = sanitizePermissionOverrides(user.permissionOverrides);
  // Broader rights granted by override also bring their finer rights.
  for (const [key, value] of Object.entries(preOverrides)) if (value) permissions.add(key as PermissionKey);
  for (const [key, sources] of Object.entries(IMPLIED_PERMISSIONS) as Array<[PermissionKey, PermissionKey[]]>) {
    if (preOverrides[key] === undefined && sources.some((source) => permissions.has(source))) permissions.add(key);
  }
  const overrides = sanitizePermissionOverrides(user.permissionOverrides);
  for (const [key, value] of Object.entries(overrides)) {
    if (value) permissions.add(key as PermissionKey);
    else permissions.delete(key as PermissionKey);
  }
  return Array.from(permissions).sort();
}

export function hasPermission(user: { role?: string | null; permissionOverrides?: unknown }, permission: PermissionKey): boolean {
  return effectivePermissionsForUser(user).includes(permission);
}
