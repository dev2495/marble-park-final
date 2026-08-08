import { BadRequestException } from '@nestjs/common';
import { ulid } from 'ulid';
import { applyLotStockPostingTx } from './lot-stock-posting';

export async function reserveAvailableLotsTx(tx: any, args: {
  reservationId: string;
  salesOrderLineId: string;
  productId: string;
  quantity: number;
  actorUserId: string;
  quoteId?: string | null;
  orderNumber: string;
}) {
  const quantity = Math.trunc(Number(args.quantity || 0));
  if (quantity <= 0) return [];
  if (!args.salesOrderLineId) throw new BadRequestException('A sales-order line is required for lot reservation');
  const balances = await tx.inventoryLotBalance.findMany({
    where: { available: { gt: 0 }, lot: { productId: args.productId, status: 'active' } },
    include: { lot: true, location: true },
  });
  balances.sort((left: any, right: any) => {
    const received = new Date(left.lot.receivedAt).getTime() - new Date(right.lot.receivedAt).getTime();
    return received || String(left.lot.lotNumber).localeCompare(String(right.lot.lotNumber));
  });
  const available = balances.reduce((sum: number, row: any) => sum + Number(row.available || 0), 0);
  if (available < quantity) throw new BadRequestException(`Only ${available} units remain available for lot allocation`);

  let remaining = quantity;
  const allocations: any[] = [];
  for (const balance of balances) {
    if (remaining <= 0) break;
    const allocated = Math.min(remaining, Number(balance.available || 0));
    await applyLotStockPostingTx(tx, {
      productId: args.productId, lotId: balance.lotId, locationId: balance.locationId,
      idempotencyKey: `reservation:${args.reservationId}:${balance.lotId}:${balance.locationId}:reserve`,
      type: 'reserve', direction: 'reserve', quantity: allocated, reservedDelta: allocated,
      reason: `Reserved for ${args.orderNumber}`, createdBy: args.actorUserId,
      relatedQuoteId: args.quoteId, referenceType: 'Reservation', referenceId: args.reservationId,
      sourceDocumentNo: args.orderNumber, requireAvailable: true,
      metadata: { salesOrderLineId: args.salesOrderLineId },
    });
    const allocation = await tx.lotReservation.create({
      data: {
        id: ulid(), reservationId: args.reservationId, salesOrderLineId: args.salesOrderLineId,
        lotId: balance.lotId, locationId: balance.locationId, quantity: allocated,
        status: 'reserved', metadata: { orderNumber: args.orderNumber }, updatedAt: new Date(),
      },
    });
    allocations.push(allocation);
    remaining -= allocated;
  }
  return allocations;
}

export async function releaseReservedLotsTx(tx: any, args: {
  reservation: any;
  quantity?: number;
  reason: string;
  actorUserId: string;
}) {
  const allocations = await tx.lotReservation.findMany({
    where: { reservationId: args.reservation.id, status: 'reserved' },
    orderBy: { reservedAt: 'asc' },
  });
  let remaining = args.quantity === undefined
    ? allocations.reduce((sum: number, row: any) => sum + Number(row.quantity || 0), 0)
    : Math.trunc(Number(args.quantity || 0));
  for (const allocation of allocations) {
    if (remaining <= 0) break;
    const released = Math.min(remaining, Number(allocation.quantity || 0));
    await applyLotStockPostingTx(tx, {
      productId: args.reservation.productId, lotId: allocation.lotId, locationId: allocation.locationId,
      idempotencyKey: `reservation:${args.reservation.id}:${allocation.id}:release:${released}`,
      type: 'release', direction: 'release', quantity: released, reservedDelta: -released,
      reason: args.reason, createdBy: args.actorUserId, relatedQuoteId: args.reservation.quoteId,
      referenceType: 'Reservation', referenceId: args.reservation.id, requireReserved: true,
    });
    if (released === Number(allocation.quantity)) {
      await tx.lotReservation.update({
        where: { id: allocation.id }, data: { status: 'released', releasedAt: new Date(), updatedAt: new Date() },
      });
    } else {
      await tx.lotReservation.update({
        where: { id: allocation.id }, data: { quantity: Number(allocation.quantity) - released, updatedAt: new Date() },
      });
    }
    remaining -= released;
  }
  if (remaining > 0) throw new BadRequestException('Reserved lot allocation is lower than the requested release quantity');
}

