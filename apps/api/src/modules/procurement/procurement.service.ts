import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ulid } from 'ulid';
import { nextDocumentNumber } from '../common/sequence';
import { PrismaService } from '../prisma/prisma.service';

export interface CreatePurchaseOrderInput {
  demandIds: string[];
  vendorId?: string;
  vendorName?: string;
  expectedDate?: Date;
  notes?: string;
}

export interface ReceivePurchaseOrderInput {
  purchaseOrderId: string;
  supplierChallan?: string;
  supplierBill?: string;
  receivedDate?: Date;
  notes?: string;
  locationId?: string;
  lines?: any;
}

export interface ManualGoodsReceiptInput {
  vendorId?: string;
  vendorName: string;
  supplierChallan?: string;
  supplierBill?: string;
  receivedDate?: Date;
  reason?: string;
  notes?: string;
  locationId?: string;
  lines?: any;
}

@Injectable()
export class ProcurementService {
  constructor(private prisma: PrismaService) {}

  async purchaseDemandQueue(args?: { status?: string; take?: number }) {
    await this.ensureDemandsForOpenOrders();
    const take = this.limit(args?.take, 250);
    const statuses = args?.status && args.status !== 'all'
      ? [args.status]
      : ['open', 'ordered', 'partial_received', 'received', 'allocated'];
    const rows = await (this.prisma as any).purchaseDemand.findMany({
      where: { status: { in: statuses } },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take,
    });
    return this.decorateDemands(rows);
  }

