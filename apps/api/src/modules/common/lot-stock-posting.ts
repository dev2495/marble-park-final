import { BadRequestException } from '@nestjs/common';
import { ulid } from 'ulid';
import { applyStockPostingTx, wholeDelta } from './stock-posting';

type Tx = any;

export interface LotStockPostingInput {
  productId: string;
  lotId: string;
  locationId: string;
  idempotencyKey: string;
  type: string;
  reason: string;
  createdBy: string;
  quantity: number;
  onHandDelta?: number;
  reservedDelta?: number;
  damagedDelta?: number;
  holdDelta?: number;
  direction?: 'in' | 'out' | 'neutral' | 'reserve' | 'release' | 'damage' | 'damage_release' | 'hold' | 'hold_release';
  referenceType: string;
  referenceId: string;
  sourceDocumentNo?: string | null;
  relatedQuoteId?: string | null;
  relatedChallanId?: string | null;
  unitCost?: number;
  metadata?: Record<string, unknown>;
  requireAvailable?: boolean;
  requireReserved?: boolean;
  requireOnHand?: boolean;
  effectiveAt?: Date | string;
}

export async function applyLotStockPostingTx(tx: Tx, input: LotStockPostingInput) {
  const productId = String(input.productId || '').trim();
  const lotId = String(input.lotId || '').trim();
  const locationId = String(input.locationId || '').trim();
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  if (!productId || !lotId || !locationId) throw new BadRequestException('Product, lot and location are required for physical stock posting');
  if (!idempotencyKey) throw new BadRequestException('An idempotency key is required for physical stock posting');

  const quantity = Math.abs(wholeDelta(input.quantity));
  if (quantity <= 0) throw new BadRequestException('Physical stock posting quantity must be greater than zero');

  const existingPosting = await tx.inventoryLotLedgerEntry.findUnique({ where: { idempotencyKey } }).catch(() => null);
  if (existingPosting) {
    if (existingPosting.productId !== productId || existingPosting.lotId !== lotId || existingPosting.locationId !== locationId) {
      throw new BadRequestException('Physical stock idempotency key belongs to another stock identity');
    }
    return {
      idempotent: true,
      ledger: existingPosting,
      balance: await tx.inventoryLotBalance.findUnique({ where: { lotId_locationId: { lotId, locationId } } }),
    };
  }

  const [lot, location] = await Promise.all([
    tx.inventoryLot.findUnique({ where: { id: lotId } }),
    tx.stockLocation.findUnique({ where: { id: locationId } }),
  ]);
  if (!lot || lot.productId !== productId) throw new BadRequestException('Selected lot does not belong to the Product Master SKU');
  if (lot.status !== 'active') throw new BadRequestException('Selected inventory lot is not active');
  if (!location || location.status !== 'active') throw new BadRequestException('Selected stock location is not active');

  const current = await tx.inventoryLotBalance.findUnique({ where: { lotId_locationId: { lotId, locationId } } }).catch(() => null);
  const before = {
    onHand: Number(current?.onHand || 0),
    reserved: Number(current?.reserved || 0),
    damaged: Number(current?.damaged || 0),
    hold: Number(current?.hold || 0),
    available: Number(current?.available || 0),
  };
  if (input.requireAvailable && quantity > before.available) throw new BadRequestException('Cannot post more than the available lot quantity');
  if (input.requireReserved && quantity > before.reserved) throw new BadRequestException('Cannot post more than the reserved lot quantity');
  if (input.requireOnHand && quantity > before.onHand) throw new BadRequestException('Cannot post more than the on-hand lot quantity');

  const deltas = {
    onHand: wholeDelta(input.onHandDelta),
    reserved: wholeDelta(input.reservedDelta),
    damaged: wholeDelta(input.damagedDelta),
    hold: wholeDelta(input.holdDelta),
  };
  const next = {
    onHand: before.onHand + deltas.onHand,
    reserved: before.reserved + deltas.reserved,
    damaged: before.damaged + deltas.damaged,
    hold: before.hold + deltas.hold,
  };
  if (Object.values(next).some((value) => value < 0)) throw new BadRequestException('Physical stock posting would create a negative lot bucket');
  if (next.reserved + next.damaged + next.hold > next.onHand) {
    throw new BadRequestException('Lot reserved, damaged and held stock cannot exceed lot on-hand stock');
  }
  const available = Math.max(0, next.onHand - next.reserved - next.damaged - next.hold);

  await applyStockPostingTx(tx, {
    productId,
    locationId,
    lotId,
    idempotencyKey,
    type: input.type,
    ledgerType: input.type,
    movementType: input.type,
    direction: input.direction || inferDirection(deltas),
    reason: input.reason,
    createdBy: input.createdBy,
    quantity,
    onHandDelta: deltas.onHand,
    reservedDelta: deltas.reserved,
    damagedDelta: deltas.damaged,
    holdDelta: deltas.hold,
    locationOnHandDelta: deltas.onHand,
    locationReservedDelta: deltas.reserved,
    locationDamagedDelta: deltas.damaged,
    locationHoldDelta: deltas.hold,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    sourceDocumentNo: input.sourceDocumentNo || null,
    relatedQuoteId: input.relatedQuoteId || null,
    relatedChallanId: input.relatedChallanId || null,
    unitCost: input.unitCost ?? Number(lot.unitCost || 0),
    metadata: { lotId, ...input.metadata },
    requireAvailable: input.requireAvailable,
    requireReserved: input.requireReserved,
    requireOnHand: input.requireOnHand,
    effectiveAt: input.effectiveAt,
  });

  const balance = current
    ? await tx.inventoryLotBalance.update({
        where: { lotId_locationId: { lotId, locationId } },
        data: { ...next, available, updatedAt: new Date() },
      })
    : await tx.inventoryLotBalance.create({
        data: { id: ulid(), lotId, locationId, ...next, available, updatedAt: new Date() },
      });

  const ledger = await tx.inventoryLotLedgerEntry.create({
    data: {
      id: ulid(),
      idempotencyKey,
      productId,
      lotId,
      locationId,
      type: input.type,
      direction: input.direction || inferDirection(deltas),
      quantity,
      onHandDelta: deltas.onHand,
      reservedDelta: deltas.reserved,
      damagedDelta: deltas.damaged,
      holdDelta: deltas.hold,
      balanceAfter: { ...next, available },
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      sourceDocumentNo: input.sourceDocumentNo || null,
      unitCost: Number(input.unitCost ?? lot.unitCost ?? 0),
      reason: input.reason,
      createdBy: input.createdBy,
      metadata: input.metadata || {},
    },
  });

  return { idempotent: false, balance, ledger };
}

function inferDirection(deltas: { onHand: number; reserved: number; damaged: number; hold: number }) {
  if (deltas.onHand > 0) return 'in';
  if (deltas.onHand < 0) return 'out';
  if (deltas.reserved > 0) return 'reserve';
  if (deltas.reserved < 0) return 'release';
  if (deltas.damaged > 0) return 'damage';
  if (deltas.damaged < 0) return 'damage_release';
  if (deltas.hold > 0) return 'hold';
  if (deltas.hold < 0) return 'hold_release';
  return 'neutral';
}
