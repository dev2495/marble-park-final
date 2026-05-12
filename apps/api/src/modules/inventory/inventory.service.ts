import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ulid } from 'ulid';

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

  async adjustQuantity(
    id: string,
    adjustment: number,
    type: 'inward' | 'outward' | 'damage' | 'adjustment' | 'reserve' | 'release',
    notes?: string,
    createdBy = 'system',
  ): Promise<any> {
    const balance = await this.findById(id);
    const quantity = Math.trunc(Number(adjustment || 0));
    if (!Number.isFinite(quantity) || quantity === 0) throw new BadRequestException('Quantity must be a non-zero whole number');
    if (type !== 'adjustment' && quantity < 0) throw new BadRequestException('Quantity must be positive for this movement');
    
    let newOnHand = balance.onHand;
    let newAvailable = balance.available;
    let newReserved = balance.reserved;
    let newDamaged = balance.damaged;
    const hold = Number(balance.hold || 0);
    
    switch (type) {
      case 'inward':
        newOnHand += quantity;
        newAvailable += quantity;
        break;
      case 'outward':
        if (quantity > newAvailable) throw new BadRequestException('Cannot consume more than available stock');
        newOnHand -= quantity;
        newAvailable -= quantity;
        break;
      case 'damage':
        if (quantity > newAvailable) throw new BadRequestException('Cannot mark more than available stock as damaged');
        newAvailable -= quantity;
        newDamaged += quantity;
        break;
      case 'reserve':
        if (quantity > newAvailable) throw new BadRequestException('Cannot reserve more than available stock');
        newAvailable -= quantity;
        newReserved += quantity;
        break;
      case 'release':
        if (quantity > newReserved) throw new BadRequestException('Cannot release more than reserved stock');
        newReserved -= quantity;
        newAvailable += quantity;
        break;
      case 'adjustment':
        newOnHand = Math.max(0, newOnHand + quantity);
        newAvailable = Math.max(0, newOnHand - newReserved - newDamaged - hold);
        break;
      default:
        throw new BadRequestException('Unsupported inventory movement type');
    }
    
    const [updated]: any = await this.prisma.$transaction([
      this.prisma.inventoryBalance.update({
        where: { id },
        data: { onHand: newOnHand, available: newAvailable, reserved: newReserved, damaged: newDamaged, updatedAt: new Date() },
        include: { product: true },
      } as any),
      this.prisma.inventoryMovement.create({
        data: {
          id: ulid(),
          productId: balance.productId,
          type,
          quantity,
          reason: notes || 'Manual inventory adjustment',
          createdBy,
        },
      } as any),
    ]);
    if (type === 'inward' && quantity > 0) await this.notifyBackorderReady(balance.productId, createdBy);
    
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
        await tx.inventoryBalance.update({
          where: { productId },
          data: {
            available: Number(fresh.available || 0) - Number(reservation.quantity || 0),
            reserved: Number(fresh.reserved || 0) + Number(reservation.quantity || 0),
            updatedAt: new Date(),
          },
        });
        await tx.reservation.update({
          where: { id: reservation.id },
          data: { status: 'reserved', updatedAt: new Date() },
        });
        await tx.inventoryMovement.create({
          data: {
            id: ulid(),
            productId,
            type: 'reserve',
            quantity: Number(reservation.quantity || 0),
            reason: `Auto-reserved arrived backorder for ${quote.quoteNumber}`,
            relatedQuoteId: quote.id,
            createdBy: actorUserId || 'system',
          },
        });
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
