import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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
  constructor(private prisma: PrismaService) {}

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

    const challanLines = this.normalizeLines(data.lines) || job.quote?.lines || [];
    await this.assertDispatchableLines(challanLines);
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
    return challan;
  }

  async updateChallanStatus(id: string, status: string) {
    const challan = await this.prisma.dispatchChallan.findUnique({ where: { id } });
    if (!challan) throw new NotFoundException('Challan not found');
    
    const data: any = { status };
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
      } else if (status === 'delivered') {
        await tx.dispatchJob.update({
          where: { id: challan.dispatchJobId },
          data: { status: 'delivered', updatedAt: new Date() },
        }).catch(() => null);
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

      const reservation = await tx.reservation.findFirst({
        where: { quoteId: challan.quoteId, productId, status: 'reserved' },
        orderBy: { createdAt: 'asc' },
      });
      if (reservation) {
        await tx.reservation.update({
          where: { id: reservation.id },
          data: { status: 'dispatched', updatedAt: new Date() },
        });
      }
    }
  }

  private async assertDispatchableLines(lines: any[]) {
    for (const line of Array.isArray(lines) ? lines : []) {
      const quantity = Number(line.dispatchQty || line.qty || line.quantity || 0);
      if (quantity <= 0) continue;
      if (!line.productId) {
        throw new BadRequestException(`${line.name || line.sku || 'Line item'} is not linked to stock and cannot be dispatched`);
      }
      const balance = await this.prisma.inventoryBalance.findUnique({ where: { productId: line.productId } });
      const onHand = Number(balance?.onHand || 0);
      if (!balance || onHand < quantity) {
        throw new BadRequestException(`${line.name || line.sku || 'Line item'} is not inwards yet. Required ${quantity}, on hand ${onHand}`);
      }
    }
  }
}
