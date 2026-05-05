import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ulid } from 'ulid';

export interface CreateInventoryInput {
  productId: string;
  onHand?: number;
}

export interface UpdateInventoryInput {
  onHand?: number;
  reserved?: number;
  damaged?: number;
}

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

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

  async create(data: CreateInventoryInput): Promise<any> {
    const available = data.onHand || 0;
    const created = await this.prisma.inventoryBalance.create({
      data: {
        id: ulid(),
        ...data,
        available,
        reserved: 0,
        damaged: 0,
        hold: 0,
        updatedAt: new Date(),
      },
      include: { product: true },
    } as any) as any;
    if (Number(data.onHand || 0) > 0) await this.notifyBackorderReady(data.productId, 'system');
    return created;
  }

  async update(id: string, data: UpdateInventoryInput): Promise<any> {
    await this.findById(id);
    const normalized: any = { ...data };
    if (data.onHand !== undefined || data.reserved !== undefined || data.damaged !== undefined) {
      const current = await this.findById(id);
      const onHand = data.onHand ?? current.onHand;
      const reserved = data.reserved ?? current.reserved;
      const damaged = data.damaged ?? current.damaged;
      const hold = current.hold || 0;
      normalized.available = Math.max(0, onHand - reserved - damaged - hold);
      normalized.updatedAt = new Date();
    }
    const updated = await this.prisma.inventoryBalance.update({
      where: { id },
      data: normalized,
      include: { product: true },
    } as any) as any;
    if ((data.onHand ?? 0) > 0) await this.notifyBackorderReady(updated.productId, 'system');
    return updated;
  }

  async adjustQuantity(id: string, adjustment: number, type: 'inward' | 'outward' | 'damage' | 'adjustment', notes?: string, createdBy = 'system'): Promise<any> {
    const balance = await this.findById(id);
    
    let newOnHand = balance.onHand;
    let newAvailable = balance.available;
    let newDamaged = balance.damaged;
    
    switch (type) {
      case 'inward':
        newOnHand += adjustment;
        newAvailable += adjustment;
        break;
      case 'outward':
        newOnHand = Math.max(0, newOnHand - adjustment);
        newAvailable = Math.max(0, newAvailable - adjustment);
        break;
      case 'damage':
        newOnHand = Math.max(0, newOnHand - adjustment);
        newDamaged += adjustment;
        break;
      case 'adjustment':
        newOnHand += adjustment;
        newAvailable = Math.max(0, newAvailable + adjustment);
        break;
    }
    
    const [updated]: any = await this.prisma.$transaction([
      this.prisma.inventoryBalance.update({
        where: { id },
        data: { onHand: newOnHand, available: newAvailable, damaged: newDamaged, updatedAt: new Date() },
        include: { product: true },
      } as any),
      this.prisma.inventoryMovement.create({
        data: {
          id: ulid(),
          productId: balance.productId,
          type,
          quantity: adjustment,
          reason: notes || 'Manual inventory adjustment',
          createdBy,
        },
      } as any),
    ]);
    if (type === 'inward' && adjustment > 0) await this.notifyBackorderReady(balance.productId, createdBy);
    
    return updated;
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
      if (b.available < 5) summary.lowStock++;
      if (b.available === 0) summary.outOfStock++;
    }
    
    return summary;
  }

  private async notifyBackorderReady(productId: string, actorUserId: string) {
    const balance = await this.prisma.inventoryBalance.findUnique({ where: { productId }, include: { product: true } as any } as any) as any;
    if (!balance || Number(balance.onHand || 0) <= 0) return;
    const reservations = await this.prisma.reservation.findMany({ where: { productId, status: 'backordered' } });
    for (const reservation of reservations) {
      const quote = await this.prisma.quote.findUnique({ where: { id: reservation.quoteId }, include: { lead: true } as any } as any) as any;
      if (!quote?.leadId) continue;
      await this.prisma.activity.create({
        data: {
          id: ulid(),
          leadId: quote.leadId,
          quoteId: quote.id,
          userId: quote.ownerId,
          type: 'stock_ready',
          message: `${balance.product?.sku || 'Item'} is now in store. Backorder can move to dispatch tracking.`,
        },
      }).catch(() => null);
      await this.prisma.followUpTask.create({
        data: {
          id: ulid(),
          leadId: quote.leadId,
          ownerId: quote.ownerId,
          dueAt: new Date(),
          status: 'pending',
          notes: `${balance.product?.name || balance.product?.sku || 'Item'} has arrived. Inform customer and coordinate dispatch.`,
          updatedAt: new Date(),
        },
      }).catch(() => null);
    }
  }
}
