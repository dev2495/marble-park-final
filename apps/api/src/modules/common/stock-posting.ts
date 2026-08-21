import { BadRequestException } from '@nestjs/common';
import { ulid } from 'ulid';
import { evaluateStockAlertTransitionsTx } from '../inventory/stock-alerts';

type Tx = any;

export interface StockPostingInput {
  productId: string;
  type: string;
  reason: string;
  createdBy: string;
  quantity: number;
  onHandDelta?: number;
  reservedDelta?: number;
  damagedDelta?: number;
  holdDelta?: number;
  locationId?: string | null;
  locationOnHandDelta?: number;
  locationReservedDelta?: number;
  locationDamagedDelta?: number;
  locationHoldDelta?: number;
  movementType?: string;
  movementQuantity?: number;
  ledgerType?: string;
  direction?: string;
  referenceType?: string | null;
  referenceId?: string | null;
  sourceDocumentNo?: string | null;
  lotId?: string | null;
  idempotencyKey?: string | null;
  relatedQuoteId?: string | null;
  relatedChallanId?: string | null;
  unitCost?: number;
  metadata?: Record<string, unknown>;
  requireAvailable?: boolean;
  requireReserved?: boolean;
  requireOnHand?: boolean;
  skipMovement?: boolean;
  skipLedger?: boolean;
  effectiveAt?: Date | string;
}

export function wholeDelta(value: unknown) {
  const parsed = Math.trunc(Number(value || 0));
  if (!Number.isFinite(parsed)) throw new BadRequestException('Stock quantity must be a whole number');
  return parsed;
}

export async function ensureDefaultStockLocationTx(tx: Tx) {
  const locations = await tx.stockLocation.findMany({
    where: { status: 'active' },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  }).catch(() => []);
  const flagged = locations.find((location: any) => location.metadata?.defaultStockScope);
  if (flagged) return flagged;
  const activePlant = locations.find((location: any) => location.type === 'plant');
  if (activePlant) return activePlant;
  const existing = locations.find((location: any) => location.code === 'MAIN') || await tx.stockLocation.findFirst({ where: { code: 'MAIN' } }).catch(() => null);
  if (existing) return existing;
  return tx.stockLocation.create({
    data: {
      id: ulid(),
      code: 'MAIN',
      name: 'Main Plant / Godown',
      type: 'plant',
      status: 'active',
      sortOrder: 1,
      metadata: { defaultStockScope: true },
      updatedAt: new Date(),
    },
  });
}

export async function resolveStockLocationTx(tx: Tx, locationId?: string | null) {
  if (!locationId) return ensureDefaultStockLocationTx(tx);
  const location = await tx.stockLocation.findUnique({ where: { id: locationId } }).catch(() => null);
  if (!location) throw new BadRequestException('Selected plant / stock location was not found');
  if (location.status !== 'active') throw new BadRequestException('Selected plant / stock location is inactive');
  return location;
}

