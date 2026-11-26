import { BadRequestException } from '@nestjs/common';
import { ulid } from 'ulid';
import { applyStockPostingTx, lockStockRowTx, wholeDelta } from './stock-posting';

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

  await lockStockRowTx(tx, 'InventoryLotBalance', { lotId, locationId });
  const current = await tx.inventoryLotBalance.findUnique({ where: { lotId_locationId: { lotId, locationId } } }).catch(() => null);
  const before = {
    onHand: Number(current?.onHand || 0),
    reserved: Number(current?.reserved || 0),
    damaged: Number(current?.damaged || 0),
    hold: Number(current?.hold || 0),
    available: Number(current?.available || 0),
  };
  // At a location flagged "exclude from available stock" every free unit is held, so the
  // stored available is 0 at lot, location and product level alike. Moving that stock out
  // (transfer back, write-off) may still use its free quantity.
  const heldLocation = holdsAllFreeStock(location);
  const free = heldLocation ? Math.max(0, before.onHand - before.reserved - before.damaged) : before.available;
  if (input.requireAvailable && quantity > free) throw new BadRequestException('Cannot post more than the available lot quantity');
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
  let excludedLocationHold = 0;
  if (heldLocation) {
    excludedLocationHold = Math.max(0, next.onHand - next.reserved - next.damaged) - next.hold;
    deltas.hold += excludedLocationHold;
    next.hold += excludedLocationHold;
  }
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
    metadata: { lotId, ...input.metadata, ...(excludedLocationHold ? { excludedLocationHold } : {}) },
    // The lot check above already covered a held location; the product's own available is 0 for it.
    requireAvailable: heldLocation ? false : input.requireAvailable,
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
      metadata: { ...(input.metadata || {}), ...(excludedLocationHold ? { excludedLocationHold } : {}) },
      // Business date when the posting carries one, so a period close counts it in its own period.
      effectiveAt: input.effectiveAt ? new Date(input.effectiveAt) : null,
    },
  });

  return { idempotent: false, balance, ledger };
}

/**
 * A location flagged `excludeFromAvailableStock` (other than the in-transit location,
 * whose transfers post their own hold): everything there that is not reserved or
 * damaged is kept on hold, so it never counts as available anywhere.
 */
export function holdsAllFreeStock(location: any) {
  if (!location) return false;
  if (String(location.type || '').toLowerCase() === 'transit') return false;
  if (String(location.code || '').toUpperCase() === 'IN-TRANSIT') return false;
  const metadata = location.metadata && typeof location.metadata === 'object' ? location.metadata : {};
  return metadata.excludeFromAvailableStock === true;
}

/**
 * Bring the holds at one location in line with its flag, lot by lot, through the normal
 * posting (so lot, location and product books move together). Flag on: hold the free
 * stock. Flag off: release the holds the flag put on (quality holds are left alone).
 * Used when a location's flag changes and by scripts/backfill-excluded-location-holds.mjs.
 */
export async function syncExcludedLocationHoldsTx(tx: Tx, locationId: string, actorUserId: string, keyPrefix: string) {
  const location = await tx.stockLocation.findUnique({ where: { id: locationId } });
  if (!location) return [];
  const held = holdsAllFreeStock(location);
  const balances = await tx.inventoryLotBalance.findMany({ where: { locationId }, include: { lot: true } });
  const changes: Array<{ lotId: string; productId: string; holdDelta: number }> = [];
  for (const balance of balances as any[]) {
    let holdDelta = 0;
    if (held) {
      holdDelta = Math.max(0, Number(balance.onHand) - Number(balance.reserved) - Number(balance.damaged) - Number(balance.hold));
    } else {
      const rows = await tx.$queryRaw`
        SELECT COALESCE(SUM((metadata->>'excludedLocationHold')::int), 0)::int AS held
        FROM "InventoryLotLedgerEntry" WHERE "lotId" = ${balance.lotId} AND "locationId" = ${locationId}`;
      const flagHeld = Number((rows as any[])[0]?.held || 0);
      holdDelta = -Math.min(Math.max(0, flagHeld), Number(balance.hold));
    }
    if (!holdDelta || balance.lot?.status !== 'active') continue;
    changes.push({ lotId: balance.lotId, productId: balance.lot.productId, holdDelta });
  }
  if (!changes.length || location.status !== 'active') return changes;
  for (const change of changes) {
    await applyLotStockPostingTx(tx, {
      productId: change.productId,
      lotId: change.lotId,
      locationId,
      idempotencyKey: `${keyPrefix}:${locationId}:${change.lotId}`,
      type: held ? 'excluded_location_hold' : 'excluded_location_release',
      direction: held ? 'hold' : 'hold_release',
      quantity: Math.abs(change.holdDelta),
      // Flag on: the posting's own rule adds the hold (and records it as the flag's hold).
      holdDelta: held ? 0 : change.holdDelta,
      reason: held ? `${location.name} is excluded from available stock` : `${location.name} counts in available stock again`,
      createdBy: actorUserId,
      referenceType: 'StockLocation',
      referenceId: locationId,
      // On release the ledger records it as a negative flag hold so a later switch-on/off sums correctly.
      metadata: held ? {} : { excludedLocationHold: change.holdDelta },
    });
  }
  return changes;
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
