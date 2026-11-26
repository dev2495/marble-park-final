// One rule for purchase demand states, read by every screen and count.
//
//   open              raised from an order shortage, not on a purchase order yet
//   ordered           on a purchase order, goods not in yet
//   partial_received  part of it came in
//   received          all of it came in, the order has not been delivered yet
//   allocated         the shortage was filled (from this or other stock), the order has not been delivered yet
//   closed            the goods came in and the order was delivered: nothing left to do
//   cancelled         the order was cancelled before it was bought

/** Still waiting on a supplier: what "Pending inward" and every "active demand" count means. */
export const ACTIVE_DEMAND_STATUSES = ['open', 'ordered', 'partial_received'];

/** Never moves again and is never bought, received or filled. */
export const TERMINAL_DEMAND_STATUSES = ['closed', 'cancelled'];

/** Goods are in (or the shortage was filled) and wait only for the order to be delivered. */
export const FINISHED_INWARD_DEMAND_STATUSES = ['received', 'allocated'];

/**
 * Closes the purchase demands of one order once their work is finished: the goods
 * came in (received / allocated) and the order is fully delivered. Runs inside the
 * caller's transaction (delivery or goods receipt). Partly delivered orders and
 * demands still waiting on a supplier are left as they are. Returns how many closed.
 */
export async function closeFinishedDemandsTx(tx: any, salesOrderId: string | null | undefined): Promise<number> {
  if (!salesOrderId) return 0;
  const order = await tx.salesOrder.findUnique({ where: { id: salesOrderId }, select: { id: true, status: true } });
  if (!order || order.status !== 'delivered') return 0;
  const result = await tx.purchaseDemand.updateMany({
    where: { sourceOrderId: salesOrderId, status: { in: FINISHED_INWARD_DEMAND_STATUSES } },
    data: { status: 'closed', updatedAt: new Date() },
  });
  return Number(result?.count || 0);
}