export async function applyStockPostingTx(tx: Tx, input: StockPostingInput) {
  const productId = String(input.productId || '').trim();
  if (!productId) throw new BadRequestException('Product Master SKU is required for stock posting');
  const quantity = Math.abs(wholeDelta(input.quantity));
  if (quantity <= 0) throw new BadRequestException('Stock posting quantity must be greater than zero');
  const unitCost = Number(input.unitCost ?? 0);
  if (!Number.isFinite(unitCost) || unitCost < 0) {
    throw new BadRequestException('Stock posting unit cost must be zero or greater');
  }

  if (input.idempotencyKey) {
    const existingPosting = await tx.stockLedgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } }).catch(() => null);
    if (existingPosting) {
      if (existingPosting.productId !== productId) throw new BadRequestException('Stock idempotency key belongs to another product');
      return tx.inventoryBalance.findUnique({ where: { productId } });
    }
  }

  const effectiveAt = normalizeEffectiveAt(input.effectiveAt);
  await assertInventoryPeriodOpenTx(tx, effectiveAt);

  const onHandDelta = wholeDelta(input.onHandDelta);
  const reservedDelta = wholeDelta(input.reservedDelta);
  const damagedDelta = wholeDelta(input.damagedDelta);
  const holdDelta = wholeDelta(input.holdDelta);
  const hasLocationDelta = input.locationOnHandDelta !== undefined
    || input.locationReservedDelta !== undefined
    || input.locationDamagedDelta !== undefined
    || input.locationHoldDelta !== undefined;
  const location = hasLocationDelta || !input.skipLedger ? await resolveStockLocationTx(tx, input.locationId) : null;

  const current = await tx.inventoryBalance.findUnique({ where: { productId } }).catch(() => null);
  if (!current && (onHandDelta < 0 || reservedDelta < 0 || damagedDelta < 0 || holdDelta < 0)) {
    throw new BadRequestException('Cannot reduce stock for a SKU without an inventory balance');
  }

  const before = {
    onHand: Number(current?.onHand || 0),
    reserved: Number(current?.reserved || 0),
    damaged: Number(current?.damaged || 0),
    hold: Number(current?.hold || 0),
    available: Number(current?.available || 0),
  };

  if (input.requireAvailable && quantity > before.available) throw new BadRequestException('Cannot post more than available stock');
  if (input.requireReserved && quantity > before.reserved) throw new BadRequestException('Cannot post more than reserved stock');
  if (input.requireOnHand && quantity > before.onHand) throw new BadRequestException('Cannot post more than on-hand stock');

  const next = {
    onHand: before.onHand + onHandDelta,
    reserved: before.reserved + reservedDelta,
    damaged: before.damaged + damagedDelta,
    hold: before.hold + holdDelta,
  };
  if (next.onHand < 0 || next.reserved < 0 || next.damaged < 0 || next.hold < 0) {
    throw new BadRequestException('Stock posting would create a negative stock bucket');
  }
  if (next.reserved + next.damaged + next.hold > next.onHand) {
    throw new BadRequestException('Reserved, damaged and held stock cannot exceed on-hand stock');
  }
  const nextAvailable = Math.max(0, next.onHand - next.reserved - next.damaged - next.hold);

  const balance = current
    ? await tx.inventoryBalance.update({
        where: { productId },
        data: { ...next, available: nextAvailable, updatedAt: new Date() },
      })
    : await tx.inventoryBalance.create({
        data: {
          id: ulid(),
          productId,
          ...next,
          available: nextAvailable,
          updatedAt: new Date(),
        },
      });

  // Stock alert transitions (warning / critical) — best-effort inside the same tx.
  try {
    await evaluateStockAlertTransitionsTx(tx, {
      productId,
      previousAvailable: before.available,
      nextAvailable,
      balance: current || balance,
    });
  } catch {
    // Never block stock posting on notification failures.
  }

  if (location && hasLocationDelta) {
    await applyLocationBucketDeltaTx(tx, {
      productId,
      locationId: location.id,
      initial: before,
      onHandDelta: wholeDelta(input.locationOnHandDelta),
      reservedDelta: wholeDelta(input.locationReservedDelta),
      damagedDelta: wholeDelta(input.locationDamagedDelta),
      holdDelta: wholeDelta(input.locationHoldDelta),
    });
  }

  if (!input.skipMovement) {
    await tx.inventoryMovement.create({
      data: {
        id: ulid(),
        productId,
        type: input.movementType || input.type,
        quantity: input.movementQuantity ?? quantity,
        reason: input.reason,
        relatedQuoteId: input.relatedQuoteId || null,
        relatedChallanId: input.relatedChallanId || null,
        createdBy: input.createdBy || 'system',
      },
    });
  }

  if (!input.skipLedger) {
    await tx.stockLedgerEntry.create({
      data: {
        id: ulid(),
        productId,
        locationId: location?.id || null,
        lotId: input.lotId || null,
        idempotencyKey: input.idempotencyKey || null,
        type: input.ledgerType || input.type,
        quantity,
        direction: input.direction || inferLedgerDirection(onHandDelta, reservedDelta, damagedDelta, holdDelta),
        referenceType: input.referenceType || null,
        referenceId: input.referenceId || null,
        sourceDocumentNo: input.sourceDocumentNo || null,
        unitCost,
        reason: input.reason,
        createdBy: input.createdBy || 'system',
        metadata: {
          before,
          after: { ...next, available: nextAvailable },
          effectiveAt: effectiveAt.toISOString(),
          ...(input.metadata || {}),
        },
      },
    });
  }

  return balance;
}

