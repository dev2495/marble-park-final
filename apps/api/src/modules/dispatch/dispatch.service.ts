import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { nextDocumentNumber } from '../common/sequence';
import { applyStockPostingTx, syncSalesOrderLinesForQuoteTx } from '../common/stock-posting';
import { ulid } from 'ulid';

export interface CreateDispatchJobInput {
  quoteId?: string;
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
      include: { customer: true, quote: true },
      orderBy: { createdAt: 'desc' },
    } as any) as any;
  }

  async dispatchQueue(args?: { status?: string; customerId?: string }): Promise<any[]> {
    const where: any = {};
    if (args?.status) where.status = args.status;
    else where.status = { in: ['pending', 'packed', 'dispatched', 'delivered'] };
    if (args?.customerId) where.customerId = args.customerId;

    const jobs = await this.prisma.dispatchJob.findMany({
      where,
      include: { customer: true, quote: true },
      orderBy: { updatedAt: 'desc' },
      take: 80,
    } as any) as any[];
    if (!jobs.length) return [];

    const jobIds = jobs.map((job: any) => job.id);
    const quoteIds = Array.from(new Set(jobs.map((job: any) => job.quoteId).filter(Boolean)));
    const quoteLines = jobs.flatMap((job: any) => this.normalizeLines(job.quote?.lines) || []);
    const productIds = Array.from(new Set(quoteLines.map((line: any) => String(line.productId || '').trim()).filter(Boolean)));

    const [challans, reservations, balances, orders] = await Promise.all([
      this.prisma.dispatchChallan.findMany({
        where: { dispatchJobId: { in: jobIds }, status: { in: ['pending', 'dispatched', 'delivered'] } },
      } as any),
      this.prisma.reservation.findMany({ where: { quoteId: { in: quoteIds } } }),
      this.prisma.inventoryBalance.findMany({ where: { productId: { in: productIds } }, include: { product: true } as any } as any),
      this.prisma.salesOrder.findMany({ where: { quoteId: { in: quoteIds } } }),
    ]);

    const balanceMap = new Map((balances as any[]).map((balance) => [balance.productId, balance]));
    const orderMap = new Map((orders as any[]).map((order) => [order.quoteId, order]));
    const orderIds = (orders as any[]).map((order) => order.id);
    const purchaseDemands = orderIds.length
      ? await (this.prisma as any).purchaseDemand.findMany({ where: { sourceOrderId: { in: orderIds } } }).catch(() => [])
      : [];
    const demandByOrderKey = new Map((purchaseDemands as any[]).map((demand) => [`${demand.sourceOrderId}:${demand.sourceLineKey}`, demand]));
    const demandByOrderSku = new Map((purchaseDemands as any[]).map((demand) => [`${demand.sourceOrderId}:${demand.sku}`, demand]));
    const reservationsByQuoteProduct = this.groupByQuoteProduct(reservations as any[]);
    const challanQtyByJobProduct = this.groupChallanQty(challans as any[]);
    const challansByJob = new Map<string, any[]>();
    for (const challan of challans as any[]) {
      challansByJob.set(challan.dispatchJobId, [...(challansByJob.get(challan.dispatchJobId) || []), challan]);
    }

    return jobs.map((job: any) => {
      const lines = this.normalizeLines(job.quote?.lines) || [];
      const salesOrder = orderMap.get(job.quoteId) as any;
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
        const committedQty = Number(challanQtyByJobProduct.get(`${job.id}:${productId}`) || 0);
        const remainingQty = Math.max(0, orderedQty - committedQty);
        const reservationRows = reservationsByQuoteProduct.get(`${job.quoteId}:${productId}`) || [];
        const reservedQty = reservationRows
          .filter((reservation: any) => reservation.status === 'reserved')
          .reduce((sum: number, reservation: any) => sum + Number(reservation.quantity || 0), 0);
        const backorderedQty = reservationRows
          .filter((reservation: any) => reservation.status === 'backordered')
          .reduce((sum: number, reservation: any) => sum + Number(reservation.quantity || 0), 0);
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
          onHand: Number(balance?.onHand || 0),
          available: Number(balance?.available || 0),
          status,
        };
      });

      return {
        id: job.id,
        quoteId: job.quoteId,
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
        challans: challansByJob.get(job.id) || [],
      };
    });
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
    if (!data.quoteId) {
      throw new BadRequestException('A quote is required to create a dispatch job');
    }

    const quote = await this.prisma.quote.findUnique({
      where: { id: data.quoteId },
      include: { customer: true },
    } as any) as any;
    if (!quote) throw new NotFoundException('Quote not found');

    const dueDate = data.scheduledAt ? new Date(data.scheduledAt) : new Date(Date.now() + 86400000);

    return this.prisma.dispatchJob.create({
      data: {
        id: ulid(),
        quoteId: quote.id,
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

  async createChallan(data: CreateChallanInput) {
    const dispatchJobId = data.dispatchJobId || data.jobId;
    if (!dispatchJobId) throw new BadRequestException('A dispatch job is required to create a challan');

    const job = await this.prisma.dispatchJob.findUnique({
      where: { id: dispatchJobId },
      include: { quote: true, customer: true },
    } as any) as any;
    if (!job) throw new NotFoundException('Dispatch job not found');
    const salesOrder = await (this.prisma as any).salesOrder.findUnique({ where: { quoteId: job.quoteId } }).catch(() => null);
    if (!salesOrder) throw new BadRequestException('Dispatch requires a linked Sales Order. Convert the quote to a sales order first.');

    const contactPhone = data.contactPhone || data.driverPhone || job.customer?.mobile || '';
    if (!contactPhone) throw new BadRequestException('A driver/contact phone is required');

    let challanLines = this.normalizeLines(data.lines) || [];
    if (!challanLines.length) {
      const queueJob = (await this.dispatchQueue()).find((row: any) => row.id === dispatchJobId);
      if ((queueJob?.pendingInwardLines || []).length || (queueJob?.invalidLines || []).length) {
        throw new BadRequestException('Select ready lines for partial dispatch. This job still has items not inwards yet.');
      }
      challanLines = (queueJob?.readyLines || []).map((line: any) => ({ ...line, dispatchQty: Number(line.dispatchableQty || 0) })).filter((line: any) => Number(line.dispatchQty || 0) > 0);
    }
    if (!challanLines.length) throw new BadRequestException('Select at least one ready item to create a challan');
    await this.assertDispatchableLines(challanLines, job);
    const challan = await this.prisma.dispatchChallan.create({
      data: {
        id: ulid(),
        challanNumber: await this.generateChallanNumber(),
        quoteId: data.quoteId || job.quoteId,
        dispatchJobId,
        customerId: data.customerId || job.customerId,
        status: 'pending',
        vehicleNumber: data.vehicleNumber || data.vehicleNo,
        driverName: data.driverName,
        transporterName: data.transporterName || data.transporter,
        contactPhone,
        siteAddress: data.siteAddress || job.siteAddress,
        remarks: data.remarks || data.notes || '',
        lines: challanLines,
        updatedAt: new Date(),
      },
      include: { customer: true, quote: true }
    } as any) as any;
    await this.createDispatchRecordsForChallan(challan, job, salesOrder, challanLines, data);
    await this.prisma.dispatchJob.update({
      where: { id: dispatchJobId },
      data: { status: 'packed', updatedAt: new Date() },
    }).catch(() => {});
    await this.notifications.create({
      title: 'Partial challan created',
      message: `${challan.challanNumber} created for ${job.customer?.name || 'customer'}. Dispatch only listed rows.`,
      type: 'challan_created',
      entityType: 'DispatchChallan',
      entityId: challan.id,
      href: '/dashboard/dispatch',
      targetUserId: job.quote?.ownerId,
      metadata: { dispatchJobId, quoteId: challan.quoteId },
    });
    return challan;
  }

  async updateChallanStatus(id: string, status: string) {
    const challan = await this.prisma.dispatchChallan.findUnique({ where: { id } });
    if (!challan) throw new NotFoundException('Challan not found');
    if (challan.status === status) return challan as any;

    if (status === 'dispatched' && challan.status === 'pending') {
      const job = await this.prisma.dispatchJob.findUnique({ where: { id: challan.dispatchJobId } }).catch(() => null);
      if (job) await this.assertDispatchableLines(this.normalizeLines((challan as any).lines) || [], job, { excludeChallanId: challan.id });
    }
    
    const data: any = { status };
    if (status === 'dispatched') {
      data.dispatchedAt = new Date();
    } else if (status === 'delivered') {
      data.deliveredAt = new Date();
    }
    
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.dispatchChallan.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Challan not found');
      if (current.status === status) return current;

      let updated: any = current;
      if (status === 'dispatched') {
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
        const job = await tx.dispatchJob.findUnique({ where: { id: updated.dispatchJobId }, include: { quote: true, customer: true } as any } as any).catch(() => null) as any;
        if (job?.quote?.ownerId) {
          await tx.notification.create({
            data: {
              id: ulid(),
              title: 'Items dispatched',
              message: `${updated.challanNumber} has been dispatched for ${job.customer?.name || 'customer'}.`,
              type: 'dispatch_dispatched',
              entityType: 'DispatchChallan',
              entityId: updated.id,
              href: `/dashboard/leads/${job.quote.leadId}`,
              targetUserId: job.quote.ownerId,
              metadata: { quoteId: updated.quoteId },
            },
          }).catch(() => null);
        }
      } else if (status === 'delivered') {
        updated = await tx.dispatchChallan.update({ where: { id }, data });
        await this.markChallanDeliveredTx(tx, updated as any);
        await this.refreshJobStatusTx(tx, updated.dispatchJobId);
        const job = await tx.dispatchJob.findUnique({ where: { id: updated.dispatchJobId }, include: { quote: true, customer: true } as any } as any).catch(() => null) as any;
        if (job?.quote?.ownerId) {
          await tx.notification.create({
            data: {
              id: ulid(),
              title: 'Delivery completed',
              message: `${updated.challanNumber} has been marked delivered for ${job.customer?.name || 'customer'}.`,
              type: 'dispatch_delivered',
              entityType: 'DispatchChallan',
              entityId: updated.id,
              href: `/dashboard/leads/${job.quote.leadId}`,
              targetUserId: job.quote.ownerId,
              metadata: { quoteId: updated.quoteId },
            },
          }).catch(() => null);
        }
      } else {
        updated = await tx.dispatchChallan.update({ where: { id }, data });
      }

      return updated;
    });
  }

  async findAllChallans(args?: { status?: string; dispatchJobId?: string }) {
    const where: any = {};
    if (args?.status) where.status = args.status;
    if (args?.dispatchJobId) where.dispatchJobId = args.dispatchJobId;
    return this.prisma.dispatchChallan.findMany({
      where,
      include: { customer: true, quote: true },
      orderBy: { createdAt: 'desc' },
    } as any) as any;
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

  private async generateChallanNumber(): Promise<string> {
    return nextDocumentNumber(this.prisma as any, 'challan', 'CH', new Date(), {
      existingNumbers: async (prefixForYear) => (await this.prisma.dispatchChallan.findMany({
        where: { challanNumber: { startsWith: prefixForYear } },
        select: { challanNumber: true },
      })).map((row) => row.challanNumber),
    });
  }

  private async generateShipmentNumber(): Promise<string> {
    return nextDocumentNumber(this.prisma as any, 'shipment', 'SHP', new Date(), {
      existingNumbers: async (prefixForYear) => (await (this.prisma as any).shipment.findMany({
        where: { shipmentNumber: { startsWith: prefixForYear } },
        select: { shipmentNumber: true },
      })).map((row: any) => row.shipmentNumber),
    });
  }

  private async createDispatchRecordsForChallan(challan: any, job: any, salesOrder: any, lines: any[], input: CreateChallanInput) {
    const packageCount = Math.max(1, Math.trunc(Number(input.packages || 1)));
    const shipmentNumber = await this.generateShipmentNumber();
    await this.prisma.$transaction(async (tx: any) => {
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
        const orderLine = await tx.salesOrderLine.findFirst({
          where: {
            salesOrderId: salesOrder.id,
            OR: [
              { productId: productId || undefined },
              { lineKey: dispatchKey },
            ].filter((item: any) => Object.values(item)[0]),
          },
        }).catch(() => null);
        await tx.dispatchLine.create({
          data: {
            id: ulid(),
            dispatchJobId: job.id,
            challanId: challan.id,
            salesOrderId: salesOrder.id,
            salesOrderLineId: orderLine?.id || null,
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
    }, { timeout: 15000 });
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
    for (const line of lines) {
      const productId = String(line.productId || '').trim();
      const quantity = Number(line.dispatchQty || line.qty || line.quantity || 0);
      if (quantity <= 0) continue;
      if (!productId) {
        await this.consumeSpecialOrderLineTx(tx, challan, line, quantity);
        continue;
      }

      await applyStockPostingTx(tx, {
        productId,
        type: 'dispatch',
        movementType: 'dispatch',
        ledgerType: 'dispatch',
        quantity,
        onHandDelta: -quantity,
        reservedDelta: -quantity,
        locationOnHandDelta: -quantity,
        locationReservedDelta: -quantity,
        requireReserved: true,
        requireOnHand: true,
        reason: `Dispatched on ${challan.challanNumber}`,
        relatedQuoteId: challan.quoteId,
        relatedChallanId: challan.id,
        referenceType: 'DispatchChallan',
        referenceId: challan.id,
        sourceDocumentNo: challan.challanNumber,
        createdBy: 'dispatch',
        metadata: { quoteId: challan.quoteId },
      });
      const salesOrder = await tx.salesOrder.findUnique({ where: { quoteId: challan.quoteId } }).catch(() => null);
      if (salesOrder) {
        const orderLine = await tx.salesOrderLine.findFirst({
          where: { salesOrderId: salesOrder.id, productId },
          orderBy: { lineNo: 'asc' },
        }).catch(() => null);
        if (orderLine) {
          await tx.salesOrderLine.update({
            where: { id: orderLine.id },
            data: {
              dispatchedQuantity: Math.min(Number(orderLine.orderedQuantity || 0), Number(orderLine.dispatchedQuantity || 0) + quantity),
              status: Number(orderLine.dispatchedQuantity || 0) + quantity >= Number(orderLine.orderedQuantity || 0) ? 'dispatched' : 'partial_dispatched',
              updatedAt: new Date(),
            },
          }).catch(() => null);
        }
        await tx.dispatchLine.updateMany({
          where: { challanId: challan.id, productId },
          data: { dispatchedQuantity: quantity, status: 'dispatched', updatedAt: new Date() },
        }).catch(() => null);
      }

      let remainingToDispatch = quantity;
      while (remainingToDispatch > 0) {
        const reservation = await tx.reservation.findFirst({
          where: { quoteId: challan.quoteId, productId, status: 'reserved' },
          orderBy: { createdAt: 'asc' },
        });
        if (!reservation) break;
        const consume = Math.min(remainingToDispatch, Number(reservation.quantity || 0));
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
    }
    await syncSalesOrderLinesForQuoteTx(tx, challan.quoteId);
  }

  private async consumeSpecialOrderLineTx(tx: any, challan: any, line: any, quantity: number) {
    const salesOrder = await tx.salesOrder.findUnique({ where: { quoteId: challan.quoteId } }).catch(() => null);
    if (!salesOrder) return;
    const dispatchKey = String(line.dispatchKey || line.sourceLineKey || line.tileCode || line.sku || '').trim();
    const orderLine = await tx.salesOrderLine.findFirst({
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
      where: { challanId: challan.id, dispatchKey: orderLine.lineKey },
      data: { dispatchedQuantity: quantity, status: 'dispatched', updatedAt: new Date() },
    }).catch(() => null);
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

  private async markChallanDeliveredTx(tx: any, challan: any) {
    const shipment = await tx.shipment.findFirst({ where: { challanId: challan.id } }).catch(() => null);
    await tx.shipment.updateMany({
      where: { challanId: challan.id },
      data: { status: 'delivered', deliveredAt: new Date(), updatedAt: new Date() },
    }).catch(() => null);
    const existingProof = await tx.deliveryProof.findFirst({ where: { challanId: challan.id } }).catch(() => null);
    if (!existingProof) {
      await tx.deliveryProof.create({
        data: {
          id: ulid(),
          shipmentId: shipment?.id || null,
          challanId: challan.id,
          receivedByName: (challan.proof as any)?.receivedBy || challan.driverName || 'Customer representative',
          receivedByPhone: (challan.proof as any)?.phone || challan.contactPhone || null,
          proofType: (challan.proof as any)?.type || 'manual',
          proofUrl: (challan.proof as any)?.url || null,
          createdBy: 'dispatch',
          metadata: challan.proof || {},
        },
      }).catch(() => null);
    }
    const lines = await tx.dispatchLine.findMany({ where: { challanId: challan.id } }).catch(() => []);
    for (const line of lines) {
      const delivered = Number(line.packedQuantity || line.dispatchedQuantity || line.orderedQuantity || 0);
      await tx.dispatchLine.update({
        where: { id: line.id },
        data: { deliveredQuantity: delivered, status: 'delivered', updatedAt: new Date() },
      }).catch(() => null);
      if (line.salesOrderLineId) {
        const orderLine = await tx.salesOrderLine.findUnique({ where: { id: line.salesOrderLineId } }).catch(() => null);
        if (orderLine) {
          const nextDelivered = Math.min(Number(orderLine.orderedQuantity || 0), Number(orderLine.deliveredQuantity || 0) + delivered);
          await tx.salesOrderLine.update({
            where: { id: line.salesOrderLineId },
            data: {
              deliveredQuantity: nextDelivered,
              status: nextDelivered >= Number(orderLine.orderedQuantity || 0) ? 'delivered' : 'partial_delivered',
              updatedAt: new Date(),
            },
          }).catch(() => null);
        }
      }
    }
  }

  private async assertDispatchableLines(lines: any[], job: any, options?: { excludeChallanId?: string }) {
    const quoteId = job.quoteId;
    const quote = await this.prisma.quote.findUnique({ where: { id: quoteId } });
    if (!quote) throw new BadRequestException('Dispatch quote not found');
    const salesOrder = await (this.prisma as any).salesOrder.findUnique({ where: { quoteId } }).catch(() => null);
    if (!salesOrder) throw new BadRequestException('Dispatch requires a linked Sales Order. Convert the quote first.');
    const quoteLines = this.normalizeLines((quote as any).lines) || [];
    const quoteQtyByProduct = new Map<string, number>();
    const tileQtyByKey = new Map<string, number>();
    for (const line of quoteLines) {
      const productId = String(line.productId || '').trim();
      if (productId) {
        quoteQtyByProduct.set(productId, (quoteQtyByProduct.get(productId) || 0) + Number(line.qty || line.quantity || 0));
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
          quoteId,
          status: { in: ['pending', 'dispatched', 'delivered'] },
          ...(options?.excludeChallanId ? { id: { not: options.excludeChallanId } } : {}),
        },
      } as any),
      this.prisma.reservation.findMany({ where: { quoteId, status: 'reserved' } }),
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

  private groupByQuoteProduct(reservations: any[]) {
    const grouped = new Map<string, any[]>();
    for (const reservation of reservations) {
      const key = `${reservation.quoteId}:${reservation.productId}`;
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
    const job = await tx.dispatchJob.findUnique({ where: { id: dispatchJobId }, include: { quote: true } as any } as any);
    if (!job?.quote) return;
    const challans = await tx.dispatchChallan.findMany({ where: { dispatchJobId, status: { in: ['pending', 'dispatched', 'delivered'] } } });
    if (!challans.length) {
      await tx.dispatchJob.update({ where: { id: dispatchJobId }, data: { status: 'pending', updatedAt: new Date() } }).catch(() => null);
      return;
    }
    const order = await tx.salesOrder.findUnique({ where: { quoteId: job.quoteId } }).catch(() => null);
    const orderedKeys = new Map<string, number>();
    (this.normalizeLines(job.quote.lines) || []).forEach((line: any, index: number) => {
      const productId = String(line.productId || '').trim();
      const key = productId || (order ? this.tileDemandKey(order.id, line, index) : this.lineDispatchKey(line, index));
      const qty = Number(line.qty || line.quantity || 0);
      if (key && qty > 0) orderedKeys.set(key, (orderedKeys.get(key) || 0) + qty);
    });
    const deliveredQty = this.groupChallanQty(challans.filter((challan: any) => challan.status === 'delivered'), 'quote');
    const committedQty = this.groupChallanQty(challans, 'quote');
    const fullyCommitted = Array.from(orderedKeys.entries()).every(([key, qty]) => Number(committedQty.get(key) || 0) >= qty);
    const fullyDelivered = Array.from(orderedKeys.entries()).every(([key, qty]) => Number(deliveredQty.get(key) || 0) >= qty);
    const hasPending = challans.some((challan: any) => challan.status === 'pending');
    const hasDispatched = challans.some((challan: any) => challan.status === 'dispatched');
    const nextStatus = fullyCommitted && fullyDelivered
      ? 'delivered'
      : hasDispatched
        ? 'dispatched'
        : hasPending
          ? 'packed'
          : 'pending';
    await tx.dispatchJob.update({ where: { id: dispatchJobId }, data: { status: nextStatus, updatedAt: new Date() } }).catch(() => null);
  }

  private lineDispatchKey(line: any, fallback?: string | number) {
    const productId = String(line?.productId || '').trim();
    if (productId) return productId;
    return String(line?.dispatchKey || line?.sourceLineKey || line?.tileCode || line?.sku || line?.name || fallback || '').trim();
  }

  private tileDemandKey(orderId: string, line: any, index: number) {
    return `tile:${orderId}:${String(line.tileCode || line.sku || index).trim()}:${index}`;
  }

  private async ensureDefaultLocationTx(tx: any) {
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

  private async defaultLocationIdTx(tx: any) {
    const location = await this.ensureDefaultLocationTx(tx);
    return location.id;
  }

  private async applyDefaultLocationDispatchTx(
    tx: any,
    args: { productId: string; quantity: number; previousOnHand: number; previousReserved: number },
  ) {
    const location = await this.ensureDefaultLocationTx(tx);
    const existing = await tx.stockBalanceByLocation.findUnique({
      where: { productId_locationId: { productId: args.productId, locationId: location.id } },
    }).catch(() => null);
    const nextOnHand = Math.max(0, Number(existing?.onHand ?? args.previousOnHand) - args.quantity);
    const nextReserved = Math.max(0, Number(existing?.reserved ?? args.previousReserved) - args.quantity);
    if (existing) {
      await tx.stockBalanceByLocation.update({
        where: { productId_locationId: { productId: args.productId, locationId: location.id } },
        data: { onHand: nextOnHand, reserved: nextReserved, updatedAt: new Date() },
      });
      return;
    }
    await tx.stockBalanceByLocation.create({
      data: {
        id: ulid(),
        productId: args.productId,
        locationId: location.id,
        onHand: nextOnHand,
        reserved: nextReserved,
        damaged: 0,
        hold: 0,
        updatedAt: new Date(),
      },
    });
  }
}
