import { ulid } from 'ulid';
import { reservableLotQuantityTx, reserveAvailableLotsTx } from './lot-allocation';
import { syncSalesOrderLinesForQuoteTx } from './stock-posting';
import { toSellingQtyCeil, toSellingQtyFloor } from './stock-units';

// One rule for "waiting orders get the stock that comes in". Every stock gain
// (goods receipt, customer return, count gain, opening stock, display piece
// back, failed delivery back) calls fillBackordersTx inside its own
// transaction, so a backorder never waits while the same item sits free.

/** Order statuses that will never take more stock (a delivered order has every line delivered). */
const DEAD_ORDER_STATUSES = new Set(['cancelled', 'closed', 'void', 'delivered']);
/** Quote statuses that will never take more stock (legacy rows with no order). */
const DEAD_QUOTE_STATUSES = new Set(['cancelled', 'closed', 'lost', 'expired', 'superseded', 'rejected']);

export type StockGainSource = 'goods_receipt' | 'customer_return' | 'stock_count' | 'opening_stock' | 'display_return' | 'stock_adjustment' | 'failed_delivery' | 'transfer_receipt' | 'order_cancelled';

const SOURCE_LABEL: Record<StockGainSource, string> = {
  goods_receipt: 'goods receipt',
  customer_return: 'customer return',
  stock_count: 'stock count',
  opening_stock: 'opening stock',
  display_return: 'display piece back in stock',
  stock_adjustment: 'stock adjustment',
  failed_delivery: 'goods back from a failed delivery',
  transfer_receipt: 'stock transfer received',
  order_cancelled: 'stock freed by a cancelled order',
};

/**
 * Reserves newly free stock of one product for its waiting backorders, oldest
 * first. Skips backorders whose order or quote is cancelled or closed, and
 * moves past a backorder that is larger than the free stock so a smaller one
 * behind it can still be filled. A backorder is filled whole or waits.
 */
export async function fillBackordersTx(tx: any, productId: string, options: { actorUserId?: string; source: StockGainSource }) {
  const filled: Array<{ reservationId: string; quantity: number }> = [];
  if (!productId) return filled;
  const reservations = await tx.reservation.findMany({
    where: { productId, status: 'backordered', quantity: { gt: 0 } },
    orderBy: { createdAt: 'asc' },
  });
  if (!reservations.length) return filled;
  let free = await reservableLotQuantityTx(tx, productId);
  if (free <= 0) return filled;
  // No .catch on queries here: this runs inside the posting's transaction, and a failed
  // statement aborts it, so the real error must reach the caller.
  const product = await tx.product.findUnique({ where: { id: productId } });
  const actorUserId = options.actorUserId || 'system';
  const sourceLabel = SOURCE_LABEL[options.source] || 'stock gain';

  for (const reservation of reservations) {
    if (free <= 0) break;
    const quantity = Number(reservation.quantity || 0);
    if (quantity <= 0) continue;
    const salesOrder = reservation.salesOrderId
      ? await tx.salesOrder.findUnique({ where: { id: reservation.salesOrderId } })
      : null;
    if (reservation.salesOrderId && (!salesOrder || DEAD_ORDER_STATUSES.has(String(salesOrder.status || '').toLowerCase()))) continue;
    const quote = reservation.quoteId
      ? await tx.quote.findUnique({ where: { id: reservation.quoteId } })
      : null;
    if (!salesOrder && (!quote || DEAD_QUOTE_STATUSES.has(String(quote.status || '').toLowerCase()))) continue;
    // A legacy backorder with no order line cannot hold lots; leave it rather than fail the whole posting.
    if (!reservation.salesOrderLineId) continue;
    // Too big for the free stock: keep waiting, but do not block the smaller ones behind it.
    if (quantity > free) continue;

    const allocations = await reserveAvailableLotsTx(tx, {
      reservationId: reservation.id, salesOrderLineId: reservation.salesOrderLineId,
      productId, quantity, actorUserId, quoteId: reservation.quoteId,
      orderNumber: salesOrder?.orderNumber || quote?.quoteNumber || reservation.quoteId || reservation.id,
    });
    free -= quantity;
    filled.push({ reservationId: reservation.id, quantity });
    await tx.reservation.update({
      where: { id: reservation.id },
      data: {
        status: 'reserved',
        locationId: new Set(allocations.map((row: any) => row.locationId)).size === 1 ? allocations[0].locationId : null,
        updatedAt: new Date(),
      },
    });
    await tx.purchaseDemand.updateMany({
      // A closed or cancelled demand is finished and never moves again.
      where: { sourceReservationId: reservation.id, status: { notIn: ['closed', 'cancelled'] } },
      data: { status: 'allocated', updatedAt: new Date() },
    });
    if (reservation.quoteId) {
      await syncSalesOrderLinesForQuoteTx(tx, reservation.quoteId);
    } else {
      await refreshOrderLineStockTx(tx, reservation.salesOrderLineId, product);
    }

    const sku = product?.sku || 'Item';
    if (quote?.leadId) {
      await tx.activity.create({
        data: {
          id: ulid(), leadId: quote.leadId, quoteId: quote.id, userId: quote.ownerId, type: 'stock_ready',
          message: `${sku} came in (${sourceLabel}), was reserved, and is ready for dispatch.`,
        },
      });
    }
    const ownerId = quote?.ownerId || salesOrder?.ownerId || null;
    const documentNo = salesOrder?.orderNumber || quote?.quoteNumber || 'the order';
    await tx.notification.createMany({
      data: [
        ...(ownerId ? [{
          id: ulid(), title: 'Backorder item reserved',
          message: `${sku} has come in for ${documentNo} and is reserved.`,
          type: 'stock_ready',
          entityType: quote ? 'Quote' : 'SalesOrder', entityId: quote?.id || salesOrder?.id,
          href: quote?.leadId ? `/dashboard/leads/${quote.leadId}` : '/dashboard/orders',
          targetUserId: ownerId,
          metadata: { productId, quoteId: quote?.id || null, salesOrderId: salesOrder?.id || null, source: options.source },
        }] : []),
        {
          id: ulid(), title: 'Pending dispatch item ready',
          message: `${sku} is in stock and reserved for ${documentNo}. Dispatch can create the remaining challan.`,
          type: 'stock_ready',
          entityType: quote ? 'Quote' : 'SalesOrder', entityId: quote?.id || salesOrder?.id,
          href: '/dashboard/dispatch', targetRole: 'dispatch_ops',
          metadata: { productId, quoteId: quote?.id || null, salesOrderId: salesOrder?.id || null, source: options.source },
        },
      ],
    });
  }
  return filled;
}