export async function assertInventoryPeriodOpenTx(tx: Tx, effectiveAt: Date | string = new Date()) {
  const date = normalizeEffectiveAt(effectiveAt);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || '';
  const year = Number(value('year'));
  const month = Number(value('month'));
  const monthlyKey = `${year}-${String(month).padStart(2, '0')}`;
  const fiscalStart = month >= 4 ? year : year - 1;
  const fiscalEnd = fiscalStart + 1;
  const yearEndKeys = [
    `${fiscalStart}-${String(fiscalEnd).slice(-2)}`,
    `${fiscalStart}-${fiscalEnd}`,
    `FY${fiscalStart}-${String(fiscalEnd).slice(-2)}`,
  ];
  const closed = await tx.inventoryPeriodClose.findFirst({
    where: {
      status: 'closed',
      OR: [
        { periodType: 'monthly', periodKey: monthlyKey },
        { periodType: 'year_end', periodKey: { in: yearEndKeys } },
      ],
    },
    select: { closeNumber: true, periodKey: true },
  }).catch(() => null);
  if (closed) throw new BadRequestException(`Inventory period ${closed.periodKey} is closed (${closed.closeNumber}); stock posting is locked`);
}

function normalizeEffectiveAt(value?: Date | string) {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) throw new BadRequestException('Stock posting effective date is invalid');
  return date;
}

async function applyLocationBucketDeltaTx(
  tx: Tx,
  args: {
    productId: string;
    locationId: string;
    initial: { onHand: number; reserved: number; damaged: number; hold: number };
    onHandDelta: number;
    reservedDelta: number;
    damagedDelta: number;
    holdDelta: number;
  },
) {
  const existing = await tx.stockBalanceByLocation.findUnique({
    where: { productId_locationId: { productId: args.productId, locationId: args.locationId } },
  }).catch(() => null);

  let base = existing;
  if (!base) {
    const locationRowCount = await tx.stockBalanceByLocation.count({ where: { productId: args.productId } }).catch(() => 0);
    // Legacy SKUs may have aggregate balance but no location row yet. Seed the
    // first location from aggregate only in that migration case; otherwise new
    // location buckets start at zero to avoid duplicating stock across plants.
    base = locationRowCount > 0
      ? { onHand: 0, reserved: 0, damaged: 0, hold: 0 }
      : {
          onHand: args.initial.onHand,
          reserved: args.initial.reserved,
          damaged: args.initial.damaged,
          hold: args.initial.hold,
        };
  }
  const next = {
    onHand: Number(base.onHand || 0) + args.onHandDelta,
    reserved: Number(base.reserved || 0) + args.reservedDelta,
    damaged: Number(base.damaged || 0) + args.damagedDelta,
    hold: Number(base.hold || 0) + args.holdDelta,
  };
  if (next.onHand < 0 || next.reserved < 0 || next.damaged < 0 || next.hold < 0) {
    throw new BadRequestException('Location stock posting would create a negative stock bucket');
  }
  if (next.reserved + next.damaged + next.hold > next.onHand) {
    throw new BadRequestException('Location reserved, damaged and held stock cannot exceed location on-hand stock');
  }
  if (existing) {
    return tx.stockBalanceByLocation.update({
      where: { productId_locationId: { productId: args.productId, locationId: args.locationId } },
      data: { ...next, updatedAt: new Date() },
    });
  }
  return tx.stockBalanceByLocation.create({
    data: {
      id: ulid(),
      productId: args.productId,
      locationId: args.locationId,
      ...next,
      updatedAt: new Date(),
    },
  });
}

function inferLedgerDirection(onHandDelta: number, reservedDelta: number, damagedDelta: number, holdDelta: number) {
  if (onHandDelta > 0) return 'in';
  if (onHandDelta < 0) return 'out';
  if (reservedDelta > 0) return 'reserve';
  if (reservedDelta < 0) return 'release';
  if (damagedDelta > 0) return 'damage';
  if (damagedDelta < 0) return 'damage_release';
  if (holdDelta > 0) return 'hold';
  if (holdDelta < 0) return 'hold_release';
  return 'neutral';
}

