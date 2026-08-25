import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ulid } from 'ulid';
import { nextDocumentNumber } from '../common/sequence';
import { syncSalesOrderLinesForQuoteTx } from '../common/stock-posting';
import { applyLotStockPostingTx } from '../common/lot-stock-posting';
import { reserveAvailableLotsTx } from '../common/lot-allocation';
import { pricePoLines } from '../common/po-pricing';
import { PrismaService } from '../prisma/prisma.service';
import { indiaDay, reportRange } from '../reporting/reporting-time';

export interface CreatePurchaseOrderInput {
  demandIds?: string[];
  lines?: any;
  vendorId?: string;
  vendorName?: string;
  expectedDate?: Date;
  notes?: string;
  /** Optional header discount % (0–100). Blank/0 = none. */
  discountPercent?: number;
  /** Optional GST % (0–100). Blank/0/null = no GST. */
  taxRate?: number | null;
}

export interface ReceivePurchaseOrderInput {
  purchaseOrderId: string;
  supplierChallan?: string;
  supplierBill?: string;
  receivedDate?: Date;
  notes?: string;
  locationId?: string;
  lines?: any;
  idempotencyKey?: string;
}

export interface ManualGoodsReceiptInput {
  vendorId?: string;
  vendorName: string;
  supplierChallan?: string;
  supplierBill?: string;
  receivedDate?: Date;
  idempotencyKey?: string;
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

  async purchaseDemandPage(args?: { search?: string; status?: string; sort?: string; skip?: number; take?: number }) {
    await this.ensureDemandsForOpenOrders();
    const where: any = {};
    if (args?.status && args.status !== 'all') where.status = args.status;
    const search = String(args?.search || '').trim();
    if (search) where.OR = [
      { sku: { contains: search, mode: 'insensitive' } },
      { name: { contains: search, mode: 'insensitive' } },
      { brand: { contains: search, mode: 'insensitive' } },
      { vendorName: { contains: search, mode: 'insensitive' } },
      { sourceLineKey: { contains: search, mode: 'insensitive' } },
    ];
    const take = this.limit(args?.take, 40);
    const skip = Math.max(0, Number(args?.skip || 0));
    const orderBy: any = args?.sort === 'oldest' ? [{ createdAt: 'asc' }, { id: 'asc' }]
      : args?.sort === 'sku_asc' ? [{ sku: 'asc' }, { createdAt: 'asc' }]
      : args?.sort === 'shortage_desc' ? [{ quantity: 'desc' }, { createdAt: 'asc' }]
      : args?.sort === 'eta_asc' ? [{ expectedDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }]
      : [{ priority: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }];
    const [rows, total] = await Promise.all([
      (this.prisma as any).purchaseDemand.findMany({ where, orderBy, skip, take }),
      (this.prisma as any).purchaseDemand.count({ where }),
    ]);
    const items = await this.decorateDemands(rows);
    return { items, total, skip, take, hasNext: skip + items.length < total };
  }

