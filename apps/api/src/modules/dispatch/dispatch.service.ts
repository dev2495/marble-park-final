import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { nextDocumentNumber } from '../common/sequence';
import { syncSalesOrderLinesForQuoteTx } from '../common/stock-posting';
import { consumeExactReservedLotTx, consumeReservedLotsTx } from '../common/lot-allocation';
import { applyLotStockPostingTx } from '../common/lot-stock-posting';
import { fillBackordersForProductsTx, refreshOrderLineStockTx } from '../common/backorder-fill';
import { closeFinishedDemandsTx } from '../common/demand-status';
import { inventoryTruthByProduct, zeroInventoryTruth } from '../common/inventory-truth';
import { ulid } from 'ulid';
import { stockFactor, tileBoxReading } from '../common/stock-units';
import { refusesPartBox } from '@marble-park/pricing-contract/box-quantity';

export interface CreateDispatchJobInput {
  quoteId?: string;
  salesOrderId?: string;
  customerId: string;
  scheduledAt?: Date;
  notes?: string;
}

export interface UpdateDispatchJobInput {
  scheduledAt?: Date;
  notes?: string;
}

export interface CreateChallanInput {
  jobId?: string;
  dispatchJobId?: string;
  quoteId?: string;
  salesOrderId?: string;
  customerId?: string;
  vehicleNumber?: string;
  vehicleNo?: string;
  driverName?: string;
  transporterName?: string;
  transporter?: string;
  contactPhone?: string;
  driverPhone?: string;
  siteAddress?: string;
  remarks?: string;
  notes?: string;
  packages?: number;
  lines?: any;
  pickListId?: string;
  /** 'vehicle' (our or a hired vehicle, details required) or 'self_pickup' (customer collects). */
  transportMode?: string;
}

export interface ChallanTransportInput {
  transportMode?: string;
  vehicleNo?: string;
  vehicleNumber?: string;
  driverName?: string;
  driverPhone?: string;
  contactPhone?: string;
  transporter?: string;
  transporterName?: string;
  notes?: string;
  remarks?: string;
}

/** Values the old screen sent before there was a transport form. Shown as "not entered". */
export const PLACEHOLDER_TRANSPORT = { vehicleNumber: 'PENDING', driverName: 'Dispatch desk', transporterName: 'Store vehicle', contactPhone: '0000000000' };

export interface CreatePickListInput {
  salesOrderId: string;
  locationId: string;
  assignedTo?: string;
  notes?: string;
  lines?: any;
}

@Injectable()
export class DispatchService {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  async findAllJobs(args?: { status?: string; customerId?: string }): Promise<any[]> {
    const where: any = {};
    if (args?.status) where.status = args.status;
    if (args?.customerId) where.customerId = args.customerId;
    
    return this.prisma.dispatchJob.findMany({
      where,
      include: { customer: true, quote: true, salesOrder: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    } as any) as any;
  }

  async dispatchQueue(args?: { status?: string; customerId?: string }): Promise<any[]> {
    const where: any = {};
    if (args?.status) where.status = args.status;
    // The work queue: delivered and cancelled jobs are finished (ask for status 'delivered' to see them).
    else where.status = { in: ['pending', 'packed', 'dispatched'] };
    if (args?.customerId) where.customerId = args.customerId;

    const jobs = await this.prisma.dispatchJob.findMany({
      where,
      include: { customer: true, quote: true, salesOrder: true },
      orderBy: { updatedAt: 'desc' },
      take: 80,
    } as any) as any[];
    if (!jobs.length) return [];

    const jobIds = jobs.map((job: any) => job.id);
    const quoteIds = Array.from(new Set(jobs.map((job: any) => job.quoteId).filter(Boolean)));
    const directOrderIds = Array.from(new Set(jobs.map((job: any) => job.salesOrderId).filter(Boolean)));
    const quoteLines = jobs.flatMap((job: any) => this.normalizeLines(job.quote?.lines) || []);
    const productIds = Array.from(new Set(quoteLines.map((line: any) => String(line.productId || '').trim()).filter(Boolean)));

    const [challans, reservations, balances, orders] = await Promise.all([
      this.prisma.dispatchChallan.findMany({
        where: { dispatchJobId: { in: jobIds }, status: { in: ['pending', 'dispatched', 'delivered'] } },
      } as any),
      this.prisma.reservation.findMany({ where: { OR: [{ salesOrderId: { in: directOrderIds } }, { salesOrderId: null, quoteId: { in: quoteIds } }] } } as any),
      this.prisma.inventoryBalance.findMany({ where: { productId: { in: productIds } }, include: { product: true } as any } as any),
      this.prisma.salesOrder.findMany({ where: { OR: [{ id: { in: directOrderIds } }, { quoteId: { in: quoteIds } }] } }),
    ]);

    const inventoryTruth = await inventoryTruthByProduct(this.prisma, productIds);
    // Stock, reservations and challans count base units (pieces); order lines count selling units (boxes).
    const unitFactor = await this.unitFactors([
      ...productIds,
      ...(reservations as any[]).map((row) => row.productId),
      ...(orders as any[]).flatMap((order) => (this.normalizeLines(order.lines) || []).map((line: any) => line.productId)),
    ]);
    const toSelling = (productId: string, base: number) => Number((Number(base || 0) / (unitFactor.get(productId) || 1)).toFixed(2));
    const balanceMap = new Map((balances as any[]).map((balance) => [
      balance.productId,
      { ...balance, ...(inventoryTruth.get(balance.productId) || zeroInventoryTruth(balance.productId)) },
    ]));
    const orderById = new Map((orders as any[]).map((order) => [order.id, order]));
    const ordersByQuote = new Map<string, any[]>();
    for (const order of orders as any[]) {
      const matching = ordersByQuote.get(order.quoteId) || [];
      matching.push(order);
      ordersByQuote.set(order.quoteId, matching);
    }
    const orderIds = (orders as any[]).map((order) => order.id);
    const pickableByOrder = await this.unpickedReservedByLocation(this.prisma, orderIds);
    const purchaseDemands = orderIds.length
      ? await (this.prisma as any).purchaseDemand.findMany({ where: { sourceOrderId: { in: orderIds } } }).catch(() => [])
      : [];
    const demandByOrderKey = new Map((purchaseDemands as any[]).map((demand) => [`${demand.sourceOrderId}:${demand.sourceLineKey}`, demand]));
    const demandByOrderSku = new Map((purchaseDemands as any[]).map((demand) => [`${demand.sourceOrderId}:${demand.sku}`, demand]));
    const reservationsByOrderProduct = this.groupByOrderProduct(reservations as any[]);
    const challanQtyByJobProduct = this.groupChallanQty(challans as any[]);
    const challansByJob = new Map<string, any[]>();
    // Products of order and challan lines, so each line can read in boxes (pieces per box, sold by box or piece).
    const readingIds = Array.from(new Set([
      ...Array.from(unitFactor.keys()),
      ...(challans as any[]).flatMap((challan) => (Array.isArray(challan.lines) ? challan.lines : []).map((line: any) => line?.productId)),
    ].filter(Boolean))) as string[];
    const readingProducts = readingIds.length ? await this.prisma.product.findMany({ where: { id: { in: readingIds } } }) : [];
    const productById = new Map((readingProducts as any[]).map((product) => [product.id, product]));
    for (const challan of challans as any[]) {
      const lines = Array.isArray(challan.lines) ? this.withBoxReading(challan.lines, productById) : challan.lines;
      challansByJob.set(challan.dispatchJobId, [...(challansByJob.get(challan.dispatchJobId) || []), { ...challan, lines }]);
    }

    return jobs.map((job: any) => {
      const legacyOrders = ordersByQuote.get(job.quoteId) || [];
      const salesOrder = (job.salesOrderId
        ? orderById.get(job.salesOrderId)
        : legacyOrders.length === 1 ? legacyOrders[0] : null) as any;
      const lines = this.normalizeLines(salesOrder?.lines || job.quote?.lines) || [];
      const lineStatus = lines.map((line: any, index: number) => {
        const productId = String(line.productId || '').trim();
        const orderedQty = Number(line.qty || line.quantity || 0);
        const tileSpecialOrder = this.isTileLine(line) && orderedQty > 0 && !productId;
        if (!productId || orderedQty <= 0) {
          const dispatchKey = salesOrder ? this.tileDemandKey(salesOrder.id, line, index) : this.lineDispatchKey(line, index);
          const committedQty = Number(challanQtyByJobProduct.get(`${job.id}:${dispatchKey}`) || 0);
          const remainingQty = Math.max(0, orderedQty - committedQty);
          const demand = salesOrder
            ? ((demandByOrderKey.get(`${salesOrder.id}:${dispatchKey}`) || demandByOrderSku.get(`${salesOrder.id}:${line.tileCode || line.sku}`)) as any)
            : null;
          const receivedQty = Number(demand?.receivedQuantity || 0);
          const dispatchableQty = tileSpecialOrder ? Math.max(0, Math.min(remainingQty, receivedQty - committedQty)) : 0;
          return {
            ...line,
            productId,
            dispatchKey,
            // Lets the screen put a received special-order line on a challan without a pick list.
            salesOrderLineId: demand?.metadata?.salesOrderLineId || null,
            specialOrder: tileSpecialOrder,
            purchaseDemand: demand || null,
            orderedQty,
            committedQty,
            remainingQty,
            reservedQty: 0,
            backorderedQty: 0,
            receivedQty,
            dispatchableQty,
            blockedQty: Math.max(0, remainingQty - dispatchableQty),
            onHand: 0,
            available: 0,
            status: remainingQty <= 0
              ? 'fully_dispatched'
              : tileSpecialOrder && dispatchableQty > 0
                ? 'ready'
                : tileSpecialOrder
                  ? 'tile_special_order'
                  : 'invalid_product',
          };
        }
        const committedQty = toSelling(productId, Number(challanQtyByJobProduct.get(`${job.id}:${productId}`) || 0));
        const remainingQty = Math.max(0, orderedQty - committedQty);
        const reservationScope = salesOrder?.id || `legacy:${job.quoteId}`;
        const reservationRows = reservationsByOrderProduct.get(`${reservationScope}:${productId}`) || [];
        const reservedQty = toSelling(productId, reservationRows
          .filter((reservation: any) => reservation.status === 'reserved')
          .reduce((sum: number, reservation: any) => sum + Number(reservation.quantity || 0), 0));
        const backorderedQty = toSelling(productId, reservationRows
          .filter((reservation: any) => reservation.status === 'backordered')
          .reduce((sum: number, reservation: any) => sum + Number(reservation.quantity || 0), 0));
        const balance = balanceMap.get(productId) as any;
        const dispatchableQty = Math.max(0, Math.min(remainingQty, reservedQty));
        const blockedQty = Math.max(0, remainingQty - dispatchableQty);
        const status = remainingQty <= 0
          ? 'fully_dispatched'
          : dispatchableQty > 0
            ? 'ready'
            : backorderedQty > 0
              ? 'pending_inward'
              : 'not_reserved';
        return {
          ...line,
          productId,
          orderedQty,
          committedQty,
          remainingQty,
          reservedQty,
          backorderedQty,
          dispatchableQty,
          blockedQty,
          onHand: toSelling(productId, Number(balance?.onHand || 0)),
          available: toSelling(productId, Number(balance?.available || 0)),
          piecesPerUnit: unitFactor.get(productId) || 1,
          ...tileBoxReading(productById.get(productId)),
          status,
        };
      });

      return {
        id: job.id,
        quoteId: job.quoteId,
        salesOrderId: salesOrder?.id || job.salesOrderId || null,
        customerId: job.customerId,
        siteAddress: job.siteAddress,
        status: job.status,
        dueDate: job.dueDate,
        ownerId: job.ownerId,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        customer: job.customer
          ? {
              id: job.customer.id,
              name: job.customer.name,
              mobile: job.customer.mobile,
              city: job.customer.city,
              siteAddress: job.customer.siteAddress,
            }
          : null,
        quote: job.quote
          ? {
              id: job.quote.id,
              quoteNumber: job.quote.quoteNumber,
              status: job.quote.status,
              leadId: job.quote.leadId,
              title: job.quote.title,
            }
          : null,
        salesOrder: salesOrder
          ? {
              id: salesOrder.id,
              orderNumber: salesOrder.orderNumber,
              status: salesOrder.status,
              paymentMode: salesOrder.paymentMode,
              paymentStatus: salesOrder.paymentStatus,
              totalAmount: salesOrder.totalAmount,
              advanceAmount: salesOrder.advanceAmount,
              documents: salesOrder.documents,
            }
          : null,
        lines: lineStatus,
        readyLines: lineStatus.filter((line: any) => line.status === 'ready'),
        pendingInwardLines: lineStatus.filter((line: any) => line.status === 'pending_inward' || line.status === 'tile_special_order'),
        invalidLines: lineStatus.filter((line: any) => line.status === 'invalid_product'),
        specialOrderLines: lineStatus.filter((line: any) => line.status === 'tile_special_order'),
        completedLines: lineStatus.filter((line: any) => line.status === 'fully_dispatched'),
        // Locations holding this order's reserved stock not yet on a pick list, most first (base units).
        pickableLocations: salesOrder ? pickableByOrder.get(salesOrder.id) || [] : [],
      challans: challansByJob.get(job.id) || [],
      };
    });
  }

