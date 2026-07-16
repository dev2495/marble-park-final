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
    const balances = await this.prisma.inventoryBalance.findMany({
      include: { product: true },
    } as any) as any[];
    
    const summary = {
      total: 0,
      available: 0,
      reserved: 0,
      damaged: 0,
      lowStock: 0,
      outOfStock: 0,
    };
    
    for (const b of balances) {
      summary.total += b.onHand;
      summary.available += b.available;
      summary.reserved += b.reserved;
      summary.damaged += b.damaged;
      const threshold = b.reorderPoint ?? b.lowStockThreshold ?? 5;
      if (Number(threshold) > 0 && b.available <= Number(threshold)) summary.lowStock++;
      if (b.available === 0) summary.outOfStock++;
    }
    
    return summary;
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
