/**
 * Stock test helpers (stock test lane). Small, read-mostly helpers on top of the harness:
 * the stock invariant checked after every stock scenario, lot/location reads, and thin
 * wrappers for the stock actions the harness does not have yet.
 */
import { Harness, World, Session, stamp } from './harness';

export interface StockTotals { onHand: number; reserved: number; damaged: number; hold: number; available: number }

const n = (v: any) => Number(v ?? 0);

/**
 * The stock books agree for one product:
 *  - sum of its lot balances = product balance = sum of its location balances (every bucket);
 *  - product available = on-hand - reserved - damaged - hold;
 *  - nothing negative, reserved+damaged+hold never above on-hand, per lot and in total;
 *  - lot reservations still holding stock add up to the reserved bucket (lot and product).
 * Returns the product totals so a test can assert exact numbers next.
 */
export async function expectStockBooksAgree(h: Harness, productId: string): Promise<StockTotals> {
  const lots = await h.prisma.inventoryLotBalance.findMany({ where: { lot: { productId } } });
  const locs = await h.prisma.stockBalanceByLocation.findMany({ where: { productId } });
  const bal: any = await h.prisma.inventoryBalance.findUnique({ where: { productId } });
  const sum = (rows: any[], k: string) => rows.reduce((t, r) => t + n(r[k]), 0);
  const product = { onHand: n(bal?.onHand), reserved: n(bal?.reserved), damaged: n(bal?.damaged), hold: n(bal?.hold), available: n(bal?.available) };
  const fromLots = { onHand: sum(lots, 'onHand'), reserved: sum(lots, 'reserved'), damaged: sum(lots, 'damaged'), hold: sum(lots, 'hold') };
  const fromLocs = { onHand: sum(locs, 'onHand'), reserved: sum(locs, 'reserved'), damaged: sum(locs, 'damaged'), hold: sum(locs, 'hold') };
  const label = `stock books for product ${productId}`;
  expect({ label, ...fromLots }).toEqual({ label, onHand: product.onHand, reserved: product.reserved, damaged: product.damaged, hold: product.hold });
  expect({ label, ...fromLocs }).toEqual({ label, onHand: product.onHand, reserved: product.reserved, damaged: product.damaged, hold: product.hold });
  expect(product.available).toBe(Math.max(0, product.onHand - product.reserved - product.damaged - product.hold));
  for (const row of [...lots, ...locs, product] as any[]) {
    for (const k of ['onHand', 'reserved', 'damaged', 'hold']) expect(n(row[k])).toBeGreaterThanOrEqual(0);
    expect(n(row.reserved) + n(row.damaged) + n(row.hold)).toBeLessThanOrEqual(n(row.onHand));
  }
  for (const lot of lots as any[]) {
    expect(n(lot.available)).toBe(Math.max(0, n(lot.onHand) - n(lot.reserved) - n(lot.damaged) - n(lot.hold)));
  }
  // Every reserved unit in a lot is held for a named order line, and vice versa.
  const held = await h.prisma.lotReservation.findMany({ where: { lot: { productId }, status: 'reserved' } });
  const heldByLot = new Map<string, number>();
  for (const r of held) heldByLot.set(`${r.lotId}:${r.locationId}`, (heldByLot.get(`${r.lotId}:${r.locationId}`) || 0) + n(r.quantity));
  for (const lot of lots as any[]) {
    expect({ lot: `${lot.lotId}:${lot.locationId}`, reserved: heldByLot.get(`${lot.lotId}:${lot.locationId}`) || 0 })
      .toEqual({ lot: `${lot.lotId}:${lot.locationId}`, reserved: n(lot.reserved) });
  }
  const reservations = await h.prisma.reservation.findMany({ where: { productId, status: 'reserved' } });
  expect(reservations.reduce((t, r) => t + n(r.quantity), 0)).toBe(product.reserved);
  return product;
}

/** Lot balance row(s) of a product at a location. */
export async function lotsAt(h: Harness, productId: string, locationId: string) {
  return h.prisma.inventoryLotBalance.findMany({ where: { lot: { productId }, locationId }, include: { lot: true }, orderBy: { id: 'asc' } });
}

export async function orderLines(h: Harness, salesOrderId: string) {
  return h.prisma.salesOrderLine.findMany({ where: { salesOrderId }, orderBy: { lineNo: 'asc' } });
}

export function cancelOrder(s: Session, id: string, reason = 'Stock test cancel') {
  return s.gql(`mutation($id: ID!, $reason: String!) { cancelSalesOrder(id: $id, reason: $reason) }`, { id, reason });
}

