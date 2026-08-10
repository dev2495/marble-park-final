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
  | 'customers.force_create';

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
  'customers.force_create',
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

export function effectivePermissionsForUser(user: { role?: string | null; permissionOverrides?: unknown }): PermissionKey[] {
  const permissions = new Set<PermissionKey>(ROLE_PERMISSIONS[user.role || ''] || []);
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
