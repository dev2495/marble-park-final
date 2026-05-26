import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
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
    const jobs = await this.findAllJobs(args);
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
    const reservationsByQuoteProduct = this.groupByQuoteProduct(reservations as any[]);
    const challanQtyByJobProduct = this.groupChallanQty(challans as any[]);
    const challansByJob = new Map<string, any[]>();
    for (const challan of challans as any[]) {
      challansByJob.set(challan.dispatchJobId, [...(challansByJob.get(challan.dispatchJobId) || []), challan]);
    }

    return jobs.map((job: any) => {
      const lines = this.normalizeLines(job.quote?.lines) || [];
      const lineStatus = lines.map((line: any) => {
        const productId = String(line.productId || '').trim();
        const orderedQty = Number(line.qty || line.quantity || 0);
        if (!productId || orderedQty <= 0) {
          return {
            ...line,
            productId,
            orderedQty,
            committedQty: 0,
            remainingQty: Math.max(0, orderedQty),
            reservedQty: 0,
            backorderedQty: 0,
            dispatchableQty: 0,
            blockedQty: Math.max(0, orderedQty),
            onHand: 0,
            available: 0,
            status: 'invalid_product',
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
        ...job,
        salesOrder: orderMap.get(job.quoteId) || null,
        lines: lineStatus,
        readyLines: lineStatus.filter((line: any) => line.status === 'ready'),
        pendingInwardLines: lineStatus.filter((line: any) => line.status === 'pending_inward'),
        invalidLines: lineStatus.filter((line: any) => line.status === 'invalid_product'),
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

    const contactPhone = data.contactPhone || data.driverPhone || job.customer?.mobile || '';
    if (!contactPhone) throw new BadRequestException('A driver/contact phone is required');

    const selectedLines = this.normalizeLines(data.lines) || [];
    const quoteLines = this.normalizeLines(job.quote?.lines) || [];
    const challanLines = selectedLines.length ? selectedLines : quoteLines;
    if (!challanLines.length) throw new BadRequestException('Select at least one ready item to create a challan');
    await this.assertDispatchableLines(challanLines, job.quoteId);
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

  async updateChallanStatus(id: string, status: string, proof?: { receiverName?: string; receiverContact?: string; photoUrl?: string; signatureUrl?: string; notes?: string } | null) {
    const challan = await this.prisma.dispatchChallan.findUnique({ where: { id } });
    if (!challan) throw new NotFoundException('Challan not found');

    if (status === 'delivered') {
      const proofPayload = proof || (challan as any).proof || null;
      const receiverName = String(proofPayload?.receiverName || '').trim();
      const hasVisualProof = Boolean(
        String(proofPayload?.photoUrl || '').trim() ||
        String(proofPayload?.signatureUrl || '').trim(),
      );
      if (!receiverName || !hasVisualProof) {
        throw new BadRequestException('Delivery proof is required (receiver name + photo or signature).');
      }
    }

    const data: any = { status };
    if (proof) {
      data.proof = {
        ...(challan as any).proof,
        ...proof,
        recordedAt: new Date().toISOString(),
      };
    }
    if (status === 'dispatched') {
      data.dispatchedAt = new Date();
    } else if (status === 'delivered') {
      data.deliveredAt = new Date();
    }
    
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.dispatchChallan.update({
        where: { id },
        data,
      });

      if (status === 'dispatched') {
        await this.consumeInventoryForChallan(tx, challan as any);
        await tx.dispatchJob.update({
          where: { id: challan.dispatchJobId },
          data: { status: 'dispatched', updatedAt: new Date() },
        }).catch(() => null);
        const job = await tx.dispatchJob.findUnique({ where: { id: challan.dispatchJobId }, include: { quote: true, customer: true } as any } as any).catch(() => null) as any;
        if (job?.quote?.ownerId) {
          await tx.notification.create({
            data: {
              id: ulid(),
              title: 'Items dispatched',
              message: `${challan.challanNumber} has been dispatched for ${job.customer?.name || 'customer'}.`,
              type: 'dispatch_dispatched',
              entityType: 'DispatchChallan',
              entityId: challan.id,
              href: `/dashboard/leads/${job.quote.leadId}`,
              targetUserId: job.quote.ownerId,
              metadata: { quoteId: challan.quoteId },
            },
          }).catch(() => null);
        }
      } else if (status === 'delivered') {
        await tx.dispatchJob.update({
          where: { id: challan.dispatchJobId },
          data: { status: 'delivered', updatedAt: new Date() },
        }).catch(() => null);
        const job = await tx.dispatchJob.findUnique({ where: { id: challan.dispatchJobId }, include: { quote: true, customer: true } as any } as any).catch(() => null) as any;
        if (job?.quote?.ownerId) {
          await tx.notification.create({
            data: {
              id: ulid(),
              title: 'Delivery completed',
              message: `${challan.challanNumber} has been marked delivered for ${job.customer?.name || 'customer'}.`,
              type: 'dispatch_delivered',
              entityType: 'DispatchChallan',
              entityId: challan.id,
              href: `/dashboard/leads/${job.quote.leadId}`,
              targetUserId: job.quote.ownerId,
              metadata: { quoteId: challan.quoteId },
            },
          }).catch(() => null);
        }
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
    const prefix = `CH`;
    const timestamp = Date.now().toString(36).toUpperCase();
    return `${prefix}/${timestamp}`;
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

  private async consumeInventoryForChallan(tx: any, challan: any) {
    const lines = Array.isArray(challan.lines) ? challan.lines : [];
    for (const line of lines) {
      const productId = line.productId;
      const quantity = Number(line.dispatchQty || line.qty || line.quantity || 0);
      if (!productId || quantity <= 0) continue;

      const balance = await tx.inventoryBalance.findUnique({ where: { productId } });
      if (!balance) continue;
      const location = await this.resolveDispatchLocationTx(tx, line.locationId || line.stockLocationId || line.location?.id);

      const onHand = Math.max(0, Number(balance.onHand || 0) - quantity);
      const reserved = Math.max(0, Number(balance.reserved || 0) - quantity);
      const damaged = Number(balance.damaged || 0);
      const hold = Number(balance.hold || 0);
      await tx.inventoryBalance.update({
        where: { productId },
        data: {
          onHand,
          reserved,
          available: Math.max(0, onHand - reserved - damaged - hold),
          updatedAt: new Date(),
        },
      });

      await tx.inventoryMovement.create({
        data: {
          id: ulid(),
          productId,
          type: 'dispatch',
          quantity,
          reason: `Dispatched on ${challan.challanNumber}`,
          relatedQuoteId: challan.quoteId,
          relatedChallanId: challan.id,
          createdBy: 'dispatch',
        },
      });
      if (location) {
        const locationBalance = await tx.stockBalanceByLocation.findUnique({
          where: { productId_locationId: { productId, locationId: location.id } },
        }).catch(() => null);
        if (locationBalance) {
          await tx.stockBalanceByLocation.update({
            where: { productId_locationId: { productId, locationId: location.id } },
            data: {
              onHand: Math.max(0, Number(locationBalance.onHand || 0) - quantity),
              reserved: Math.max(0, Number(locationBalance.reserved || 0) - quantity),
              updatedAt: new Date(),
            },
          });
        }
        await tx.stockLedgerEntry.create({
          data: {
            id: ulid(),
            productId,
            locationId: location.id,
            type: 'dispatch',
            quantity,
            direction: 'out',
            referenceType: 'DispatchChallan',
            referenceId: challan.id,
            sourceDocumentNo: challan.challanNumber,
            reason: `Dispatched on ${challan.challanNumber}`,
            createdBy: 'dispatch',
            metadata: { quoteId: challan.quoteId, dispatchJobId: challan.dispatchJobId },
          },
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
  }

  private async assertDispatchableLines(lines: any[], quoteId: string) {
    const quote = await this.prisma.quote.findUnique({ where: { id: quoteId } });
    if (!quote) throw new BadRequestException('Dispatch quote not found');
    const quoteLines = this.normalizeLines((quote as any).lines) || [];
    const quoteQtyByProduct = new Map<string, number>();
    for (const line of quoteLines) {
      const productId = String(line.productId || '').trim();
      if (!productId) continue;
      quoteQtyByProduct.set(productId, (quoteQtyByProduct.get(productId) || 0) + Number(line.qty || line.quantity || 0));
    }

    const [challans, reservations] = await Promise.all([
      this.prisma.dispatchChallan.findMany({
        where: { quoteId, status: { in: ['pending', 'dispatched', 'delivered'] } },
      } as any),
      this.prisma.reservation.findMany({ where: { quoteId, status: 'reserved' } }),
    ]);
    const committedByProduct = this.groupChallanQty(challans as any[], 'quote');
    const reservedByProduct = new Map<string, number>();
    for (const reservation of reservations as any[]) {
      reservedByProduct.set(reservation.productId, (reservedByProduct.get(reservation.productId) || 0) + Number(reservation.quantity || 0));
    }

    for (const line of Array.isArray(lines) ? lines : []) {
      const quantity = Number(line.dispatchQty || line.qty || line.quantity || 0);
      if (quantity <= 0) continue;
      const productId = String(line.productId || '').trim();
      if (!productId) {
        throw new BadRequestException(`${line.name || line.sku || 'Line item'} is not linked to stock and cannot be dispatched`);
      }
      const ordered = Number(quoteQtyByProduct.get(productId) || 0);
      const alreadyCommitted = Number(committedByProduct.get(productId) || 0);
      const remainingOrderQty = Math.max(0, ordered - alreadyCommitted);
      const reservedQty = Number(reservedByProduct.get(productId) || 0);
      const dispatchable = Math.min(remainingOrderQty, reservedQty);
      if (quantity > dispatchable) {
        throw new BadRequestException(`${line.name || line.sku || 'Line item'} is not inwards yet and cannot be dispatched. Requested ${quantity}, ready ${dispatchable}, pending inward ${Math.max(0, remainingOrderQty - dispatchable)}`);
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
      for (const line of lines) {
        const productId = String(line.productId || '').trim();
        if (!productId) continue;
        const prefix = scope === 'quote' ? '' : `${challan.dispatchJobId}:`;
        const key = `${prefix}${productId}`;
        grouped.set(key, (grouped.get(key) || 0) + Number(line.dispatchQty || line.qty || line.quantity || 0));
      }
    }
    return grouped;
  }

  private async resolveDispatchLocationTx(tx: any, locationId?: string | null) {
    if (locationId) {
      const requested = await tx.stockLocation.findUnique({ where: { id: locationId } }).catch(() => null);
      if (requested) return requested;
    }
    const locations = await tx.stockLocation.findMany({ where: { status: 'active' } }).catch(() => []);
    const flagged = locations.find((location: any) => location.metadata?.defaultStockScope);
    if (flagged) return flagged;
    if (locations[0]) return locations[0];
    return tx.stockLocation.create({
      data: {
        id: ulid(),
        code: 'MAIN',
        name: 'Main Plant / Godown',
        type: 'plant',
        status: 'active',
        sortOrder: 0,
        metadata: { defaultStockScope: true },
        updatedAt: new Date(),
      },
    });
  }
}
