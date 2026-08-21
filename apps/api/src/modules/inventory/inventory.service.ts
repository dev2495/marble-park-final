import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ulid } from 'ulid';
import { applyStockPostingTx, syncSalesOrderLinesForQuoteTx } from '../common/stock-posting';
import { Prisma } from '@prisma/client';
import { computeStockAlertState, evaluateStockAlertTransitionsTx, isAlertingState, normalizeThreshold } from './stock-alerts';
import { inventoryTruthByProduct, zeroInventoryTruth } from '../common/inventory-truth';

export interface CreateInventoryInput {
  productId: string;
  onHand?: number;
}

export interface UpdateInventoryInput {
  onHand?: number;
  reserved?: number;
  damaged?: number;
  lowStockThreshold?: number;
  criticalStockThreshold?: number | null;
  reorderPoint?: number | null;
}

export interface StockAlertPolicyRowInput {
  balanceId: string;
  lowStockThreshold?: number;
  criticalStockThreshold?: number | null;
}

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  async findAll(args?: { productId?: string; search?: string; take?: number }): Promise<any[]> {
    const where: any = {};
    if (args?.productId) where.productId = args.productId;
    if (args?.search) {
      where.product = {
        OR: [
          { name: { contains: args.search, mode: 'insensitive' } },
          { sku: { contains: args.search, mode: 'insensitive' } },
          { brand: { contains: args.search, mode: 'insensitive' } },
        ],
      };
    }
    
    const rows = await this.prisma.inventoryBalance.findMany({
      where,
      include: { product: true },
      orderBy: { updatedAt: 'desc' },
      take: args?.take || 150,
    } as any) as any[];
    return this.withInventoryTruth(rows);
  }

  async controlTower(args?: {
    search?: string;
    category?: string;
    brand?: string;
    stockState?: string;
    locationId?: string;
    lotState?: string;
    sort?: string;
    cursor?: string;
    take?: number;
  }) {
    const limit = Math.max(1, Math.min(100, Math.trunc(Number(args?.take || 30))));
    const productWhere: any = {};
    const search = String(args?.search || '').trim();
    if (search) {
      productWhere.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { internalCode: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (args?.category) productWhere.category = { equals: args.category, mode: 'insensitive' };
    if (args?.brand) productWhere.brand = { equals: args.brand, mode: 'insensitive' };
    const stockState = String(args?.stockState || '').trim().toLowerCase();
    const locationBalanceWhere: any = args?.locationId ? { locationId: args.locationId, onHand: { gt: 0 } } : null;
    if (args?.locationId && stockState === 'out_of_stock') locationBalanceWhere.available = 0;
    else if (args?.locationId && stockState === 'reserved') locationBalanceWhere.reserved = { gt: 0 };
    else if (args?.locationId && stockState === 'available') locationBalanceWhere.available = { gt: 0 };
    if (args?.locationId && args?.lotState === 'hold') locationBalanceWhere.hold = { gt: 0 };
    else if (args?.locationId && args?.lotState === 'damaged') locationBalanceWhere.damaged = { gt: 0 };
    if (locationBalanceWhere) productWhere.inventoryLots = { some: { status: 'active', balances: { some: locationBalanceWhere } } };
    const where: any = Object.keys(productWhere).length ? { product: productWhere } : {};
    if (stockState || args?.lotState) {
      const truthIds = await this.prisma.$queryRaw<any[]>(Prisma.sql`
        WITH truth AS (
          SELECT policy."id",
            COALESCE(SUM(lb."available"), 0)::double precision AS "available",
            COALESCE(SUM(lb."reserved"), 0)::double precision AS "reserved",
            COALESCE(SUM(lb."hold"), 0)::double precision AS "hold",
            COALESCE(SUM(lb."damaged"), 0)::double precision AS "damaged",
            COALESCE(SUM(CASE WHEN lot."unitCost" <= 0 THEN lb."onHand" ELSE 0 END), 0)::double precision AS "missingCostQuantity",
            MAX(product."defaultNrpInclusive")::double precision AS "defaultNrpInclusive",
            policy."lowStockThreshold", policy."criticalStockThreshold"
          FROM "InventoryBalance" policy
          INNER JOIN "Product" product ON product."id" = policy."productId"
          LEFT JOIN "InventoryLot" lot ON lot."productId" = policy."productId" AND lot."status" = 'active'
          LEFT JOIN "InventoryLotBalance" lb ON lb."lotId" = lot."id"
            AND (${args?.locationId || null}::text IS NULL OR lb."locationId" = ${args?.locationId || null})
          GROUP BY policy."id", policy."lowStockThreshold", policy."criticalStockThreshold"
        )
        SELECT "id" FROM truth WHERE
          (${stockState || null}::text IS NULL OR
            (${stockState} = 'out_of_stock' AND "available" = 0) OR
            (${stockState} = 'reserved' AND "reserved" > 0) OR
            (${stockState} = 'available' AND "available" > 0) OR
            (${stockState} = 'data_exception' AND ("missingCostQuantity" > 0 OR COALESCE("defaultNrpInclusive", 0) <= 0)) OR
            (${stockState} IN ('low_stock', 'critical') AND COALESCE("criticalStockThreshold", 0) > 0 AND "available" <= COALESCE("criticalStockThreshold", 0)) OR
            (${stockState} IN ('low_stock', 'warning') AND "lowStockThreshold" > 0 AND "available" <= "lowStockThreshold"
              AND NOT (COALESCE("criticalStockThreshold", 0) > 0 AND "available" <= COALESCE("criticalStockThreshold", 0))))
          AND (${args?.lotState || null}::text IS NULL OR (${args?.lotState} = 'hold' AND "hold" > 0) OR (${args?.lotState} = 'damaged' AND "damaged" > 0))
      `);
      where.id = { in: truthIds.map((row: any) => row.id) };
      if (!truthIds.length) return { items: [], nextCursor: null, total: 0, summary: await this.getFilteredStockSummary({ search, category: args?.category, brand: args?.brand, stockState, locationId: args?.locationId, lotState: args?.lotState }) };
    }
    const sortMap: Record<string, any[]> = {
      available_asc: [{ available: 'asc' }, { id: 'asc' }],
      available_desc: [{ available: 'desc' }, { id: 'asc' }],
      value_desc: [{ onHand: 'desc' }, { id: 'asc' }],
      updated_asc: [{ updatedAt: 'asc' }, { id: 'asc' }],
    };
    const query: any = {
      where,
      include: { product: true },
      orderBy: sortMap[String(args?.sort || '')] || [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    };
    const cursor = String(args?.cursor || '').trim();
    if (cursor) {
      query.cursor = { id: cursor };
      query.skip = 1;
    }
    const rows = await this.prisma.inventoryBalance.findMany(query) as any[];
    const hasNextPage = rows.length > limit;
    const page = hasNextPage ? rows.slice(0, limit) : rows;
    const productIds = page.map((row) => row.productId);
    const lots = productIds.length ? await this.prisma.inventoryLot.findMany({
      where: {
        productId: { in: productIds },
        status: 'active',
        ...(args?.locationId ? { balances: { some: { locationId: args.locationId, onHand: { gt: 0 } } } } : {}),
      },
      include: { balances: { include: { location: true }, orderBy: [{ locationId: 'asc' }] } },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
      take: Math.min(500, Math.max(50, page.length * 10)),
    } as any) : [];
    const lotsByProduct = new Map<string, any[]>();
    for (const lot of lots as any[]) lotsByProduct.set(lot.productId, [...(lotsByProduct.get(lot.productId) || []), lot]);
    const locationTotals = productIds.length
      ? await this.prisma.$queryRaw<any[]>(Prisma.sql`
          SELECT lot."productId",
            COALESCE(SUM(lb."onHand"), 0)::double precision AS "onHand",
            COALESCE(SUM(lb."available"), 0)::double precision AS "available",
            COALESCE(SUM(lb."reserved"), 0)::double precision AS "reserved",
            COALESCE(SUM(lb."hold"), 0)::double precision AS "hold",
            COALESCE(SUM(lb."damaged"), 0)::double precision AS "damaged",
            COALESCE(SUM(lb."onHand" * lot."unitCost"), 0)::double precision AS "onHandValue",
            COALESCE(SUM(lb."available" * lot."unitCost"), 0)::double precision AS "availableValue",
            COALESCE(SUM(CASE WHEN lot."unitCost" <= 0 THEN lb."onHand" ELSE 0 END), 0)::double precision AS "missingCostQuantity"
          FROM "InventoryLotBalance" lb INNER JOIN "InventoryLot" lot ON lot."id" = lb."lotId"
          WHERE (${args?.locationId || null}::text IS NULL OR lb."locationId" = ${args?.locationId || null})
            AND lot."status" = 'active' AND lot."productId" IN (${Prisma.join(productIds)})
          GROUP BY lot."productId"
        `)
      : [];
    const locationTotalByProduct = new Map(locationTotals.map((row: any) => [row.productId, row]));
    return {
      items: page.map((row) => {
        const scoped = locationTotalByProduct.get(row.productId) || { onHand: 0, available: 0, reserved: 0, hold: 0, damaged: 0, onHandValue: 0, availableValue: 0, missingCostQuantity: 0 };
        const onHand = Number(scoped.onHand || 0);
        const available = Number(scoped.available || 0);
        const reserved = Number(scoped.reserved || 0);
        const alertState = computeStockAlertState(available, row.lowStockThreshold, row.criticalStockThreshold);
        return ({
        ...row, onHand, available, reserved, hold: Number(scoped.hold || 0), damaged: Number(scoped.damaged || 0),
        alertState,
        stockState: available === 0 ? 'out_of_stock' : isAlertingState(alertState) ? 'low_stock' : reserved > 0 ? 'reserved' : 'available',
        onHandValue: Number(scoped.onHandValue || 0),
        availableValue: Number(scoped.availableValue || 0),
        retailValue: available * Number(row.product?.defaultNrpInclusive || 0),
        completenessCodes: [Number(row.product?.defaultNrpInclusive || 0) <= 0 ? 'DEFAULT_NRP_MISSING' : null, Number(scoped.missingCostQuantity || 0) > 0 ? 'LOT_COST_MISSING' : null].filter(Boolean),
        lots: (lotsByProduct.get(row.productId) || []).slice(0, 10).map((lot: any) => ({
          id: lot.id, lotNumber: lot.lotNumber, sourceType: lot.sourceType, sourceId: lot.sourceId,
          qualityStatus: lot.qualityStatus, receivedAt: lot.receivedAt, unitCost: Number(lot.unitCost || 0),
          locations: (lot.balances || []).filter((balance: any) => !args?.locationId || balance.locationId === args.locationId).map((balance: any) => ({
            id: balance.id, locationId: balance.locationId, locationCode: balance.location?.code, locationName: balance.location?.name,
            onHand: balance.onHand, available: balance.available, reserved: balance.reserved, hold: balance.hold, damaged: balance.damaged,
          })),
        })),
      }); }),
      nextCursor: hasNextPage ? page[page.length - 1].id : null,
      total: await this.prisma.inventoryBalance.count({ where }),
      summary: await this.getFilteredStockSummary({ search, category: args?.category, brand: args?.brand, stockState, locationId: args?.locationId, lotState: args?.lotState }),
    };
  }

  private async getFilteredStockSummary(args: { search?: string; category?: string; brand?: string; stockState?: string; locationId?: string; lotState?: string }) {
    const conditions: Prisma.Sql[] = [];
    if (args.search) {
      const pattern = `%${args.search}%`;
      conditions.push(Prisma.sql`(p."name" ILIKE ${pattern} OR p."sku" ILIKE ${pattern} OR p."internalCode" ILIKE ${pattern} OR p."brand" ILIKE ${pattern})`);
    }
    if (args.category) conditions.push(Prisma.sql`LOWER(p."category") = LOWER(${args.category})`);
    if (args.brand) conditions.push(Prisma.sql`LOWER(p."brand") = LOWER(${args.brand})`);
    if (args.locationId) conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "InventoryLot" lot INNER JOIN "InventoryLotBalance" lb ON lb."lotId" = lot."id"
      WHERE lot."productId" = p."id" AND lb."locationId" = ${args.locationId} AND lb."onHand" > 0
    )`);
    if (args.stockState === 'out_of_stock') conditions.push(Prisma.sql`b."available" = 0`);
    else if (args.stockState === 'reserved') conditions.push(Prisma.sql`b."reserved" > 0`);
    else if (args.stockState === 'available') conditions.push(Prisma.sql`b."available" > 0`);
    else if (args.stockState === 'low_stock') conditions.push(Prisma.sql`(
      (COALESCE(b."criticalStockThreshold", 0) > 0 AND b."available" <= COALESCE(b."criticalStockThreshold", 0))
      OR (b."lowStockThreshold" > 0 AND b."available" <= b."lowStockThreshold")
    )`);
    else if (args.stockState === 'warning') conditions.push(Prisma.sql`b."lowStockThreshold" > 0 AND b."available" <= b."lowStockThreshold"
      AND NOT (COALESCE(b."criticalStockThreshold", 0) > 0 AND b."available" <= COALESCE(b."criticalStockThreshold", 0))`);
    else if (args.stockState === 'critical') conditions.push(Prisma.sql`COALESCE(b."criticalStockThreshold", 0) > 0 AND b."available" <= COALESCE(b."criticalStockThreshold", 0)`);
    else if (args.stockState === 'data_exception') conditions.push(Prisma.sql`(b."missingCostQuantity" > 0 OR COALESCE(p."defaultNrpInclusive", 0) <= 0)`);
    if (args.lotState === 'hold') conditions.push(Prisma.sql`b."hold" > 0`);
    else if (args.lotState === 'damaged') conditions.push(Prisma.sql`b."damaged" > 0`);
    const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
    const source = Prisma.sql`FROM (
          SELECT policy."productId",
            COALESCE(SUM(lb."onHand"), 0)::double precision AS "onHand",
            COALESCE(SUM(lb."available"), 0)::double precision AS "available",
            COALESCE(SUM(lb."reserved"), 0)::double precision AS "reserved",
            COALESCE(SUM(lb."hold"), 0)::double precision AS "hold",
            COALESCE(SUM(lb."damaged"), 0)::double precision AS "damaged",
            COALESCE(SUM(lb."onHand" * lot."unitCost"), 0)::double precision AS "onHandValue",
            COALESCE(SUM(CASE WHEN lot."unitCost" <= 0 THEN lb."onHand" ELSE 0 END), 0)::double precision AS "missingCostQuantity",
            MAX(policy."lowStockThreshold") AS "lowStockThreshold",
            MAX(policy."criticalStockThreshold") AS "criticalStockThreshold",
            MAX(policy."reorderPoint") AS "reorderPoint"
          FROM "InventoryBalance" policy
          LEFT JOIN "InventoryLot" lot ON lot."productId" = policy."productId" AND lot."status" = 'active'
          LEFT JOIN "InventoryLotBalance" lb ON lb."lotId" = lot."id"
            AND (${args.locationId || null}::text IS NULL OR lb."locationId" = ${args.locationId || null})
          GROUP BY policy."productId"
        ) b INNER JOIN "Product" p ON p."id" = b."productId"`;
    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        COUNT(*)::int AS "productCount",
        COALESCE(SUM(b."onHand"), 0)::double precision AS "total",
        COALESCE(SUM(b."available"), 0)::double precision AS "available",
        COALESCE(SUM(b."reserved"), 0)::double precision AS "reserved",
        COALESCE(SUM(b."hold"), 0)::double precision AS "hold",
        COALESCE(SUM(b."damaged"), 0)::double precision AS "damaged",
        COUNT(*) FILTER (WHERE
          (COALESCE(b."criticalStockThreshold", 0) > 0 AND b."available" <= COALESCE(b."criticalStockThreshold", 0))
          OR (b."lowStockThreshold" > 0 AND b."available" <= b."lowStockThreshold")
        )::int AS "lowStock",
        COUNT(*) FILTER (WHERE COALESCE(b."criticalStockThreshold", 0) > 0 AND b."available" <= COALESCE(b."criticalStockThreshold", 0))::int AS "criticalStock",
        COUNT(*) FILTER (WHERE b."lowStockThreshold" > 0 AND b."available" <= b."lowStockThreshold"
          AND NOT (COALESCE(b."criticalStockThreshold", 0) > 0 AND b."available" <= COALESCE(b."criticalStockThreshold", 0)))::int AS "warningStock",
        COUNT(*) FILTER (WHERE b."available" = 0)::int AS "outOfStock",
        COALESCE(SUM(b."onHandValue"), 0)::double precision AS "onHandValue",
        COALESCE(SUM(b."available" * COALESCE(p."defaultNrpInclusive", 0)), 0)::double precision AS "retailValue",
        COUNT(*) FILTER (WHERE COALESCE(p."defaultNrpInclusive", 0) <= 0)::int AS "zeroDefaultNrp",
        COUNT(*) FILTER (WHERE b."missingCostQuantity" > 0)::int AS "zeroCostOnHand",
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "InventoryLot" lot WHERE lot."productId" = p."id" AND lot."status" = 'active' AND lot."receivedAt" < NOW() - INTERVAL '180 days'))::int AS "staleStock"
      ${source} ${where}
    `);
    const row = rows[0] || {};
    const demand = await this.prisma.purchaseDemand.aggregate({
      where: { status: { in: ['open', 'partially_ordered', 'ordered'] }, ...(args.category ? { category: { equals: args.category, mode: 'insensitive' } } : {}), ...(args.brand ? { brand: { equals: args.brand, mode: 'insensitive' } } : {}) } as any,
      _sum: { quantity: true, receivedQuantity: true },
    });
    return {
      total: Number(row.total || 0), available: Number(row.available || 0), reserved: Number(row.reserved || 0), hold: Number(row.hold || 0), damaged: Number(row.damaged || 0),
      lowStock: Number(row.lowStock || 0), criticalStock: Number(row.criticalStock || 0), warningStock: Number(row.warningStock || 0), outOfStock: Number(row.outOfStock || 0), productCount: Number(row.productCount || 0),
      onHandValue: Number(row.onHandValue || 0), retailValue: Number(row.retailValue || 0), zeroDefaultNrp: Number(row.zeroDefaultNrp || 0), zeroCostOnHand: Number(row.zeroCostOnHand || 0), staleStock: Number(row.staleStock || 0),
      inbound: Math.max(0, Number(demand._sum.quantity || 0) - Number(demand._sum.receivedQuantity || 0)),
    };
  }

  async findById(id: string): Promise<any> {
    const balance = await this.prisma.inventoryBalance.findUnique({
      where: { id },
      include: { product: true },
    } as any) as any;
    if (!balance) throw new NotFoundException('Inventory not found');
    return (await this.withInventoryTruth([balance]))[0];
  }

  async findByProductId(productId: string): Promise<any[]> {
    const rows = await this.prisma.inventoryBalance.findMany({
      where: { productId },
      include: { product: true },
    } as any) as any[];
    return this.withInventoryTruth(rows);
  }

  private async withInventoryTruth(rows: any[]) {
    const truth = await inventoryTruthByProduct(this.prisma, rows.map((row) => row.productId));
    return rows.map((row) => ({ ...row, ...(truth.get(row.productId) || zeroInventoryTruth(row.productId)) }));
  }

  /**
   * Low-stock list. Implemented as a raw SQL clause because Prisma can't
   * compare two columns (e.g. `available <= lowStockThreshold`) in a regular
   * findMany. We then re-hydrate the products via a single batched fetch.
   */
  async findLowStock(take = 100): Promise<any[]> {
    const limit = Math.max(1, Math.min(500, Number(take) || 100));
    const rows = (await (this.prisma as any).$queryRawUnsafe(
      `SELECT * FROM "InventoryBalance"
        WHERE (
          (COALESCE("criticalStockThreshold", 0) > 0 AND "available" <= COALESCE("criticalStockThreshold", 0))
          OR ("lowStockThreshold" > 0 AND "available" <= "lowStockThreshold")
        )
        ORDER BY
          CASE
            WHEN COALESCE("criticalStockThreshold", 0) > 0 AND "available" <= COALESCE("criticalStockThreshold", 0) THEN 0
            ELSE 1
          END ASC,
          ("available"::float / NULLIF(GREATEST(COALESCE("criticalStockThreshold", 0), "lowStockThreshold"), 0)) ASC,
          "available" ASC
        LIMIT ${limit}`,
    )) as any[];
    if (!rows.length) return [];
    const productIds = Array.from(new Set(rows.map((r) => r.productId)));
    const products = await this.prisma.product.findMany({ where: { id: { in: productIds } } });
    const byId = new Map(products.map((p) => [p.id, p] as const));
    const truthfulRows = await this.withInventoryTruth(rows);
    return truthfulRows.map((row) => ({
      ...row,
      product: byId.get(row.productId) || null,
      alertState: computeStockAlertState(row.available, row.lowStockThreshold, row.criticalStockThreshold),
    }));
  }

  async stockAlertPolicies(args?: {
    search?: string;
    category?: string;
    brand?: string;
    alertState?: string;
    take?: number;
    cursor?: string;
  }) {
    const limit = Math.max(1, Math.min(200, Math.trunc(Number(args?.take || 50))));
    const productWhere: any = {};
    const search = String(args?.search || '').trim();
    if (search) {
      productWhere.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
        { internalCode: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (args?.category) productWhere.category = { equals: args.category, mode: 'insensitive' };
    if (args?.brand) productWhere.brand = { equals: args.brand, mode: 'insensitive' };
    const where: any = Object.keys(productWhere).length ? { product: productWhere } : {};

    const alertState = String(args?.alertState || '').trim().toLowerCase();
    if (alertState && alertState !== 'all') {
      const ids = await (this.prisma as any).$queryRawUnsafe(
        `SELECT "id" FROM "InventoryBalance"
         WHERE
           CASE
             WHEN $1 = 'critical' THEN COALESCE("criticalStockThreshold", 0) > 0 AND "available" <= COALESCE("criticalStockThreshold", 0)
             WHEN $1 = 'warning' THEN "lowStockThreshold" > 0 AND "available" <= "lowStockThreshold"
               AND NOT (COALESCE("criticalStockThreshold", 0) > 0 AND "available" <= COALESCE("criticalStockThreshold", 0))
             WHEN $1 = 'healthy' THEN NOT (
               (COALESCE("criticalStockThreshold", 0) > 0 AND "available" <= COALESCE("criticalStockThreshold", 0))
               OR ("lowStockThreshold" > 0 AND "available" <= "lowStockThreshold")
             ) AND ("lowStockThreshold" > 0 OR COALESCE("criticalStockThreshold", 0) > 0)
             WHEN $1 = 'off' THEN "lowStockThreshold" <= 0 AND COALESCE("criticalStockThreshold", 0) <= 0
             ELSE TRUE
           END`,
        alertState,
      ) as any[];
      where.id = { in: ids.map((row: any) => row.id) };
      if (!ids.length) {
        return { items: [], nextCursor: null, summary: await this.stockAlertSummary() };
      }
    }

    const query: any = {
      where,
      include: { product: true },
      orderBy: [{ available: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    };
    const cursor = String(args?.cursor || '').trim();
    if (cursor) {
      query.cursor = { id: cursor };
      query.skip = 1;
    }
    const rows = await this.prisma.inventoryBalance.findMany(query) as any[];
    const hasNext = rows.length > limit;
    const page = hasNext ? rows.slice(0, limit) : rows;
    return {
      items: page.map((row) => ({
        ...row,
        alertState: computeStockAlertState(row.available, row.lowStockThreshold, row.criticalStockThreshold),
      })),
      nextCursor: hasNext ? page[page.length - 1].id : null,
      summary: await this.stockAlertSummary(),
    };
  }

  async stockAlertSummary() {
    const rows = await (this.prisma as any).$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS "tracked",
        COUNT(*) FILTER (WHERE COALESCE("criticalStockThreshold", 0) > 0 AND "available" <= COALESCE("criticalStockThreshold", 0))::int AS "critical",
        COUNT(*) FILTER (WHERE "lowStockThreshold" > 0 AND "available" <= "lowStockThreshold"
          AND NOT (COALESCE("criticalStockThreshold", 0) > 0 AND "available" <= COALESCE("criticalStockThreshold", 0)))::int AS "warning",
        COUNT(*) FILTER (WHERE "lowStockThreshold" <= 0 AND COALESCE("criticalStockThreshold", 0) <= 0)::int AS "off",
        COUNT(*) FILTER (WHERE
          ("lowStockThreshold" > 0 OR COALESCE("criticalStockThreshold", 0) > 0)
          AND NOT (
            (COALESCE("criticalStockThreshold", 0) > 0 AND "available" <= COALESCE("criticalStockThreshold", 0))
            OR ("lowStockThreshold" > 0 AND "available" <= "lowStockThreshold")
          )
        )::int AS "healthy"
      FROM "InventoryBalance"
    `) as any[];
    const row = rows[0] || {};
    return {
      tracked: Number(row.tracked || 0),
      warning: Number(row.warning || 0),
      critical: Number(row.critical || 0),
      healthy: Number(row.healthy || 0),
      off: Number(row.off || 0),
    };
  }

  private assertPolicyThresholds(warning: number, critical: number | null) {
    if (critical != null && critical > 0 && warning > 0 && critical > warning) {
      throw new BadRequestException('Critical threshold must be less than or equal to warning threshold');
    }
  }

  async create(data: CreateInventoryInput): Promise<any> {
    const quantity = Math.max(0, Math.trunc(Number(data.onHand || 0)));
    if (quantity > 0) {
      throw new BadRequestException('Use Opening Stock or a Goods Receipt Note to add physical inventory');
    }
    await this.prisma.inventoryBalance.upsert({
      where: { productId: data.productId },
      update: { updatedAt: new Date() },
      create: {
        id: ulid(), productId: data.productId, onHand: 0, available: 0,
        reserved: 0, damaged: 0, hold: 0, updatedAt: new Date(),
      },
    } as any);
    return this.prisma.inventoryBalance.findUnique({
      where: { productId: data.productId },
      include: { product: true },
    } as any) as any;
  }

  async update(id: string, data: UpdateInventoryInput, actorUserId?: string): Promise<any> {
    const current = await this.findById(id);
    const stockFieldTouched = data.onHand !== undefined || data.reserved !== undefined || data.damaged !== undefined;
    const policyData: any = {};
    if (data.lowStockThreshold !== undefined) policyData.lowStockThreshold = normalizeThreshold(data.lowStockThreshold) as number;
    if (data.criticalStockThreshold !== undefined) {
      policyData.criticalStockThreshold = normalizeThreshold(data.criticalStockThreshold, true);
    }
    if (data.reorderPoint !== undefined) policyData.reorderPoint = data.reorderPoint === null ? null : Math.max(0, Math.trunc(Number(data.reorderPoint || 0)));

    if (!stockFieldTouched) {
      const nextWarning = policyData.lowStockThreshold !== undefined ? policyData.lowStockThreshold : Number(current.lowStockThreshold || 0);
      const nextCritical = policyData.criticalStockThreshold !== undefined ? policyData.criticalStockThreshold : current.criticalStockThreshold;
      this.assertPolicyThresholds(nextWarning, nextCritical);
      const updated = await this.prisma.$transaction(async (tx) => {
        const next = await tx.inventoryBalance.update({
          where: { id },
          data: { ...policyData, updatedAt: new Date() },
          include: { product: true },
        } as any) as any;
        await evaluateStockAlertTransitionsTx(tx, {
          productId: next.productId,
          previousAvailable: Number(current.available || 0),
          nextAvailable: Number(next.available || 0),
          previousBalance: current,
          balance: next,
        });
        if (actorUserId) await tx.auditEvent.create({
          data: {
            id: ulid(),
            actorUserId,
            action: 'stock_alert.policy_update',
            entityType: 'InventoryBalance',
            entityId: id,
            summary: `Updated stock alert policy for ${next.product?.sku || next.productId}`,
            metadata: policyData,
          },
        }).catch(() => null);
        return next;
      });
      return { ...updated, alertState: computeStockAlertState(updated.available, updated.lowStockThreshold, updated.criticalStockThreshold) };
    }
    throw new BadRequestException('Physical balances cannot be overwritten. Use stock count, GRN, reservation, dispatch, return, or approved adjustment workflows');
  }

  async bulkUpdateStockAlertPolicies(rows: StockAlertPolicyRowInput[], actorUserId: string) {
    if (!Array.isArray(rows) || !rows.length) throw new BadRequestException('At least one policy row is required');
    if (rows.length > 200) throw new BadRequestException('Bulk update is limited to 200 rows');
    const normalized = rows.map((row) => {
      const balanceId = String(row.balanceId || '').trim();
      if (!balanceId) throw new BadRequestException('Every policy row needs a balance ID');
      return {
        balanceId,
        lowStockThreshold: normalizeThreshold(row.lowStockThreshold) as number,
        criticalStockThreshold: normalizeThreshold(row.criticalStockThreshold, true),
      };
    });
    if (new Set(normalized.map((row) => row.balanceId)).size !== normalized.length) throw new BadRequestException('The same balance cannot appear twice in one bulk update');
    const updated = await this.prisma.$transaction(async (tx) => {
      const currentRows = await tx.inventoryBalance.findMany({ where: { id: { in: normalized.map((row) => row.balanceId) } }, include: { product: true } } as any) as any[];
      if (currentRows.length !== normalized.length) throw new BadRequestException('One or more inventory balances no longer exist. Refresh and retry.');
      const byId = new Map(currentRows.map((row) => [row.id, row]));
      const result: any[] = [];
      for (const row of normalized) {
        const current = byId.get(row.balanceId)!;
        this.assertPolicyThresholds(row.lowStockThreshold, row.criticalStockThreshold);
        const next = await tx.inventoryBalance.update({
          where: { id: row.balanceId },
          data: { lowStockThreshold: row.lowStockThreshold, criticalStockThreshold: row.criticalStockThreshold, updatedAt: new Date() },
          include: { product: true },
        } as any) as any;
        await evaluateStockAlertTransitionsTx(tx, {
          productId: next.productId,
          previousAvailable: Number(current.available || 0),
          nextAvailable: Number(next.available || 0),
          previousBalance: current,
          balance: next,
        });
        result.push({ ...next, alertState: computeStockAlertState(next.available, next.lowStockThreshold, next.criticalStockThreshold) });
      }
      await tx.auditEvent.create({
        data: { id: ulid(), actorUserId, action: 'stock_alert.policy_bulk_update', entityType: 'InventoryBalance', entityId: 'bulk', summary: `Updated ${result.length} stock alert policies`, metadata: { balanceIds: normalized.map((row) => row.balanceId) } },
      });
      return result;
    });
    return { updated: updated.length, items: updated, summary: await this.stockAlertSummary() };
  }

  async adjustQuantity(
    id: string,
    adjustment: number,
    type: 'inward' | 'outward' | 'damage' | 'adjustment' | 'reserve' | 'release',
    notes?: string,
    createdBy = 'system',
  ): Promise<any> {
    await this.findById(id);
    void adjustment; void type; void notes; void createdBy;
    throw new BadRequestException('Direct stock adjustment is disabled. Submit a physical count or approved lot adjustment');
  }

  async getStockSummary() {
    const rows = await (this.prisma as any).$queryRawUnsafe(`
      WITH truth AS (
        SELECT policy."productId", policy."lowStockThreshold", policy."criticalStockThreshold",
          COALESCE(SUM(lb."onHand"), 0)::double precision AS "onHand",
          COALESCE(SUM(lb."available"), 0)::double precision AS "available",
          COALESCE(SUM(lb."reserved"), 0)::double precision AS "reserved",
          COALESCE(SUM(lb."damaged"), 0)::double precision AS "damaged",
          COALESCE(SUM(lb."onHand" * lot."unitCost"), 0)::double precision AS "onHandValue",
          COALESCE(SUM(lb."available" * lot."unitCost"), 0)::double precision AS "availableValue",
          COALESCE(SUM(CASE WHEN lot."unitCost" <= 0 THEN lb."onHand" ELSE 0 END), 0)::double precision AS "missingCostQuantity"
        FROM "InventoryBalance" policy
        LEFT JOIN "InventoryLot" lot ON lot."productId" = policy."productId" AND lot."status" = 'active'
        LEFT JOIN "InventoryLotBalance" lb ON lb."lotId" = lot."id"
        GROUP BY policy."productId", policy."lowStockThreshold", policy."criticalStockThreshold"
      )
      SELECT
        COUNT(*)::int AS "productCount",
        COALESCE(SUM(b."onHand"), 0)::double precision AS "total",
        COALESCE(SUM(b."available"), 0)::double precision AS "available",
        COALESCE(SUM(b."reserved"), 0)::double precision AS "reserved",
        COALESCE(SUM(b."damaged"), 0)::double precision AS "damaged",
        COUNT(*) FILTER (
          WHERE (COALESCE(b."criticalStockThreshold", 0) > 0 AND b."available" <= COALESCE(b."criticalStockThreshold", 0))
            OR (b."lowStockThreshold" > 0 AND b."available" <= b."lowStockThreshold")
        )::int AS "lowStock",
        COUNT(*) FILTER (WHERE b."available" = 0)::int AS "outOfStock",
        COALESCE(SUM(b."onHandValue"), 0)::double precision AS "onHandValue",
        COALESCE(SUM(b."availableValue"), 0)::double precision AS "availableValue",
        COALESCE(SUM(b."available" * COALESCE(p."defaultNrpInclusive", 0)), 0)::double precision AS "retailValue",
        COUNT(*) FILTER (WHERE COALESCE(p."defaultNrpInclusive", 0) <= 0)::int AS "zeroDefaultNrp",
        COUNT(*) FILTER (WHERE b."missingCostQuantity" > 0)::int AS "zeroCostOnHand",
        COUNT(*) FILTER (WHERE COALESCE(p."defaultNrpInclusive", 0) > 0)::int AS "priceCompleteProducts"
      FROM truth b
      INNER JOIN "Product" p ON p."id" = b."productId"
    `) as any[];
    const row = rows[0] || {};
    return {
      total: Number(row.total || 0),
      available: Number(row.available || 0),
      reserved: Number(row.reserved || 0),
      damaged: Number(row.damaged || 0),
      lowStock: Number(row.lowStock || 0),
      outOfStock: Number(row.outOfStock || 0),
      productCount: Number(row.productCount || 0),
      onHandValue: Number(row.onHandValue || 0),
      availableValue: Number(row.availableValue || 0),
      retailValue: Number(row.retailValue || 0),
      zeroDefaultNrp: Number(row.zeroDefaultNrp || 0),
      zeroCostOnHand: Number(row.zeroCostOnHand || 0),
      priceCompleteProducts: Number(row.priceCompleteProducts || 0),
    };
  }

  async pendingInwardItems(take = 200): Promise<any[]> {
    const limit = Math.max(1, Math.min(500, Number(take) || 200));
    const [reservations, salesOrders] = await Promise.all([
      this.prisma.reservation.findMany({
        where: { status: 'backordered' },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.salesOrder.findMany({
        where: { status: { in: ['open', 'confirmed', 'partial', 'pending'] } as any },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
    ]);

    const quoteIds = Array.from(new Set([
      ...reservations.map((reservation) => reservation.quoteId),
      ...salesOrders.map((order) => order.quoteId),
    ].filter((id): id is string => Boolean(id))));
    const productIds = Array.from(new Set(reservations.map((reservation) => reservation.productId).filter(Boolean)));
    const [quotes, products, balances] = await Promise.all([
      quoteIds.length
        ? this.prisma.quote.findMany({
            where: { id: { in: quoteIds } },
            select: { id: true, quoteNumber: true, leadId: true, customerId: true, ownerId: true },
          })
        : [],
      productIds.length ? this.prisma.product.findMany({ where: { id: { in: productIds } } }) : [],
      productIds.length ? this.prisma.inventoryBalance.findMany({ where: { productId: { in: productIds } } }) : [],
    ]);

    const quoteMap = new Map(quotes.map((quote) => [quote.id, quote] as const));
    const productMap = new Map(products.map((product) => [product.id, product] as const));
    const balanceMap = new Map(balances.map((balance) => [balance.productId, balance] as const));
    const orderById = new Map(salesOrders.map((order) => [order.id, order] as const));
    const ordersByQuote = new Map<string, any[]>();
    for (const order of salesOrders as any[]) {
      const matching = ordersByQuote.get(order.quoteId) || [];
      matching.push(order);
      ordersByQuote.set(order.quoteId, matching);
    }
    const customerIds = Array.from(new Set([
      ...quotes.map((quote) => quote.customerId),
      ...salesOrders.map((order) => order.customerId),
    ].filter(Boolean)));
    const ownerIds = Array.from(new Set([
      ...quotes.map((quote) => quote.ownerId),
      ...salesOrders.map((order) => order.ownerId),
    ].filter(Boolean)));
    const [customers, owners] = await Promise.all([
      customerIds.length ? this.prisma.customer.findMany({ where: { id: { in: customerIds } } }) : [],
      ownerIds.length ? this.prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true, email: true, role: true, phone: true } }) : [],
    ]);
    const customerMap = new Map(customers.map((customer) => [customer.id, customer] as const));
    const ownerMap = new Map(owners.map((owner) => [owner.id, owner] as const));
    const demands = await (this.prisma as any).purchaseDemand.findMany({
      where: {
        OR: [
          { sourceReservationId: { in: reservations.map((reservation) => reservation.id) } },
          { sourceOrderId: { in: salesOrders.map((order) => order.id) } },
        ],
      },
    }).catch(() => []);
    const demandByReservation = new Map((demands as any[]).map((demand) => [demand.sourceReservationId, demand]));
    const demandBySourceLine = new Map((demands as any[]).map((demand) => [demand.sourceLineKey, demand]));

    const reservationRows = reservations.map((reservation) => {
      const product = productMap.get(reservation.productId) as any;
      const balance = balanceMap.get(reservation.productId) as any;
      const quote = reservation.quoteId ? quoteMap.get(reservation.quoteId) as any : null;
      const legacyOrders = reservation.quoteId ? ordersByQuote.get(reservation.quoteId) || [] : [];
      const order = (reservation.salesOrderId
        ? orderById.get(reservation.salesOrderId)
        : legacyOrders.length === 1 ? legacyOrders[0] : null) as any;
      const demand = demandByReservation.get(reservation.id) as any;
      const quantity = Number(reservation.quantity || 0);
      const available = Number(balance?.available || 0);
      return {
        reservationId: reservation.id,
        status: 'pending_inward',
        productId: reservation.productId,
        quoteId: reservation.quoteId,
        leadId: order?.leadId || quote?.leadId || null,
        orderId: order?.id || null,
        orderNumber: order?.orderNumber || '',
        quoteNumber: quote?.quoteNumber || '',
        customer: (order?.customerId || quote?.customerId) ? customerMap.get(order?.customerId || quote?.customerId) || null : null,
        owner: (order?.ownerId || quote?.ownerId) ? ownerMap.get(order?.ownerId || quote?.ownerId) || null : null,
        sku: product?.sku || reservation.productId,
        name: product?.name || 'Pending product',
        category: product?.category || '',
        brand: product?.brand || '',
        finish: product?.finish || '',
        quantity,
        available,
        shortage: Math.max(0, quantity - available),
        defaultNrpInclusive: Number(product?.defaultNrpInclusive || 0),
        purchaseStatus: demand?.status || 'demand_pending',
        vendorName: demand?.vendorName || product?.brand || '',
        expectedDate: demand?.expectedDate || null,
        purchaseDemandId: demand?.id || null,
        createdAt: reservation.createdAt,
        updatedAt: reservation.updatedAt,
      };
    });

    const tileRows = salesOrders.flatMap((order: any) => {
      const quote = quoteMap.get(order.quoteId) as any;
      const lines = this.normalizeLines(order.lines) || [];
      return lines
        .filter((line: any) => this.isTileLine(line) && !String(line.productId || '').trim() && Number(line.qty || line.quantity || 0) > 0)
        .map((line: any, index: number) => {
          const quantity = Number(line.qty || line.quantity || 0);
          const demand = demandBySourceLine.get(this.tileDemandKey(order.id, line, index)) as any;
          return {
            reservationId: `tile-${order.id}-${index}`,
            status: 'tile_special_order',
            productId: '',
            quoteId: order.quoteId,
            leadId: order.leadId,
            orderId: order.id,
            orderNumber: order.orderNumber,
            quoteNumber: quote?.quoteNumber || '',
            customer: customerMap.get(order.customerId) || null,
            owner: ownerMap.get(order.ownerId) || null,
            sku: line.tileCode || line.sku || 'Tile order',
            name: line.name || `Tile ${line.tileCode || ''} ${line.tileSize || line.dimensions || ''}`.trim(),
            category: 'Tiles',
            brand: line.brand || 'Tile selection',
            finish: line.tileSize || line.dimensions || '',
            quantity,
            available: 0,
            shortage: quantity,
            sellPrice: Number(line.price || line.sellPrice || 0),
            purchaseStatus: demand?.status || 'demand_pending',
            vendorName: demand?.vendorName || line.brand || 'Tile vendor',
            expectedDate: demand?.expectedDate || null,
            purchaseDemandId: demand?.id || null,
            createdAt: order.createdAt,
            updatedAt: order.updatedAt,
          };
        });
    });

    return [...reservationRows, ...tileRows]
      .sort((a: any, b: any) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime())
      .slice(0, limit);
  }

  private normalizeLines(lines: any) {
    if (!lines) return [];
    if (typeof lines === 'string') {
      try {
        const parsed = JSON.parse(lines);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return Array.isArray(lines) ? lines : [];
  }

  private isTileLine(line: any) {
    return line?.type === 'tile' || line?.nonStock === true || String(line?.category || '').toLowerCase() === 'tiles';
  }

  private tileDemandKey(orderId: string, line: any, index: number) {
    return `tile:${orderId}:${String(line.tileCode || line.sku || index).trim()}:${index}`;
  }

  private async notifyBackorderReady(productId: string, actorUserId: string) {
    const reservations = await this.prisma.reservation.findMany({
      where: { productId, status: 'backordered' },
      orderBy: { createdAt: 'asc' },
    });
    for (const reservation of reservations) {
      const balance = await this.prisma.inventoryBalance.findUnique({ where: { productId }, include: { product: true } as any } as any) as any;
      if (!balance || Number(balance.available || 0) < Number(reservation.quantity || 0)) return;
      const quote = await this.prisma.quote.findUnique({ where: { id: reservation.quoteId }, include: { lead: true } as any } as any) as any;
      if (!quote?.leadId) continue;
      const reservedNow = await this.prisma.$transaction(async (tx) => {
        const fresh = await tx.inventoryBalance.findUnique({ where: { productId } });
        if (!fresh || Number(fresh.available || 0) < Number(reservation.quantity || 0)) return false;
        await applyStockPostingTx(tx, {
          productId,
          type: 'auto_reserve_backorder',
          movementType: 'reserve',
          ledgerType: 'reserve',
          quantity: Number(reservation.quantity || 0),
          reservedDelta: Number(reservation.quantity || 0),
          locationReservedDelta: Number(reservation.quantity || 0),
          requireAvailable: true,
          reason: `Auto-reserved arrived backorder for ${quote.quoteNumber}`,
          relatedQuoteId: quote.id,
          referenceType: 'Reservation',
          referenceId: reservation.id,
          sourceDocumentNo: quote.quoteNumber,
          createdBy: actorUserId || 'system',
          metadata: { source: 'notifyBackorderReady' },
        });
        await tx.reservation.update({
          where: { id: reservation.id },
          data: { status: 'reserved', updatedAt: new Date() },
        });
        await syncSalesOrderLinesForQuoteTx(tx, quote.id);
        return true;
      }, { timeout: 10000 }).catch(() => false);
      if (!reservedNow) continue;
      await this.prisma.activity.create({
        data: {
          id: ulid(),
          leadId: quote.leadId,
          quoteId: quote.id,
          userId: quote.ownerId,
          type: 'stock_ready',
          message: `${balance.product?.sku || 'Item'} arrived, was auto-reserved, and is now ready for dispatch tracking.`,
        },
      }).catch(() => null);
      await this.prisma.followUpTask.create({
        data: {
          id: ulid(),
          leadId: quote.leadId,
          ownerId: quote.ownerId,
          dueAt: new Date(),
          status: 'pending',
          notes: `${balance.product?.name || balance.product?.sku || 'Item'} has arrived and is reserved. Inform customer and coordinate dispatch.`,
          updatedAt: new Date(),
        },
      }).catch(() => null);
      await this.notifications.createMany([
        {
          title: 'Backorder item reserved',
          message: `${balance.product?.sku || 'Item'} has arrived for ${quote.quoteNumber} and is reserved. Inform the customer and prepare pending dispatch.`,
          type: 'stock_ready',
          entityType: 'Quote',
          entityId: quote.id,
          href: `/dashboard/leads/${quote.leadId}`,
          targetUserId: quote.ownerId,
          metadata: { productId, quoteId: quote.id },
        },
        {
          title: 'Backorder item reserved',
          message: `${balance.product?.sku || 'Item'} has arrived for ${quote.quoteNumber} and is reserved.`,
          type: 'stock_ready',
          entityType: 'Quote',
          entityId: quote.id,
          href: `/dashboard/leads/${quote.leadId}`,
          targetRole: 'owner',
          metadata: { productId, quoteId: quote.id },
        },
        {
          title: 'Backorder item reserved',
          message: `${balance.product?.sku || 'Item'} has arrived for ${quote.quoteNumber} and is reserved.`,
          type: 'stock_ready',
          entityType: 'Quote',
          entityId: quote.id,
          href: `/dashboard/leads/${quote.leadId}`,
          targetRole: 'admin',
          metadata: { productId, quoteId: quote.id },
        },
        {
          title: 'Pending dispatch item ready',
          message: `${balance.product?.sku || 'Item'} is inwarded and reserved. Dispatch can create the remaining challan when scheduled.`,
          type: 'stock_ready',
          entityType: 'Quote',
          entityId: quote.id,
          href: '/dashboard/dispatch',
          targetRole: 'dispatch_ops',
          metadata: { productId, quoteId: quote.id },
        },
      ]);
    }
  }
}