  async reservedDispatchLines(args?: {
    search?: string;
    status?: string;
    brand?: string;
    category?: string;
    locationId?: string;
    sort?: string;
    cursor?: string;
    take?: number;
  }) {
    const limit = Math.max(1, Math.min(100, Math.trunc(Number(args?.take || 30))));
    const search = String(args?.search || '').trim();
    const lineWhere: any = {};

    if (search) {
      lineWhere.OR = [
        { sku: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
        { order: { is: { OR: [
          { orderNumber: { contains: search, mode: 'insensitive' } },
          { quoteId: { contains: search, mode: 'insensitive' } },
          { customer: { is: { OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { mobile: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ] } } },
        ] } } },
      ];
    }
    if (args?.brand) lineWhere.brand = args.brand;
    if (args?.category) lineWhere.category = args.category;
    if (args?.locationId) {
      lineWhere.AND = [
        ...(lineWhere.AND || []),
        { OR: [
          { lotReservations: { some: { locationId: args.locationId, status: 'reserved' } } },
          { pickLines: { some: { locationId: args.locationId, status: { notIn: ['cancelled', 'dispatched'] } } } },
        ] },
      ];
    }

    const status = String(args?.status || '').trim().toLowerCase();
    if (status === 'pending_inward') lineWhere.backorderedQuantity = { gt: 0 };
    else if (status === 'ready_to_pick') lineWhere.status = { in: ['open', 'reserved', 'ready', 'partial_ready'] };
    else if (status === 'partial_dispatch') lineWhere.status = 'partial_dispatched';
    else if (status === 'dispatched') lineWhere.status = 'dispatched';
    else if (status === 'delivered') lineWhere.status = 'delivered';
    // Sent, delivered and cancelled lines hold nothing and need nothing.
    else if (status === 'needs_reservation') {
      lineWhere.reservedQuantity = 0;
      lineWhere.allocatedQuantity = 0;
      lineWhere.backorderedQuantity = 0;
      lineWhere.status = { notIn: ['dispatched', 'delivered', 'cancelled', 'partial_dispatched', 'partial_delivered'] };
    }

    const sortMap: Record<string, any[]> = {
      oldest: [{ createdAt: 'asc' }, { id: 'asc' }],
      quantity_desc: [{ orderedQuantity: 'desc' }, { id: 'desc' }],
      inward_first: [{ backorderedQuantity: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
      newest: [{ createdAt: 'desc' }, { id: 'desc' }],
    };
    const query: any = {
      where: lineWhere,
      orderBy: sortMap[String(args?.sort || 'newest')] || sortMap.newest,
      take: limit + 1,
    };
    const cursor = String(args?.cursor || '').trim();
    if (cursor) {
      query.cursor = { id: cursor };
      query.skip = 1;
    }
    const [rawLines, aggregate, total] = await Promise.all([
      this.prisma.salesOrderLine.findMany(query) as any,
      this.prisma.salesOrderLine.aggregate({
        where: lineWhere,
        _sum: { orderedQuantity: true, reservedQuantity: true, allocatedQuantity: true, backorderedQuantity: true, dispatchedQuantity: true, deliveredQuantity: true, returnedQuantity: true },
      }) as any,
      this.prisma.salesOrderLine.count({ where: lineWhere }),
    ]);
    const hasNextPage = rawLines.length > limit;
    const page = hasNextPage ? rawLines.slice(0, limit) : rawLines;
    if (!page.length) {
      return { items: [], nextCursor: null, total, summary: this.dispatchLineSummary(aggregate?._sum || {}) };
    }

    const orderIds = Array.from(new Set(page.map((line: any) => line.salesOrderId).filter(Boolean))) as string[];
    const productIds = Array.from(new Set(page.map((line: any) => line.productId).filter(Boolean))) as string[];
    const lineIds = page.map((line: any) => line.id) as string[];
    const [orders, products, reservations, allocations, picks, dispatchLines, demands] = await Promise.all([
      this.prisma.salesOrder.findMany({ where: { id: { in: orderIds } } }) as any,
      productIds.length ? this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, sku: true, name: true, brand: true, media: true, category: true, unit: true, baseUom: true, salesUom: true, purchaseUom: true, piecesPerPack: true } }) as any : [],
      this.prisma.reservation.findMany({ where: { salesOrderLineId: { in: lineIds }, status: { in: ['reserved', 'backordered'] } } }) as any,
      this.prisma.lotReservation.findMany({ where: { salesOrderLineId: { in: lineIds }, status: 'reserved' }, include: { lot: true, location: true } }) as any,
      this.prisma.pickLine.findMany({ where: { salesOrderLineId: { in: lineIds }, status: { notIn: ['cancelled', 'dispatched'] } }, include: { pickList: true, lot: true, location: true } }) as any,
      this.prisma.dispatchLine.findMany({ where: { salesOrderLineId: { in: lineIds }, status: { not: 'cancelled' } } }) as any,
      orderIds.length ? (this.prisma as any).purchaseDemand.findMany({ where: { sourceOrderId: { in: orderIds }, status: { notIn: ['closed', 'cancelled'] } } }) : [],
    ]);
    const orderMap = new Map((orders as any[]).map((row) => [row.id, row]));
    const productMap = new Map((products as any[]).map((row) => [row.id, row]));
    const reservationsByLine = this.groupByKey(reservations as any[], 'salesOrderLineId');
    const allocationsByLine = this.groupByKey(allocations as any[], 'salesOrderLineId');
    const picksByLine = this.groupByKey(picks as any[], 'salesOrderLineId');
    const dispatchesByLine = this.groupByKey(dispatchLines as any[], 'salesOrderLineId');
    const demandByKey = new Map((demands as any[]).map((row) => [`${row.sourceOrderId}:${row.sourceLineKey}`, row]));
    const demandBySku = new Map((demands as any[]).map((row) => [`${row.sourceOrderId}:${row.sku}`, row]));
    const customerIds = Array.from(new Set((orders as any[]).map((row) => row.customerId).filter(Boolean)));
    const customers = customerIds.length ? await this.prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true, mobile: true, city: true, siteAddress: true } }) : [];
    const customerMap = new Map((customers as any[]).map((row) => [row.id, row]));

    const items = page.map((line: any) => {
      const order = orderMap.get(line.salesOrderId) as any;
      const ordered = Math.max(0, Number(line.orderedQuantity || 0));
      const reserved = Math.max(0, Number(line.reservedQuantity || 0));
      const allocated = Math.max(0, Number(line.allocatedQuantity || 0));
      const backordered = Math.max(0, Number(line.backorderedQuantity || 0));
      const dispatched = Math.max(0, Number(line.dispatchedQuantity || 0));
      const delivered = Math.max(0, Number(line.deliveredQuantity || 0));
      const returned = Math.max(0, Number(line.returnedQuantity || 0));
      const leftToDispatch = Math.max(0, ordered + returned - dispatched);
      const readyToPick = Math.max(0, Math.min(leftToDispatch, reserved + allocated));
      const status = delivered >= ordered && ordered > 0
        ? 'delivered'
        : dispatched >= ordered && ordered > 0
          ? 'dispatched'
          : dispatched > 0
            ? 'partial_dispatch'
            : backordered > 0
              ? 'pending_inward'
              : readyToPick > 0
                ? 'ready_to_pick'
                : 'needs_reservation';
      const lineReservations = reservationsByLine.get(line.id) || [];
      const lineAllocations = allocationsByLine.get(line.id) || [];
      const linePicks = picksByLine.get(line.id) || [];
      const lineDispatches = dispatchesByLine.get(line.id) || [];
      const demand = demandByKey.get(`${line.salesOrderId}:${line.lineKey}`) || demandBySku.get(`${line.salesOrderId}:${line.sku}`) || null;
      return {
        id: line.id,
        salesOrderId: line.salesOrderId,
        quoteId: line.quoteId,
        lineKey: line.lineKey,
        lineNo: line.lineNo,
        productId: line.productId,
        sku: line.sku,
        name: line.name,
        category: line.category,
        brand: line.brand,
        finish: line.finish,
        unit: line.unit,
        orderedQuantity: ordered,
        reservedQuantity: reserved,
        allocatedQuantity: allocated,
        backorderedQuantity: backordered,
        dispatchedQuantity: dispatched,
        deliveredQuantity: delivered,
        returnedQuantity: returned,
        leftToDispatch,
        readyToPick,
        status,
        nextAction: status === 'pending_inward' ? 'Receive or convert PO' : status === 'ready_to_pick' ? 'Create or continue pick' : status === 'partial_dispatch' ? 'Dispatch remaining balance' : status === 'needs_reservation' ? 'Reserve stock' : status === 'dispatched' ? 'Confirm delivery' : status,
        nextActionHref: status === 'pending_inward' ? '/dashboard/pending-inward' : status === 'dispatched' ? '/dashboard/dispatch' : '/dashboard/dispatch',
        order: order ? { id: order.id, orderNumber: order.orderNumber, status: order.status, paymentMode: order.paymentMode, paymentStatus: order.paymentStatus, totalAmount: order.totalAmount } : null,
        customer: order ? customerMap.get(order.customerId) || null : null,
        product: productMap.get(line.productId) || null,
        // Reservations, lot allocations and pick lines below count base units (pieces per box for boxed tiles).
        piecesPerUnit: stockFactor(productMap.get(line.productId)),
        ...tileBoxReading(productMap.get(line.productId)),
        purchaseDemand: demand,
        reservations: lineReservations,
        lotAllocations: lineAllocations,
        openPickLines: linePicks,
        dispatchLines: lineDispatches,
      };
    });
    return {
      items,
      nextCursor: hasNextPage ? page[page.length - 1].id : null,
      total,
      summary: this.dispatchLineSummary(aggregate?._sum || {}),
    };
  }

  private groupByKey(rows: any[], key: string) {
    const groups = new Map<string, any[]>();
    for (const row of rows || []) {
      const value = String(row?.[key] || '');
      if (!value) continue;
      groups.set(value, [...(groups.get(value) || []), row]);
    }
    return groups;
  }

  private dispatchLineSummary(sum: any) {
    const ordered = Number(sum.orderedQuantity || 0);
    const reserved = Number(sum.reservedQuantity || 0);
    const allocated = Number(sum.allocatedQuantity || 0);
    const backordered = Number(sum.backorderedQuantity || 0);
    const dispatched = Number(sum.dispatchedQuantity || 0);
    const delivered = Number(sum.deliveredQuantity || 0);
    const returned = Number(sum.returnedQuantity || 0);
    const leftToDispatch = Math.max(0, ordered + returned - dispatched);
    return {
      ordered,
      reserved,
      allocated,
      backordered,
      dispatched,
      delivered,
      returned,
      leftToDispatch,
      readyToPick: Math.max(0, Math.min(leftToDispatch, reserved + allocated)),
      pendingInward: backordered,
    };
  }

  async findJobById(id: string): Promise<any> {
    const job = await this.prisma.dispatchJob.findUnique({
      where: { id },
      include: { customer: true, dispatchChallans: true },
    } as any) as any;
    if (!job) throw new NotFoundException('Dispatch job not found');
    return job;
  }

  async createJob(data: CreateDispatchJobInput): Promise<any> {
    let salesOrder: any = null;
    if (data.salesOrderId) salesOrder = await this.prisma.salesOrder.findUnique({ where: { id: data.salesOrderId } }).catch(() => null);
    if (!salesOrder && data.quoteId) {
      const orders = await this.prisma.salesOrder.findMany({ where: { quoteId: data.quoteId, status: { in: ['open', 'partial'] } }, orderBy: { createdAt: 'desc' } });
      if (orders.length === 1) salesOrder = orders[0];
      if (orders.length > 1) throw new BadRequestException('Choose the sales order to create a dispatch job. This quote has multiple partial orders.');
    }
    if (!salesOrder) throw new BadRequestException('A sales order is required to create a dispatch job');
    const existingJob = await this.prisma.dispatchJob.findUnique({
      where: { salesOrderId: salesOrder.id }, include: { customer: true },
    } as any).catch(() => null);
    if (existingJob) return existingJob;
    const quote = await this.prisma.quote.findUnique({
      where: { id: salesOrder.quoteId },
      include: { customer: true },
    } as any) as any;
    if (!quote) throw new NotFoundException('Quote not found');

    const dueDate = data.scheduledAt ? new Date(data.scheduledAt) : new Date(Date.now() + 86400000);

    return this.prisma.dispatchJob.create({
      data: {
        id: ulid(),
        quoteId: quote.id,
        salesOrderId: salesOrder.id,
        customerId: data.customerId || quote.customerId,
        siteAddress: quote.customer?.siteAddress || '',
        status: 'pending',
        dueDate,
        ownerId: quote.ownerId,
        updatedAt: new Date(),
      },
      include: { customer: true },
    } as any) as any;
  }

  async updateJob(id: string, data: UpdateDispatchJobInput): Promise<any> {
    await this.findJobById(id);
    return this.prisma.dispatchJob.update({
      where: { id },
      data,
      include: { customer: true },
    } as any) as any;
  }

  async updateJobStatus(id: string, status: string): Promise<any> {
    await this.findJobById(id);
    return this.prisma.dispatchJob.update({
      where: { id },
      data: { status },
      include: { customer: true },
    } as any) as any;
  }

  async pickLists(args?: { salesOrderId?: string; status?: string; take?: number }) {
    const where: any = {};
    if (args?.salesOrderId) where.salesOrderId = args.salesOrderId;
    if (args?.status && args.status !== 'all') where.status = args.status;
    return this.prisma.pickList.findMany({
      where,
      include: {
        salesOrder: true,
        location: true,
        lines: { include: { salesOrderLine: true, product: true, lot: true, location: true }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(200, Number(args?.take) || 80)),
    });
  }

  async createPickList(input: CreatePickListInput, actorUserId: string) {
    const requestedRows = this.normalizeLines(input.lines) || [];
    return this.prisma.$transaction(async (tx: any) => {
      const [salesOrder, location] = await Promise.all([
        tx.salesOrder.findUnique({ where: { id: input.salesOrderId } }),
        tx.stockLocation.findUnique({ where: { id: input.locationId } }),
      ]);
      if (!salesOrder) throw new NotFoundException('Sales order not found');
      if (!location || location.status !== 'active') throw new BadRequestException('Select an active pick location');
      const existing = await tx.pickList.findFirst({
        where: { salesOrderId: salesOrder.id, locationId: location.id, status: { in: ['ready', 'picking', 'picked', 'partial_packed', 'packed', 'completed', 'challan_created'] } },
        include: { salesOrder: true, location: true, lines: { include: { salesOrderLine: true, product: true, lot: true, location: true } } },
      });
      if (existing && !requestedRows.length) return existing;
      const orderLines = await tx.salesOrderLine.findMany({ where: { salesOrderId: salesOrder.id, productId: { not: null } } });
      const orderLineIds = orderLines.map((line: any) => line.id);
      const allocations = await tx.lotReservation.findMany({
        where: { salesOrderLineId: { in: orderLineIds }, locationId: location.id, status: 'reserved', quantity: { gt: 0 } },
        include: { salesOrderLine: true, lot: true, location: true },
        orderBy: { reservedAt: 'asc' },
      });
      const openPicks = await tx.pickLine.findMany({
        where: {
          salesOrderLineId: { in: orderLineIds }, locationId: location.id,
          // Sent, cancelled or returned pick lines no longer hold any reserved stock.
          status: { notIn: ['dispatched', 'cancelled', 'returned'] },
          pickList: { status: { in: ['ready', 'picking', 'picked', 'partial_packed', 'packed', 'completed', 'challan_created'] } },
        },
      });
      const openByIdentity = new Map<string, number>();
      for (const line of openPicks) {
        const key = `${line.salesOrderLineId}:${line.lotId}:${line.locationId}`;
        openByIdentity.set(key, (openByIdentity.get(key) || 0) + Number(line.requestedQuantity || 0));
      }
      const requestedByIdentity = new Map<string, number>();
      for (const row of requestedRows) {
        const key = `${row.salesOrderLineId || ''}:${row.lotId || ''}:${row.locationId || location.id}`;
        const quantity = this.wholeQty(row.quantity ?? row.requestedQuantity, 'Pick quantity');
        if (quantity > 0) requestedByIdentity.set(key, quantity);
      }
      const pickProducts = requestedRows.length
        ? new Map(((await tx.product.findMany({ where: { id: { in: Array.from(new Set(allocations.map((row: any) => row.salesOrderLine?.productId).filter(Boolean))) as string[] } } })) as any[]).map((row) => [row.id, row]))
        : new Map<string, any>();
      let selected = allocations.map((allocation: any) => {
        const key = `${allocation.salesOrderLineId}:${allocation.lotId}:${allocation.locationId}`;
        const available = Math.max(0, Number(allocation.quantity || 0) - Number(openByIdentity.get(key) || 0));
        const requested = requestedRows.length ? Number(requestedByIdentity.get(key) || 0) : available;
        if (requested > available) throw new BadRequestException(`${allocation.lot.lotNumber} has only ${available} unpicked reserved units`);
        return { allocation, requested, available };
      });
      if (requestedRows.length) {
        this.assertFullBoxesPerOrderLine(selected.map((row: any) => ({
          salesOrderLineId: row.allocation.salesOrderLineId, product: pickProducts.get(row.allocation.salesOrderLine?.productId),
          quantity: row.requested, systemQuantity: row.available,
        })));
      }
      selected = selected.filter((row: any) => row.requested > 0);
      if (!selected.length) {
        const elsewhere = ((await this.unpickedReservedByLocation(tx, [salesOrder.id])).get(salesOrder.id) || [])
          .filter((row) => row.locationId !== location.id)
          .map((row) => row.name || row.code);
        throw new BadRequestException(elsewhere.length
          ? `No unpicked reserved stock is available at ${location.name || 'this location'}. This order's reserved stock is at: ${elsewhere.join(', ')}.`
          : 'No unpicked reserved stock is available at this location. This order has no reserved stock left to pick.');
      }
      const pickNumber = await nextDocumentNumber(tx, 'pick_list', 'PK', new Date(), {
        existingNumbers: async (prefixForYear) => (await tx.pickList.findMany({
          where: { pickNumber: { startsWith: prefixForYear } }, select: { pickNumber: true },
        })).map((row: any) => row.pickNumber),
      });
      const pick = await tx.pickList.create({
        data: {
          id: ulid(), pickNumber, salesOrderId: salesOrder.id, locationId: location.id,
          status: 'ready', assignedTo: input.assignedTo || null, createdBy: actorUserId,
          notes: input.notes || '', metadata: {}, updatedAt: new Date(),
        },
      });
      for (const { allocation, requested } of selected) {
        await tx.pickLine.create({
          data: {
            id: ulid(), pickListId: pick.id, salesOrderLineId: allocation.salesOrderLineId,
            productId: allocation.salesOrderLine.productId, lotId: allocation.lotId, locationId: allocation.locationId,
            requestedQuantity: requested, status: 'pending', metadata: { lotReservationId: allocation.id }, updatedAt: new Date(),
          },
        });
      }
      await tx.auditEvent.create({
        data: {
          id: ulid(), actorUserId, action: 'pick_list.create', entityType: 'PickList', entityId: pick.id,
          summary: `Created ${pickNumber}`, metadata: { salesOrderId: salesOrder.id, locationId: location.id, lineCount: selected.length },
        },
      });
      return tx.pickList.findUnique({
        where: { id: pick.id },
        include: { salesOrder: true, location: true, lines: { include: { salesOrderLine: true, product: true, lot: true, location: true } } },
      });
    }, { isolationLevel: 'Serializable', timeout: 30000 });
  }

  async transitionPickList(id: string, action: string, input: any, actorUserId: string) {
    const normalizedAction = String(action || '').trim().toLowerCase();
    if (!['start', 'pick', 'pack', 'complete', 'cancel'].includes(normalizedAction)) throw new BadRequestException('Unsupported pick-list action');
    const inputLines = new Map((this.normalizeLines(input?.lines) || []).map((row: any) => [String(row.pickLineId || row.id || ''), row]));
    return this.prisma.$transaction(async (tx: any) => {
      const pick = await tx.pickList.findUnique({ where: { id }, include: { lines: { include: { product: true } } } });
      if (!pick) throw new NotFoundException('Pick list not found');
      if (normalizedAction === 'cancel') {
        if (!['ready', 'picking', 'picked', 'partial_packed', 'packed', 'completed'].includes(pick.status)) throw new BadRequestException(`${pick.pickNumber} cannot be cancelled from ${pick.status}`);
        // A packed pick can be undone only while none of it is on a live challan; its stock stays reserved for the order.
        const onChallan = await tx.dispatchLine.count({ where: { pickLineId: { in: pick.lines.map((line: any) => line.id) }, status: { notIn: ['cancelled', 'returned'] } } });
        if (onChallan) throw new BadRequestException(`${pick.pickNumber} is on a challan. Cancel the challan first.`);
        await tx.pickLine.updateMany({ where: { pickListId: id }, data: { status: 'cancelled', updatedAt: new Date() } });
        await tx.pickList.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date(), metadata: { ...(pick.metadata as any), cancelReason: input?.reason || 'Cancelled' } } });
      } else if (normalizedAction === 'start') {
        if (pick.status !== 'ready') throw new BadRequestException(`${pick.pickNumber} cannot start from ${pick.status}`);
        await tx.pickList.update({ where: { id }, data: { status: 'picking', startedAt: new Date(), assignedTo: input?.assignedTo || pick.assignedTo || actorUserId, updatedAt: new Date() } });
      } else if (normalizedAction === 'pick') {
        if (!['ready', 'picking'].includes(pick.status)) throw new BadRequestException(`${pick.pickNumber} cannot be picked from ${pick.status}`);
        const picked = new Map<string, number>();
        for (const line of pick.lines) {
          const row: any = inputLines.get(line.id);
          if (!row) continue;
          const quantity = this.wholeQty(row.pickedQuantity ?? row.quantity, 'Picked quantity');
          if (quantity < 0 || quantity > line.requestedQuantity) throw new BadRequestException('Picked quantity must be between zero and requested quantity');
          picked.set(line.id, quantity);
        }
        // Per order line, as it stands after this save (rows not sent keep what they had).
        this.assertFullBoxesPerOrderLine(pick.lines.filter((line: any) => line.status !== 'cancelled').map((line: any) => ({
          salesOrderLineId: line.salesOrderLineId, product: line.product,
          quantity: picked.has(line.id) ? picked.get(line.id) : Number(line.pickedQuantity || 0),
          systemQuantity: line.requestedQuantity, touched: picked.has(line.id),
        })));
        for (const line of pick.lines) {
          if (!picked.has(line.id)) continue;
          const quantity = picked.get(line.id) as number;
          await tx.pickLine.update({ where: { id: line.id }, data: { pickedQuantity: quantity, status: quantity === line.requestedQuantity ? 'picked' : 'partial', pickedBy: actorUserId, pickedAt: new Date(), updatedAt: new Date() } });
        }
        const refreshed = await tx.pickLine.findMany({ where: { pickListId: id } });
        const fullyPicked = refreshed.every((line: any) => line.pickedQuantity === line.requestedQuantity);
        await tx.pickList.update({ where: { id }, data: { status: fullyPicked ? 'picked' : 'picking', startedAt: pick.startedAt || new Date(), updatedAt: new Date() } });
      } else if (normalizedAction === 'pack') {
        if (!['picking', 'picked', 'partial_packed'].includes(pick.status)) throw new BadRequestException(`${pick.pickNumber} cannot be packed from ${pick.status}`);
        const packed = new Map<string, number>();
        for (const line of pick.lines) {
          const row: any = inputLines.get(line.id);
          if (!row) continue;
          const quantity = this.wholeQty(row.packedQuantity ?? row.quantity, 'Packed quantity');
          if (quantity < 0 || quantity > line.pickedQuantity) throw new BadRequestException('Packed quantity cannot exceed picked quantity');
          packed.set(line.id, quantity);
        }
        // Per order line, as it stands after this save (rows not sent keep what they had).
        this.assertFullBoxesPerOrderLine(pick.lines.filter((line: any) => line.status !== 'cancelled').map((line: any) => ({
          salesOrderLineId: line.salesOrderLineId, product: line.product,
          quantity: packed.has(line.id) ? packed.get(line.id) : Number(line.packedQuantity || 0),
          systemQuantity: line.pickedQuantity, touched: packed.has(line.id),
        })));
        for (const line of pick.lines) {
          if (!packed.has(line.id)) continue;
          const quantity = packed.get(line.id) as number;
          await tx.pickLine.update({ where: { id: line.id }, data: { packedQuantity: quantity, status: quantity === line.requestedQuantity ? 'packed' : 'partial_packed', updatedAt: new Date() } });
        }
        const refreshed = await tx.pickLine.findMany({ where: { pickListId: id } });
        const fullyPacked = refreshed.every((line: any) => line.packedQuantity === line.requestedQuantity);
        await tx.pickList.update({ where: { id }, data: { status: fullyPacked ? 'packed' : 'partial_packed', updatedAt: new Date() } });
      } else {
        if (!['packed', 'partial_packed'].includes(pick.status)) throw new BadRequestException(`${pick.pickNumber} must have packed quantities before completion`);
        const packedTotal = pick.lines.reduce((sum: number, line: any) => sum + Number(line.packedQuantity || 0), 0);
        if (packedTotal <= 0) throw new BadRequestException('Pack at least one unit before completing the pick list');
        for (const line of pick.lines) {
          if (line.packedQuantity > 0) {
            await tx.pickLine.update({ where: { id: line.id }, data: { requestedQuantity: line.packedQuantity, pickedQuantity: line.packedQuantity, status: 'packed', updatedAt: new Date() } });
          } else {
            await tx.pickLine.update({ where: { id: line.id }, data: { requestedQuantity: 0, pickedQuantity: 0, status: 'cancelled', updatedAt: new Date() } });
          }
        }
        await tx.pickList.update({ where: { id }, data: { status: 'completed', completedAt: new Date(), updatedAt: new Date() } });
      }
      await tx.auditEvent.create({
        data: { id: ulid(), actorUserId, action: `pick_list.${normalizedAction}`, entityType: 'PickList', entityId: id, summary: `${normalizedAction} ${pick.pickNumber}`, metadata: {} },
      });
      return tx.pickList.findUnique({
        where: { id }, include: { salesOrder: true, location: true, lines: { include: { salesOrderLine: true, product: true, lot: true, location: true } } },
      });
    }, { isolationLevel: 'Serializable', timeout: 30000 });
  }

  async createChallan(data: CreateChallanInput, actorUserId = 'system') {
    const dispatchJobId = data.dispatchJobId || data.jobId;
    if (!dispatchJobId) throw new BadRequestException('A dispatch job is required to create a challan');

    const job = await this.prisma.dispatchJob.findUnique({
      where: { id: dispatchJobId },
      include: { quote: true, customer: true },
    } as any) as any;
    if (!job) throw new NotFoundException('Dispatch job not found');
    const salesOrder = job.salesOrderId
      ? await this.prisma.salesOrder.findUnique({ where: { id: job.salesOrderId } }).catch(() => null)
      : await this.prisma.salesOrder.findFirst({ where: { quoteId: job.quoteId } }).catch(() => null);
    if (!salesOrder) throw new BadRequestException('Dispatch requires a linked Sales Order. Convert the quote to a sales order first.');

    const transport = this.normalizeTransport(data, job);
    const requestedLines = this.normalizeLines(data.lines) || [];
    // Special-order tile lines have no Product Master item, no lot and no pick list.
    // They go on a challan once their goods have been received against the order.
    const specialLines = await this.specialOrderChallanLines(salesOrder, requestedLines);
    if (!data.pickListId && !specialLines.length) throw new BadRequestException('Complete a pick list before creating a challan');
    const pickList: any = data.pickListId ? await this.prisma.pickList.findUnique({
      where: { id: data.pickListId },
      include: { lines: { include: { salesOrderLine: true, product: true, lot: true, location: true } } },
    }) : null;
    if (data.pickListId && (!pickList || pickList.salesOrderId !== salesOrder.id)) throw new BadRequestException('Selected pick list does not belong to this sales order');
    if (pickList && !['packed', 'completed'].includes(pickList.status)) throw new BadRequestException('Pick list must be completed before challan creation');

    const contactPhone = transport.contactPhone;

    const priorDispatchLines = pickList ? await this.prisma.dispatchLine.findMany({
      where: { pickLineId: { in: pickList.lines.map((line: any) => line.id) }, status: { notIn: ['cancelled', 'returned'] } },
    }) : [];
    const priorByPickLine = new Map<string, number>();
    for (const line of priorDispatchLines) {
      if (!line.pickLineId) continue;
      priorByPickLine.set(line.pickLineId, (priorByPickLine.get(line.pickLineId) || 0) + Number(line.packedQuantity || 0));
    }
    const pickRequests = requestedLines.filter((line: any) => line.pickLineId);
    const requestedByPickLine = new Map(pickRequests.map((line: any) => [String(line.pickLineId || ''), this.wholeQty(line.dispatchQty ?? line.quantity, 'Challan quantity')]));
    const pickChallanRows = (pickList?.lines || []).map((line: any) => {
      const availablePacked = Math.max(0, Number(line.packedQuantity || 0) - Number(priorByPickLine.get(line.id) || 0));
      const dispatchQty = pickRequests.length ? Number(requestedByPickLine.get(line.id) || 0) : availablePacked;
      if (dispatchQty > availablePacked) throw new BadRequestException(`${line.product.sku} has only ${availablePacked} packed units left on ${pickList.pickNumber}`);
      return {
        availablePacked,
        product: line.product,
        pickLineId: line.id,
        salesOrderLineId: line.salesOrderLineId,
        lineKey: line.salesOrderLine.lineKey,
        quoteLineId: line.salesOrderLine.quoteLineId,
        productId: line.productId,
        lotId: line.lotId,
        locationId: line.locationId,
        sku: line.product.sku,
        name: line.product.name,
        category: line.product.category,
        brand: line.product.brand,
        finish: line.product.finish,
        // Pick lines count base units (pieces for a boxed tile); keep the order's unit for reading.
        unit: String(line.product.baseUom || line.salesOrderLine.unit || 'PC').toUpperCase(),
        orderUnit: line.salesOrderLine.unit,
        piecesPerUnit: stockFactor(line.product),
        dispatchQty,
      };
    });
    if (pickRequests.length) {
      this.assertFullBoxesPerOrderLine(pickChallanRows.map((row: any) => ({
        salesOrderLineId: row.salesOrderLineId, product: row.product, quantity: row.dispatchQty, systemQuantity: row.availablePacked,
      })));
    }
    const pickChallanLines = pickChallanRows
      .filter((row: any) => row.dispatchQty > 0)
      .map(({ availablePacked: _availablePacked, product: _product, ...line }: any) => line);
    const challanLines = [...pickChallanLines, ...specialLines];
    if (!challanLines.length) throw new BadRequestException('Select at least one ready item to create a challan');
    await this.assertDispatchableLines(challanLines, job);
    const challan = await this.prisma.$transaction(async (tx: any) => {
      const created = await tx.dispatchChallan.create({
        data: {
          id: ulid(), challanNumber: await this.generateChallanNumber(tx),
          quoteId: data.quoteId || job.quoteId, salesOrderId: data.salesOrderId || salesOrder.id,
          dispatchJobId, customerId: data.customerId || job.customerId, status: 'pending',
          vehicleNumber: transport.vehicleNumber, driverName: transport.driverName,
          transporterName: transport.transporterName, contactPhone,
          transportMode: transport.transportMode,
          siteAddress: data.siteAddress || job.siteAddress, remarks: transport.notes,
          lines: challanLines, updatedAt: new Date(),
        },
        include: { customer: true, quote: true },
      });
      await this.createDispatchRecordsForChallanTx(tx, created, job, salesOrder, challanLines, { ...data, transporterName: transport.transporterName || undefined, transporter: transport.transporterName || undefined, vehicleNumber: transport.vehicleNumber || undefined, vehicleNo: transport.vehicleNumber || undefined, driverName: transport.driverName || undefined, contactPhone: transport.contactPhone || undefined, driverPhone: transport.contactPhone || undefined, remarks: transport.notes, notes: transport.notes });
      await tx.dispatchJob.update({
        where: { id: dispatchJobId }, data: { status: 'packed', updatedAt: new Date() },
      });
      if (pickList) {
        // Only a pick whose every packed unit is now on a challan is finished; a part
        // challan leaves the rest of the pick ready for the next challan.
        const onChallans = await tx.dispatchLine.groupBy({
          by: ['pickLineId'],
          where: { pickLineId: { in: pickList.lines.map((line: any) => line.id) }, status: { notIn: ['cancelled', 'returned'] } },
          _sum: { packedQuantity: true },
        });
        const coveredByLine = new Map((onChallans as any[]).map((row) => [row.pickLineId, Number(row._sum?.packedQuantity || 0)]));
        const fullyCovered = pickList.lines.every((line: any) => Number(line.packedQuantity || 0) <= 0 || Number(coveredByLine.get(line.id) || 0) >= Number(line.packedQuantity || 0));
        if (fullyCovered) await tx.pickList.update({ where: { id: pickList.id }, data: { status: 'challan_created', updatedAt: new Date() } });
      }
      await tx.auditEvent.create({
        data: {
          id: ulid(), actorUserId, action: 'dispatch_challan.create', entityType: 'DispatchChallan', entityId: created.id,
          summary: `Created ${created.challanNumber}`,
          metadata: { pickListId: pickList?.id || null, lineCount: challanLines.length, transportMode: transport.transportMode, specialOrderLines: specialLines.length },
        },
      });
      return created;
    }, { isolationLevel: 'Serializable', timeout: 30000 });
    await this.notifications.create({
      title: 'Partial challan created',
      message: `${challan.challanNumber} created for ${job.customer?.name || 'customer'}. Dispatch only listed rows.`,
      type: 'challan_created',
      entityType: 'DispatchChallan',
      entityId: challan.id,
      href: '/dashboard/dispatch',
      targetUserId: job.quote?.ownerId || job.ownerId || salesOrder.ownerId,
      metadata: { dispatchJobId, quoteId: challan.quoteId },
    });
    return challan;
  }

  async confirmDelivery(id: string, input: any, actorUserId: string) {
    const receivedByName = String(input?.receivedByName || '').trim();
    if (!receivedByName) throw new BadRequestException('Recipient name is required to confirm delivery');
    const proofType = String(input?.proofType || 'manual').trim().toLowerCase();
    if (!['manual', 'otp', 'photo', 'signature'].includes(proofType)) throw new BadRequestException('Delivery proof type must be manual, OTP, photo, or signature');
    const proofUrl = String(input?.proofUrl || '').trim() || null;
    if (['photo', 'signature'].includes(proofType) && !proofUrl) throw new BadRequestException(`${proofType} delivery proof requires an uploaded proof file`);
    return this.updateChallanStatus(id, 'delivered', actorUserId, {
      receivedByName,
      receivedByPhone: String(input?.receivedByPhone || '').trim() || null,
      proofType,
      proofUrl,
      latitude: input?.latitude == null ? null : Number(input.latitude),
      longitude: input?.longitude == null ? null : Number(input.longitude),
      notes: String(input?.notes || '').trim(),
      capturedAt: new Date().toISOString(),
    });
  }

  /**
   * Cancels a challan. Before it leaves: its lines go back to the pick so a new
   * challan can be made; stock was never taken out. After a failed delivery: the
   * goods are back, so stock is posted back in (re-reserved for the same order
   * line) with a movement record, and the order line is no longer counted as sent.
   */
  async cancelChallan(id: string, reasonInput: string, actorUserId: string) {
    const reason = String(reasonInput || '').replace(/\s+/g, ' ').trim().slice(0, 500);
    if (reason.length < 5) throw new BadRequestException('Say why this challan is being cancelled');
    return this.prisma.$transaction(async (tx: any) => {
      const challan = await tx.dispatchChallan.findUnique({ where: { id } });
      if (!challan) throw new NotFoundException('Challan not found');
      if (challan.status === 'cancelled') return challan;
      if (challan.status === 'dispatched') throw new BadRequestException(`${challan.challanNumber} is out for delivery. Mark the delivery as failed first, then cancel it when the goods are back.`);
      if (!['pending', 'failed_delivery'].includes(challan.status)) throw new BadRequestException(`${challan.challanNumber} is ${challan.status} and cannot be cancelled`);
      const lines = await tx.dispatchLine.findMany({ where: { challanId: id } });
      // Goods already billed: cancelling would let them be sent and billed again.
      const billed = lines.length ? await tx.salesInvoiceLine.findFirst({
        where: { dispatchLineId: { in: lines.map((line: any) => line.id) }, salesInvoice: { status: { not: 'void' } } },
        select: { salesInvoice: { select: { invoiceNumber: true } } },
      }) : null;
      if (billed) throw new BadRequestException(`${challan.challanNumber} is already billed on invoice ${billed.salesInvoice?.invoiceNumber || ''}. Void that invoice first, then cancel the challan.`);
      const wasOut = challan.status === 'failed_delivery';
      if (wasOut) {
        await this.returnFailedDeliveryStockTx(tx, challan, lines, actorUserId, reason);
      } else {
        await tx.dispatchLine.updateMany({ where: { challanId: id }, data: { status: 'cancelled', updatedAt: new Date() } });
      }
      // The pick is open again: a finished pick goes back to "completed" so a new challan can be made.
      const pickLineIds = lines.map((line: any) => line.pickLineId).filter(Boolean);
      if (pickLineIds.length) {
        const pickLines = await tx.pickLine.findMany({ where: { id: { in: pickLineIds } }, select: { pickListId: true } });
        const pickIds = Array.from(new Set(pickLines.map((row: any) => row.pickListId)));
        if (!wasOut) await tx.pickList.updateMany({ where: { id: { in: pickIds }, status: 'challan_created' }, data: { status: 'completed', updatedAt: new Date() } });
      }
      await tx.shipment.updateMany({ where: { challanId: id }, data: { status: 'cancelled', updatedAt: new Date() } });
      const updated = await tx.dispatchChallan.update({
        where: { id },
        data: { status: 'cancelled', remarks: [String(challan.remarks || '').trim(), `Cancelled: ${reason}`].filter(Boolean).join('\n'), updatedAt: new Date() },
      });
      await this.refreshJobStatusTx(tx, challan.dispatchJobId);
      await tx.auditEvent.create({ data: {
        id: ulid(), actorUserId, action: 'dispatch_challan.cancel', entityType: 'DispatchChallan', entityId: id,
        summary: `Cancelled ${challan.challanNumber}${wasOut ? ' after a failed delivery; stock taken back' : ''}`,
        metadata: { reason, statusWas: challan.status, stockReturned: wasOut, lineCount: lines.length },
      } });
      return updated;
    }, { isolationLevel: 'Serializable', timeout: 60000 });
  }

  /** The delivery did not happen. Goods are still on the books as sent until the challan is cancelled or sent again. */
  async reportFailedDelivery(id: string, reasonInput: string, actorUserId: string) {
    const reason = String(reasonInput || '').replace(/\s+/g, ' ').trim().slice(0, 500);
    if (reason.length < 5) throw new BadRequestException('Say why the delivery failed');
    return this.prisma.$transaction(async (tx: any) => {
      const challan = await tx.dispatchChallan.findUnique({ where: { id } });
      if (!challan) throw new NotFoundException('Challan not found');
      if (challan.status === 'failed_delivery') return challan;
      if (challan.status !== 'dispatched') throw new BadRequestException(`${challan.challanNumber} is ${challan.status}; only a challan out for delivery can fail`);
      await tx.dispatchLine.updateMany({ where: { challanId: id, status: 'dispatched' }, data: { status: 'failed_delivery', updatedAt: new Date() } });
      await tx.shipment.updateMany({ where: { challanId: id }, data: { status: 'failed_delivery', updatedAt: new Date() } });
      const updated = await tx.dispatchChallan.update({
        where: { id },
        data: { status: 'failed_delivery', remarks: [String(challan.remarks || '').trim(), `Delivery failed: ${reason}`].filter(Boolean).join('\n'), updatedAt: new Date() },
      });
      await this.refreshJobStatusTx(tx, challan.dispatchJobId);
      await tx.auditEvent.create({ data: {
        id: ulid(), actorUserId, action: 'dispatch_challan.failed_delivery', entityType: 'DispatchChallan', entityId: id,
        summary: `Delivery failed for ${challan.challanNumber}`, metadata: { reason },
      } });
      return updated;
    }, { isolationLevel: 'Serializable', timeout: 30000 });
  }

  /** Posts the goods of a failed delivery back into stock, held again for the same order line. */
  private async returnFailedDeliveryStockTx(tx: any, challan: any, lines: any[], actorUserId: string, reason: string) {
    const touchedOrderLines = new Set<string>();
    const order = challan.salesOrderId ? await tx.salesOrder.findUnique({ where: { id: challan.salesOrderId } }) : null;
    // A cancelled order gets nothing held back: its goods come back as free stock.
    const orderLive = !order || !['cancelled', 'closed'].includes(String(order.status || ''));
    const freedProducts: string[] = [];
    for (const line of lines) {
      if (!['dispatched', 'failed_delivery'].includes(String(line.status))) continue;
      const quantity = Number(line.dispatchedQuantity || line.packedQuantity || 0);
      if (quantity <= 0) continue;
      if (line.productId) {
        const allocations: any[] = Array.isArray(line.metadata?.lotAllocations) && line.metadata.lotAllocations.length
          ? line.metadata.lotAllocations
          : line.lotId && line.locationId ? [{ lotId: line.lotId, locationId: line.locationId, quantity }] : [];
        let left = quantity;
        for (const allocation of allocations) {
          const back = Math.min(left, Number(allocation.quantity || 0));
          if (back <= 0 || !allocation.lotId || !allocation.locationId) continue;
          left -= back;
          const lotReservation = line.salesOrderLineId && orderLive ? await tx.lotReservation.findFirst({
            where: { salesOrderLineId: line.salesOrderLineId, lotId: String(allocation.lotId), locationId: String(allocation.locationId) },
            include: { reservation: true },
            orderBy: { updatedAt: 'desc' },
          }) : null;
          await applyLotStockPostingTx(tx, {
            productId: line.productId, lotId: String(allocation.lotId), locationId: String(allocation.locationId),
            idempotencyKey: `failed-delivery-return:${challan.id}:${line.id}:${allocation.lotId}:${allocation.locationId}`,
            type: 'failed_delivery_return', direction: 'in', quantity: back,
            onHandDelta: back, reservedDelta: lotReservation ? back : 0,
            reason: `Back from failed delivery ${challan.challanNumber}: ${reason}`, createdBy: actorUserId,
            relatedQuoteId: challan.quoteId, relatedChallanId: challan.id,
            referenceType: 'DispatchChallan', referenceId: challan.id, sourceDocumentNo: challan.challanNumber,
            metadata: { dispatchLineId: line.id, salesOrderLineId: line.salesOrderLineId, reReserved: Boolean(lotReservation) },
          });
          if (lotReservation) {
            const heldNow = lotReservation.status === 'reserved' ? Number(lotReservation.quantity || 0) : 0;
            await tx.lotReservation.update({ where: { id: lotReservation.id }, data: { quantity: heldNow + back, status: 'reserved', releasedAt: null, updatedAt: new Date() } });
            const reservation = await tx.reservation.findUnique({ where: { id: lotReservation.reservationId } });
            const reservationNow = reservation && reservation.status === 'reserved' ? Number(reservation.quantity || 0) : 0;
            await tx.reservation.update({ where: { id: lotReservation.reservationId }, data: { quantity: reservationNow + back, status: 'reserved', updatedAt: new Date() } });
          } else {
            freedProducts.push(line.productId);
          }
        }
        if (left > 0) throw new BadRequestException(`${line.sku}: could not find the lots it was sent from, so its stock cannot be taken back automatically`);
        if (line.pickLineId) await tx.pickLine.updateMany({ where: { id: line.pickLineId }, data: { status: 'returned', updatedAt: new Date() } });
      } else if (line.salesOrderLineId) {
        // Special-order tile: no stock record, only the order line's sent and ready counts move back.
        const orderLine = await tx.salesOrderLine.findUnique({ where: { id: line.salesOrderLineId } });
        if (orderLine) {
          await tx.salesOrderLine.update({
            where: { id: orderLine.id },
            data: {
              dispatchedQuantity: Math.max(0, Number(orderLine.dispatchedQuantity || 0) - quantity),
              allocatedQuantity: Math.min(Number(orderLine.orderedQuantity || 0), Number(orderLine.allocatedQuantity || 0) + quantity),
              updatedAt: new Date(),
            },
          });
        }
        await tx.stockLedgerEntry.create({
          data: {
            id: ulid(), productId: null, locationId: null, type: 'special_order_return', quantity, direction: 'in',
            referenceType: 'DispatchChallan', referenceId: challan.id, sourceDocumentNo: challan.challanNumber,
            reason: `Special-order goods back from failed delivery ${challan.challanNumber}`, createdBy: actorUserId,
            metadata: { dispatchLineId: line.id, salesOrderLineId: line.salesOrderLineId, sku: line.sku },
          },
        });
      }
      await tx.dispatchLine.update({ where: { id: line.id }, data: { status: 'returned', returnedQuantity: quantity, updatedAt: new Date() } });
      if (line.salesOrderLineId && line.productId) touchedOrderLines.add(line.salesOrderLineId);
    }
    // Sent counts on the order lines no longer include the goods that came back.
    for (const orderLineId of touchedOrderLines) {
      const orderLine = await tx.salesOrderLine.findUnique({ where: { id: orderLineId } });
      if (!orderLine) continue;
      const product = orderLine.productId ? await tx.product.findUnique({ where: { id: orderLine.productId } }) : null;
      const sent = await tx.dispatchLine.aggregate({ where: { salesOrderLineId: orderLineId, status: { in: ['dispatched', 'delivered', 'failed_delivery'] } }, _sum: { dispatchedQuantity: true } });
      const dispatchedQuantity = Math.min(Number(orderLine.orderedQuantity || 0), Math.floor(Number(sent._sum?.dispatchedQuantity || 0) / stockFactor(product) + 1e-9));
      await tx.salesOrderLine.update({ where: { id: orderLineId }, data: { dispatchedQuantity, updatedAt: new Date() } });
      if (!challan.quoteId) await refreshOrderLineStockTx(tx, orderLineId, product);
    }
    if (challan.quoteId) await syncSalesOrderLinesForQuoteTx(tx, challan.quoteId);
    // Goods that came back free (no live hold to return to) go to waiting orders first.
    await fillBackordersForProductsTx(tx, freedProducts, { actorUserId, source: 'failed_delivery' });
  }

  async updateChallanStatus(id: string, status: string, actorUserId = 'system', deliveryProof?: any) {
    const challan = await this.prisma.dispatchChallan.findUnique({ where: { id } });
    if (!challan) throw new NotFoundException('Challan not found');
    if (challan.status === status) return challan as any;
    // Cancelling and failed delivery move stock and pick lists, and need a reason.
    if (status === 'cancelled') return this.cancelChallan(id, 'Cancelled from the challan status', actorUserId);
    if (status === 'failed_delivery') return this.reportFailedDelivery(id, 'Delivery reported as failed', actorUserId);

    const allowedTransitions: Record<string, string[]> = {
      pending: ['dispatched', 'cancelled'],
      dispatched: ['delivered', 'failed_delivery'],
      failed_delivery: ['dispatched', 'cancelled'],
    };
    if (!(allowedTransitions[challan.status] || []).includes(status)) {
      throw new BadRequestException(`Challan cannot move from ${challan.status} to ${status}`);
    }
    if (status === 'delivered' && !deliveryProof) throw new BadRequestException('Use delivery confirmation with recipient proof to mark a challan delivered');

    if (status === 'dispatched' && challan.status === 'pending') {
      const job = await this.prisma.dispatchJob.findUnique({ where: { id: challan.dispatchJobId } }).catch(() => null);
      if (job) await this.assertDispatchableLines(this.normalizeLines((challan as any).lines) || [], job, { excludeChallanId: challan.id });
    }
    
    const data: any = { status };
    if (status === 'dispatched') {
      data.dispatchedAt = new Date();
    } else if (status === 'delivered') {
      data.deliveredAt = new Date();
      data.proof = deliveryProof;
    }
    
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.dispatchChallan.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Challan not found');
      if (current.status === status) return current;

      let updated: any = current;
      if (status === 'dispatched') {
        if (current.status === 'failed_delivery') {
          updated = await tx.dispatchChallan.update({ where: { id }, data });
          // Sent again after a failed attempt: the lines are on the road again.
          await tx.dispatchLine.updateMany({ where: { challanId: id, status: 'failed_delivery' }, data: { status: 'dispatched', updatedAt: new Date() } });
          await tx.shipment.updateMany({ where: { challanId: id }, data: { status: 'dispatched', updatedAt: new Date() } });
          await this.refreshJobStatusTx(tx, updated.dispatchJobId);
        } else {
        const claimed = await tx.dispatchChallan.updateMany({ where: { id, status: 'pending' }, data });
        updated = await tx.dispatchChallan.findUnique({ where: { id } });
        if (claimed.count !== 1) return updated;
        await this.consumeInventoryForChallan(tx, updated as any);
        await tx.shipment.updateMany({
          where: { challanId: updated.id },
          data: { status: 'dispatched', dispatchedAt: new Date(), updatedAt: new Date() },
        }).catch(() => null);
        await tx.dispatchLine.updateMany({
          where: { challanId: updated.id, status: 'packed' },
          data: { status: 'dispatched', updatedAt: new Date() },
        }).catch(() => null);
        await this.refreshJobStatusTx(tx, updated.dispatchJobId);
        const job = await tx.dispatchJob.findUnique({ where: { id: updated.dispatchJobId }, include: { quote: true, customer: true, salesOrder: true } as any } as any).catch(() => null) as any;
        if (job?.quote?.ownerId || job?.ownerId) {
          await tx.notification.create({
            data: {
              id: ulid(),
              title: 'Items dispatched',
              message: `${updated.challanNumber} has been dispatched for ${job.customer?.name || 'customer'}.`,
              type: 'dispatch_dispatched',
              entityType: 'DispatchChallan',
              entityId: updated.id,
              href: `/dashboard/dispatch?search=${encodeURIComponent(job.salesOrder?.orderNumber || job.customer?.name || "")}`,
              targetUserId: job.quote?.ownerId || job.ownerId,
              metadata: { quoteId: updated.quoteId },
            },
          }).catch(() => null);
        }
        }
      } else if (status === 'delivered') {
        updated = await tx.dispatchChallan.update({ where: { id }, data });
        await this.markChallanDeliveredTx(tx, updated as any, actorUserId);
        await this.refreshJobStatusTx(tx, updated.dispatchJobId);
        const job = await tx.dispatchJob.findUnique({ where: { id: updated.dispatchJobId }, include: { quote: true, customer: true, salesOrder: true } as any } as any).catch(() => null) as any;
        if (job?.quote?.ownerId || job?.ownerId) {
          await tx.notification.create({
            data: {
              id: ulid(),
              title: 'Delivery completed',
              message: `${updated.challanNumber} has been marked delivered for ${job.customer?.name || 'customer'}.`,
              type: 'dispatch_delivered',
              entityType: 'DispatchChallan',
              entityId: updated.id,
              href: `/dashboard/dispatch?search=${encodeURIComponent(job.salesOrder?.orderNumber || job.customer?.name || "")}`,
              targetUserId: job.quote?.ownerId || job.ownerId,
              metadata: { quoteId: updated.quoteId },
            },
          }).catch(() => null);
        }
      } else {
        updated = await tx.dispatchChallan.update({ where: { id }, data });
      }

      await tx.auditEvent.create({
        data: {
          id: ulid(), actorUserId, action: `dispatch_challan.${status}`, entityType: 'DispatchChallan', entityId: id,
          summary: `${updated.challanNumber} marked ${status}`, metadata: status === 'delivered' ? { proofType: deliveryProof?.proofType, receivedByName: deliveryProof?.receivedByName } : {},
        },
      });

      return updated;
    }, { isolationLevel: 'Serializable', timeout: 30000 });
  }

  async findAllChallans(args?: { status?: string; dispatchJobId?: string }) {
    const where: any = {};
    if (args?.status) where.status = args.status;
    if (args?.dispatchJobId) where.dispatchJobId = args.dispatchJobId;
    return this.prisma.dispatchChallan.findMany({
      where,
      include: { customer: true, quote: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    } as any) as any;
  }

  async findChallanById(id: string) {
    const challan = await this.prisma.dispatchChallan.findUnique({
      where: { id },
      include: { customer: true, quote: true },
    } as any) as any;
    if (!challan) throw new NotFoundException('Challan not found');
    const salesOrder = challan.salesOrderId
      ? await this.prisma.salesOrder.findUnique({ where: { id: challan.salesOrderId } }).catch(() => null)
      : null;
    return { ...challan, lines: await this.withPiecesPerUnit(challan.lines), salesOrder };
  }

  /**
   * Challan lines made before pieces per box was stored on them: a line counted
   * in pieces of a boxed tile gets the product's factor so it reads in boxes.
   * Lines counted in boxes (older tile challans) are left exactly as stored.
   */
  private async withPiecesPerUnit(rawLines: any) {
    const lines = Array.isArray(rawLines) ? rawLines : [];
    const productIds = Array.from(new Set(lines.map((line: any) => line?.productId).filter(Boolean))) as string[];
    if (!productIds.length) return rawLines;
    const products = await this.prisma.product.findMany({ where: { id: { in: productIds } } });
    return this.withBoxReading(lines, new Map((products as any[]).map((product) => [product.id, product])));
  }

  /** Adds piecesPerBox / soldBy (and a missing piecesPerUnit on pieces-counted lines) so a line reads in boxes. Read-only. */
  private withBoxReading(lines: any[], productById: Map<string, any>) {
    return lines.map((line: any) => {
      const product = line?.productId ? productById.get(line.productId) : null;
      if (!product) return line;
      const countedInPieces = String(line.unit || '').toUpperCase() === 'PC';
      return {
        ...line,
        ...(line.piecesPerUnit == null && countedInPieces ? { piecesPerUnit: stockFactor(product) } : {}),
        // Older lines stored in boxes keep reading as stored.
        ...(countedInPieces ? tileBoxReading(product) : {}),
      };
    });
  }

  async getDashboardStats() {
    const [pending, packed, dispatched, delivered] = await Promise.all([
      this.prisma.dispatchJob.count({ where: { status: 'pending' } }),
      this.prisma.dispatchJob.count({ where: { status: 'packed' } }),
      this.prisma.dispatchJob.count({ where: { status: 'dispatched' } }),
      this.prisma.dispatchJob.count({ where: { status: 'delivered' } }),
    ]);

    return { pending, packed, dispatched, delivered };
  }

  private async generateChallanNumber(client: any = this.prisma as any): Promise<string> {
    return nextDocumentNumber(client, 'challan', 'CH', new Date(), {
      existingNumbers: async (prefixForYear) => (await client.dispatchChallan.findMany({
        where: { challanNumber: { startsWith: prefixForYear } },
        select: { challanNumber: true },
      })).map((row) => row.challanNumber),
    });
  }

  private async generateShipmentNumber(client: any = this.prisma as any): Promise<string> {
    return nextDocumentNumber(client, 'shipment', 'SHP', new Date(), {
      existingNumbers: async (prefixForYear) => (await client.shipment.findMany({
        where: { shipmentNumber: { startsWith: prefixForYear } },
        select: { shipmentNumber: true },
      })).map((row: any) => row.shipmentNumber),
    });
  }

  private async createDispatchRecordsForChallanTx(tx: any, challan: any, job: any, salesOrder: any, lines: any[], input: CreateChallanInput) {
    const packageCount = Math.max(1, Math.trunc(Number(input.packages || 1)));
    const shipmentNumber = await this.generateShipmentNumber(tx);
      for (let index = 0; index < packageCount; index += 1) {
        await tx.dispatchPackage.create({
          data: {
            id: ulid(),
            dispatchJobId: job.id,
            challanId: challan.id,
            packageNumber: `${challan.challanNumber}-PKG-${String(index + 1).padStart(2, '0')}`,
            boxCount: 1,
            status: 'packed',
            packedBy: salesOrder.ownerId || job.ownerId,
            packedAt: new Date(),
            remarks: input.remarks || input.notes || '',
            updatedAt: new Date(),
            metadata: { source: 'challan_create' },
          },
        });
      }
      await tx.shipment.create({
        data: {
          id: ulid(),
          shipmentNumber,
          dispatchJobId: job.id,
          challanId: challan.id,
          transporterName: input.transporterName || input.transporter || null,
          vehicleNumber: input.vehicleNumber || input.vehicleNo || null,
          driverName: input.driverName || null,
          contactPhone: input.contactPhone || input.driverPhone || challan.contactPhone || null,
          status: 'ready',
          updatedAt: new Date(),
          metadata: { siteAddress: challan.siteAddress },
        },
      });
      for (const [index, line] of (lines || []).entries()) {
        const productId = String(line.productId || '').trim();
        const dispatchKey = productId || String(line.dispatchKey || line.sourceLineKey || line.tileCode || line.sku || index);
        const quantity = Math.trunc(Number(line.dispatchQty || line.qty || line.quantity || 0));
        const orderLine = await this.resolveOrderLineTx(tx, salesOrder.id, line);
        await tx.dispatchLine.create({
          data: {
            id: ulid(),
            dispatchJobId: job.id,
            challanId: challan.id,
            salesOrderId: salesOrder.id,
            salesOrderLineId: orderLine?.id || null,
            pickLineId: line.pickLineId || null,
            lotId: line.lotId || null,
            locationId: line.locationId || null,
            dispatchKey,
            productId: productId || null,
            sku: String(line.sku || line.tileCode || productId || `LINE-${index + 1}`),
            name: String(line.name || line.description || line.sku || `Line ${index + 1}`),
            orderedQuantity: quantity,
            packedQuantity: quantity,
            status: 'packed',
            updatedAt: new Date(),
            metadata: { snapshot: line, challanNumber: challan.challanNumber },
          },
        });
      }
  }

  private wholeQty(value: any, label: string) {
    const number = Number(value || 0);
    if (!Number.isFinite(number) || number < 0) throw new BadRequestException(`${label} cannot be negative`);
    if (!Number.isInteger(number)) throw new BadRequestException(`${label} must be a whole number (${number} is not). Stock is counted in whole units.`);
    return number;
  }

  /**
   * Real transport details for a challan. A vehicle delivery needs the vehicle
   * number, driver name and driver phone; a customer pickup needs none of them.
   */
  private normalizeTransport(data: ChallanTransportInput, job?: any) {
    const clean = (value: any, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
    const transportMode = String(data.transportMode || 'vehicle').trim().toLowerCase() === 'self_pickup' ? 'self_pickup' : 'vehicle';
    const notes = clean(data.notes ?? data.remarks, 500);
    if (transportMode === 'self_pickup') {
      const phone = clean(data.driverPhone || data.contactPhone || job?.customer?.mobile || '', 24);
      return { transportMode, vehicleNumber: null, driverName: clean(data.driverName, 80) || null, transporterName: null, contactPhone: phone, notes };
    }
    const vehicleNumber = clean(data.vehicleNumber || data.vehicleNo, 20).toUpperCase();
    const driverName = clean(data.driverName, 80);
    const contactPhone = clean(data.driverPhone || data.contactPhone, 24);
    const transporterName = clean(data.transporterName || data.transporter, 80) || null;
    if (!vehicleNumber || vehicleNumber === PLACEHOLDER_TRANSPORT.vehicleNumber) throw new BadRequestException('Enter the vehicle number, or choose customer pickup');
    if (!/^[A-Z0-9][A-Z0-9 -]{3,19}$/.test(vehicleNumber)) throw new BadRequestException('Vehicle number can use letters, numbers, spaces and dashes only (for example GJ 01 AB 1234)');
    if (driverName.length < 2 || driverName === PLACEHOLDER_TRANSPORT.driverName) throw new BadRequestException("Enter the driver's name");
    const digits = contactPhone.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 13 || /^0+$/.test(digits)) throw new BadRequestException("Enter the driver's phone number (10 digits)");
    return { transportMode, vehicleNumber, driverName, transporterName, contactPhone, notes };
  }

  /** Transport details can be corrected until the challan leaves. */
  async updateChallanTransport(id: string, input: ChallanTransportInput, actorUserId: string) {
    return this.prisma.$transaction(async (tx: any) => {
      const challan = await tx.dispatchChallan.findUnique({ where: { id }, include: { customer: true } });
      if (!challan) throw new NotFoundException('Challan not found');
      if (challan.status !== 'pending') throw new BadRequestException(`${challan.challanNumber} has already left; its transport details are final`);
      const transport = this.normalizeTransport(input, { customer: challan.customer });
      const before = { transportMode: challan.transportMode, vehicleNumber: challan.vehicleNumber, driverName: challan.driverName, transporterName: challan.transporterName, contactPhone: challan.contactPhone, remarks: challan.remarks };
      const updated = await tx.dispatchChallan.update({
        where: { id },
        data: {
          transportMode: transport.transportMode, vehicleNumber: transport.vehicleNumber, driverName: transport.driverName,
          transporterName: transport.transporterName, contactPhone: transport.contactPhone, remarks: transport.notes, updatedAt: new Date(),
        },
      });
      await tx.shipment.updateMany({
        where: { challanId: id },
        data: { transporterName: transport.transporterName, vehicleNumber: transport.vehicleNumber, driverName: transport.driverName, contactPhone: transport.contactPhone || null, updatedAt: new Date() },
      });
      await tx.auditEvent.create({ data: {
        id: ulid(), actorUserId, action: 'dispatch_challan.transport', entityType: 'DispatchChallan', entityId: id,
        summary: `Updated transport for ${challan.challanNumber}`, metadata: { before, after: transport },
      } });
      return updated;
    }, { isolationLevel: 'Serializable', timeout: 20000 });
  }

  /** Challan lines for special-order tile lines (no Product Master item) that have been received. */
  private async specialOrderChallanLines(salesOrder: any, requested: any[]) {
    const rows = (requested || []).filter((line: any) => !line.pickLineId && line.salesOrderLineId && Number(line.dispatchQty ?? line.quantity ?? 0) > 0);
    if (!rows.length) return [];
    const orderLines = await this.prisma.salesOrderLine.findMany({ where: { id: { in: rows.map((row: any) => String(row.salesOrderLineId)) }, salesOrderId: salesOrder.id } });
    const demands = await (this.prisma as any).purchaseDemand.findMany({ where: { sourceOrderId: salesOrder.id, sourceType: 'tile_special_order' } }).catch(() => []);
    return rows.map((row: any) => {
      const orderLine: any = orderLines.find((line: any) => line.id === String(row.salesOrderLineId));
      if (!orderLine) throw new BadRequestException('A special-order line does not belong to this sales order');
      if (orderLine.productId) throw new BadRequestException(`${orderLine.sku} is a stock item; dispatch it through a pick list`);
      const demand = (demands as any[]).find((item) => String(item.metadata?.salesOrderLineId || '') === orderLine.id)
        || (demands as any[]).find((item) => item.sku === orderLine.sku);
      if (!demand) throw new BadRequestException(`${orderLine.sku} has no special-order purchase yet; it cannot be dispatched`);
      return {
        salesOrderLineId: orderLine.id,
        lineKey: orderLine.lineKey,
        dispatchKey: demand.sourceLineKey,
        productId: null,
        type: 'tile',
        nonStock: true,
        tileCode: demand.sku,
        sku: orderLine.sku,
        name: orderLine.name,
        category: orderLine.category,
        brand: orderLine.brand,
        finish: orderLine.finish,
        unit: String(orderLine.unit || demand.unit || 'BOX').toUpperCase(),
        orderUnit: orderLine.unit,
        piecesPerUnit: 1,
        dispatchQty: this.wholeQty(row.dispatchQty ?? row.quantity, `${orderLine.sku} challan quantity`),
      };
    });
  }

  /**
   * Finds the order line a challan line belongs to. A challan line built from a
   * pick line carries its order-line id; that is the only safe match when the
   * same item sits in two rooms. Older lines without it fall back to quote line,
   * line key, and last to the product only when exactly one line has it.
   */
  private async resolveOrderLineTx(tx: any, salesOrderId: string, line: any) {
    const orderLineId = String(line?.salesOrderLineId || '').trim();
    if (orderLineId) {
      const exact = await tx.salesOrderLine.findUnique({ where: { id: orderLineId } });
      if (exact && exact.salesOrderId === salesOrderId) return exact;
    }
    if (line?.quoteLineId) {
      const byQuoteLine = await tx.salesOrderLine.findMany({ where: { salesOrderId, quoteLineId: String(line.quoteLineId) } });
      if (byQuoteLine.length === 1) return byQuoteLine[0];
    }
    const lineKey = String(line?.lineKey || '').trim();
    if (lineKey) {
      const byKey = await tx.salesOrderLine.findUnique({ where: { salesOrderId_lineKey: { salesOrderId, lineKey } } });
      if (byKey) return byKey;
    }
    const productId = String(line?.productId || '').trim();
    if (productId) {
      const byProduct = await tx.salesOrderLine.findMany({ where: { salesOrderId, productId } });
      if (byProduct.length === 1) return byProduct[0];
      if (byProduct.length > 1) {
        throw new BadRequestException(`${line?.sku || 'An item'} is on more than one line of this order and this challan line does not say which. Cancel the challan and create it again from the pick list.`);
      }
    }
    return null;
  }

  private normalizeLines(lines: any) {
    if (!lines) return null;
    if (typeof lines === 'string') {
      try {
        return JSON.parse(lines);
      } catch {
        return null;
      }
    }
    return Array.isArray(lines) ? lines : null;
  }

  private isTileLine(line: any) {
    return line?.type === 'tile' || line?.nonStock === true || String(line?.category || '').toLowerCase() === 'tiles';
  }

  private async consumeInventoryForChallan(tx: any, challan: any) {
    const lines = Array.isArray(challan.lines) ? challan.lines : [];
    const sentOrderLines = new Set<string>();
    for (const line of lines) {
      const productId = String(line.productId || '').trim();
      const quantity = Number(line.dispatchQty || line.qty || line.quantity || 0);
      if (quantity <= 0) continue;
      if (!productId) {
        await this.consumeSpecialOrderLineTx(tx, challan, line, quantity);
        continue;
      }

      const salesOrder = challan.salesOrderId
        ? await tx.salesOrder.findUnique({ where: { id: challan.salesOrderId } }).catch(() => null)
        : await tx.salesOrder.findFirst({ where: { quoteId: challan.quoteId } }).catch(() => null);
      let orderLine: any = null;
      if (salesOrder) {
        // The same item in two rooms is two order lines: match the exact line the pick carried.
        orderLine = await this.resolveOrderLineTx(tx, salesOrder.id, line);
        // One challan line per pick line (one lot): update only its own dispatch line, or a second
        // lot of the same item would overwrite the first lot's quantity.
        await tx.dispatchLine.updateMany({
          where: line.pickLineId
            ? { challanId: challan.id, pickLineId: String(line.pickLineId) }
            : orderLine ? { challanId: challan.id, salesOrderLineId: orderLine.id } : { challanId: challan.id, productId },
          data: { dispatchedQuantity: quantity, status: 'dispatched', updatedAt: new Date() },
        });
        if (orderLine) {
          // The challan counts base units; the order line counts selling units (whole boxes sent).
          const product = await tx.product.findUnique({ where: { id: productId } }).catch(() => null);
          const factor = stockFactor(product);
          let nextDispatched = Number(orderLine.dispatchedQuantity || 0) + quantity;
          if (factor > 1) {
            const sent = await tx.dispatchLine.aggregate({ where: { salesOrderLineId: orderLine.id, status: { in: ['dispatched', 'delivered'] } }, _sum: { dispatchedQuantity: true } });
            nextDispatched = Math.floor(Number(sent._sum?.dispatchedQuantity || 0) / factor + 1e-9);
          }
          nextDispatched = Math.min(Number(orderLine.orderedQuantity || 0), nextDispatched);
          sentOrderLines.add(orderLine.id);
          await tx.salesOrderLine.update({
            where: { id: orderLine.id },
            data: {
              dispatchedQuantity: nextDispatched,
              status: nextDispatched >= Number(orderLine.orderedQuantity || 0) ? 'dispatched' : 'partial_dispatched',
              updatedAt: new Date(),
            },
          });
        }
      }

      if (line.pickLineId && line.lotId && line.locationId && orderLine) {
        const consumedLots = await consumeExactReservedLotTx(tx, {
          salesOrderLineId: orderLine.id, productId, lotId: String(line.lotId), locationId: String(line.locationId),
          quantity, challanId: challan.id, challanNumber: challan.challanNumber, actorUserId: 'dispatch',
        });
        await tx.dispatchLine.updateMany({
          where: { challanId: challan.id, pickLineId: String(line.pickLineId) },
          data: { metadata: { quoteId: challan.quoteId, lotAllocations: consumedLots, pickControlled: true }, updatedAt: new Date() },
        });
        // A pick line sent in parts stays open until every packed unit has gone.
        const pickLineRow = await tx.pickLine.findUnique({ where: { id: String(line.pickLineId) } });
        const sentForPickLine = await tx.dispatchLine.aggregate({
          where: { pickLineId: String(line.pickLineId), status: { in: ['dispatched', 'delivered', 'failed_delivery'] } },
          _sum: { dispatchedQuantity: true },
        });
        const fullySent = Number(sentForPickLine._sum?.dispatchedQuantity || 0) >= Number(pickLineRow?.packedQuantity || 0);
        const pickedLine = fullySent
          ? await tx.pickLine.update({ where: { id: String(line.pickLineId) }, data: { status: 'dispatched', updatedAt: new Date() } })
          : pickLineRow;
        const remainingPickLines = await tx.pickLine.count({
          where: { pickListId: pickedLine.pickListId, status: { notIn: ['dispatched', 'cancelled'] } },
        });
        if (!remainingPickLines) {
          await tx.pickList.update({ where: { id: pickedLine.pickListId }, data: { status: 'dispatched', updatedAt: new Date() } });
        }
        continue;
      }

      let remainingToDispatch = quantity;
      const consumedLots: any[] = [];
      while (remainingToDispatch > 0) {
        const reservation = await tx.reservation.findFirst({
          where: { ...(salesOrder ? { salesOrderId: salesOrder.id } : { quoteId: challan.quoteId, salesOrderId: null }), productId, status: 'reserved' },
          orderBy: { createdAt: 'asc' },
        });
        if (!reservation) break;
        const consume = Math.min(remainingToDispatch, Number(reservation.quantity || 0));
        consumedLots.push(...await consumeReservedLotsTx(tx, {
          reservation, quantity: consume, challanId: challan.id, challanNumber: challan.challanNumber,
          actorUserId: 'dispatch',
        }));
        if (consume >= Number(reservation.quantity || 0)) {
          await tx.reservation.update({
            where: { id: reservation.id },
            data: { status: 'dispatched', updatedAt: new Date() },
          });
        } else {
          await tx.reservation.update({
            where: { id: reservation.id },
            data: { quantity: Number(reservation.quantity || 0) - consume, updatedAt: new Date() },
          });
        }
        remainingToDispatch -= consume;
      }
      if (remainingToDispatch > 0) {
        throw new BadRequestException(`${line.name || line.sku || productId} has ${quantity - remainingToDispatch} lot-reserved units, below dispatch quantity ${quantity}`);
      }
      const dispatchLines = await tx.dispatchLine.findMany({ where: { challanId: challan.id, productId } });
      for (const dispatchLine of dispatchLines) {
        await tx.dispatchLine.update({
          where: { id: dispatchLine.id },
          data: { metadata: { ...(dispatchLine.metadata || {}), quoteId: challan.quoteId, lotAllocations: consumedLots }, updatedAt: new Date() },
        });
      }
    }
    if (challan.quoteId) await syncSalesOrderLinesForQuoteTx(tx, challan.quoteId);
    // A direct order has no quote to sync: its lines' reserved / waiting counts are read again
    // from the reservations, so goods sent no longer show as held for it.
    else for (const orderLineId of sentOrderLines) await refreshOrderLineStockTx(tx, orderLineId);
  }

  private async consumeSpecialOrderLineTx(tx: any, challan: any, line: any, quantity: number) {
    const salesOrder = challan.salesOrderId
      ? await tx.salesOrder.findUnique({ where: { id: challan.salesOrderId } }).catch(() => null)
      : await tx.salesOrder.findFirst({ where: { quoteId: challan.quoteId } }).catch(() => null);
    if (!salesOrder) return;
    const dispatchKey = String(line.dispatchKey || line.sourceLineKey || line.tileCode || line.sku || '').trim();
    const exactLine = line.salesOrderLineId
      ? await tx.salesOrderLine.findUnique({ where: { id: String(line.salesOrderLineId) } })
      : null;
    const orderLine = (exactLine && exactLine.salesOrderId === salesOrder.id ? exactLine : null) || await tx.salesOrderLine.findFirst({
      where: {
        salesOrderId: salesOrder.id,
        OR: [
          dispatchKey ? { lineKey: dispatchKey } : undefined,
          line.sku || line.tileCode ? { sku: String(line.sku || line.tileCode) } : undefined,
        ].filter(Boolean),
      },
      orderBy: { lineNo: 'asc' },
    }).catch(() => null);
    if (!orderLine) return;

    const nextDispatched = Math.min(Number(orderLine.orderedQuantity || 0), Number(orderLine.dispatchedQuantity || 0) + quantity);
    const nextAllocated = Math.max(0, Number(orderLine.allocatedQuantity || 0) - quantity);
    await tx.salesOrderLine.update({
      where: { id: orderLine.id },
      data: {
        dispatchedQuantity: nextDispatched,
        allocatedQuantity: nextAllocated,
        status: nextDispatched >= Number(orderLine.orderedQuantity || 0) ? 'dispatched' : 'partial_dispatched',
        updatedAt: new Date(),
      },
    }).catch(() => null);
    await tx.dispatchLine.updateMany({
      where: { challanId: challan.id, OR: [{ salesOrderLineId: orderLine.id }, { dispatchKey: dispatchKey || orderLine.lineKey }] },
      data: { dispatchedQuantity: quantity, status: 'dispatched', updatedAt: new Date() },
    });
    await tx.stockLedgerEntry.create({
      data: {
        id: ulid(),
        productId: null,
        locationId: null,
        type: 'special_order_dispatch',
        quantity,
        direction: 'out',
        referenceType: 'DispatchChallan',
        referenceId: challan.id,
        sourceDocumentNo: challan.challanNumber,
        reason: `Special-order dispatch on ${challan.challanNumber}`,
        createdBy: 'dispatch',
        metadata: { quoteId: challan.quoteId, salesOrderId: salesOrder.id, lineKey: orderLine.lineKey, sku: orderLine.sku },
      },
    }).catch(() => null);
  }

  private async markChallanDeliveredTx(tx: any, challan: any, actorUserId: string) {
    const shipment = await tx.shipment.findFirst({ where: { challanId: challan.id } });
    await tx.shipment.updateMany({
      where: { challanId: challan.id },
      data: { status: 'delivered', deliveredAt: new Date(), updatedAt: new Date() },
    });
    const existingProof = await tx.deliveryProof.findFirst({ where: { challanId: challan.id } });
    if (!existingProof) {
      await tx.deliveryProof.create({
        data: {
          id: ulid(),
          shipmentId: shipment?.id || null,
          challanId: challan.id,
          receivedByName: (challan.proof as any)?.receivedByName,
          receivedByPhone: (challan.proof as any)?.receivedByPhone || null,
          proofType: (challan.proof as any)?.proofType || 'manual',
          proofUrl: (challan.proof as any)?.proofUrl || null,
          latitude: (challan.proof as any)?.latitude ?? null,
          longitude: (challan.proof as any)?.longitude ?? null,
          createdBy: actorUserId,
          metadata: challan.proof || {},
        },
      });
    }
    const lines = await tx.dispatchLine.findMany({ where: { challanId: challan.id } });
    for (const line of lines) {
      const delivered = Number(line.packedQuantity || line.dispatchedQuantity || line.orderedQuantity || 0);
      await tx.dispatchLine.update({
        where: { id: line.id },
        data: { deliveredQuantity: delivered, status: 'delivered', updatedAt: new Date() },
      });
      if (line.salesOrderLineId) {
        const orderLine = await tx.salesOrderLine.findUnique({ where: { id: line.salesOrderLineId } });
        if (orderLine) {
          // Dispatch lines count base units; the order line counts whole selling units delivered.
          const factor = stockFactor(line.productId ? await tx.product.findUnique({ where: { id: line.productId } }).catch(() => null) : null);
          let deliveredSelling = Number(orderLine.deliveredQuantity || 0) + delivered;
          if (factor > 1) {
            const done = await tx.dispatchLine.aggregate({ where: { salesOrderLineId: line.salesOrderLineId, status: 'delivered' }, _sum: { deliveredQuantity: true } });
            deliveredSelling = Math.floor(Number(done._sum?.deliveredQuantity || 0) / factor + 1e-9);
          }
          const nextDelivered = Math.min(Number(orderLine.orderedQuantity || 0), deliveredSelling);
          await tx.salesOrderLine.update({
            where: { id: line.salesOrderLineId },
            data: {
              deliveredQuantity: nextDelivered,
              // Part delivered with some still to send stays in "left to dispatch" (partial_dispatched);
              // everything sent and part of it delivered is partial_delivered.
              status: nextDelivered >= Number(orderLine.orderedQuantity || 0)
                ? 'delivered'
                : Number(orderLine.dispatchedQuantity || 0) < Number(orderLine.orderedQuantity || 0) ? 'partial_dispatched' : 'partial_delivered',
              updatedAt: new Date(),
            },
          });
        }
      }
    }
  }

  private async assertDispatchableLines(lines: any[], job: any, options?: { excludeChallanId?: string }) {
    const quoteId = job.quoteId;
    const quote = quoteId ? await this.prisma.quote.findUnique({ where: { id: quoteId } }) : null;
    const salesOrder = job.salesOrderId
      ? await this.prisma.salesOrder.findUnique({ where: { id: job.salesOrderId } }).catch(() => null)
      : await this.prisma.salesOrder.findFirst({ where: { quoteId } }).catch(() => null);
    if (!salesOrder) throw new BadRequestException('Dispatch requires a linked Sales Order. Convert the quote first.');
    if (quoteId && !quote) throw new BadRequestException('Dispatch quote not found');
    const quoteLines = this.normalizeLines(salesOrder.lines) || [];
    const quoteQtyByProduct = new Map<string, number>();
    const tileQtyByKey = new Map<string, number>();
    // Challans, reservations and stock count base units, so the ordered boxes are counted as pieces here.
    const orderFactors = await this.unitFactors(quoteLines.map((line: any) => line.productId));
    for (const line of quoteLines) {
      const productId = String(line.productId || '').trim();
      if (productId) {
        quoteQtyByProduct.set(productId, (quoteQtyByProduct.get(productId) || 0) + Number(line.qty || line.quantity || 0) * (orderFactors.get(productId) || 1));
      }
    }
    quoteLines.forEach((line: any, index: number) => {
      if (String(line.productId || '').trim() || !this.isTileLine(line)) return;
      const key = this.tileDemandKey(salesOrder.id, line, index);
      tileQtyByKey.set(key, Number(line.qty || line.quantity || 0));
    });
    const demands = await (this.prisma as any).purchaseDemand.findMany({
      where: { sourceOrderId: salesOrder.id, sourceType: 'tile_special_order' },
    }).catch(() => []);
    const demandByKey = new Map((demands as any[]).map((demand) => [demand.sourceLineKey, demand]));
    const demandBySku = new Map((demands as any[]).map((demand) => [demand.sku, demand]));

    const normalizedRequested = (Array.isArray(lines) ? lines : []).map((line, index) => {
      if (String(line.productId || '').trim() || !this.isTileLine(line)) return line;
      const dispatchKey = line.dispatchKey || this.tileDemandKey(salesOrder.id, line, index);
      return { ...line, dispatchKey };
    });
    const requestedTileKeys = normalizedRequested
      .filter((line) => !String(line.productId || '').trim() && this.isTileLine(line))
      .map((line) => String(line.dispatchKey || ''));
    for (const key of requestedTileKeys) {
      if (!tileQtyByKey.has(key)) {
        const demand = demandByKey.get(key) as any;
        if (demand) tileQtyByKey.set(key, Number(demand.quantity || 0));
      }
    }

    const [challans, reservations] = await Promise.all([
      this.prisma.dispatchChallan.findMany({
        where: {
          ...(salesOrder ? { salesOrderId: salesOrder.id } : { quoteId }),
          status: { in: ['pending', 'dispatched', 'delivered'] },
          ...(options?.excludeChallanId ? { id: { not: options.excludeChallanId } } : {}),
        },
      } as any),
      this.prisma.reservation.findMany({ where: salesOrder ? { salesOrderId: salesOrder.id, status: 'reserved' } : { quoteId, salesOrderId: null, status: 'reserved' } }),
    ]);
    const committedByProduct = this.groupChallanQty(challans as any[], 'quote');
    const reservedByProduct = new Map<string, number>();
    for (const reservation of reservations as any[]) {
      reservedByProduct.set(reservation.productId, (reservedByProduct.get(reservation.productId) || 0) + Number(reservation.quantity || 0));
    }

    for (const line of normalizedRequested) {
      const quantity = Number(line.dispatchQty || line.qty || line.quantity || 0);
      if (quantity <= 0) continue;
      const productId = String(line.productId || '').trim();
      if (!productId) {
        const dispatchKey = String(line.dispatchKey || '');
        const demand = (dispatchKey ? demandByKey.get(dispatchKey) : null) as any || (demandBySku.get(line.tileCode || line.sku) as any);
        const ordered = Number(tileQtyByKey.get(dispatchKey) || demand?.quantity || 0);
        const alreadyCommitted = Number(committedByProduct.get(dispatchKey) || 0);
        const remainingOrderQty = Math.max(0, ordered - alreadyCommitted);
        const receivedQty = Number(demand?.receivedQuantity || 0);
        const dispatchable = Math.min(remainingOrderQty, Math.max(0, receivedQty - alreadyCommitted));
        if (!demand || dispatchable <= 0 || quantity > dispatchable) {
          throw new BadRequestException(`${line.name || line.sku || 'Tile line'} is not ready to dispatch. Requested ${quantity}, ready ${dispatchable}, pending inward ${Math.max(0, remainingOrderQty - dispatchable)}`);
        }
        continue;
      }
      const ordered = Number(quoteQtyByProduct.get(productId) || 0);
      const alreadyCommitted = Number(committedByProduct.get(productId) || 0);
      const remainingOrderQty = Math.max(0, ordered - alreadyCommitted);
      const reservedQty = Number(reservedByProduct.get(productId) || 0);
      const dispatchable = Math.min(remainingOrderQty, reservedQty);
      if (quantity > dispatchable) {
        throw new BadRequestException(`${line.name || line.sku || 'Line item'} is not ready to dispatch. Requested ${quantity}, ready ${dispatchable}, pending inward ${Math.max(0, remainingOrderQty - dispatchable)}`);
      }
    }
  }

  /**
   * A tile sold by the box leaves in full boxes only, counted per ORDER LINE:
   * one order line's reservation can sit on several lots that do not split on
   * box boundaries (58 pc + 284 pc at 9 a box), so a single lot row may hold any
   * piece count. Each order line touched by the save must add up, across its
   * rows, to whole boxes, or to everything the system holds or offers for that
   * line on those rows (reserved, picked or packed), so a part box the
   * reservation itself holds can still leave as the final remainder.
   * Same rule as the pick/pack screens (refusesPartBox in packages/pricing-contract).
   */
  private assertFullBoxesPerOrderLine(rows: Array<{ salesOrderLineId: string; product: any; quantity: number; systemQuantity: number; touched?: boolean }>) {
    const lines = new Map<string, { product: any; quantity: number; systemQuantity: number; touched: boolean }>();
    for (const row of rows) {
      const key = String(row.salesOrderLineId || '');
      const line = lines.get(key) || { product: row.product, quantity: 0, systemQuantity: 0, touched: false };
      line.quantity += Math.max(0, Number(row.quantity || 0));
      line.systemQuantity += Math.max(0, Number(row.systemQuantity || 0));
      line.touched = line.touched || row.touched !== false;
      if (!line.product && row.product) line.product = row.product;
      lines.set(key, line);
    }
    for (const line of lines.values()) {
      if (!line.touched || !refusesPartBox(line.quantity, line.systemQuantity, line.product)) continue;
      throw new BadRequestException(`This tile is sold in full boxes of ${stockFactor(line.product)} pieces`);
    }
  }

  /** Base units per selling unit for each product (pieces per box for boxed tiles, else 1). */
  private async unitFactors(ids: any[]) {
    const productIds = Array.from(new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean)));
    if (!productIds.length) return new Map<string, number>();
    const products = await this.prisma.product.findMany({ where: { id: { in: productIds } } });
    return new Map(products.map((product: any) => [product.id, stockFactor(product)]));
  }

  // Reserved stock not yet on an open pick list, per order and location (base units), most first.
  // Same counting as createPickList, so the screen can default to a location that will work.
  private async unpickedReservedByLocation(db: any, salesOrderIds: string[]) {
    const result = new Map<string, Array<{ locationId: string; code: string; name: string; quantity: number }>>();
    const ids = Array.from(new Set(salesOrderIds.filter(Boolean)));
    if (!ids.length) return result;
    const allocations = await db.lotReservation.findMany({
      where: { salesOrderLine: { salesOrderId: { in: ids } }, status: 'reserved', quantity: { gt: 0 } },
      select: { salesOrderLineId: true, lotId: true, locationId: true, quantity: true, salesOrderLine: { select: { salesOrderId: true } }, location: { select: { code: true, name: true } } },
    });
    if (!allocations.length) return result;
    const openPicks = await db.pickLine.findMany({
      where: {
        salesOrderLine: { salesOrderId: { in: ids } },
        status: { notIn: ['dispatched', 'cancelled', 'returned'] },
        pickList: { status: { in: ['ready', 'picking', 'picked', 'partial_packed', 'packed', 'completed', 'challan_created'] } },
      },
      select: { salesOrderLineId: true, lotId: true, locationId: true, requestedQuantity: true },
    });
    const openByIdentity = new Map<string, number>();
    for (const line of openPicks) {
      const key = `${line.salesOrderLineId}:${line.lotId}:${line.locationId}`;
      openByIdentity.set(key, (openByIdentity.get(key) || 0) + Number(line.requestedQuantity || 0));
    }
    const byOrderLocation = new Map<string, { orderId: string; locationId: string; code: string; name: string; quantity: number }>();
    for (const allocation of allocations) {
      const key = `${allocation.salesOrderLineId}:${allocation.lotId}:${allocation.locationId}`;
      const used = Math.min(Number(allocation.quantity || 0), Number(openByIdentity.get(key) || 0));
      openByIdentity.set(key, Math.max(0, Number(openByIdentity.get(key) || 0) - used));
      const free = Math.max(0, Number(allocation.quantity || 0) - used);
      if (free <= 0) continue;
      const orderId = allocation.salesOrderLine.salesOrderId;
      const groupKey = `${orderId}:${allocation.locationId}`;
      const row = byOrderLocation.get(groupKey) || { orderId, locationId: allocation.locationId, code: allocation.location?.code || '', name: allocation.location?.name || '', quantity: 0 };
      row.quantity += free;
      byOrderLocation.set(groupKey, row);
    }
    for (const { orderId, ...row } of byOrderLocation.values()) {
      result.set(orderId, [...(result.get(orderId) || []), row]);
    }
    for (const rows of result.values()) rows.sort((a, b) => b.quantity - a.quantity);
    return result;
  }

  private groupByOrderProduct(reservations: any[]) {
    const grouped = new Map<string, any[]>();
    for (const reservation of reservations) {
      const key = `${reservation.salesOrderId || `legacy:${reservation.quoteId}`}:${reservation.productId}`;
      grouped.set(key, [...(grouped.get(key) || []), reservation]);
    }
    return grouped;
  }

  private groupChallanQty(challans: any[], scope: 'job' | 'quote' = 'job') {
    const grouped = new Map<string, number>();
    for (const challan of challans || []) {
      const lines = this.normalizeLines(challan.lines) || [];
      lines.forEach((line: any, index: number) => {
        const productId = String(line.productId || '').trim();
        const keyBase = productId || this.lineDispatchKey(line, index);
        if (!keyBase) return;
        const prefix = scope === 'quote' ? '' : `${challan.dispatchJobId}:`;
        const key = `${prefix}${keyBase}`;
        grouped.set(key, (grouped.get(key) || 0) + Number(line.dispatchQty || line.qty || line.quantity || 0));
      });
    }
    return grouped;
  }

  private async refreshJobStatusTx(tx: any, dispatchJobId: string) {
    // Works for quote orders and direct orders alike: progress is read from the
    // order lines, which count selling units (boxes), so no unit mixing.
    const job = await tx.dispatchJob.findUnique({ where: { id: dispatchJobId } });
    if (!job) return;
    const order = job.salesOrderId
      ? await tx.salesOrder.findUnique({ where: { id: job.salesOrderId } }).catch(() => null)
      : job.quoteId ? await tx.salesOrder.findFirst({ where: { quoteId: job.quoteId } }) : null;
    const challans = await tx.dispatchChallan.findMany({ where: { dispatchJobId, status: { in: ['pending', 'dispatched', 'delivered', 'failed_delivery'] } } });
    const orderLines = order ? await tx.salesOrderLine.findMany({ where: { salesOrderId: order.id, orderedQuantity: { gt: 0 } } }) : [];
    const fullyDelivered = orderLines.length > 0 && orderLines.every((line: any) => Number(line.deliveredQuantity || 0) >= Number(line.orderedQuantity || 0));
    const fullyDispatched = orderLines.length > 0 && orderLines.every((line: any) => Number(line.dispatchedQuantity || 0) >= Number(line.orderedQuantity || 0));
    const hasPending = challans.some((challan: any) => challan.status === 'pending');
    const onRoad = challans.some((challan: any) => ['dispatched', 'failed_delivery'].includes(challan.status));
    const nextStatus = fullyDelivered
      ? 'delivered'
      : onRoad || (fullyDispatched && !hasPending)
        ? 'dispatched'
        : hasPending
          ? 'packed'
          : 'pending';
    await tx.dispatchJob.update({ where: { id: dispatchJobId }, data: { status: nextStatus, updatedAt: new Date() } }).catch(() => null);
    // The order itself moves too: delivered when every line is delivered, dispatched
    // when every line has left, and back to open if goods came back.
    if (order && !['cancelled', 'closed'].includes(String(order.status || ''))) {
      const orderStatus = fullyDelivered ? 'delivered' : fullyDispatched ? 'dispatched' : 'open';
      if (orderStatus !== order.status && (orderStatus !== 'open' || ['dispatched', 'delivered'].includes(String(order.status)))) {
        await tx.salesOrder.update({ where: { id: order.id }, data: { status: orderStatus, updatedAt: new Date() } });
      }
      if (fullyDelivered) await this.finishDeliveredOrderTx(tx, order.id, dispatchJobId);
    }
  }

  /**
   * Every line is delivered: the order leaves every work queue in the same save.
   * Its purchase demands whose goods came in close, a waiting (backordered) row left
   * behind holds no stock and is released so no later receipt fills it, and the
   * "order awaiting fulfilment" task is resolved. Payment is not touched.
   */
  private async finishDeliveredOrderTx(tx: any, salesOrderId: string, dispatchJobId: string) {
    const now = new Date();
    await closeFinishedDemandsTx(tx, salesOrderId);
    await tx.reservation.updateMany({ where: { salesOrderId, status: 'backordered' }, data: { status: 'released', updatedAt: now } });
    await tx.notification.updateMany({
      where: { type: 'work_dispatch', category: 'action', status: 'open', entityType: 'DispatchJob', entityId: dispatchJobId },
      data: { status: 'resolved', resolvedAt: now, assignedUserId: null },
    });
  }

  private lineDispatchKey(line: any, fallback?: string | number) {
    const productId = String(line?.productId || '').trim();
    if (productId) return productId;
    return String(line?.dispatchKey || line?.sourceLineKey || line?.tileCode || line?.sku || line?.name || fallback || '').trim();
  }

  private tileDemandKey(orderId: string, line: any, index: number) {
    return `tile:${orderId}:${String(line.tileCode || line.sku || index).trim()}:${index}`;
  }

}