/** Challan with explicit transport (vehicle by default) and optional per pick line quantities. */
export async function challanWith(w: World, salesOrderId: string, o: { pickListId?: string; lines?: any[]; transport?: Record<string, any> } = {}) {
  const job = await w.prisma.dispatchJob.findUnique({ where: { salesOrderId } });
  if (!job) throw new Error('Order has no dispatch job');
  const transport = o.transport ?? { driverName: 'Ramesh Patel', driverPhone: '9876543210', vehicleNo: 'GJ 01 AB 1234' };
  return (await w.s.gql(`mutation($input: CreateChallanInput!) { createChallan(input: $input) { id status } }`, {
    input: { jobId: job.id, salesOrderId, pickListId: o.pickListId, packages: 1, ...(o.lines ? { lines: JSON.stringify(o.lines) } : {}), ...transport },
  })).createChallan as { id: string; status: string };
}

export function challanRaw(w: World, jobId: string, salesOrderId: string, input: Record<string, any>) {
  return w.s.gqlRaw(`mutation($input: CreateChallanInput!) { createChallan(input: $input) { id status } }`, { input: { jobId, salesOrderId, packages: 1, ...input } });
}

export function cancelChallan(s: Session, id: string, reason = 'Customer asked to hold the delivery') {
  return s.gql(`mutation($id: ID!, $reason: String!) { cancelChallan(id: $id, reason: $reason) }`, { id, reason });
}

export function failDelivery(s: Session, id: string, reason = 'Site was locked, nobody to receive') {
  return s.gql(`mutation($id: ID!, $reason: String!) { reportFailedDelivery(id: $id, reason: $reason) }`, { id, reason });
}

export async function transfer(s: Session, o: { from: string; to: string; lotId: string; productId: string; qty: number }, actions = ['approve', 'dispatch']) {
  const t = (await s.gql(`mutation($input: StockTransferInput!) { createStockTransfer(input: $input) }`, {
    input: { sourceLocationId: o.from, destinationLocationId: o.to, submit: true, lines: JSON.stringify([{ lotId: o.lotId, productId: o.productId, quantity: o.qty }]) },
  })).createStockTransfer;
  for (const action of actions) await transitionTransfer(s, t.id, action);
  return t as { id: string };
}

export function transitionTransfer(s: Session, id: string, action: string) {
  return s.gql(`mutation($id: ID!, $action: String!) { transitionStockTransfer(id: $id, action: $action) }`, { id, action });
}

export async function createCount(s: Session, o: { locationId: string; lines: Array<{ productId: string; lotId?: string; countedQuantity: number }>; countType?: string; periodKey?: string }) {
  return (await s.gql(`mutation($input: StockCountInput!) { createStockCountSession(input: $input) }`, {
    input: { locationId: o.locationId, countType: o.countType || 'cycle', periodKey: o.periodKey, submit: true, lines: JSON.stringify(o.lines) },
  })).createStockCountSession;
}

export function approveCount(s: Session, id: string) {
  return s.gqlRaw(`mutation($id: ID!) { approveStockCountSession(id: $id) }`, { id });
}

/** A product sold by the BOX and stocked by the piece (PC), `perBox` pieces in a box. */
export async function createBoxedTile(w: World, perBox: number, rate = 500) {
  const sku = `HT-TILE-${stamp()}`;
  const p = (await w.s.gql(`mutation($input: CreateProductInput!) { createProduct(input: $input) { id sku name } }`, {
    input: {
      sku, internalCode: sku, name: `Harness tile ${sku}`, category: 'Tiles', brand: 'Harness', finish: 'Glossy',
      unit: 'BOX', baseUom: 'PC', purchaseUom: 'BOX', salesUom: 'BOX', piecesPerPack: perBox, allowLoose: true,
      defaultMrpInclusive: Math.round(rate * 1.18), defaultNrpInclusive: rate, floorPriceInclusive: Math.round(rate * 0.8),
      priceRateBasis: 'PIECE', priceUom: 'PC', mrpSource: 'MANUAL', taxClass: 'GST_18',
    },
  })).createProduct as { id: string; sku: string; name: string };
  return { ...p, piecesPerPack: perBox };
}

export function tileLine(w: World, p: { id: string; sku: string; name: string }, boxes: number, rate = 500, area = 'Floor') {
  return { ...w.line({ qty: boxes, productId: p.id, sku: p.sku, name: p.name, rate, area }), category: 'Tiles', finish: 'Glossy', unit: 'BOX', inventoryUom: 'BOX', tileSize: '600x600 mm', rateBasis: 'PIECE', pricingUom: 'PC', mrpRateBasis: 'PIECE', piecesPerPack: (p as any).piecesPerPack };
}

export function sumBy<T>(rows: T[], f: (r: T) => any) { return rows.reduce((t, r) => t + n(f(r)), 0); }
