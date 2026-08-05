import { ulid } from 'ulid';

export type StockAlertState = 'off' | 'healthy' | 'warning' | 'critical';

type Tx = any;

export function normalizeThreshold(value: unknown, allowNull = false): number | null {
  if (allowNull && (value === null || value === undefined || value === '')) return null;
  const n = Math.max(0, Math.trunc(Number(value || 0)));
  return Number.isFinite(n) ? n : 0;
}

/** Warning = lowStockThreshold; Critical = criticalStockThreshold. */
export function computeStockAlertState(
  available: number,
  warningThreshold: number,
  criticalThreshold: number | null | undefined,
): StockAlertState {
  const avail = Math.max(0, Number(available || 0));
  const warn = Math.max(0, Math.trunc(Number(warningThreshold || 0)));
  const crit = criticalThreshold == null ? 0 : Math.max(0, Math.trunc(Number(criticalThreshold || 0)));
  if (warn <= 0 && crit <= 0) return 'off';
  if (crit > 0 && avail <= crit) return 'critical';
  if (warn > 0 && avail <= warn) return 'warning';
  return 'healthy';
}

export function isAlertingState(state: StockAlertState) {
  return state === 'warning' || state === 'critical';
}

/**
 * Emit role-targeted bell notifications when available stock crosses into
 * warning or critical. Runs inside the stock posting transaction.
 */
export async function evaluateStockAlertTransitionsTx(
  tx: Tx,
  args: {
    productId: string;
    previousAvailable: number;
    nextAvailable: number;
    balance?: { lowStockThreshold?: number; criticalStockThreshold?: number | null };
  },
) {
  const productId = String(args.productId || '').trim();
  if (!productId) return;
  if (Number(args.previousAvailable) === Number(args.nextAvailable)) return;

  const balance = args.balance
    || (await tx.inventoryBalance.findUnique({ where: { productId } }).catch(() => null));
  if (!balance) return;

  const warning = Number(balance.lowStockThreshold ?? 0);
  const critical = balance.criticalStockThreshold;
  const prevState = computeStockAlertState(args.previousAvailable, warning, critical);
  const nextState = computeStockAlertState(args.nextAvailable, warning, critical);
  if (prevState === nextState) return;

  // Recovery: mark unread stock alerts for this product as read.
  if (nextState === 'healthy' || nextState === 'off') {
    await tx.notification.updateMany({
      where: {
        entityType: 'Product',
        entityId: productId,
        type: { in: ['stock_warning', 'stock_critical'] },
        readAt: null,
      },
      data: { readAt: new Date() },
    }).catch(() => null);
    return;
  }

  if (nextState !== 'warning' && nextState !== 'critical') return;

  const type = nextState === 'critical' ? 'stock_critical' : 'stock_warning';
  const existing = await tx.notification.count({
    where: {
      entityType: 'Product',
      entityId: productId,
      type,
      readAt: null,
    },
  }).catch(() => 0);
  if (existing > 0) return;

  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { id: true, sku: true, name: true },
  }).catch(() => null);
  const sku = product?.sku || productId;
  const name = product?.name || 'SKU';
  const available = Math.max(0, Math.trunc(Number(args.nextAvailable || 0)));
  const threshold = nextState === 'critical'
    ? Math.max(0, Math.trunc(Number(critical || 0)))
    : Math.max(0, Math.trunc(Number(warning || 0)));
  const title = nextState === 'critical' ? 'Critical stock breach' : 'Low stock warning';
  const message = nextState === 'critical'
    ? `${sku} · ${name} is at ${available} (critical ≤ ${threshold}). Reorder urgently.`
    : `${sku} · ${name} is at ${available} (warning ≤ ${threshold}). Review reorder.`;
  const href = `/dashboard/inventory/stock-alerts?sku=${encodeURIComponent(sku)}`;
  const metadata = {
    productId,
    sku,
    available,
    threshold,
    alertState: nextState,
    previousAvailable: args.previousAvailable,
  };

  const roles = ['owner', 'admin', 'inventory_manager'];
  for (const targetRole of roles) {
    await tx.notification.create({
      data: {
        id: ulid(),
        title,
        message,
        type,
        entityType: 'Product',
        entityId: productId,
        href,
        targetRole,
        metadata,
      },
    }).catch(() => null);
  }
}
