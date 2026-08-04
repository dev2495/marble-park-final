import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ulid } from 'ulid';
import { applyStockPostingTx, syncSalesOrderLinesForQuoteTx } from '../common/stock-posting';

export interface CreateInventoryInput {
  productId: string;
  onHand?: number;
}

export interface UpdateInventoryInput {
  onHand?: number;
  reserved?: number;
  damaged?: number;
  lowStockThreshold?: number;
  reorderPoint?: number | null;
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
    
    return this.prisma.inventoryBalance.findMany({
      where,
      include: { product: true },
      orderBy: { updatedAt: 'desc' },
      take: args?.take || 150,
    } as any) as any;
  }

  async controlTower(args?: {
    search?: string;
    category?: string;
    brand?: string;
    stockState?: string;
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
    const where: any = Object.keys(productWhere).length ? { product: productWhere } : {};
    const stockState = String(args?.stockState || '').trim().toLowerCase();
    if (stockState === 'out_of_stock') where.available = 0;
    else if (stockState === 'reserved') where.reserved = { gt: 0 };
    else if (stockState === 'available') where.available = { gt: 0 };
    else if (stockState === 'low_stock') {
      const lowIds = await (this.prisma as any).$queryRawUnsafe(
        `SELECT "id" FROM "InventoryBalance"
         WHERE "available" <= COALESCE("reorderPoint", "lowStockThreshold")
           AND COALESCE("reorderPoint", "lowStockThreshold") > 0`,
      ) as any[];
      where.id = { in: lowIds.map((row) => row.id) };
      if (!lowIds.length) return { items: [], nextCursor: null, total: 0, summary: await this.getStockSummary() };
    }
    const query: any = {
      where,
      include: { product: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
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
    return {
      items: page.map((row) => ({
        ...row,
        stockState: row.available === 0 ? 'out_of_stock' : (row.reorderPoint ?? row.lowStockThreshold ?? 5) > 0 && row.available <= (row.reorderPoint ?? row.lowStockThreshold ?? 5) ? 'low_stock' : row.reserved > 0 ? 'reserved' : 'available',
        onHandValue: Number(row.onHand || 0) * Number(row.product?.costPrice || 0),
        availableValue: Number(row.available || 0) * Number(row.product?.costPrice || 0),
        retailValue: Number(row.available || 0) * Number(row.product?.sellPrice || 0),
      })),
      nextCursor: hasNextPage ? page[page.length - 1].id : null,
      total: await this.prisma.inventoryBalance.count({ where }),
      summary: await this.getStockSummary(),
    };
  }

  async findById(id: string): Promise<any> {
    const balance = await this.prisma.inventoryBalance.findUnique({
      where: { id },
      include: { product: true },
    } as any) as any;
    if (!balance) throw new NotFoundException('Inventory not found');
    return balance;
  }

  async findByProductId(productId: string): Promise<any[]> {
    return this.prisma.inventoryBalance.findMany({
      where: { productId },
      include: { product: true },
    } as any) as any;
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
        WHERE ("available" <= COALESCE("reorderPoint", "lowStockThreshold"))
          AND COALESCE("reorderPoint", "lowStockThreshold") > 0
        ORDER BY ("available"::float / NULLIF(COALESCE("reorderPoint", "lowStockThreshold"), 0)) ASC,
                 "available" ASC
        LIMIT ${limit}`,
    )) as any[];
    if (!rows.length) return [];
    const productIds = Array.from(new Set(rows.map((r) => r.productId)));
    const products = await this.prisma.product.findMany({ where: { id: { in: productIds } } });
    const byId = new Map(products.map((p) => [p.id, p] as const));
    return rows.map((row) => ({ ...row, product: byId.get(row.productId) || null }));
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

  async update(id: string, data: UpdateInventoryInput): Promise<any> {
    const current = await this.findById(id);
    const stockFieldTouched = data.onHand !== undefined || data.reserved !== undefined || data.damaged !== undefined;
    const policyData: any = {};
    if (data.lowStockThreshold !== undefined) policyData.lowStockThreshold = Math.max(0, Math.trunc(Number(data.lowStockThreshold || 0)));
    if (data.reorderPoint !== undefined) policyData.reorderPoint = data.reorderPoint === null ? null : Math.max(0, Math.trunc(Number(data.reorderPoint || 0)));

    if (!stockFieldTouched) {
      return this.prisma.inventoryBalance.update({
        where: { id },
        data: { ...policyData, updatedAt: new Date() },
        include: { product: true },
      } as any) as any;
    }
    throw new BadRequestException('Physical balances cannot be overwritten. Use stock count, GRN, reservation, dispatch, return, or approved adjustment workflows');
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
    // Keep dashboard KPI reads bounded as the master grows. The previous
    // implementation hydrated every Product relation into Node just to sum
    // balances, which made the inventory page degrade with catalogue size.
    const rows = await (this.prisma as any).$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS "productCount",
        COALESCE(SUM(b."onHand"), 0)::double precision AS "total",
        COALESCE(SUM(b."available"), 0)::double precision AS "available",
        COALESCE(SUM(b."reserved"), 0)::double precision AS "reserved",
        COALESCE(SUM(b."damaged"), 0)::double precision AS "damaged",
        COUNT(*) FILTER (
          WHERE COALESCE(b."reorderPoint", b."lowStockThreshold") > 0
            AND b."available" <= COALESCE(b."reorderPoint", b."lowStockThreshold")
        )::int AS "lowStock",
        COUNT(*) FILTER (WHERE b."available" = 0)::int AS "outOfStock",
        COALESCE(SUM(b."onHand" * COALESCE(p."costPrice", 0)), 0)::double precision AS "onHandValue",
        COALESCE(SUM(b."available" * COALESCE(p."costPrice", 0)), 0)::double precision AS "availableValue",
        COALESCE(SUM(b."available" * COALESCE(p."sellPrice", 0)), 0)::double precision AS "retailValue",
        COUNT(*) FILTER (WHERE COALESCE(p."sellPrice", 0) <= 0)::int AS "zeroSellPrice",
        COUNT(*) FILTER (WHERE b."onHand" > 0 AND COALESCE(p."costPrice", 0) <= 0)::int AS "zeroCostOnHand",
        COUNT(*) FILTER (WHERE COALESCE(p."sellPrice", 0) > 0)::int AS "priceCompleteProducts"
      FROM "InventoryBalance" b
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
      zeroSellPrice: Number(row.zeroSellPrice || 0),
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
    ].filter(Boolean)));
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
      const quote = quoteMap.get(reservation.quoteId) as any;
      const legacyOrders = ordersByQuote.get(reservation.quoteId) || [];
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
        sellPrice: Number(product?.sellPrice || 0),
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