export function normalizeJsonLines(value: any): any[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function isTileSelectionLine(line: any) {
  return line?.type === 'tile' || line?.nonStock === true || String(line?.category || '').toLowerCase() === 'tiles';
}

export function quoteLineKey(line: any, index: number) {
  const productId = String(line?.productId || '').trim();
  const tileCode = String(line?.tileCode || line?.sku || '').trim();
  const area = String(line?.area || line?.room || line?.section || '').trim();
  return productId ? `product:${productId}:${area || index}` : `tile:${tileCode || index}:${area || index}`;
}

export function tileDemandKey(orderId: string, line: any, index: number) {
  return `tile:${orderId}:${String(line?.tileCode || line?.sku || index).trim()}:${index}`;
}

export async function syncSalesOrderLinesForQuoteTx(tx: Tx, quoteId: string) {
  const [quote, salesOrders, reservations, quoteLines] = await Promise.all([
    tx.quote.findUnique({ where: { id: quoteId } }).catch(() => null),
    tx.salesOrder.findMany({ where: { quoteId } }).catch(() => []),
    tx.reservation.findMany({ where: { quoteId } }).catch(() => []),
    tx.quoteLine.findMany({ where: { quoteId } }).catch(() => []),
  ]);
  if (!quote || !salesOrders.length) return;

  const quoteLineMap = new Map((quoteLines as any[]).map((row) => [row.lineKey, row]));
  const quoteLineById = new Map((quoteLines as any[]).map((row) => [row.id, row]));
  for (const salesOrder of salesOrders as any[]) {
    const linkedReservations = (reservations as any[]).filter((reservation) => reservation.salesOrderId === salesOrder.id);
    const legacyReservations = linkedReservations.length || salesOrders.length !== 1
      ? linkedReservations
      : (reservations as any[]).filter((reservation) => !reservation.salesOrderId);
    const reservedByProduct = bucketReservationQty(legacyReservations, 'reserved');
    const backorderedByProduct = bucketReservationQty(legacyReservations, 'backordered');
    const lines = normalizeJsonLines(salesOrder.lines || quote.lines);

    for (const [index, line] of lines.entries()) {
      const productId = String(line.productId || '').trim();
      const qKey = String(line.lineKey || quoteLineKey(line, index));
      const quoteLine = quoteLineById.get(String(line.quoteLineId || '')) || quoteLineMap.get(qKey);
      const key = qKey || (productId ? quoteLineKey(line, index) : tileDemandKey(salesOrder.id, line, index));
      const orderedQuantity = Math.trunc(Number(line.qty || line.quantity || 0));
      const mrpInclusive = line.mrpInclusive == null ? null : Number(line.mrpInclusive);
      const nrpInclusive = line.nrpInclusive == null ? null : Number(line.nrpInclusive);
      const specialRateInclusive = line.specialRateInclusive == null ? null : Number(line.specialRateInclusive);
      const unitPrice = Number(line.specialRateExclusive ?? line.specialRateInclusive ?? 0);
      const taxRate = Number(line.taxRate ?? 18);
      const taxableValue = Number(line.taxableValue ?? orderedQuantity * unitPrice);
      const taxAmount = Number(line.taxAmount ?? 0);
      const grossLineTotal = Number(line.grossLineTotal ?? line.total ?? taxableValue + taxAmount);
      const existing = await tx.salesOrderLine.findUnique({
        where: { salesOrderId_lineKey: { salesOrderId: salesOrder.id, lineKey: key } },
      }).catch(() => null);

      const reservedQuantity = productId ? takeFromBucket(reservedByProduct, productId, orderedQuantity) : Number(existing?.reservedQuantity || 0);
      const backorderedQuantity = productId ? takeFromBucket(backorderedByProduct, productId, Math.max(0, orderedQuantity - reservedQuantity)) : Number(existing?.backorderedQuantity ?? orderedQuantity);
      const allocatedQuantity = Number(existing?.allocatedQuantity || 0);
      const dispatchedQuantity = Number(existing?.dispatchedQuantity || 0);
      const deliveredQuantity = Number(existing?.deliveredQuantity || 0);
      const returnedQuantity = Number(existing?.returnedQuantity || 0);
      const status = deriveSalesOrderLineStatus({ orderedQuantity, reservedQuantity, backorderedQuantity, allocatedQuantity, dispatchedQuantity, deliveredQuantity });
      const payload = {
        quoteLineId: quoteLine?.id || line.quoteLineId || null,
        lineNo: index + 1,
        productId: productId || null,
        sku: String(line.sku || line.tileCode || productId || `LINE-${index + 1}`),
        name: String(line.name || line.description || line.sku || `Line ${index + 1}`),
        category: String(line.category || (isTileSelectionLine(line) ? 'Tiles' : 'Product')),
        brand: String(line.brand || ''),
        finish: line.finish || line.tileSize || line.dimensions || null,
        area: line.area || line.room || line.section || null,
        unit: String(line.unit || line.uom || 'PC').toUpperCase(),
        orderedQuantity, reservedQuantity, backorderedQuantity, allocatedQuantity, dispatchedQuantity, deliveredQuantity, returnedQuantity,
        listPrice: 0, unitPrice, discountPercent: 0, taxRate, taxableValue, taxAmount, grossLineTotal,
        mrp: mrpInclusive,
        mrpRateBasis: line.priceRateBasis || line.mrpRateBasis || line.rateBasis || null,
        mrpSource: line.mrpSource || 'quote_entry',
        mrpConfirmedAt: line.mrpConfirmedAt ? new Date(line.mrpConfirmedAt) : quoteLine?.mrpConfirmedAt || null,
        mrpConfirmedById: line.mrpConfirmedById || quoteLine?.mrpConfirmedById || null,
        pricingVersion: line.pricingVersion || 'unified_retail_v1',
        priceRateBasis: line.priceRateBasis || line.mrpRateBasis || line.rateBasis || null,
        mrpInclusive,
        nrpMode: line.nrpMode || null,
        nrpInput: line.nrpInput == null ? null : Number(line.nrpInput),
        nrpInclusive,
        nrpExclusive: line.nrpExclusive == null ? null : Number(line.nrpExclusive),
        specialMode: line.specialMode || 'NONE',
        specialInput: line.specialInput == null ? null : Number(line.specialInput),
        specialRateInclusive,
        specialRateExclusive: line.specialRateExclusive == null ? null : Number(line.specialRateExclusive),
        quoteDiscountMode: line.quoteDiscountMode || 'PERCENT',
        quoteDiscountValue: Number(line.quoteDiscountValue || 0),
        quoteDiscountAllocatedInclusive: Number(line.quoteDiscountAllocatedInclusive || 0),
        taxableValueInclusive: taxableValue,
        taxAmountInclusive: taxAmount,
        grossLineTotalInclusive: grossLineTotal,
        costSnapshot: null,
        costSnapshotSource: null,
        costSnapshotAt: null,
        lineTotal: grossLineTotal,
        status,
        isTileSpecial: isTileSelectionLine(line) && !productId,
        metadata: { ...(existing?.metadata || {}), snapshot: line },
        updatedAt: new Date(),
      };
      await tx.salesOrderLine.upsert({
        where: { salesOrderId_lineKey: { salesOrderId: salesOrder.id, lineKey: key } },
        update: payload,
        create: { id: ulid(), salesOrderId: salesOrder.id, quoteId, lineKey: key, createdAt: new Date(), ...payload },
      });
    }
  }
}

function bucketReservationQty(reservations: any[], status: string) {
  const bucket = new Map<string, number>();
  for (const reservation of reservations || []) {
    if (reservation.status !== status) continue;
    const productId = String(reservation.productId || '').trim();
    if (!productId) continue;
    bucket.set(productId, (bucket.get(productId) || 0) + Number(reservation.quantity || 0));
  }
  return bucket;
}

function takeFromBucket(bucket: Map<string, number>, productId: string, requested: number) {
  const available = Math.max(0, Number(bucket.get(productId) || 0));
  const taken = Math.min(Math.max(0, requested), available);
  bucket.set(productId, Math.max(0, available - taken));
  return taken;
}

function deriveSalesOrderLineStatus(row: {
  orderedQuantity: number;
  reservedQuantity: number;
  backorderedQuantity: number;
  allocatedQuantity: number;
  dispatchedQuantity: number;
  deliveredQuantity: number;
}) {
  if (row.deliveredQuantity >= row.orderedQuantity) return 'delivered';
  if (row.dispatchedQuantity >= row.orderedQuantity) return 'dispatched';
  if (row.dispatchedQuantity > 0) return 'partial_dispatched';
  const ready = row.reservedQuantity + row.allocatedQuantity;
  if (ready > 0 && row.backorderedQuantity > 0) return 'partial_ready';
  if (row.backorderedQuantity > 0) return 'pending_inward';
  if (ready >= row.orderedQuantity) return 'ready';
  return 'open';
}