/** Fills backorders for every product that just gained stock, once each. */
export async function fillBackordersForProductsTx(tx: any, productIds: Array<string | null | undefined>, options: { actorUserId?: string; source: StockGainSource }) {
  const unique = Array.from(new Set(productIds.map((id) => String(id || '').trim()).filter(Boolean)));
  for (const productId of unique) await fillBackordersTx(tx, productId, options);
}

/**
 * Recomputes reserved and backordered selling units on one order line from its
 * reservations (base units). Used for direct orders, which have no quote to sync.
 */
export async function refreshOrderLineStockTx(tx: any, salesOrderLineId: string, product?: any) {
  if (!salesOrderLineId) return;
  const orderLine = await tx.salesOrderLine.findUnique({ where: { id: salesOrderLineId } });
  if (!orderLine) return;
  const stockProduct = product || (orderLine.productId ? await tx.product.findUnique({ where: { id: orderLine.productId } }) : null);
  const siblings = await tx.reservation.findMany({ where: { salesOrderLineId }, select: { quantity: true, status: true } });
  const reservedBase = siblings.filter((row: any) => row.status === 'reserved').reduce((sum: number, row: any) => sum + Number(row.quantity || 0), 0);
  const backorderedBase = siblings.filter((row: any) => row.status === 'backordered').reduce((sum: number, row: any) => sum + Number(row.quantity || 0), 0);
  const ordered = Number(orderLine.orderedQuantity || 0);
  const outstanding = Math.max(0, ordered - Number(orderLine.dispatchedQuantity || 0));
  const reservedQuantity = Math.min(outstanding, toSellingQtyFloor(stockProduct, reservedBase));
  const backorderedQuantity = Math.min(Math.max(0, outstanding - reservedQuantity), toSellingQtyCeil(stockProduct, backorderedBase));
  const dispatched = Number(orderLine.dispatchedQuantity || 0);
  const delivered = Number(orderLine.deliveredQuantity || 0);
  const status = ordered > 0 && delivered >= ordered ? 'delivered'
    : ordered > 0 && dispatched >= ordered ? 'dispatched'
      : dispatched > 0 ? 'partial_dispatched'
        : backorderedQuantity > 0 ? (reservedQuantity > 0 ? 'partial_ready' : 'backordered')
          : reservedQuantity > 0 ? 'reserved' : orderLine.status;
  await tx.salesOrderLine.update({
    where: { id: salesOrderLineId },
    data: { reservedQuantity, backorderedQuantity, status, updatedAt: new Date() },
  });
}