  async purchaseOrders(args?: { status?: string; take?: number }) {
    const where: any = {};
    if (args?.status && args.status !== 'all') where.status = args.status;
    const orders = await (this.prisma as any).purchaseOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: this.limit(args?.take, 100),
    });
    return this.attachPoLines(orders);
  }

  async purchaseOrder(id: string) {
    const order = await (this.prisma as any).purchaseOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Purchase order not found');
    const [decorated] = await this.attachPoLines([order]);
    return decorated;
  }

  async goodsReceiptNotes(args?: { purchaseOrderId?: string; take?: number }) {
    const where: any = {};
    if (args?.purchaseOrderId) where.purchaseOrderId = args.purchaseOrderId;
    const notes = await (this.prisma as any).goodsReceiptNote.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: this.limit(args?.take, 80),
    });
    const grnIds = notes.map((note: any) => note.id);
    const lines = grnIds.length
      ? await (this.prisma as any).goodsReceiptLine.findMany({ where: { goodsReceiptNoteId: { in: grnIds } } })
      : [];
    const byGrn = this.groupBy(lines, 'goodsReceiptNoteId');
    return notes.map((note: any) => ({ ...note, lines: byGrn.get(note.id) || [] }));
  }

  async createPurchaseOrder(input: CreatePurchaseOrderInput, actorUserId: string) {
    const demandIds = Array.from(new Set((input.demandIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
    if (!demandIds.length) throw new BadRequestException('Select at least one purchase demand row');

    const demands = await (this.prisma as any).purchaseDemand.findMany({
      where: { id: { in: demandIds }, status: { in: ['open', 'ordered', 'partial_received'] } },
      orderBy: { createdAt: 'asc' },
    });
    if (!demands.length) throw new BadRequestException('Selected demand rows are already closed or unavailable');

    const vendor = input.vendorId
      ? await (this.prisma as any).vendor.findUnique({ where: { id: input.vendorId } }).catch(() => null)
      : null;
    const vendorName = String(input.vendorName || vendor?.name || demands[0]?.vendorName || '').trim();
    if (!vendorName) throw new BadRequestException('Vendor name is required to create a purchase order');

    const poNumber = await this.generatePoNumber();
    const expectedDate = input.expectedDate ? new Date(input.expectedDate) : null;

    const po = await this.prisma.$transaction(async (tx: any) => {
      const order = await tx.purchaseOrder.create({
        data: {
          id: ulid(),
          poNumber,
          vendorId: input.vendorId || vendor?.id || null,
          vendorName,
          status: 'ordered',
          expectedDate,
          orderedAt: new Date(),
          createdBy: actorUserId,
          notes: input.notes || '',
          metadata: {
            source: 'purchase_demand_queue',
            demandIds,
          },
          updatedAt: new Date(),
        },
      });

      for (const demand of demands) {
        await tx.purchaseOrderLine.create({
          data: {
            id: ulid(),
            purchaseOrderId: order.id,
            purchaseDemandId: demand.id,
            productId: demand.productId || null,
            sku: demand.sku,
            name: demand.name,
            category: demand.category,
            brand: demand.brand,
            finish: demand.finish || null,
            unit: demand.unit || 'PC',
            orderedQuantity: Math.max(0, Number(demand.quantity || 0) - Number(demand.receivedQuantity || 0)),
            unitCost: Number((demand.metadata || {})?.unitCost || 0),
            status: 'ordered',
            metadata: {
              sourceLineKey: demand.sourceLineKey,
              sourceOrderId: demand.sourceOrderId,
              sourceQuoteId: demand.sourceQuoteId,
              customerId: demand.customerId,
              ownerId: demand.ownerId,
            },
            updatedAt: new Date(),
          },
        });
        if (input.vendorId && demand.productId) {
          await tx.productVendor.upsert({
            where: { productId_vendorId: { productId: demand.productId, vendorId: input.vendorId } },
            update: {
              vendorName,
              preferred: true,
              status: 'active',
              updatedAt: new Date(),
              metadata: { source: 'purchase_order', poNumber },
            },
            create: {
              id: ulid(),
              productId: demand.productId,
              vendorId: input.vendorId,
              vendorName,
              preferred: true,
              status: 'active',
              updatedAt: new Date(),
              metadata: { source: 'purchase_order', poNumber },
            },
          }).catch(() => null);
          await tx.reorderPolicy.upsert({
            where: { productId: demand.productId },
            update: {
              preferredVendorId: input.vendorId,
              reorderQuantity: Math.max(Number(demand.quantity || 0), 1),
              reorderPoint: 0,
              updatedAt: new Date(),
            },
            create: {
              id: ulid(),
              productId: demand.productId,
              preferredVendorId: input.vendorId,
              reorderQuantity: Math.max(Number(demand.quantity || 0), 1),
              reorderPoint: 0,
              updatedAt: new Date(),
            },
          }).catch(() => null);
        }
        await tx.purchaseDemand.update({
          where: { id: demand.id },
          data: {
            status: 'ordered',
            orderedQuantity: Math.max(Number(demand.orderedQuantity || 0), Number(demand.quantity || 0)),
            vendorName,
            preferredVendorId: input.vendorId || demand.preferredVendorId || null,
            expectedDate,
            updatedAt: new Date(),
          },
        });
      }

      await tx.auditEvent.create({
        data: {
          id: ulid(),
          actorUserId,
          action: 'purchase_order.create',
          entityType: 'PurchaseOrder',
          entityId: order.id,
          summary: `Created ${order.poNumber} for ${vendorName}`,
          metadata: { demandIds },
        },
      }).catch(() => null);
      return order;
    }, { timeout: 15000 });

    return this.purchaseOrder(po.id);
  }

  async updatePurchaseOrderStatus(id: string, status: string, actorUserId: string) {
    const allowed = ['draft', 'ordered', 'partial_received', 'received', 'closed', 'cancelled'];
    if (!allowed.includes(status)) throw new BadRequestException(`Invalid purchase order status: ${status}`);
    const order = await (this.prisma as any).purchaseOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Purchase order not found');
    const update: any = { status, updatedAt: new Date() };
    if (status === 'ordered') update.orderedAt = order.orderedAt || new Date();
    if (status === 'closed') update.closedAt = new Date();
    const updated = await (this.prisma as any).purchaseOrder.update({ where: { id }, data: update });
    await (this.prisma as any).auditEvent.create({
      data: {
        id: ulid(),
        actorUserId,
        action: 'purchase_order.status',
        entityType: 'PurchaseOrder',
        entityId: id,
        summary: `${order.poNumber} marked ${status}`,
        metadata: { status },
      },
    }).catch(() => null);
    return this.purchaseOrder(updated.id);
  }

  async receivePurchaseOrder(input: ReceivePurchaseOrderInput, actorUserId: string) {
    if (!input.purchaseOrderId) throw new BadRequestException('Purchase order is required for GRN receiving');
    const po = await (this.prisma as any).purchaseOrder.findUnique({ where: { id: input.purchaseOrderId } });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status === 'cancelled' || po.status === 'closed') throw new BadRequestException('This purchase order is closed or cancelled');
    const poLines = await (this.prisma as any).purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
    const lineInputs = this.normalizeLines(input.lines);
    const selected = lineInputs.length
      ? lineInputs
      : poLines
          .map((line: any) => ({
            purchaseOrderLineId: line.id,
            receivedQuantity: Math.max(0, Number(line.orderedQuantity || 0) - Number(line.receivedQuantity || 0)),
            damagedQuantity: 0,
          }))
          .filter((line: any) => line.receivedQuantity > 0);
    if (!selected.length) throw new BadRequestException('Enter at least one received quantity');

    const grnNumber = await this.generateGrnNumber();
    const lineMap = new Map(poLines.map((line: any) => [line.id, line]));

    const grn = await this.prisma.$transaction(async (tx: any) => {
      const receiptLocation = input.locationId
        ? await this.resolveStockLocationTx(tx, input.locationId)
        : await this.ensureDefaultLocationTx(tx);
      const note = await tx.goodsReceiptNote.create({
        data: {
          id: ulid(),
          grnNumber,
          purchaseOrderId: po.id,
          vendorId: po.vendorId || null,
          vendorName: po.vendorName,
          supplierChallan: input.supplierChallan || null,
          supplierBill: input.supplierBill || null,
          receivedDate: input.receivedDate ? new Date(input.receivedDate) : new Date(),
          receivedBy: actorUserId,
          status: 'posted',
          notes: input.notes || '',
          updatedAt: new Date(),
        },
      });

      for (const row of selected) {
        const line = lineMap.get(String(row.purchaseOrderLineId || '')) as any;
        if (!line) throw new BadRequestException('One GRN line does not belong to this purchase order');
        const received = this.whole(row.receivedQuantity, `${line.sku} received quantity`);
        const damaged = Math.max(0, Math.trunc(Number(row.damagedQuantity || 0)));
        if (damaged > received) throw new BadRequestException(`${line.sku} damaged quantity cannot exceed received quantity`);
        const accepted = received - damaged;
        if (received <= 0) continue;

        await tx.goodsReceiptLine.create({
          data: {
            id: ulid(),
            goodsReceiptNoteId: note.id,
            purchaseOrderLineId: line.id,
            productId: line.productId || null,
            sku: line.sku,
            name: line.name,
            orderedQuantity: Number(line.orderedQuantity || 0),
            receivedQuantity: received,
            acceptedQuantity: accepted,
            damagedQuantity: damaged,
            location: row.location || receiptLocation.name,
            unitCost: Number(row.unitCost || line.unitCost || 0),
            metadata: { purchaseDemandId: line.purchaseDemandId, note: row.note || '', locationId: receiptLocation.id },
          },
        });

        const lineReceived = Number(line.receivedQuantity || 0) + accepted;
        const lineStatus = lineReceived >= Number(line.orderedQuantity || 0) ? 'received' : 'partial_received';
        await tx.purchaseOrderLine.update({
          where: { id: line.id },
          data: { receivedQuantity: lineReceived, status: lineStatus, updatedAt: new Date() },
        });

        if (line.purchaseDemandId) {
          const demand = await tx.purchaseDemand.findUnique({ where: { id: line.purchaseDemandId } });
          if (demand) {
            const demandReceived = Number(demand.receivedQuantity || 0) + accepted;
            await tx.purchaseDemand.update({
              where: { id: demand.id },
              data: {
                receivedQuantity: demandReceived,
                status: demandReceived >= Number(demand.quantity || 0) ? 'received' : 'partial_received',
                updatedAt: new Date(),
              },
            });
            if (!line.productId && accepted > 0) {
              await this.allocateSpecialOrderReceiptTx(tx, demand, accepted, actorUserId, note.id, grnNumber);
            }
          }
        }

        if (line.productId && accepted > 0) {
          await this.addAcceptedStockTx(tx, {
            productId: line.productId,
            quantity: accepted,
            reason: `GRN ${grnNumber} against ${po.poNumber}`,
            actorUserId,
            locationId: receiptLocation.id,
            referenceId: note.id,
            sourceDocumentNo: grnNumber,
          });
        }
      }

      await this.refreshPurchaseOrderStatusTx(tx, po.id);
      await tx.auditEvent.create({
        data: {
          id: ulid(),
          actorUserId,
          action: 'grn.post',
          entityType: 'GoodsReceiptNote',
          entityId: note.id,
          summary: `Posted ${note.grnNumber} for ${po.poNumber}`,
          metadata: { purchaseOrderId: po.id },
        },
      }).catch(() => null);
      return note;
    }, { timeout: 20000 });

    const [decorated] = await this.decorateGrns([grn]);
    return decorated;
  }

  async createManualGoodsReceipt(input: ManualGoodsReceiptInput, actorUserId: string) {
    const vendor = input.vendorId
      ? await (this.prisma as any).vendor.findUnique({ where: { id: input.vendorId } }).catch(() => null)
      : null;
    const vendorName = String(input.vendorName || vendor?.name || '').trim();
    if (!vendorName) throw new BadRequestException('Vendor name is required');
    const lines = this.normalizeLines(input.lines);
    if (!lines.length) throw new BadRequestException('Add at least one SKU to receive');
    const productIds = Array.from(new Set(lines.map((line: any) => String(line.productId || '').trim()).filter(Boolean)));
    const products = productIds.length ? await this.prisma.product.findMany({ where: { id: { in: productIds } } }) : [];
    const productMap = new Map(products.map((product: any) => [product.id, product]));
    const grnNumber = await this.generateGrnNumber();

    const grn = await this.prisma.$transaction(async (tx: any) => {
      const receiptLocation = input.locationId
        ? await this.resolveStockLocationTx(tx, input.locationId)
        : await this.ensureDefaultLocationTx(tx);
      const note = await tx.goodsReceiptNote.create({
        data: {
          id: ulid(),
          grnNumber,
          vendorId: input.vendorId || vendor?.id || null,
          vendorName,
          supplierChallan: input.supplierChallan || null,
          supplierBill: input.supplierBill || null,
          receivedDate: input.receivedDate ? new Date(input.receivedDate) : new Date(),
          receivedBy: actorUserId,
          notes: [input.reason ? `Reason: ${input.reason}` : '', input.notes || ''].filter(Boolean).join(' • '),
          updatedAt: new Date(),
        },
      });

      for (const row of lines) {
        const product = productMap.get(String(row.productId || '')) as any;
        if (!product) throw new BadRequestException('Manual GRN rows must use an existing Product Master SKU');
        const received = this.whole(row.receivedQuantity || row.quantity, `${product.sku} received quantity`);
        const damaged = Math.max(0, Math.trunc(Number(row.damagedQuantity || 0)));
        if (damaged > received) throw new BadRequestException(`${product.sku} damaged quantity cannot exceed received quantity`);
        const accepted = received - damaged;

        await tx.goodsReceiptLine.create({
          data: {
            id: ulid(),
            goodsReceiptNoteId: note.id,
            productId: product.id,
            sku: product.sku,
            name: product.name,
            orderedQuantity: received,
            receivedQuantity: received,
            acceptedQuantity: accepted,
            damagedQuantity: damaged,
            location: row.location || receiptLocation.name,
            unitCost: Number(row.unitCost || 0),
            metadata: { manualReason: input.reason || '', locationId: receiptLocation.id },
          },
        });

        if (accepted > 0) {
          await this.addAcceptedStockTx(tx, {
            productId: product.id,
            quantity: accepted,
            reason: `Manual GRN ${grnNumber} from ${vendorName}`,
            actorUserId,
            locationId: receiptLocation.id,
            referenceId: note.id,
            sourceDocumentNo: grnNumber,
          });
        }
      }

      await tx.auditEvent.create({
        data: {
          id: ulid(),
          actorUserId,
          action: 'grn.manual_post',
          entityType: 'GoodsReceiptNote',
          entityId: note.id,
          summary: `Posted manual GRN ${note.grnNumber} from ${vendorName}`,
          metadata: { vendorName },
        },
      }).catch(() => null);
      return note;
    }, { timeout: 20000 });

    const [decorated] = await this.decorateGrns([grn]);
    return decorated;
  }

  async procurementSummary() {
    await this.ensureDemandsForOpenOrders();
    const [openDemand, orderedDemand, partialDemand, openPo, partialPo, recentGrn] = await Promise.all([
      (this.prisma as any).purchaseDemand.count({ where: { status: 'open' } }),
      (this.prisma as any).purchaseDemand.count({ where: { status: 'ordered' } }),
      (this.prisma as any).purchaseDemand.count({ where: { status: 'partial_received' } }),
      (this.prisma as any).purchaseOrder.count({ where: { status: { in: ['draft', 'ordered'] } } }),
      (this.prisma as any).purchaseOrder.count({ where: { status: 'partial_received' } }),
      (this.prisma as any).goodsReceiptNote.count({ where: { createdAt: { gte: new Date(Date.now() - 86400000 * 7) } } }),
    ]);
    return { openDemand, orderedDemand, partialDemand, activePurchaseOrders: openPo + partialPo, recentGrn };
  }

  async ensureDemandsForOpenOrders() {
    const orders = await (this.prisma as any).salesOrder.findMany({
      where: { status: { in: ['open', 'confirmed', 'partial', 'pending'] } },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    if (!orders.length) return;

    const quoteIds = Array.from(new Set(orders.map((order: any) => order.quoteId).filter(Boolean))) as string[];
    const orderByQuote = new Map(orders.map((order: any) => [order.quoteId, order] as const));
    const reservations = await this.prisma.reservation.findMany({
      where: { quoteId: { in: quoteIds }, status: 'backordered' },
      orderBy: { createdAt: 'asc' },
    });
    const productIds = Array.from(new Set(reservations.map((reservation: any) => reservation.productId).filter(Boolean))) as string[];
    const customerIds = Array.from(new Set(orders.map((order: any) => order.customerId).filter(Boolean))) as string[];
    const ownerIds = Array.from(new Set(orders.map((order: any) => order.ownerId).filter(Boolean))) as string[];
    const [products, customers, owners] = await Promise.all([
      productIds.length ? this.prisma.product.findMany({ where: { id: { in: productIds } } }) : [],
      customerIds.length ? this.prisma.customer.findMany({ where: { id: { in: customerIds } } }) : [],
      ownerIds.length ? this.prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } }) : [],
    ]) as [any[], any[], Array<{ id: string; name: string | null }>];
    const productMap = new Map(products.map((product: any) => [product.id, product] as const));
    const customerMap = new Map(customers.map((customer: any) => [customer.id, customer] as const));
    const ownerMap = new Map(owners.map((owner: any) => [owner.id, owner] as const));
    const rows: any[] = [];

    for (const reservation of reservations as any[]) {
      const order = orderByQuote.get(reservation.quoteId) as any;
      const product = productMap.get(reservation.productId) as any;
      if (!order || !product) continue;
      rows.push({
        id: ulid(),
        sourceType: 'backorder_reservation',
        sourceLineKey: `reservation:${reservation.id}`,
        sourceOrderId: order.id,
        sourceQuoteId: order.quoteId,
        sourceReservationId: reservation.id,
        customerId: order.customerId,
        ownerId: order.ownerId,
        productId: product.id,
        sku: product.sku,
        name: product.name,
        category: product.category,
        brand: product.brand,
        finish: product.finish,
        unit: product.unit || 'PC',
        quantity: Math.max(1, Number(reservation.quantity || 0)),
        status: 'open',
        vendorName: product.brand || null,
        notes: `${order.orderNumber || 'Sales order'} shortage for ${customerMap.get(order.customerId)?.name || 'customer'}`,
        metadata: { orderNumber: order.orderNumber, customerName: customerMap.get(order.customerId)?.name, ownerName: ownerMap.get(order.ownerId)?.name },
        updatedAt: new Date(),
      });
    }

    for (const order of orders as any[]) {
      const lines = this.normalizeLines(order.lines);
      lines.forEach((line: any, index: number) => {
        if (!this.isTileLine(line) || String(line.productId || '').trim()) return;
        const quantity = Math.trunc(Number(line.qty || line.quantity || 0));
        if (quantity <= 0) return;
        const sku = String(line.tileCode || line.sku || `TILE-${index + 1}`).trim();
        rows.push({
          id: ulid(),
          sourceType: 'tile_special_order',
          sourceLineKey: this.tileDemandKey(order.id, line, index),
          sourceOrderId: order.id,
          sourceQuoteId: order.quoteId,
          customerId: order.customerId,
          ownerId: order.ownerId,
          sku,
          name: String(line.name || `Tile ${sku}`).trim(),
          category: 'Tiles',
          brand: line.brand || 'Tile vendor',
          finish: line.tileSize || line.dimensions || '',
          unit: line.unit || line.uom || 'BOX',
          quantity,
          status: 'open',
          vendorName: line.brand || 'Tile vendor',
          notes: `${order.orderNumber || 'Sales order'} tile special order for ${customerMap.get(order.customerId)?.name || 'customer'}`,
          metadata: { orderNumber: order.orderNumber, tileCode: sku, tileSize: line.tileSize || line.dimensions || '', lineIndex: index },
          updatedAt: new Date(),
        });
      });
    }

    if (!rows.length) return;
    await (this.prisma as any).purchaseDemand.createMany({ data: rows, skipDuplicates: true }).catch(() => null);
  }

  private async decorateDemands(rows: any[]) {
    if (!rows.length) return [];
    const customerIds = Array.from(new Set(rows.map((row) => row.customerId).filter(Boolean))) as string[];
    const ownerIds = Array.from(new Set(rows.map((row) => row.ownerId).filter(Boolean))) as string[];
    const orderIds = Array.from(new Set(rows.map((row) => row.sourceOrderId).filter(Boolean))) as string[];
    const [customers, owners, orders] = await Promise.all([
      customerIds.length ? this.prisma.customer.findMany({ where: { id: { in: customerIds } } }) : [],
      ownerIds.length ? this.prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true, email: true, role: true, phone: true } }) : [],
      orderIds.length ? (this.prisma as any).salesOrder.findMany({ where: { id: { in: orderIds } } }) : [],
    ]);
    const customerMap = new Map(customers.map((item: any) => [item.id, item] as const));
    const ownerMap = new Map(owners.map((item: any) => [item.id, item] as const));
    const orderMap = new Map(orders.map((item: any) => [item.id, item] as const));
    return rows.map((row) => ({ ...row, customer: row.customerId ? customerMap.get(row.customerId) || null : null, owner: row.ownerId ? ownerMap.get(row.ownerId) || null : null, salesOrder: row.sourceOrderId ? orderMap.get(row.sourceOrderId) || null : null }));
  }

  private async attachPoLines(orders: any[]) {
    if (!orders.length) return [];
    const orderIds = orders.map((order) => order.id);
    const lines = await (this.prisma as any).purchaseOrderLine.findMany({ where: { purchaseOrderId: { in: orderIds } }, orderBy: { createdAt: 'asc' } });
    const demandIds = Array.from(new Set(lines.map((line: any) => line.purchaseDemandId).filter(Boolean)));
    const demands = demandIds.length ? await (this.prisma as any).purchaseDemand.findMany({ where: { id: { in: demandIds } } }) : [];
    const demandMap = new Map(demands.map((demand: any) => [demand.id, demand]));
    const linesByPo = this.groupBy(lines.map((line: any) => ({ ...line, demand: line.purchaseDemandId ? demandMap.get(line.purchaseDemandId) || null : null })), 'purchaseOrderId');
    return orders.map((order) => ({ ...order, lines: linesByPo.get(order.id) || [] }));
  }

  private async decorateGrns(notes: any[]) {
    const grnIds = notes.map((note) => note.id);
    const lines = grnIds.length ? await (this.prisma as any).goodsReceiptLine.findMany({ where: { goodsReceiptNoteId: { in: grnIds } } }) : [];
    const byGrn = this.groupBy(lines, 'goodsReceiptNoteId');
    return notes.map((note) => ({ ...note, lines: byGrn.get(note.id) || [] }));
  }

  private async allocateSpecialOrderReceiptTx(
    tx: any,
    demand: any,
    acceptedQuantity: number,
    actorUserId: string,
    grnId: string,
    grnNumber: string,
  ) {
    if (!demand?.sourceOrderId || !demand?.sourceLineKey || acceptedQuantity <= 0) return;
    const order = await tx.salesOrder.findUnique({ where: { id: demand.sourceOrderId } }).catch(() => null);
    if (!order) return;
    const line = await tx.salesOrderLine.findUnique({
      where: { salesOrderId_lineKey: { salesOrderId: demand.sourceOrderId, lineKey: demand.sourceLineKey } },
    }).catch(() => null);
    if (!line) return;

    const nextAllocated = Math.min(Number(line.orderedQuantity || 0), Number(line.allocatedQuantity || 0) + acceptedQuantity);
    const dispatched = Number(line.dispatchedQuantity || 0);
    const remainingAfterDispatch = Math.max(0, Number(line.orderedQuantity || 0) - dispatched);
    const nextBackordered = Math.max(0, remainingAfterDispatch - nextAllocated);
    await tx.salesOrderLine.update({
      where: { id: line.id },
      data: {
        allocatedQuantity: nextAllocated,
        backorderedQuantity: nextBackordered,
        status: nextBackordered <= 0 ? 'ready' : 'partial_ready',
        updatedAt: new Date(),
      },
    }).catch(() => null);

    const quote = await tx.quote.findUnique({ where: { id: order.quoteId } }).catch(() => null);
    if (quote?.leadId) {
      await tx.activity.create({
        data: {
          id: ulid(),
          leadId: quote.leadId,
          quoteId: quote.id,
          userId: quote.ownerId,
          type: 'stock_ready',
          message: `${line.sku || demand.sku} arrived on ${grnNumber}; special-order quantity is ready for dispatch.`,
        },
      }).catch(() => null);
    }

    await tx.notification.createMany({
      data: [
        {
          id: ulid(),
          title: 'Special-order item arrived',
          message: `${line.sku || demand.sku} has been inwarded for ${order.orderNumber} and is ready for dispatch.`,
          type: 'stock_ready',
          entityType: 'SalesOrder',
          entityId: order.id,
          href: quote?.leadId ? `/dashboard/leads/${quote.leadId}` : '/dashboard/orders',
          targetUserId: order.ownerId,
          metadata: { salesOrderId: order.id, grnId, demandId: demand.id },
        },
        {
          id: ulid(),
          title: 'Pending inward item ready',
          message: `${line.sku || demand.sku} is inwarded for ${order.orderNumber}. Dispatch can create the remaining challan.`,
          type: 'stock_ready',
          entityType: 'SalesOrder',
          entityId: order.id,
          href: '/dashboard/dispatch',
          targetRole: 'dispatch_ops',
          metadata: { salesOrderId: order.id, grnId, demandId: demand.id },
        },
      ],
    }).catch(() => null);

    await tx.stockLedgerEntry.create({
      data: {
        id: ulid(),
        productId: null,
        locationId: null,
        type: 'special_order_receipt',
        quantity: acceptedQuantity,
        direction: 'in',
        referenceType: 'GoodsReceiptNote',
        referenceId: grnId,
        sourceDocumentNo: grnNumber,
        reason: `Special-order receipt allocated to ${order.orderNumber}`,
        createdBy: actorUserId,
        metadata: { salesOrderId: order.id, lineKey: demand.sourceLineKey, demandId: demand.id, sku: line.sku || demand.sku },
      },
    }).catch(() => null);
  }

  private async addAcceptedStockTx(
    tx: any,
    args: { productId: string; quantity: number; reason: string; actorUserId: string; locationId?: string; referenceId?: string; sourceDocumentNo?: string },
  ) {
    const location = args.locationId
      ? await this.resolveStockLocationTx(tx, args.locationId)
      : await this.ensureDefaultLocationTx(tx);
    const current = await tx.inventoryBalance.findUnique({ where: { productId: args.productId } });
    if (current) {
      await tx.inventoryBalance.update({
        where: { productId: args.productId },
        data: {
          onHand: Number(current.onHand || 0) + args.quantity,
          available: Number(current.available || 0) + args.quantity,
          updatedAt: new Date(),
        },
      });
    } else {
      await tx.inventoryBalance.create({
        data: {
          id: ulid(),
          productId: args.productId,
          onHand: args.quantity,
          available: args.quantity,
          reserved: 0,
          damaged: 0,
          hold: 0,
          updatedAt: new Date(),
        },
      });
    }
    await tx.inventoryMovement.create({
      data: {
        id: ulid(),
        productId: args.productId,
        type: 'inward',
        quantity: args.quantity,
        reason: args.reason,
        createdBy: args.actorUserId,
      },
    });
    const byLocation = await tx.stockBalanceByLocation.findUnique({
      where: { productId_locationId: { productId: args.productId, locationId: location.id } },
    }).catch(() => null);
    if (byLocation) {
      await tx.stockBalanceByLocation.update({
        where: { productId_locationId: { productId: args.productId, locationId: location.id } },
        data: {
          onHand: Number(byLocation.onHand || 0) + args.quantity,
          updatedAt: new Date(),
        },
      });
    } else {
      await tx.stockBalanceByLocation.create({
        data: {
          id: ulid(),
          productId: args.productId,
          locationId: location.id,
          onHand: args.quantity,
          reserved: 0,
          damaged: 0,
          hold: 0,
          updatedAt: new Date(),
        },
      });
    }
    await tx.stockLedgerEntry.create({
      data: {
        id: ulid(),
        productId: args.productId,
        locationId: location.id,
        type: 'grn_receipt',
        quantity: args.quantity,
        direction: 'in',
        referenceType: 'GoodsReceiptNote',
        referenceId: args.referenceId || null,
        sourceDocumentNo: args.sourceDocumentNo || null,
        reason: args.reason,
        createdBy: args.actorUserId,
        metadata: { source: 'procurement_service' },
      },
    }).catch(() => null);
    await this.autoReserveBackordersTx(tx, args.productId, args.actorUserId);
  }

  private async autoReserveBackordersTx(tx: any, productId: string, actorUserId: string) {
    const reservations = await tx.reservation.findMany({
      where: { productId, status: 'backordered' },
      orderBy: { createdAt: 'asc' },
    });
    for (const reservation of reservations) {
      const balance = await tx.inventoryBalance.findUnique({ where: { productId }, include: { product: true } });
      if (!balance || Number(balance.available || 0) < Number(reservation.quantity || 0)) return;
      const quote = await tx.quote.findUnique({ where: { id: reservation.quoteId } });
      await tx.inventoryBalance.update({
        where: { productId },
        data: {
          available: Number(balance.available || 0) - Number(reservation.quantity || 0),
          reserved: Number(balance.reserved || 0) + Number(reservation.quantity || 0),
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
          reason: `Auto-reserved arrived backorder for ${quote?.quoteNumber || reservation.quoteId}`,
          relatedQuoteId: reservation.quoteId,
          createdBy: actorUserId || 'system',
        },
      });
      await tx.purchaseDemand.updateMany({
        where: { sourceReservationId: reservation.id },
        data: { status: 'allocated', updatedAt: new Date() },
      }).catch(() => null);
      if (quote?.leadId) {
        await tx.activity.create({
          data: {
            id: ulid(),
            leadId: quote.leadId,
            quoteId: quote.id,
            userId: quote.ownerId,
            type: 'stock_ready',
            message: `${balance.product?.sku || 'Item'} arrived through GRN, was auto-reserved, and is ready for dispatch.`,
          },
        }).catch(() => null);
        await tx.notification.createMany({
          data: [
            {
              id: ulid(),
              title: 'Backorder item reserved',
              message: `${balance.product?.sku || 'Item'} has arrived for ${quote.quoteNumber} and is reserved.`,
              type: 'stock_ready',
              entityType: 'Quote',
              entityId: quote.id,
              href: `/dashboard/leads/${quote.leadId}`,
              targetUserId: quote.ownerId,
              metadata: { productId, quoteId: quote.id },
            },
            {
              id: ulid(),
              title: 'Pending dispatch item ready',
              message: `${balance.product?.sku || 'Item'} is inwarded and reserved. Dispatch can create the remaining challan.`,
              type: 'stock_ready',
              entityType: 'Quote',
              entityId: quote.id,
              href: '/dashboard/dispatch',
              targetRole: 'dispatch_ops',
              metadata: { productId, quoteId: quote.id },
            },
          ],
        }).catch(() => null);
      }
    }
  }

  private async refreshPurchaseOrderStatusTx(tx: any, purchaseOrderId: string) {
    const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId } });
    const received = lines.filter((line: any) => Number(line.receivedQuantity || 0) >= Number(line.orderedQuantity || 0)).length;
    const partial = lines.some((line: any) => Number(line.receivedQuantity || 0) > 0);
    const status = received === lines.length ? 'received' : partial ? 'partial_received' : 'ordered';
    await tx.purchaseOrder.update({ where: { id: purchaseOrderId }, data: { status, updatedAt: new Date(), closedAt: status === 'received' ? new Date() : undefined } });
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

  private groupBy(rows: any[], key: string) {
    const grouped = new Map<string, any[]>();
    for (const row of rows || []) {
      const groupKey = String(row[key] || '');
      grouped.set(groupKey, [...(grouped.get(groupKey) || []), row]);
    }
    return grouped;
  }

  private whole(value: any, label: string) {
    const number = Math.trunc(Number(value || 0));
    if (!Number.isFinite(number) || number <= 0) throw new BadRequestException(`${label} must be a positive whole number`);
    return number;
  }

  private limit(value: any, fallback: number) {
    return Math.max(1, Math.min(500, Number(value) || fallback));
  }

  private async generatePoNumber() {
    return nextDocumentNumber(this.prisma as any, 'purchase_order', 'PO', new Date(), {
      existingNumbers: async (prefixForYear) => (await (this.prisma as any).purchaseOrder.findMany({
        where: { poNumber: { startsWith: prefixForYear } },
        select: { poNumber: true },
      })).map((row: any) => row.poNumber),
    });
  }

  private async generateGrnNumber() {
    return nextDocumentNumber(this.prisma as any, 'goods_receipt', 'GRN', new Date(), {
      existingNumbers: async (prefixForYear) => (await (this.prisma as any).goodsReceiptNote.findMany({
        where: { grnNumber: { startsWith: prefixForYear } },
        select: { grnNumber: true },
      })).map((row: any) => row.grnNumber),
    });
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

  private async resolveStockLocationTx(tx: any, locationId: string) {
    const location = await tx.stockLocation.findUnique({ where: { id: locationId } }).catch(() => null);
    if (!location) throw new BadRequestException('Selected plant / stock location was not found');
    if (location.status !== 'active') throw new BadRequestException('Selected plant / stock location is inactive');
    return location;
  }
}