export async function consumeReservedLotsTx(tx: any, args: {
  reservation: any;
  quantity: number;
  challanId: string;
  challanNumber: string;
  actorUserId: string;
}) {
  const allocations = await tx.lotReservation.findMany({
    where: { reservationId: args.reservation.id, status: 'reserved' },
    include: { lot: true, location: true }, orderBy: { reservedAt: 'asc' },
  });
  let remaining = Math.trunc(Number(args.quantity || 0));
  const consumed: any[] = [];
  for (const allocation of allocations) {
    if (remaining <= 0) break;
    const quantity = Math.min(remaining, Number(allocation.quantity || 0));
    await applyLotStockPostingTx(tx, {
      productId: args.reservation.productId, lotId: allocation.lotId, locationId: allocation.locationId,
      idempotencyKey: `dispatch:${args.challanId}:${args.reservation.id}:${allocation.id}:${quantity}`,
      type: 'dispatch', direction: 'out', quantity, onHandDelta: -quantity, reservedDelta: -quantity,
      reason: `Dispatched on ${args.challanNumber}`, createdBy: args.actorUserId,
      relatedQuoteId: args.reservation.quoteId, relatedChallanId: args.challanId,
      referenceType: 'DispatchChallan', referenceId: args.challanId, sourceDocumentNo: args.challanNumber,
      requireReserved: true, requireOnHand: true,
    });
    consumed.push({ lotId: allocation.lotId, locationId: allocation.locationId, quantity });
    if (quantity === Number(allocation.quantity)) {
      await tx.lotReservation.update({
        where: { id: allocation.id }, data: { status: 'dispatched', releasedAt: new Date(), updatedAt: new Date() },
      });
    } else {
      await tx.lotReservation.update({
        where: { id: allocation.id }, data: { quantity: Number(allocation.quantity) - quantity, updatedAt: new Date() },
      });
    }
    remaining -= quantity;
  }
  if (remaining > 0) throw new BadRequestException('The order does not have enough reserved lot stock to dispatch');
  return consumed;
}

export async function consumeExactReservedLotTx(tx: any, args: {
  salesOrderLineId: string;
  productId: string;
  lotId: string;
  locationId: string;
  quantity: number;
  challanId: string;
  challanNumber: string;
  actorUserId: string;
}) {
  let remaining = Math.trunc(Number(args.quantity || 0));
  if (remaining <= 0) return [];
  const allocations = await tx.lotReservation.findMany({
    where: {
      salesOrderLineId: args.salesOrderLineId,
      lotId: args.lotId,
      locationId: args.locationId,
      status: 'reserved',
    },
    include: { reservation: true },
    orderBy: { reservedAt: 'asc' },
  });
  const consumed: any[] = [];
  for (const allocation of allocations) {
    if (remaining <= 0) break;
    const quantity = Math.min(remaining, Number(allocation.quantity || 0));
    await applyLotStockPostingTx(tx, {
      productId: args.productId, lotId: args.lotId, locationId: args.locationId,
      idempotencyKey: `dispatch:${args.challanId}:pick:${allocation.id}:${quantity}`,
      type: 'dispatch', direction: 'out', quantity, onHandDelta: -quantity, reservedDelta: -quantity,
      reason: `Picked lot dispatched on ${args.challanNumber}`, createdBy: args.actorUserId,
      relatedQuoteId: allocation.reservation.quoteId, relatedChallanId: args.challanId,
      referenceType: 'DispatchChallan', referenceId: args.challanId, sourceDocumentNo: args.challanNumber,
      requireReserved: true, requireOnHand: true,
      metadata: { salesOrderLineId: args.salesOrderLineId, pickControlled: true },
    });
    consumed.push({ lotId: args.lotId, locationId: args.locationId, quantity });
    if (quantity === Number(allocation.quantity)) {
      await tx.lotReservation.update({
        where: { id: allocation.id }, data: { status: 'dispatched', releasedAt: new Date(), updatedAt: new Date() },
      });
    } else {
      await tx.lotReservation.update({
        where: { id: allocation.id }, data: { quantity: Number(allocation.quantity) - quantity, updatedAt: new Date() },
      });
    }
    const reservationRemaining = Math.max(0, Number(allocation.reservation.quantity || 0) - quantity);
    await tx.reservation.update({
      where: { id: allocation.reservationId },
      data: { quantity: reservationRemaining, status: reservationRemaining > 0 ? 'reserved' : 'dispatched', updatedAt: new Date() },
    });
    remaining -= quantity;
  }
  if (remaining > 0) throw new BadRequestException('The scanned pick lot does not have enough reserved quantity to dispatch');
  return consumed;
}