  async purchaseOrderPage(args?: { search?: string; status?: string; sort?: string; dateFrom?: string; dateTo?: string; skip?: number; take?: number }) {
    const where: any = {};
    if (args?.status === 'open') where.status = { in: ['draft', 'ordered', 'partial_received'] };
    else if (args?.status && args.status !== 'all') where.status = args.status;
    const search = String(args?.search || '').trim();
    if (search) where.OR = [
      { poNumber: { contains: search, mode: 'insensitive' } },
      { vendorName: { contains: search, mode: 'insensitive' } },
      { notes: { contains: search, mode: 'insensitive' } },
      { lines: { some: { OR: [
        { sku: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
      ] } } },
    ];
    const date = this.dateWindow(args?.dateFrom, args?.dateTo);
    if (date) where.createdAt = date;
    const take = this.limit(args?.take, 30);
    const skip = Math.max(0, Number(args?.skip || 0));
    const orderBy: any = args?.sort === 'oldest' ? [{ createdAt: 'asc' }, { id: 'asc' }]
      : args?.sort === 'po_asc' ? [{ poNumber: 'asc' }, { id: 'asc' }]
      : args?.sort === 'vendor_asc' ? [{ vendorName: 'asc' }, { createdAt: 'desc' }]
      : args?.sort === 'value_desc' ? [{ grandTotal: 'desc' }, { createdAt: 'desc' }]
      : args?.sort === 'eta_asc' ? [{ expectedDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }]
      : [{ createdAt: 'desc' }, { id: 'desc' }];
    const [rows, total] = await Promise.all([
      (this.prisma as any).purchaseOrder.findMany({ where, orderBy, skip, take }),
      (this.prisma as any).purchaseOrder.count({ where }),
    ]);
    const items = await this.attachPoLines(rows);
    return { items, total, skip, take, hasNext: skip + items.length < total };
  }

  async goodsReceiptPage(args?: { search?: string; source?: string; sort?: string; dateFrom?: string; dateTo?: string; skip?: number; take?: number }) {
    const where: any = {};
    if (args?.source === 'po') where.purchaseOrderId = { not: null };
    if (args?.source === 'manual') where.purchaseOrderId = null;
    const search = String(args?.search || '').trim();
    if (search) where.OR = [
      { grnNumber: { contains: search, mode: 'insensitive' } },
      { vendorName: { contains: search, mode: 'insensitive' } },
      { supplierChallan: { contains: search, mode: 'insensitive' } },
      { supplierBill: { contains: search, mode: 'insensitive' } },
      { lines: { some: { OR: [
        { sku: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { lotId: { contains: search, mode: 'insensitive' } },
      ] } } },
    ];
    const date = this.dateWindow(args?.dateFrom, args?.dateTo);
    if (date) where.receivedDate = date;
    const take = this.limit(args?.take, 30);
    const skip = Math.max(0, Number(args?.skip || 0));
    const orderBy: any = args?.sort === 'oldest' ? [{ receivedDate: 'asc' }, { id: 'asc' }]
      : args?.sort === 'grn_asc' ? [{ grnNumber: 'asc' }, { id: 'asc' }]
      : args?.sort === 'vendor_asc' ? [{ vendorName: 'asc' }, { receivedDate: 'desc' }]
      : [{ receivedDate: 'desc' }, { id: 'desc' }];
    const [rows, total] = await Promise.all([
      (this.prisma as any).goodsReceiptNote.findMany({ where, orderBy, skip, take }),
      (this.prisma as any).goodsReceiptNote.count({ where }),
    ]);
    const items = await this.decorateGrns(rows);
    return { items, total, skip, take, hasNext: skip + items.length < total };
  }

  async purchaseOrderCostReadinessPage(args?: { search?: string; skip?: number; take?: number }) {
    const search = String(args?.search || '').trim();
    const where: any = {
      status: { in: ['draft', 'ordered', 'partial_received'] },
      lines: { some: { OR: [{ costStatus: 'missing' }, { unitCost: { lte: 0 } }, { netUnitCost: { lte: 0 } }] } },
    };
    if (search) where.AND = [{ OR: [
      { poNumber: { contains: search, mode: 'insensitive' } },
      { vendorName: { contains: search, mode: 'insensitive' } },
      { lines: { some: { OR: [
        { sku: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ] } } },
    ] }];
    const take = this.limit(args?.take, 20);
    const skip = Math.max(0, Number(args?.skip || 0));
    const [orders, total] = await Promise.all([
      (this.prisma as any).purchaseOrder.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take }),
      (this.prisma as any).purchaseOrder.count({ where }),
    ]);
    const items = await this.attachPoLines(orders);
    const decorated = items.map((order: any) => {
      const missingLines = (order.lines || []).filter((line: any) => Number(line.unitCost || 0) <= 0 || Number(line.netUnitCost || 0) <= 0 || line.costStatus === 'missing');
      return {
        ...order,
        missingLineCount: missingLines.length,
        blockedReceivedLineCount: missingLines.filter((line: any) => Number(line.receivedQuantity || 0) > 0).length,
        missingLines,
      };
    });
    return { items: decorated, total, skip, take, hasNext: skip + decorated.length < total };
  }

  async completePurchaseOrderCosts(input: { purchaseOrderId: string; lines?: any; reason?: string }, actorUserId: string) {
    const purchaseOrderId = String(input.purchaseOrderId || '').trim();
    const reason = String(input.reason || '').trim();
    if (!purchaseOrderId) throw new BadRequestException('Purchase order is required');
    if (reason.length < 3) throw new BadRequestException('Enter a clear reason for completing legacy PO rates');
    const order = await (this.prisma as any).purchaseOrder.findUnique({ where: { id: purchaseOrderId } });
    if (!order) throw new NotFoundException('Purchase order not found');
    if (!['draft', 'ordered', 'partial_received'].includes(String(order.status || ''))) {
      throw new BadRequestException(`${order.poNumber} is ${order.status} and cannot be repriced`);
    }
    const rows = await (this.prisma as any).purchaseOrderLine.findMany({ where: { purchaseOrderId }, orderBy: { createdAt: 'asc' } });
    const missing = rows.filter((row: any) => Number(row.unitCost || 0) <= 0 || Number(row.netUnitCost || 0) <= 0 || row.costStatus === 'missing');
    if (!missing.length) return this.purchaseOrder(purchaseOrderId);
    if (missing.some((row: any) => Number(row.receivedQuantity || 0) > 0)) {
      throw new BadRequestException('A zero-cost line was already received. Use the audited inventory cost-correction workflow; historical lots are never silently repriced.');
    }
    const enteredRows = this.normalizeLines(input.lines);
    const enteredById = new Map(enteredRows.map((row: any) => [String(row.purchaseOrderLineId || row.id || ''), row]));
    const missingInput = missing.find((row: any) => !enteredById.has(row.id));
    if (missingInput) throw new BadRequestException(`Enter the supplier rate for ${missingInput.sku}`);
    const productIds = Array.from(new Set(rows.map((row: any) => row.productId).filter(Boolean))) as string[];
    const products = productIds.length ? await this.prisma.product.findMany({ where: { id: { in: productIds } } }) : [];
    const productMap = new Map(products.map((product: any) => [product.id, product] as const));
    const normalized = rows.map((row: any) => {
      if (!missing.includes(row)) {
        const unitCost = Number(row.unitCost || 0);
        if (!Number.isFinite(unitCost) || unitCost <= 0) throw new BadRequestException(`${row.sku} has an invalid saved PO rate`);
        return {
          row,
          enteredUnitCost: Number(row.enteredUnitCost || unitCost),
          rateUom: String(row.rateUom || row.unit || 'PC'),
          rateUomFactor: Number(row.rateUomFactor || 1),
          unitCost,
        };
      }
      const product: any = productMap.get(row.productId);
      if (!product) throw new BadRequestException(`${row.sku} must be linked to Product Master before its PO rate can be completed`);
      return { row, ...this.normalizePurchaseRate(enteredById.get(row.id), product, `${row.sku} purchase rate`) };
    });
    const priced = pricePoLines(
      normalized.map((item: any) => ({ orderedQuantity: Number(item.row.orderedQuantity || 0), unitCost: item.unitCost })),
      { discountPercent: order.discountPercent, taxRate: order.taxRate },
    );

    await this.prisma.$transaction(async (tx: any) => {
      for (let index = 0; index < normalized.length; index += 1) {
        const item: any = normalized[index];
        const commercial = priced.lines[index];
        const netUnitCost = this.money4(commercial.taxableValue / Math.max(1, commercial.orderedQuantity));
        await tx.purchaseOrderLine.update({
          where: { id: item.row.id },
          data: {
            enteredUnitCost: item.enteredUnitCost,
            rateUom: item.rateUom,
            rateUomFactor: item.rateUomFactor,
            unitCost: commercial.unitCost,
            netUnitCost,
            costStatus: 'complete',
            discountPercent: commercial.discountPercent,
            taxRate: commercial.taxRate,
            taxableValue: commercial.taxableValue,
            taxAmount: commercial.taxAmount,
            lineTotal: commercial.lineTotal,
            metadata: {
              ...(item.row.metadata || {}),
              costStatus: 'confirmed_on_legacy_po',
              enteredRate: item.enteredUnitCost,
              rateUom: item.rateUom,
              rateUomFactor: item.rateUomFactor,
              normalizedBaseUnitCost: commercial.unitCost,
              netBaseUnitCost: netUnitCost,
              lineGross: commercial.lineGross,
              lineDiscount: commercial.lineDiscount,
              legacyCostCompletedAt: new Date().toISOString(),
              legacyCostCompletionReason: reason,
            },
            updatedAt: new Date(),
          },
        });
      }
      await tx.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: {
          subtotal: priced.totals.subtotal,
          discountAmount: priced.totals.discountAmount,
          taxableValue: priced.totals.taxableValue,
          taxAmount: priced.totals.taxAmount,
          grandTotal: priced.totals.grandTotal,
          metadata: {
            ...(order.metadata || {}),
            legacyCostCompletedAt: new Date().toISOString(),
            legacyCostCompletedBy: actorUserId,
            legacyCostCompletionReason: reason,
          },
          updatedAt: new Date(),
        },
      });
      await tx.auditEvent.create({
        data: {
          id: ulid(),
          actorUserId,
          action: 'purchase_order.cost_complete',
          entityType: 'PurchaseOrder',
          entityId: purchaseOrderId,
          summary: `Completed missing supplier rates for ${order.poNumber}`,
          metadata: { reason, lineIds: missing.map((row: any) => row.id), totals: priced.totals },
        },
      });
    }, { timeout: 15000 });
    return this.purchaseOrder(purchaseOrderId);
  }

  async createPurchaseOrder(input: CreatePurchaseOrderInput, actorUserId: string) {
    const demandIds = Array.from(new Set((input.demandIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
    const lineInputs = this.normalizeLines(input.lines);
    const demandCostInputs = lineInputs.filter((line: any) => String(line.purchaseDemandId || '').trim());
    const directInputs = lineInputs.filter((line: any) => !String(line.purchaseDemandId || '').trim());
    if (!demandIds.length && !directInputs.length) throw new BadRequestException('Select purchase demand or add at least one Product Master line');

    const demands = demandIds.length ? await (this.prisma as any).purchaseDemand.findMany({
      where: { id: { in: demandIds }, status: { in: ['open', 'ordered', 'partial_received'] } },
      orderBy: { createdAt: 'asc' },
    }) : [];
    if (demandIds.length && demands.length !== demandIds.length) {
      throw new BadRequestException('One or more selected demand rows changed or are no longer available. Refresh the queue and select again.');
    }
    const selectedDemandIds = new Set(demands.map((demand: any) => demand.id));
    const unknownDemandCost = demandCostInputs.find((line: any) => !selectedDemandIds.has(String(line.purchaseDemandId)));
    if (unknownDemandCost) throw new BadRequestException('A demand cost override does not belong to the selected purchase demand');
    const invalidDemand = demands.find((demand: any) => !demand.productId);
    if (invalidDemand) throw new BadRequestException(`${invalidDemand.sku} must be linked to a Product Master SKU before purchase ordering`);
    if (directInputs.some((line: any) => !String(line.productId || '').trim())) throw new BadRequestException('Every direct PO line must select a Product Master SKU');
    const directProductIds = directInputs.map((line: any) => String(line.productId).trim());
    const demandProductIds = demands.map((demand: any) => String(demand.productId || '').trim()).filter(Boolean);
    const productIds = Array.from(new Set([...directProductIds, ...demandProductIds]));
    const products = productIds.length ? await this.prisma.product.findMany({ where: { id: { in: productIds }, status: 'active' } }) : [];
    const productById = new Map(products.map((product: any) => [product.id, product]));
    const demandCostById = new Map(demandCostInputs.map((line: any) => [String(line.purchaseDemandId), line]));
    const demandLines = demands.map((demand: any) => {
      const product: any = productById.get(String(demand.productId || ''));
      if (!product) throw new BadRequestException(`${demand.sku} is not an active Product Master SKU`);
      const captured: any = demandCostById.get(demand.id) || {};
      const legacyCost = Number((demand.metadata || {})?.unitCost || 0);
      const rate = this.normalizePurchaseRate({
        ...captured,
        enteredUnitCost: captured.enteredUnitCost ?? captured.unitCost ?? legacyCost,
      }, product, `${demand.sku} purchase rate`);
      return { demand, product, ...rate };
    });
    const directLines = directInputs.map((line: any, index: number) => {
      const product: any = productById.get(String(line.productId || ''));
      if (!product) throw new BadRequestException(`Direct PO line ${index + 1} is not an active Product Master SKU`);
      const orderedQuantity = this.baseQuantity(line, product, `${product.sku} quantity`);
      const rate = this.normalizePurchaseRate(line, product, `${product.sku} purchase rate`);
      return { product, orderedQuantity, ...rate, unit: String(product.baseUom || 'PC'), note: String(line.note || '').trim(), orderedInput: this.uomSnapshot(line, product) };
    });

    const selectedPreferredVendors = new Set(
      demands.map((demand: any) => String(demand.preferredVendorId || '').trim()).filter(Boolean),
    );
    const selectedVendorNames = new Set(
      demands.map((demand: any) => String(demand.vendorName || '').trim().toLowerCase()).filter(Boolean),
    );
    if (!input.vendorId && (selectedPreferredVendors.size > 1 || selectedVendorNames.size > 1)) {
      throw new BadRequestException('Selected demand lines belong to different suppliers. Choose one supplier explicitly or create separate purchase orders.');
    }

    const vendor = input.vendorId
      ? await (this.prisma as any).vendor.findUnique({ where: { id: input.vendorId } }).catch(() => null)
      : null;
    const vendorName = String(input.vendorName || vendor?.name || demands[0]?.vendorName || '').trim();
    if (!vendorName) throw new BadRequestException('Vendor name is required to create a purchase order');

    const poNumber = await this.generatePoNumber();
    const expectedDate = input.expectedDate ? new Date(input.expectedDate) : null;

    // Build commercial line drafts, then price once (header discount + GST).
    const commercialDrafts: Array<{
      kind: 'demand' | 'direct';
      demand?: any;
      product?: any;
      orderedQuantity: number;
      unitCost: number;
      enteredUnitCost: number;
      rateUom: string;
      rateUomFactor: number;
      unit: string;
      note?: string;
      sku: string;
      name: string;
      category: string;
      brand: string;
      finish: string | null;
      productId: string | null;
      purchaseDemandId?: string;
      orderedInput?: any;
    }> = [
      ...demandLines.map(({ demand, product, unitCost, enteredUnitCost, rateUom, rateUomFactor }) => ({
        kind: 'demand' as const,
        demand,
        product,
        orderedQuantity: Math.max(0, Number(demand.quantity || 0) - Number(demand.receivedQuantity || 0)),
        unitCost,
        enteredUnitCost,
        rateUom,
        rateUomFactor,
        unit: String(product.baseUom || 'PC'),
        sku: demand.sku,
        name: demand.name,
        category: demand.category,
        brand: demand.brand,
        finish: demand.finish || null,
        productId: demand.productId || null,
        purchaseDemandId: demand.id,
      })),
      ...directLines.map((row) => ({
        kind: 'direct' as const,
        product: row.product,
        orderedQuantity: row.orderedQuantity,
        unitCost: row.unitCost,
        enteredUnitCost: row.enteredUnitCost,
        rateUom: row.rateUom,
        rateUomFactor: row.rateUomFactor,
        unit: row.unit,
        note: row.note,
        orderedInput: row.orderedInput,
        sku: row.product.sku,
        name: row.product.name,
        category: row.product.category,
        brand: row.product.brand,
        finish: row.product.finish || null,
        productId: row.product.id,
      })),
    ];
    if (!commercialDrafts.length) throw new BadRequestException('No purchase order lines to create');

    const priced = pricePoLines(
      commercialDrafts.map((row) => ({ orderedQuantity: row.orderedQuantity, unitCost: row.unitCost })),
      { discountPercent: input.discountPercent, taxRate: input.taxRate },
    );

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
          discountPercent: priced.totals.discountPercent,
          taxRate: priced.totals.taxRate > 0 ? priced.totals.taxRate : null,
          subtotal: priced.totals.subtotal,
          discountAmount: priced.totals.discountAmount,
          taxableValue: priced.totals.taxableValue,
          taxAmount: priced.totals.taxAmount,
          grandTotal: priced.totals.grandTotal,
          metadata: {
            source: demandIds.length && directLines.length ? 'mixed_purchase_order' : demandIds.length ? 'purchase_demand_queue' : 'direct_product_master',
            demandIds,
            directLineCount: directLines.length,
            commercial: {
              discountPercent: priced.totals.discountPercent,
              taxRate: priced.totals.taxRate,
              grandTotal: priced.totals.grandTotal,
            },
          },
          updatedAt: new Date(),
        },
      });

      for (let index = 0; index < commercialDrafts.length; index += 1) {
        const draft = commercialDrafts[index];
        const commercial = priced.lines[index];
        const netUnitCost = this.money4(commercial.taxableValue / Math.max(1, commercial.orderedQuantity));
        if (draft.kind === 'demand') {
          const demand = draft.demand;
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
              orderedQuantity: commercial.orderedQuantity,
              enteredUnitCost: draft.enteredUnitCost,
              rateUom: draft.rateUom,
              rateUomFactor: draft.rateUomFactor,
              unitCost: commercial.unitCost,
              netUnitCost,
              costStatus: 'complete',
              discountPercent: commercial.discountPercent,
              taxRate: commercial.taxRate,
              taxableValue: commercial.taxableValue,
              taxAmount: commercial.taxAmount,
              lineTotal: commercial.lineTotal,
              status: 'ordered',
              metadata: {
                sourceLineKey: demand.sourceLineKey,
                sourceOrderId: demand.sourceOrderId,
                sourceQuoteId: demand.sourceQuoteId,
                customerId: demand.customerId,
                ownerId: demand.ownerId,
                costStatus: 'confirmed_on_po',
                enteredRate: draft.enteredUnitCost,
                rateUom: draft.rateUom,
                rateUomFactor: draft.rateUomFactor,
                normalizedBaseUnitCost: commercial.unitCost,
                netBaseUnitCost: netUnitCost,
                lineGross: commercial.lineGross,
                lineDiscount: commercial.lineDiscount,
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
            });
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
            });
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
          continue;
        }

        const product: any = draft.product;
        await tx.purchaseOrderLine.create({
          data: {
            id: ulid(),
            purchaseOrderId: order.id,
            productId: product.id,
            sku: product.sku,
            name: product.name,
            category: product.category,
            brand: product.brand,
            finish: product.finish || null,
            unit: draft.unit,
            orderedQuantity: commercial.orderedQuantity,
            enteredUnitCost: draft.enteredUnitCost,
            rateUom: draft.rateUom,
            rateUomFactor: draft.rateUomFactor,
            unitCost: commercial.unitCost,
            netUnitCost,
            costStatus: 'complete',
            discountPercent: commercial.discountPercent,
            taxRate: commercial.taxRate,
            taxableValue: commercial.taxableValue,
            taxAmount: commercial.taxAmount,
            lineTotal: commercial.lineTotal,
            status: 'ordered',
            metadata: {
              source: 'direct_product_master',
              internalCode: product.internalCode || null,
              note: draft.note || null,
              orderedInput: (draft as any).orderedInput || null,
              costStatus: 'confirmed_on_po',
              enteredRate: draft.enteredUnitCost,
              rateUom: draft.rateUom,
              rateUomFactor: draft.rateUomFactor,
              normalizedBaseUnitCost: commercial.unitCost,
              netBaseUnitCost: netUnitCost,
              lineGross: commercial.lineGross,
              lineDiscount: commercial.lineDiscount,
            },
            updatedAt: new Date(),
          },
        });
        if (input.vendorId) {
          await tx.productVendor.upsert({
            where: { productId_vendorId: { productId: product.id, vendorId: input.vendorId } },
            update: { vendorName, preferred: true, status: 'active', updatedAt: new Date(), metadata: { source: 'direct_purchase_order', poNumber } },
            create: { id: ulid(), productId: product.id, vendorId: input.vendorId, vendorName, preferred: true, status: 'active', updatedAt: new Date(), metadata: { source: 'direct_purchase_order', poNumber } },
          });
          await tx.reorderPolicy.upsert({
            where: { productId: product.id },
            update: { preferredVendorId: input.vendorId, reorderQuantity: commercial.orderedQuantity, reorderPoint: 0, updatedAt: new Date() },
            create: { id: ulid(), productId: product.id, preferredVendorId: input.vendorId, reorderQuantity: commercial.orderedQuantity, reorderPoint: 0, updatedAt: new Date() },
          });
        }
      }

      await tx.auditEvent.create({
        data: {
          id: ulid(),
          actorUserId,
          action: 'purchase_order.create',
          entityType: 'PurchaseOrder',
          entityId: order.id,
          summary: `Created ${order.poNumber} for ${vendorName}`,
          metadata: {
            demandIds,
            directLineCount: directLines.length,
            discountPercent: priced.totals.discountPercent,
            taxRate: priced.totals.taxRate,
            grandTotal: priced.totals.grandTotal,
          },
        },
      });
      return order;
    }, { timeout: 15000 });

    return this.purchaseOrder(po.id);
  }

  async updatePurchaseOrderStatus(id: string, status: string, actorUserId: string) {
    const allowed = ['draft', 'ordered', 'partial_received', 'received', 'closed'];
    if (status === 'cancelled') {
      throw new BadRequestException('Use cancelPurchaseOrder with a cancellation reason. Purchase orders are never deleted or silently cancelled.');
    }
    if (!allowed.includes(status)) throw new BadRequestException(`Invalid purchase order status: ${status}`);
    const order = await (this.prisma as any).purchaseOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Purchase order not found');
    if (['cancelled', 'closed'].includes(String(order.status || '')) && order.status !== status) {
      throw new BadRequestException(`${order.poNumber} is ${order.status} and cannot be reopened through a status update.`);
    }
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

  async cancelPurchaseOrder(id: string, reason: string, actorUserId: string) {
    const order = await (this.prisma as any).purchaseOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Purchase order not found');
    if (order.status === 'cancelled') return this.purchaseOrder(id);
    if (order.status === 'received' || order.status === 'closed') {
      throw new BadRequestException('A received or closed purchase order cannot be cancelled. Use a supplier return or stock correction workflow.');
    }
    const cancellationReason = String(reason || '').trim();
    if (!cancellationReason) throw new BadRequestException('Enter a cancellation reason.');
    const lines = await (this.prisma as any).purchaseOrderLine.findMany({ where: { purchaseOrderId: id } });
    const demandIds = Array.from(new Set(lines.map((line: any) => line.purchaseDemandId).filter(Boolean))) as string[];

    await this.prisma.$transaction(async (tx: any) => {
      if (demandIds.length) {
        const demands = await tx.purchaseDemand.findMany({ where: { id: { in: demandIds } } });
        for (const demand of demands) {
          if (!['ordered', 'partial_received'].includes(String(demand.status || ''))) continue;
          const remaining = Math.max(0, Number(demand.quantity || 0) - Number(demand.receivedQuantity || 0));
          if (remaining <= 0) continue;
          await tx.purchaseDemand.update({
            where: { id: demand.id },
            data: {
              status: Number(demand.receivedQuantity || 0) > 0 ? 'partial_received' : 'open',
              orderedQuantity: Math.max(0, Number(demand.receivedQuantity || 0)),
              updatedAt: new Date(),
            },
          });
        }
      }
      for (const line of lines) {
        const remaining = Math.max(0, Number(line.orderedQuantity || 0) - Number(line.receivedQuantity || 0));
        await tx.purchaseOrderLine.update({
          where: { id: line.id },
          data: {
            cancelledQuantity: Number(line.cancelledQuantity || 0) + remaining,
            status: Number(line.receivedQuantity || 0) > 0 ? 'partial_received_cancelled' : 'cancelled',
            updatedAt: new Date(),
          },
        });
      }
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: 'cancelled',
          closedAt: new Date(),
          notes: [String(order.notes || '').trim(), `Cancelled: ${cancellationReason}`].filter(Boolean).join('\n'),
          metadata: { ...(order.metadata || {}), cancellation: { reason: cancellationReason, cancelledAt: new Date().toISOString(), cancelledBy: actorUserId } },
          updatedAt: new Date(),
        },
      });
      await tx.auditEvent.create({
        data: {
          id: ulid(),
          actorUserId,
          action: 'purchase_order.cancel',
          entityType: 'PurchaseOrder',
          entityId: id,
          summary: `Cancelled ${order.poNumber}`,
          metadata: {
            poNumber: order.poNumber,
            vendorName: order.vendorName,
            lineCount: lines.length,
            demandIds,
            statusWas: order.status,
            reason: cancellationReason,
          },
        },
      });
    });

    return this.purchaseOrder(id);
  }

  async receivePurchaseOrder(input: ReceivePurchaseOrderInput, actorUserId: string) {
    const idempotencyKey = String((input as any).idempotencyKey || '').trim() || null;
    if (idempotencyKey) {
      const existing = await (this.prisma as any).goodsReceiptNote.findUnique({ where: { idempotencyKey } });
      if (existing) return (await this.decorateGrns([existing]))[0];
    }
    if (!input.purchaseOrderId) throw new BadRequestException('Purchase order is required for GRN receiving');
    const po = await (this.prisma as any).purchaseOrder.findUnique({ where: { id: input.purchaseOrderId } });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status === 'cancelled' || po.status === 'closed') throw new BadRequestException('This purchase order is closed or cancelled');
    const poLines = await (this.prisma as any).purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
    const productIds = Array.from(new Set(poLines.map((line: any) => line.productId).filter(Boolean))) as string[];
    const products = productIds.length ? await this.prisma.product.findMany({ where: { id: { in: productIds } } }) : [];
    const productMap = new Map(products.map((product: any) => [product.id, product]));
    const lineInputs = this.normalizeLines(input.lines);
    // Never infer a full receipt. A browser refresh or an empty form must not
    // silently inward every outstanding line on the purchase order.
    const selected = lineInputs;
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
          idempotencyKey,
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

      for (const [lineIndex, row] of selected.entries()) {
        const line = lineMap.get(String(row.purchaseOrderLineId || '')) as any;
        if (!line) throw new BadRequestException('One GRN line does not belong to this purchase order');
        if (row.unitCost !== undefined || row.enteredUnitCost !== undefined || row.rateUom !== undefined) {
          throw new BadRequestException('PO-linked GRN cost is locked to the approved purchase order. Remove receipt-level rate fields.');
        }
        const product = line.productId ? productMap.get(line.productId) as any : null;
        const received = this.baseQuantity(row, product, `${line.sku} received quantity`);
        const damaged = Math.max(0, Math.trunc(Number(row.damagedQuantity || 0)));
        if (damaged > received) throw new BadRequestException(`${line.sku} damaged quantity cannot exceed received quantity`);
        const accepted = received - damaged;
        if (received <= 0) continue;

        const remaining = Math.max(0, Number(line.orderedQuantity || 0) - Number(line.receivedQuantity || 0));
        if (received > remaining) {
          throw new BadRequestException(`${line.sku} receipt ${received} exceeds remaining PO quantity ${remaining}`);
        }
        const receiptCost = this.resolvePoReceiptCost(line);

        const receiptLine = await tx.goodsReceiptLine.create({
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
            unitCost: receiptCost.unitCost,
            metadata: {
              purchaseDemandId: line.purchaseDemandId,
              note: row.note || '',
              locationId: receiptLocation.id,
              costSource: receiptCost.source,
              poUnitCost: Number(line.unitCost || 0),
              poNetUnitCost: Number(line.netUnitCost || 0),
              poEnteredRate: Number(line.enteredUnitCost || 0),
              poRateUom: line.rateUom,
              poRateUomFactor: Number(line.rateUomFactor || 1),
              uomConversion: this.uomSnapshot(row, product),
            },
          },
        });

        let lot: any = null;
        if (line.productId) {
          lot = await tx.inventoryLot.create({
            data: {
              id: ulid(), lotNumber: `${grnNumber}-${String(lineIndex + 1).padStart(3, '0')}`,
              productId: line.productId, sourceType: 'grn', sourceId: note.id, sourceLineId: receiptLine.id,
              supplierBatch: row.supplierBatch || null, qualityStatus: damaged === received ? 'damaged' : 'available',
              receivedAt: note.receivedDate, unitCost: receiptCost.unitCost, status: 'active',
              attributes: { ...(row.attributes || {}), shade: row.shade || null, caliber: row.caliber || null, grade: row.grade || null },
              metadata: {
                purchaseOrderId: po.id,
                purchaseOrderLineId: line.id,
                costSource: receiptCost.source,
                poCostSnapshot: {
                  enteredRate: Number(line.enteredUnitCost || 0),
                  rateUom: line.rateUom,
                  rateUomFactor: Number(line.rateUomFactor || 1),
                  preDiscountBaseUnitCost: Number(line.unitCost || 0),
                  netBaseUnitCost: Number(line.netUnitCost || 0),
                  discountPercent: Number(line.discountPercent || 0),
                  taxRate: Number(line.taxRate || 0),
                },
                uomConversion: this.uomSnapshot(row, product),
              },
              createdBy: actorUserId, updatedAt: new Date(),
            },
          });
          await tx.goodsReceiptLine.update({ where: { id: receiptLine.id }, data: { lotId: lot.id } });
        }

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

        if (line.productId && lot) {
          await this.addReceivedStockTx(tx, {
            productId: line.productId,
            lotId: lot.id,
            receivedQuantity: received,
            damagedQuantity: damaged,
            unitCost: receiptCost.unitCost,
            costSource: receiptCost.source,
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
    }, { isolationLevel: 'Serializable', timeout: 30000 });

    const [decorated] = await this.decorateGrns([grn]);
    return decorated;
  }

  async createManualGoodsReceipt(input: ManualGoodsReceiptInput, actorUserId: string) {
    const idempotencyKey = String(input.idempotencyKey || '').trim() || null;
    if (idempotencyKey) {
      const existing = await (this.prisma as any).goodsReceiptNote.findUnique({ where: { idempotencyKey } });
      if (existing) return (await this.decorateGrns([existing]))[0];
    }
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
          idempotencyKey,
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

      for (const [lineIndex, row] of lines.entries()) {
        const product = productMap.get(String(row.productId || '')) as any;
        if (!product) throw new BadRequestException('Manual GRN rows must use an existing Product Master SKU');
        const received = this.baseQuantity(row, product, `${product.sku} received quantity`);
        const damaged = Math.max(0, Math.trunc(Number(row.damagedQuantity || 0)));
        if (damaged > received) throw new BadRequestException(`${product.sku} damaged quantity cannot exceed received quantity`);
        const accepted = received - damaged;
        const manualRate = this.normalizePurchaseRate(row, product, `${product.sku} manual GRN rate`);
        const receiptCost = { unitCost: manualRate.unitCost, source: 'manual_grn_entered_rate' };

        const receiptLine = await tx.goodsReceiptLine.create({
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
            unitCost: receiptCost.unitCost,
            metadata: {
              manualReason: input.reason || '',
              locationId: receiptLocation.id,
              costSource: receiptCost.source,
              enteredRate: manualRate.enteredUnitCost,
              rateUom: manualRate.rateUom,
              rateUomFactor: manualRate.rateUomFactor,
              uomConversion: this.uomSnapshot(row, product),
            },
          },
        });

        const lot = await tx.inventoryLot.create({
          data: {
            id: ulid(), lotNumber: `${grnNumber}-${String(lineIndex + 1).padStart(3, '0')}`,
            productId: product.id, sourceType: 'manual_grn', sourceId: note.id, sourceLineId: receiptLine.id,
            supplierBatch: row.supplierBatch || null, qualityStatus: damaged === received ? 'damaged' : 'available',
            receivedAt: note.receivedDate, unitCost: receiptCost.unitCost, status: 'active',
            attributes: { ...(row.attributes || {}), shade: row.shade || null, caliber: row.caliber || null, grade: row.grade || null },
            metadata: {
              manualReason: input.reason || '',
              costSource: receiptCost.source,
              enteredRate: manualRate.enteredUnitCost,
              rateUom: manualRate.rateUom,
              rateUomFactor: manualRate.rateUomFactor,
              uomConversion: this.uomSnapshot(row, product),
            },
            createdBy: actorUserId, updatedAt: new Date(),
          },
        });
        await tx.goodsReceiptLine.update({ where: { id: receiptLine.id }, data: { lotId: lot.id } });

        if (received > 0) {
          await this.addReceivedStockTx(tx, {
            productId: product.id,
            lotId: lot.id,
            receivedQuantity: received,
            damagedQuantity: damaged,
            unitCost: receiptCost.unitCost,
            costSource: receiptCost.source,
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
    const today = indiaDay(new Date());
    const { from: todayFrom, to: todayTo } = reportRange(today, today);
    const activePoStatus = ['draft', 'ordered', 'partial_received'];
    const receivingPoStatus = ['ordered', 'partial_received'];
    const [
      openDemand,
      orderedDemand,
      partialDemand,
      draftPo,
      orderedPo,
      partialPo,
      overduePurchaseOrders,
      dueTodayPurchaseOrders,
      purchaseOrdersWithoutEta,
      activePoValue,
      valuedPurchaseOrders,
      recentGrn,
      todayReceipts,
      expectedOrders,
    ] = await Promise.all([
      (this.prisma as any).purchaseDemand.count({ where: { status: 'open' } }),
      (this.prisma as any).purchaseDemand.count({ where: { status: 'ordered' } }),
      (this.prisma as any).purchaseDemand.count({ where: { status: 'partial_received' } }),
      (this.prisma as any).purchaseOrder.count({ where: { status: 'draft' } }),
      (this.prisma as any).purchaseOrder.count({ where: { status: 'ordered' } }),
      (this.prisma as any).purchaseOrder.count({ where: { status: 'partial_received' } }),
      (this.prisma as any).purchaseOrder.count({ where: { status: { in: receivingPoStatus }, expectedDate: { lt: todayFrom } } }),
      (this.prisma as any).purchaseOrder.count({ where: { status: { in: receivingPoStatus }, expectedDate: { gte: todayFrom, lte: todayTo } } }),
      (this.prisma as any).purchaseOrder.count({ where: { status: { in: receivingPoStatus }, expectedDate: null } }),
      (this.prisma as any).purchaseOrder.aggregate({ where: { status: { in: activePoStatus } }, _sum: { grandTotal: true } }),
      (this.prisma as any).purchaseOrder.count({ where: { status: { in: activePoStatus }, grandTotal: { gt: 0 } } }),
      (this.prisma as any).goodsReceiptNote.count({ where: { createdAt: { gte: new Date(Date.now() - 86400000 * 7) } } }),
      (this.prisma as any).goodsReceiptNote.findMany({
        where: { receivedDate: { gte: todayFrom, lte: todayTo } },
        select: { id: true, purchaseOrderId: true, supplierChallan: true, supplierBill: true },
      }),
      (this.prisma as any).purchaseOrder.findMany({
        where: { status: { in: receivingPoStatus } },
        orderBy: [{ expectedDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
        take: 6,
      }),
    ]);

    const todayReceiptIds = todayReceipts.map((receipt: any) => receipt.id);
    const expectedOrderIds = expectedOrders.map((order: any) => order.id);
    const [todayQuantity, expectedLines] = await Promise.all([
      todayReceiptIds.length
        ? (this.prisma as any).goodsReceiptLine.aggregate({
            where: { goodsReceiptNoteId: { in: todayReceiptIds } },
            _sum: { receivedQuantity: true, acceptedQuantity: true, damagedQuantity: true },
          })
        : Promise.resolve({ _sum: {} }),
      expectedOrderIds.length
        ? (this.prisma as any).purchaseOrderLine.findMany({ where: { purchaseOrderId: { in: expectedOrderIds } } })
        : Promise.resolve([]),
    ]);

    const linesByPo = this.groupBy(expectedLines, 'purchaseOrderId');
    const expectedReceipts = expectedOrders.map((order: any) => {
      const lines = linesByPo.get(order.id) || [];
      return {
        id: order.id,
        poNumber: order.poNumber,
        vendorName: order.vendorName,
        status: order.status,
        expectedDate: order.expectedDate,
        grandTotal: order.grandTotal,
        lineCount: lines.length,
        demandLineCount: lines.filter((line: any) => Boolean(line.purchaseDemandId)).length,
        orderedQuantity: lines.reduce((sum: number, line: any) => sum + Number(line.orderedQuantity || 0), 0),
        remainingQuantity: lines.reduce(
          (sum: number, line: any) => sum + Math.max(0, Number(line.orderedQuantity || 0) - Number(line.receivedQuantity || 0) - Number(line.cancelledQuantity || 0)),
          0,
        ),
      };
    });

    const manualReceiptsToday = todayReceipts.filter((receipt: any) => !receipt.purchaseOrderId).length;
    const documentExceptionsToday = todayReceipts.filter(
      (receipt: any) => !String(receipt.supplierChallan || '').trim() || !String(receipt.supplierBill || '').trim(),
    ).length;

    return {
      asOf: new Date().toISOString(),
      businessDate: today,
      openDemand,
      orderedDemand,
      partialDemand,
      demandInFlow: openDemand + orderedDemand + partialDemand,
      draftPurchaseOrders: draftPo,
      orderedPurchaseOrders: orderedPo,
      partialPurchaseOrders: partialPo,
      activePurchaseOrders: draftPo + orderedPo + partialPo,
      overduePurchaseOrders,
      dueTodayPurchaseOrders,
      purchaseOrdersWithoutEta,
      activePurchaseOrderValue: Number(activePoValue?._sum?.grandTotal || 0),
      valuedPurchaseOrders,
      receiptsToday: todayReceipts.length,
      manualReceiptsToday,
      receivedUnitsToday: Number(todayQuantity?._sum?.receivedQuantity || 0),
      acceptedUnitsToday: Number(todayQuantity?._sum?.acceptedQuantity || 0),
      damagedUnitsToday: Number(todayQuantity?._sum?.damagedQuantity || 0),
      documentExceptionsToday,
      recentGrn,
      expectedReceipts,
    };
  }

  async ensureDemandsForOpenOrders() {
    const orders = await (this.prisma as any).salesOrder.findMany({
      where: { status: { in: ['open', 'confirmed', 'partial', 'pending'] } },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    if (!orders.length) return;

    const orderIds = orders.map((order: any) => order.id);
    const quoteIds = Array.from(new Set(orders.map((order: any) => order.quoteId).filter(Boolean))) as string[];
    const orderById = new Map(orders.map((order: any) => [order.id, order] as const));
    const ordersByQuote = new Map<string, any[]>();
    for (const order of orders as any[]) {
      const matching = ordersByQuote.get(order.quoteId) || [];
      matching.push(order);
      ordersByQuote.set(order.quoteId, matching);
    }
    const reservations = await this.prisma.reservation.findMany({
      where: {
        status: 'backordered',
        OR: [
          { salesOrderId: { in: orderIds } },
          { salesOrderId: null, quoteId: { in: quoteIds } },
        ],
      } as any,
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
      const legacyOrders = ordersByQuote.get(reservation.quoteId) || [];
      const order = (reservation.salesOrderId
        ? orderById.get(reservation.salesOrderId)
        : legacyOrders.length === 1 ? legacyOrders[0] : null) as any;
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

    if (!rows.length) return;
    await (this.prisma as any).purchaseDemand.createMany({ data: rows, skipDuplicates: true });
  }

  private async decorateDemands(rows: any[]) {
    if (!rows.length) return [];
    const customerIds = Array.from(new Set(rows.map((row) => row.customerId).filter(Boolean))) as string[];
    const ownerIds = Array.from(new Set(rows.map((row) => row.ownerId).filter(Boolean))) as string[];
    const orderIds = Array.from(new Set(rows.map((row) => row.sourceOrderId).filter(Boolean))) as string[];
    const productIds = Array.from(new Set(rows.map((row) => row.productId).filter(Boolean))) as string[];
    const [customers, owners, orders, products] = await Promise.all([
      customerIds.length ? this.prisma.customer.findMany({ where: { id: { in: customerIds } } }) : [],
      ownerIds.length ? this.prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true, email: true, role: true, phone: true } }) : [],
      orderIds.length ? (this.prisma as any).salesOrder.findMany({ where: { id: { in: orderIds } } }) : [],
      productIds.length ? this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, sku: true, internalCode: true, baseUom: true, purchaseUom: true, piecesPerPack: true, allowLoose: true } }) : [],
    ]);
    const customerMap = new Map(customers.map((item: any) => [item.id, item] as const));
    const ownerMap = new Map(owners.map((item: any) => [item.id, item] as const));
    const orderMap = new Map(orders.map((item: any) => [item.id, item] as const));
    const productMap = new Map(products.map((item: any) => [item.id, item] as const));
    return rows.map((row) => ({
      ...row,
      customer: row.customerId ? customerMap.get(row.customerId) || null : null,
      owner: row.ownerId ? ownerMap.get(row.ownerId) || null : null,
      salesOrder: row.sourceOrderId ? orderMap.get(row.sourceOrderId) || null : null,
      product: row.productId ? productMap.get(row.productId) || null : null,
    }));
  }

  private async attachPoLines(orders: any[]) {
    if (!orders.length) return [];
    const orderIds = orders.map((order) => order.id);
    const vendorIds = Array.from(new Set(orders.map((order) => order.vendorId).filter(Boolean))) as string[];
    const lines = await (this.prisma as any).purchaseOrderLine.findMany({ where: { purchaseOrderId: { in: orderIds } }, orderBy: { createdAt: 'asc' } });
    const demandIds = Array.from(new Set(lines.map((line: any) => line.purchaseDemandId).filter(Boolean)));
    const productIds = Array.from(new Set(lines.map((line: any) => line.productId).filter(Boolean))) as string[];
    const [demands, products, vendors] = await Promise.all([
      demandIds.length ? (this.prisma as any).purchaseDemand.findMany({ where: { id: { in: demandIds } } }) : [],
      productIds.length ? this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, category: true, piecesPerPack: true, allowLoose: true, baseUom: true, purchaseUom: true, salesUom: true, dimensions: true, internalCode: true, tileDesignId: true, tileSizeId: true } }) : [],
      vendorIds.length ? (this.prisma as any).vendor.findMany({ where: { id: { in: vendorIds } } }) : [],
    ]);
    const demandMap = new Map(demands.map((demand: any) => [demand.id, demand] as const));
    const productMap = new Map(products.map((product: any) => [product.id, product] as const));
    const vendorMap = new Map(vendors.map((vendor: any) => [vendor.id, vendor] as const));
    const linesByPo = this.groupBy(lines.map((line: any) => {
      const unitCost = Number(line.unitCost || 0);
      const netUnitCost = Number(line.netUnitCost || 0);
      const orderedQuantity = Number(line.orderedQuantity || 0);
      const lineGross = Number(line.metadata?.lineGross ?? (orderedQuantity * unitCost));
      return {
        ...line,
        enteredUnitCost: Number(line.enteredUnitCost || 0),
        rateUomFactor: Number(line.rateUomFactor || 1),
        unitCost,
        netUnitCost,
        effectiveUnitCost: netUnitCost > 0 ? netUnitCost : unitCost,
        costStatus: line.costStatus === 'complete' && unitCost > 0 && netUnitCost > 0 ? 'captured' : 'missing',
        product: line.productId ? productMap.get(line.productId) || null : null,
        lineGross,
        lineDiscount: Number(line.metadata?.lineDiscount ?? 0),
        demand: line.purchaseDemandId ? demandMap.get(line.purchaseDemandId) || null : null,
      };
    }), 'purchaseOrderId');
    return orders.map((order) => {
      const orderLines = linesByPo.get(order.id) || [];
      const fallbackSubtotal = orderLines.reduce((sum: number, line: any) => sum + Number(line.orderedQuantity || 0) * Number(line.unitCost || 0), 0);
      return {
        ...order,
        vendor: order.vendorId ? vendorMap.get(order.vendorId) || null : null,
        discountPercent: Number(order.discountPercent || 0),
        taxRate: order.taxRate == null ? 0 : Number(order.taxRate || 0),
        subtotal: Number(order.subtotal || 0) || fallbackSubtotal,
        discountAmount: Number(order.discountAmount || 0),
        taxableValue: Number(order.taxableValue || 0) || fallbackSubtotal,
        taxAmount: Number(order.taxAmount || 0),
        grandTotal: Number(order.grandTotal || 0) || fallbackSubtotal,
        lines: orderLines,
      };
    });
  }

  private async decorateGrns(notes: any[]) {
    const grnIds = notes.map((note) => note.id);
    const lines = grnIds.length ? await (this.prisma as any).goodsReceiptLine.findMany({ where: { goodsReceiptNoteId: { in: grnIds } } }) : [];
    const productIds = Array.from(new Set(lines.map((line: any) => line.productId).filter(Boolean))) as string[];
    const lotIds = Array.from(new Set(lines.map((line: any) => line.lotId).filter(Boolean))) as string[];
    const [products, lots] = await Promise.all([
      productIds.length ? this.prisma.product.findMany({ where: { id: { in: productIds } } }) : [],
      lotIds.length ? (this.prisma as any).inventoryLot.findMany({
        where: { id: { in: lotIds } },
        include: { balances: { include: { location: true }, orderBy: { updatedAt: 'desc' } } },
      }) : [],
    ]);
    const productMap = new Map(products.map((product: any) => [product.id, product] as const));
    const lotMap = new Map(lots.map((lot: any) => [lot.id, lot] as const));
    const decoratedLines = lines.map((line: any) => ({
      ...line,
      product: line.productId ? productMap.get(line.productId) || null : null,
      lot: line.lotId ? lotMap.get(line.lotId) || null : null,
    }));
    const byGrn = this.groupBy(decoratedLines, 'goodsReceiptNoteId');
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
          title: 'Special-order item arrived',
          message: `${line.sku || demand.sku} has been inwarded for ${order.orderNumber} and is ready for dispatch.`,
          type: 'stock_ready',
          entityType: 'SalesOrder',
          entityId: order.id,
          href: quote?.leadId ? `/dashboard/leads/${quote.leadId}` : '/dashboard/orders',
          targetRole: 'owner',
          metadata: { salesOrderId: order.id, grnId, demandId: demand.id },
        },
        {
          id: ulid(),
          title: 'Special-order item arrived',
          message: `${line.sku || demand.sku} has been inwarded for ${order.orderNumber} and is ready for dispatch.`,
          type: 'stock_ready',
          entityType: 'SalesOrder',
          entityId: order.id,
          href: quote?.leadId ? `/dashboard/leads/${quote.leadId}` : '/dashboard/orders',
          targetRole: 'admin',
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

  private async addReceivedStockTx(
    tx: any,
    args: { productId: string; lotId: string; receivedQuantity: number; damagedQuantity: number; unitCost?: number; costSource?: string; reason: string; actorUserId: string; locationId?: string; referenceId?: string; sourceDocumentNo?: string },
  ) {
    await applyLotStockPostingTx(tx, {
      productId: args.productId,
      lotId: args.lotId,
      idempotencyKey: `grn:${args.referenceId}:${args.lotId}`,
      locationId: String(args.locationId || ''),
      type: 'grn_receipt',
      direction: 'in',
      quantity: args.receivedQuantity,
      onHandDelta: args.receivedQuantity,
      damagedDelta: args.damagedQuantity,
      reason: args.reason,
      referenceType: 'GoodsReceiptNote', referenceId: String(args.referenceId || ''),
      sourceDocumentNo: args.sourceDocumentNo || null,
      createdBy: args.actorUserId,
      unitCost: Number(args.unitCost || 0),
      metadata: { source: 'procurement_service', costSource: args.costSource || 'unspecified', acceptedQuantity: args.receivedQuantity - args.damagedQuantity },
    });
    if (args.receivedQuantity > args.damagedQuantity) await this.autoReserveBackordersTx(tx, args.productId, args.actorUserId);
  }

  private async autoReserveBackordersTx(tx: any, productId: string, actorUserId: string) {
    const reservations = await tx.reservation.findMany({
      where: { productId, status: 'backordered' },
      orderBy: { createdAt: 'asc' },
    });
    for (const reservation of reservations) {
      const balance = await tx.inventoryBalance.findUnique({ where: { productId }, include: { product: true } });
      const lotAvailability = await tx.inventoryLotBalance.aggregate({
        where: { lot: { productId, status: 'active' } }, _sum: { available: true },
      });
      if (!balance || Number(lotAvailability._sum.available || 0) < Number(reservation.quantity || 0)) return;
      const quote = reservation.quoteId
        ? await tx.quote.findUnique({ where: { id: reservation.quoteId } })
        : null;
      const salesOrder = reservation.salesOrderId
        ? await tx.salesOrder.findUnique({ where: { id: reservation.salesOrderId } })
        : null;
      const quantity = Number(reservation.quantity || 0);
      const allocations = await reserveAvailableLotsTx(tx, {
        reservationId: reservation.id, salesOrderLineId: reservation.salesOrderLineId,
        productId, quantity, actorUserId: actorUserId || 'system', quoteId: reservation.quoteId,
        orderNumber: salesOrder?.orderNumber || quote?.quoteNumber || reservation.quoteId,
      });
      await tx.reservation.update({
        where: { id: reservation.id },
        data: {
          status: 'reserved',
          locationId: new Set(allocations.map((row: any) => row.locationId)).size === 1 ? allocations[0].locationId : null,
          updatedAt: new Date(),
        },
      });
      await tx.purchaseDemand.updateMany({
        where: { sourceReservationId: reservation.id },
        data: { status: 'allocated', updatedAt: new Date() },
      }).catch(() => null);
      if (reservation.quoteId) {
        await syncSalesOrderLinesForQuoteTx(tx, reservation.quoteId);
      } else if (reservation.salesOrderLineId) {
        const siblingReservations = await tx.reservation.findMany({
          where: { salesOrderLineId: reservation.salesOrderLineId },
          select: { quantity: true, status: true },
        });
        const reservedQuantity = siblingReservations
          .filter((row: any) => row.status === 'reserved')
          .reduce((sum: number, row: any) => sum + Number(row.quantity || 0), 0);
        const backorderedQuantity = siblingReservations
          .filter((row: any) => row.status === 'backordered')
          .reduce((sum: number, row: any) => sum + Number(row.quantity || 0), 0);
        await tx.salesOrderLine.update({
          where: { id: reservation.salesOrderLineId },
          data: {
            reservedQuantity,
            backorderedQuantity,
            status: backorderedQuantity > 0 ? (reservedQuantity > 0 ? 'partial_ready' : 'backordered') : 'reserved',
            updatedAt: new Date(),
          },
        });
      }
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

  private baseQuantity(row: any, product: any, label: string) {
    const hasPackInput = row?.boxes !== undefined || row?.packs !== undefined || row?.loosePieces !== undefined;
    if (!hasPackInput) return this.whole(row?.receivedQuantity ?? row?.quantity ?? row?.orderedQuantity, label);
    const piecesPerPack = Math.max(1, Math.trunc(Number(product?.piecesPerPack || row?.piecesPerPack || 1)));
    const boxes = Math.max(0, Math.trunc(Number(row?.boxes ?? row?.packs ?? 0)));
    const loosePieces = Math.max(0, Math.trunc(Number(row?.loosePieces || 0)));
    if (loosePieces > 0 && product && product.allowLoose === false) throw new BadRequestException(`${product.sku} does not allow loose-piece inward`);
    const quantity = boxes * piecesPerPack + loosePieces;
    if (quantity <= 0) throw new BadRequestException(`${label} must be greater than zero`);
    return quantity;
  }

  private uomSnapshot(row: any, product: any) {
    const piecesPerPack = Math.max(1, Math.trunc(Number(product?.piecesPerPack || row?.piecesPerPack || 1)));
    const boxes = row?.boxes === undefined && row?.packs === undefined ? null : Math.max(0, Math.trunc(Number(row?.boxes ?? row?.packs ?? 0)));
    const loosePieces = row?.loosePieces === undefined ? null : Math.max(0, Math.trunc(Number(row?.loosePieces || 0)));
    const baseQuantity = boxes === null && loosePieces === null
      ? Math.max(0, Math.trunc(Number(row?.receivedQuantity ?? row?.quantity ?? row?.orderedQuantity ?? 0)))
      : Number(boxes || 0) * piecesPerPack + Number(loosePieces || 0);
    return {
      baseUom: String(product?.baseUom || 'PC'),
      purchaseUom: String(product?.purchaseUom || row?.unit || 'PC'),
      piecesPerPack,
      boxes,
      loosePieces,
      baseQuantity,
      capturedAt: new Date().toISOString(),
    };
  }

  private normalizePurchaseRate(row: any, product: any, label: string) {
    const enteredUnitCost = Number(row?.enteredUnitCost ?? row?.unitCost ?? 0);
    if (!Number.isFinite(enteredUnitCost) || enteredUnitCost <= 0) {
      throw new BadRequestException(`${label} must be greater than zero`);
    }
    const baseUom = String(product?.baseUom || 'PC').trim().toUpperCase();
    const purchaseUom = String(product?.purchaseUom || baseUom).trim().toUpperCase();
    const rateUom = String(row?.rateUom || purchaseUom || baseUom).trim().toUpperCase();
    const piecesPerPack = Math.max(1, Math.trunc(Number(product?.piecesPerPack || 1)));
    let rateUomFactor = 0;
    if (rateUom === baseUom) rateUomFactor = 1;
    else if (rateUom === purchaseUom || rateUom === 'BOX' || rateUom === 'PACK') rateUomFactor = piecesPerPack;
    if (rateUomFactor <= 0) {
      throw new BadRequestException(`${label} UOM ${rateUom} cannot be converted to ${baseUom}. Update the SKU packing master first.`);
    }
    return {
      enteredUnitCost: this.money4(enteredUnitCost),
      rateUom,
      rateUomFactor,
      unitCost: this.money4(enteredUnitCost / rateUomFactor),
    };
  }

  private resolvePoReceiptCost(line: any) {
    if (String(line?.costStatus || '') !== 'complete') {
      throw new BadRequestException(`${line?.sku || 'PO line'} has no approved PO rate. Complete legacy PO cost setup before receiving.`);
    }
    const value = Number(line?.netUnitCost || 0);
    if (!Number.isFinite(value) || value <= 0) {
      throw new BadRequestException(`${line?.sku || 'PO line'} has no valid net PO cost. Complete legacy PO cost setup before receiving.`);
    }
    return { unitCost: this.money4(value), source: 'purchase_order_net_snapshot' };
  }

  private money4(value: any) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new BadRequestException('Purchase amount must be a valid number');
    return Math.round((number + Number.EPSILON) * 10000) / 10000;
  }

  private limit(value: any, fallback: number) {
    return Math.max(1, Math.min(500, Number(value) || fallback));
  }

  private dateWindow(dateFrom?: string, dateTo?: string) {
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00.000Z`) : null;
    const to = dateTo ? new Date(`${dateTo}T23:59:59.999Z`) : null;
    if (from && !Number.isFinite(from.getTime())) throw new BadRequestException('Invalid start date');
    if (to && !Number.isFinite(to.getTime())) throw new BadRequestException('Invalid end date');
    if (from && to && from > to) throw new BadRequestException('Start date cannot be after end date');
    return from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : null;
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
