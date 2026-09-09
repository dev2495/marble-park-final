import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { brandedLabelQrDataUrl } from '../common/branded-label-qr';
import { nextDocumentNumber } from '../common/sequence';
import { applyLotStockPostingTx } from '../common/lot-stock-posting';
import { PrismaService } from '../prisma/prisma.service';
import { ReceivablesService } from '../receivables/receivables.service';

@Injectable()
export class OperationsService {
  constructor(private prisma: PrismaService, private receivables: ReceivablesService) {}

  async documentJobs(args?: { entityType?: string; entityId?: string; status?: string; take?: number; skip?: number }) {
    const where: any = {};
    if (args?.entityType) where.entityType = args.entityType;
    if (args?.entityId) where.entityId = args.entityId;
    if (args?.status && args.status !== 'all') where.status = args.status;
    return (this.prisma as any).documentJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: this.limit(args?.take, 120),
      skip: Math.max(0, Math.floor(Number(args?.skip || 0))),
    });
  }

  async paymentReceipts(args?: { salesOrderId?: string; customerId?: string; status?: string; take?: number }) {
    const where: any = {};
    if (args?.salesOrderId) where.salesOrderId = args.salesOrderId;
    if (args?.customerId) where.customerId = args.customerId;
    if (args?.status && args.status !== 'all') where.status = args.status;
    return (this.prisma as any).paymentReceipt.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      take: this.limit(args?.take, 120),
    });
  }

  async creditNotes(args?: { salesOrderId?: string; customerId?: string; take?: number }) {
    const where: any = {};
    if (args?.salesOrderId) where.salesOrderId = args.salesOrderId;
    if (args?.customerId) where.customerId = args.customerId;
    return (this.prisma as any).creditNote.findMany({
      where,
      orderBy: { issuedAt: 'desc' },
      take: this.limit(args?.take, 120),
    });
  }

  async managementReport(args?: { from?: string; to?: string }) {
    const to = args?.to ? new Date(`${args.to}T23:59:59.999Z`) : new Date();
    const from = args?.from ? new Date(`${args.from}T00:00:00.000Z`) : new Date(to.getTime() - 29 * 86400000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) throw new BadRequestException('Report date range is invalid');
    const dateRange = { gte: from, lte: to };
    const [orders, invoices, payments, creditNotes, ledgerBalances, lotBalances, demands, purchaseOrders, grnLines, challans, returns, closes] = await Promise.all([
      this.prisma.salesOrder.findMany({ where: { createdAt: dateRange }, orderBy: { createdAt: 'asc' } }),
      (this.prisma as any).salesInvoice.findMany({ where: { issueDate: dateRange, status: { not: 'void' } }, orderBy: { issueDate: 'asc' } }),
      (this.prisma as any).customerPayment.findMany({ where: { receivedAt: dateRange, status: 'posted' }, orderBy: { receivedAt: 'asc' } }),
      (this.prisma as any).creditNote.findMany({ where: { issuedAt: dateRange, status: 'issued' }, orderBy: { issuedAt: 'asc' } }),
      (this.prisma as any).customerLedgerEntry.groupBy({ by: ['customerId'], _sum: { debit: true, credit: true } }),
      (this.prisma as any).inventoryLotBalance.findMany({ include: { lot: { include: { product: true } } } }),
      (this.prisma as any).purchaseDemand.findMany({ where: { status: { in: ['open', 'ordered', 'partial_received'] } } }),
      (this.prisma as any).purchaseOrder.findMany({ where: { status: { in: ['draft', 'ordered', 'partial_received'] } }, orderBy: { createdAt: 'desc' }, take: 20 }),
      (this.prisma as any).goodsReceiptLine.findMany({ where: { createdAt: dateRange } }),
      this.prisma.dispatchChallan.findMany({ where: { createdAt: dateRange } }),
      (this.prisma as any).returnOrder.findMany({ where: { createdAt: dateRange } }),
      (this.prisma as any).inventoryPeriodClose.findMany({ where: { status: 'closed' }, orderBy: { effectiveAt: 'desc' }, take: 12 }),
    ]);
    // Sales and collections are now recognised from posted financial
    // documents, not the date a commercial order happened to be created.
    const sales = invoices.reduce((sum: number, row: any) => sum + Number(row.totalAmount || 0), 0);
    const collections = payments.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
    const credits = creditNotes.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
    const inventory = lotBalances.reduce((acc: any, row: any) => {
      const qty = Number(row.onHand || 0);
      const value = qty * Number(row.lot?.unitCost || 0);
      const category = row.lot?.product?.category || 'Uncategorised';
      acc.quantity += qty;
      acc.reserved += Number(row.reserved || 0);
      acc.damaged += Number(row.damaged || 0);
      acc.value += value;
      const bucket = acc.byCategory.get(category) || { category, quantity: 0, value: 0, reserved: 0 };
      bucket.quantity += qty; bucket.value += value; bucket.reserved += Number(row.reserved || 0);
      acc.byCategory.set(category, bucket);
      return acc;
    }, { quantity: 0, reserved: 0, damaged: 0, value: 0, byCategory: new Map() });
    const daily = new Map<string, any>();
    const bucket = (date: Date) => {
      const key = date.toISOString().slice(0, 10);
      if (!daily.has(key)) daily.set(key, { date: key, sales: 0, collections: 0, credits: 0, orders: 0 });
      return daily.get(key);
    };
    invoices.forEach((row: any) => { const item = bucket(row.issueDate); item.sales += Number(row.totalAmount || 0); item.orders += 1; });
    payments.forEach((row: any) => { bucket(row.receivedAt).collections += Number(row.amount || 0); });
    creditNotes.forEach((row: any) => { bucket(row.issuedAt).credits += Number(row.amount || 0); });
    return {
      generatedAt: new Date().toISOString(), range: { from: from.toISOString(), to: to.toISOString() },
      finance: {
        sales, collections, creditNotes: credits, netSales: sales - credits,
        outstanding: Math.max(0, (ledgerBalances as any[]).reduce((sum, row) => sum + Number(row._sum?.debit || 0) - Number(row._sum?.credit || 0), 0)),
        orderCount: orders.length, invoiceCount: invoices.length,
      },
      inventory: { quantity: inventory.quantity, reserved: inventory.reserved, available: inventory.quantity - inventory.reserved - inventory.damaged, damaged: inventory.damaged, value: inventory.value },
      procurement: {
        backorderQuantity: demands.reduce((sum: number, row: any) => sum + Math.max(0, Number(row.quantity || 0) - Number(row.receivedQuantity || 0)), 0),
        openDemandCount: demands.length, openPurchaseOrders: purchaseOrders.length,
        receivedQuantity: grnLines.reduce((sum: number, row: any) => sum + Number(row.acceptedQuantity || 0), 0),
        damagedReceivedQuantity: grnLines.reduce((sum: number, row: any) => sum + Number(row.damagedQuantity || 0), 0),
      },
      fulfilment: {
        challans: challans.length, delivered: challans.filter((row: any) => row.status === 'delivered').length,
        pending: challans.filter((row: any) => !['delivered', 'cancelled'].includes(row.status)).length,
        returns: returns.length, receivedReturns: returns.filter((row: any) => row.status === 'received').length,
      },
      trend: Array.from(daily.values()).sort((a, b) => a.date.localeCompare(b.date)),
      categoryStock: Array.from(inventory.byCategory.values()).sort((a: any, b: any) => b.value - a.value),
      openPurchaseOrders: purchaseOrders,
      periodCloses: closes,
    };
  }

  async stockLocations(args?: { status?: string }) {
    await this.ensureDefaultLocation();
    const where: any = {};
    if (args?.status && args.status !== 'all') where.status = args.status;
    const rows = await (this.prisma as any).stockLocation.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map((row: any) => this.decorateLocation(row));
  }

  async stockLocationBalances(args?: { locationId?: string; productId?: string; take?: number }) {
    const take = this.limit(args?.take, 250);
    // InventoryLotBalance is the physical stock truth. StockBalanceByLocation
    // remains only as a legacy posting projection and must never be served as
    // an independent quantity source because older projection rows may drift.
    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        CONCAT('lot-location:', lot."productId", ':', lb."locationId") AS id,
        lot."productId",
        lb."locationId",
        COALESCE(SUM(lb."onHand"), 0)::integer AS "onHand",
        COALESCE(SUM(lb."reserved"), 0)::integer AS reserved,
        COALESCE(SUM(lb."damaged"), 0)::integer AS damaged,
        COALESCE(SUM(lb."hold"), 0)::integer AS hold,
        MAX(lb."updatedAt") AS "updatedAt"
      FROM "InventoryLotBalance" lb
      INNER JOIN "InventoryLot" lot ON lot.id = lb."lotId" AND lot.status = 'active'
      WHERE (${args?.locationId || null}::text IS NULL OR lb."locationId" = ${args?.locationId || null})
        AND (${args?.productId || null}::text IS NULL OR lot."productId" = ${args?.productId || null})
      GROUP BY lot."productId", lb."locationId"
      ORDER BY MAX(lb."updatedAt") DESC, lot."productId", lb."locationId"
      LIMIT ${take}
    `).catch(() => []);
    const [products, locations] = await Promise.all([
      rows.length ? this.prisma.product.findMany({ where: { id: { in: Array.from(new Set(rows.map((row: any) => row.productId))) } } }) : [],
      rows.length ? (this.prisma as any).stockLocation.findMany({ where: { id: { in: Array.from(new Set(rows.map((row: any) => row.locationId))) } } }).catch(() => []) : [],
    ]);
    const productMap = new Map(products.map((product: any) => [product.id, product] as const));
    const locationMap = new Map((locations as any[]).map((location) => [location.id, this.decorateLocation(location)] as const));
    return rows.map((row: any) => ({ ...row, product: productMap.get(row.productId) || null, location: locationMap.get(row.locationId) || null }));
  }

  async createStockLocation(input: any, actorUserId: string) {
    const normalized = this.normalizeLocationInput(input);
    return this.prisma.$transaction(async (tx: any) => {
      if (normalized.defaultStockScope) await this.clearDefaultStockScopeTx(tx);
      const location = await tx.stockLocation.create({
        data: {
          id: ulid(),
          ...normalized.data,
          metadata: normalized.metadata,
          updatedAt: new Date(),
        },
      });
      await tx.auditEvent.create({
        data: {
          id: ulid(),
          actorUserId,
          action: 'stock_location.create',
          entityType: 'StockLocation',
          entityId: location.id,
          summary: `Created ${location.name} (${location.code})`,
          metadata: { defaultStockScope: normalized.defaultStockScope },
        },
      }).catch(() => null);
      return this.decorateLocation(location);
    });
  }

  async updateStockLocation(id: string, input: any, actorUserId: string) {
    const existing = await (this.prisma as any).stockLocation.findUnique({ where: { id } }).catch(() => null);
    if (!existing) throw new NotFoundException('Stock location not found');
    const normalized = this.normalizeLocationInput(input, existing);
    if (existing.metadata?.defaultStockScope && normalized.data.status && normalized.data.status !== 'active') {
      throw new BadRequestException('Choose another default plant before disabling this one');
    }
    return this.prisma.$transaction(async (tx: any) => {
      if (normalized.defaultStockScope) await this.clearDefaultStockScopeTx(tx);
      const updated = await tx.stockLocation.update({
        where: { id },
        data: {
          ...normalized.data,
          metadata: normalized.metadata,
          updatedAt: new Date(),
        },
      });
      await tx.auditEvent.create({
        data: {
          id: ulid(),
          actorUserId,
          action: 'stock_location.update',
          entityType: 'StockLocation',
          entityId: updated.id,
          summary: `Updated ${updated.name} (${updated.code})`,
          metadata: { defaultStockScope: normalized.defaultStockScope },
        },
      }).catch(() => null);
      return this.decorateLocation(updated);
    });
  }

  async stockLedgerEntries(args?: { productId?: string; referenceId?: string; take?: number; skip?: number }) {
    const where: any = {};
    if (args?.productId) where.productId = args.productId;
    if (args?.referenceId) where.referenceId = args.referenceId;
    const rows = await (this.prisma as any).stockLedgerEntry.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: this.limit(args?.take, 200),
      skip: Math.max(Number(args?.skip) || 0, 0),
    });
    const productIds = Array.from(new Set(rows.map((row: any) => row.productId).filter(Boolean)));
    const products = productIds.length ? await this.prisma.product.findMany({ where: { id: { in: productIds as string[] } } }) : [];
    const productMap = new Map(products.map((product: any) => [product.id, product]));
    return rows.map((row: any) => ({ ...row, product: row.productId ? productMap.get(row.productId) || null : null }));
  }

  async stockCountSessions(args?: { status?: string; take?: number; recordId?: string }) {
    const where: any = {};
    if (args?.recordId) where.id = args.recordId;
    if (args?.status && args.status !== 'all') where.status = args.status;
    return (this.prisma as any).stockCountSession.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: this.limit(args?.take, 80),
      include: {
        location: true,
        lines: { include: { product: true, lot: true, location: true }, orderBy: { createdAt: 'asc' } },
      },
    });
  }

  async createStockCountSession(input: any, actorUserId: string) {
    const lines = this.parseLines(input.lines);
    if (!lines.length) throw new BadRequestException('Add at least one counted SKU');
    const productIds = Array.from(new Set(lines.map((line: any) => String(line.productId || '').trim()).filter(Boolean)));
    if (!productIds.length) throw new BadRequestException('Stock count lines require Product Master SKUs');
    const products = await this.prisma.product.findMany({ where: { id: { in: productIds } } });
    const productMap = new Map((products as any[]).map((product) => [product.id, product]));
    if (products.length !== productIds.length) throw new BadRequestException('Every count line must reference an existing Product Master SKU');
    const countType = String(input.countType || 'cycle').trim().toLowerCase();
    if (!['cycle', 'monthly', 'year_end'].includes(countType)) throw new BadRequestException('Count type must be cycle, monthly, or year_end');
    const periodKey = String(input.periodKey || '').trim() || null;
    if (countType !== 'cycle' && !periodKey) throw new BadRequestException('Monthly and year-end counts require a period key');

    return this.prisma.$transaction(async (tx: any) => {
      const location = input.locationId
        ? await this.resolveStockLocationTx(tx, input.locationId)
        : await this.ensureDefaultLocationTx(tx);
      const lotIds = Array.from(new Set(lines.map((line: any) => String(line.lotId || '').trim()).filter(Boolean)));
      const lotBalances = lotIds.length
        ? await tx.inventoryLotBalance.findMany({
            where: { locationId: location.id, lotId: { in: lotIds } },
            include: { lot: true },
          })
        : [];
      const lotBalanceMap = new Map((lotBalances as any[]).map((balance) => [balance.lotId, balance]));
      const seen = new Set<string>();
      const countNumber = await nextDocumentNumber(tx, 'stock_count', 'SC', new Date(), {
        existingNumbers: async (prefixForYear) => (await tx.stockCountSession.findMany({
          where: { countNumber: { startsWith: prefixForYear } },
          select: { countNumber: true },
        })).map((row: any) => row.countNumber),
      });
      const session = await tx.stockCountSession.create({
        data: {
          id: ulid(),
          countNumber,
          status: input.submit ? 'submitted' : 'draft',
          scope: input.scope || 'selected_skus',
          countType,
          periodKey,
          effectiveAt: input.effectiveAt ? new Date(input.effectiveAt) : new Date(),
          locationId: location.id,
          notes: input.notes || '',
          createdBy: actorUserId,
          submittedAt: input.submit ? new Date() : null,
          updatedAt: new Date(),
          metadata: { source: 'inventory_count_ui', device: input.device || null },
        },
      });
      for (const row of lines) {
        const product = productMap.get(String(row.productId)) as any;
        const lotId = String(row.lotId || '').trim() || null;
        const identity = `${product.id}:${lotId || 'new'}:${location.id}`;
        if (seen.has(identity)) throw new BadRequestException(`${product.sku} has a duplicate count row for the same lot and location`);
        seen.add(identity);
        const lotBalance = lotId ? lotBalanceMap.get(lotId) as any : null;
        if (lotId && (!lotBalance || lotBalance.lot?.productId !== product.id)) {
          throw new BadRequestException(`${product.sku} lot was not found at ${location.code}`);
        }
        const counted = this.wholeOrZero(row.countedQuantity, `${product.sku} counted quantity`);
        const expected = Number(lotBalance?.onHand || 0);
        if (!lotId && expected === 0 && counted === 0) continue;
        await tx.stockCountLine.create({
          data: {
            id: ulid(),
            stockCountId: session.id,
            productId: product.id,
            lotId,
            locationId: location.id,
            expectedQuantity: expected,
            countedQuantity: counted,
            variance: counted - expected,
            unitCost: Number(row.unitCost ?? lotBalance?.lot?.unitCost ?? 0),
            varianceValue: (counted - expected) * Number(row.unitCost ?? lotBalance?.lot?.unitCost ?? 0),
            reason: row.reason || '',
            status: 'counted',
            updatedAt: new Date(),
            metadata: { sku: product.sku, name: product.name, lotNumber: lotBalance?.lot?.lotNumber || null },
          },
        });
      }
      await tx.auditEvent.create({
        data: {
          id: ulid(),
          actorUserId,
          action: 'stock_count.create',
          entityType: 'StockCountSession',
          entityId: session.id,
          summary: `Created ${countNumber} with ${lines.length} counted SKU rows`,
          metadata: { lineCount: lines.length },
        },
      });
      return this.decorateStockCount(session.id, tx);
    }, { isolationLevel: 'Serializable', timeout: 20000 });
  }

  async approveStockCountSession(id: string, actorUserId: string) {
    const session = await (this.prisma as any).stockCountSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('Stock count session not found');
    if (session.status === 'posted') return this.decorateStockCount(id);
    if (!['draft', 'submitted'].includes(session.status)) throw new BadRequestException(`Count ${session.countNumber} cannot be posted from ${session.status}`);
    const lines = await (this.prisma as any).stockCountLine.findMany({ where: { stockCountId: id }, include: { product: true, lot: true } });
    if (!lines.length) throw new BadRequestException('Stock count has no lines to approve');

    return this.prisma.$transaction(async (tx: any) => {
      for (const line of lines) {
        const variance = Number(line.variance || 0);
        let lot = line.lot;
        if (!lot && variance < 0) throw new BadRequestException(`${line.product?.sku || line.productId} needs an exact lot before stock can be reduced`);
        if (!lot && variance > 0) {
          const suffix = String(line.id).slice(-6).toUpperCase();
          lot = await tx.inventoryLot.create({
            data: {
              id: ulid(),
              lotNumber: `COUNT-${session.countNumber}-${suffix}`,
              productId: line.productId,
              sourceType: 'stock_count',
              sourceId: session.id,
              sourceLineId: line.id,
              qualityStatus: 'available',
              receivedAt: session.effectiveAt || new Date(),
              unitCost: Number(line.unitCost || 0),
              status: 'active',
              attributes: {},
              metadata: { countNumber: session.countNumber },
              createdBy: actorUserId,
              updatedAt: new Date(),
            },
          });
        }
        if (!variance) {
          await tx.stockCountLine.update({ where: { id: line.id }, data: { status: 'posted', adjustmentPosted: true, updatedAt: new Date() } });
          continue;
        }
        const locationId = line.locationId || session.locationId;
        if (!locationId || !lot) throw new BadRequestException('Count posting requires an exact lot and location');
        await applyLotStockPostingTx(tx, {
          productId: line.productId,
          lotId: lot.id,
          locationId,
          idempotencyKey: `stock-count:${session.id}:${line.id}`,
          type: 'stock_count',
          direction: variance >= 0 ? 'in' : 'out',
          quantity: Math.abs(variance),
          onHandDelta: variance,
          reason: `Approved variance from ${session.countNumber}: ${line.reason || 'physical count'}`,
          createdBy: actorUserId,
          referenceType: 'StockCountSession',
          referenceId: session.id,
          sourceDocumentNo: session.countNumber,
          effectiveAt: session.effectiveAt,
          metadata: {
            expected: line.expectedQuantity,
            counted: line.countedQuantity,
            variance: line.variance,
          },
          requireOnHand: variance < 0,
        });
        await tx.stockCountLine.update({
          where: { id: line.id },
          data: { lotId: lot.id, status: 'posted', adjustmentPosted: true, updatedAt: new Date() },
        });
      }
      const approved = await tx.stockCountSession.update({
        where: { id },
        data: {
          status: 'posted',
          approvedBy: actorUserId,
          submittedAt: session.submittedAt || new Date(),
          approvedAt: new Date(),
          frozenAt: new Date(),
          postedAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await tx.auditEvent.create({
        data: {
          id: ulid(),
          actorUserId,
          action: 'stock_count.approve',
          entityType: 'StockCountSession',
          entityId: id,
          summary: `Approved ${session.countNumber}`,
          metadata: { lineCount: lines.length },
        },
      });
      return this.decorateStockCount(approved.id, tx);
    }, { isolationLevel: 'Serializable', timeout: 30000 });
  }

  async inventoryLots(args?: { productId?: string; locationId?: string; status?: string; search?: string; take?: number }) {
    const where: any = {};
    if (args?.productId) where.productId = args.productId;
    if (args?.status && args.status !== 'all') where.status = args.status;
    if (args?.search) {
      where.OR = [
        { lotNumber: { contains: args.search, mode: 'insensitive' } },
        { supplierBatch: { contains: args.search, mode: 'insensitive' } },
        { product: { is: { OR: [
          { sku: { contains: args.search, mode: 'insensitive' } },
          { internalCode: { contains: args.search, mode: 'insensitive' } },
          { name: { contains: args.search, mode: 'insensitive' } },
        ] } } },
        { goodsReceiptLines: { some: { goodsReceiptNote: { is: { OR: [
          { grnNumber: { contains: args.search, mode: 'insensitive' } },
          { vendorName: { contains: args.search, mode: 'insensitive' } },
          { supplierChallan: { contains: args.search, mode: 'insensitive' } },
          { supplierBill: { contains: args.search, mode: 'insensitive' } },
        ] } } } } },
      ];
    }
    return (this.prisma as any).inventoryLot.findMany({
      where,
      include: {
        product: { include: { tileDesignMaster: true, tileSizeMaster: true } },
        goodsReceiptLines: {
          take: 1,
          include: { goodsReceiptNote: true },
          orderBy: { createdAt: 'desc' },
        },
        balances: {
          where: args?.locationId ? { locationId: args.locationId } : undefined,
          include: { location: true },
          orderBy: { updatedAt: 'desc' },
        },
      },
      orderBy: { receivedAt: 'desc' },
      take: this.limit(args?.take, 200),
    });
  }

  async correctMissingInventoryLotCost(id: string, unitCost: number, reason: string, actorUserId: string) {
    const nextCost = Number(unitCost);
    const correctionReason = String(reason || '').trim();
    if (!Number.isFinite(nextCost) || nextCost <= 0) throw new BadRequestException('Corrected lot cost must be greater than zero');
    if (correctionReason.length < 8) throw new BadRequestException('Enter a specific correction reason (at least 8 characters)');
    return this.prisma.$transaction(async (tx: any) => {
      const lot = await tx.inventoryLot.findUnique({ where: { id }, include: { product: true } });
      if (!lot) throw new NotFoundException('Inventory lot not found');
      if (Number(lot.unitCost || 0) > 0) throw new BadRequestException('This lot already has a governed cost. Use a reviewed accounting correction instead of overwriting it here.');
      const correctedAt = new Date();
      const updated = await tx.inventoryLot.update({
        where: { id },
        data: {
          unitCost: nextCost,
          costStatus: 'complete',
          metadata: { ...(lot.metadata || {}), costCorrection: { previousUnitCost: Number(lot.unitCost || 0), correctedUnitCost: nextCost, reason: correctionReason, correctedAt: correctedAt.toISOString(), correctedBy: actorUserId } },
          updatedAt: correctedAt,
        },
        include: { product: true, balances: { include: { location: true } } },
      });
      await tx.auditEvent.create({
        data: {
          id: ulid(), actorUserId, action: 'inventory_lot.cost_missing.correct', entityType: 'InventoryLot', entityId: id,
          summary: `Recorded missing lot cost for ${lot.lotNumber}`,
          metadata: { productId: lot.productId, lotNumber: lot.lotNumber, previousUnitCost: Number(lot.unitCost || 0), correctedUnitCost: nextCost, reason: correctionReason },
        },
      });
      return updated;
    }, { isolationLevel: 'Serializable', timeout: 15000 });
  }

  async openingStockSessions(args?: { status?: string; take?: number; recordId?: string }) {
    const where: any = {};
    if (args?.recordId) where.id = args.recordId;
    if (args?.status && args.status !== 'all') where.status = args.status;
    return (this.prisma as any).openingStockSession.findMany({
      where,
      include: { location: true, lines: { include: { product: true, lot: true }, orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: this.limit(args?.take, 80),
    });
  }

  async createOpeningStockSession(input: any, actorUserId: string) {
    const lines = this.parseLines(input.lines);
    if (!lines.length) throw new BadRequestException('Opening stock requires at least one physical count line');
    return this.prisma.$transaction(async (tx: any) => {
      const location = input.locationId
        ? await this.resolveStockLocationTx(tx, input.locationId)
        : await this.ensureDefaultLocationTx(tx);
      const productIds = Array.from(new Set(lines.map((line: any) => String(line.productId || '').trim()).filter(Boolean)));
      const products = await tx.product.findMany({ where: { id: { in: productIds } } });
      const productMap = new Map((products as any[]).map((product) => [product.id, product]));
      if (products.length !== productIds.length) throw new BadRequestException('Every opening line must reference an existing Product Master SKU');
      const effectiveAt = input.effectiveAt ? new Date(input.effectiveAt) : new Date();
      if (Number.isNaN(effectiveAt.getTime())) throw new BadRequestException('Opening-stock effective date is invalid');
      const sessionNumber = await nextDocumentNumber(tx, 'opening_stock', 'OS', effectiveAt, {
        existingNumbers: async (prefixForYear) => (await tx.openingStockSession.findMany({
          where: { sessionNumber: { startsWith: prefixForYear } }, select: { sessionNumber: true },
        })).map((row: any) => row.sessionNumber),
      });
      const session = await tx.openingStockSession.create({
        data: {
          id: ulid(), sessionNumber, status: input.submit ? 'submitted' : 'draft', locationId: location.id,
          effectiveAt, fiscalYear: String(input.fiscalYear || this.fiscalYear(effectiveAt)),
          valuationMode: input.valuationMode || 'unit_cost', notes: input.notes || '', createdBy: actorUserId,
          submittedBy: input.submit ? actorUserId : null, submittedAt: input.submit ? new Date() : null,
          metadata: { source: 'opening_stock_onboarding', ownerOverrideReason: input.ownerOverrideReason || null }, updatedAt: new Date(),
        },
      });
      const identities = new Set<string>();
      for (const [index, row] of lines.entries()) {
        const product = productMap.get(String(row.productId)) as any;
        const quantity = this.whole(row.quantity, `${product.sku} opening quantity`);
        const lotCode = String(row.lotCode || row.supplierBatch || `OPEN-${index + 1}`).trim().toUpperCase();
        const identity = `${product.id}:${lotCode}`;
        if (identities.has(identity)) throw new BadRequestException(`${product.sku} has a duplicate opening lot code`);
        identities.add(identity);
        const unitCost = Number(row.unitCost || 0);
        if (!Number.isFinite(unitCost) || unitCost < 0) throw new BadRequestException(`${product.sku} unit cost cannot be negative`);
        await tx.openingStockLine.create({
          data: {
            id: ulid(), openingStockSessionId: session.id, productId: product.id, lotCode, quantity, unitCost,
            supplierBatch: row.supplierBatch || null, qualityStatus: row.qualityStatus || 'available', rackBin: row.rackBin || null,
            status: 'counted', metadata: {
              lineNo: index + 1, packCount: Number(row.packCount || 0), labelTemplate: row.labelTemplate || 'stock_pack',
              attributes: row.attributes || {}, costStatus: unitCost > 0 ? 'captured' : 'incomplete_owner_review_required',
            }, updatedAt: new Date(),
          },
        });
      }
      await tx.auditEvent.create({
        data: { id: ulid(), actorUserId, action: 'opening_stock.create', entityType: 'OpeningStockSession', entityId: session.id,
          summary: `Created ${sessionNumber} with ${lines.length} physical count lines`, metadata: { locationId: location.id, lineCount: lines.length } },
      });
      return tx.openingStockSession.findUnique({
        where: { id: session.id }, include: { location: true, lines: { include: { product: true, lot: true }, orderBy: { createdAt: 'asc' } } },
      });
    }, { isolationLevel: 'Serializable', timeout: 30000 });
  }

  async approveOpeningStockSession(id: string, actorUserId: string, ownerOverrideReason?: string) {
    return this.prisma.$transaction(async (tx: any) => {
      const session = await tx.openingStockSession.findUnique({
        where: { id }, include: { location: true, lines: { include: { product: true }, orderBy: { createdAt: 'asc' } } },
      });
      if (!session) throw new NotFoundException('Opening-stock session not found');
      if (session.status === 'posted') return session;
      if (!['draft', 'submitted'].includes(session.status)) throw new BadRequestException(`${session.sessionNumber} cannot be posted from ${session.status}`);
      if (!session.lines.length) throw new BadRequestException('Opening-stock session has no lines');
      const incompleteCostLines = session.lines.filter((line: any) => Number(line.unitCost || 0) <= 0);
      const submittedOverrideReason = String(ownerOverrideReason || '').trim();
      const overrideReason = submittedOverrideReason || String((session.metadata as any)?.ownerOverrideReason || '').trim();
      if (incompleteCostLines.length && overrideReason.length < 12) {
        throw new BadRequestException(`Opening stock has ${incompleteCostLines.length} line(s) without unit cost. An owner must record a specific cost-incomplete reason before posting.`);
      }
      if (submittedOverrideReason) {
        await tx.openingStockSession.update({
          where: { id },
          data: { metadata: { ...(session.metadata as any), ownerOverrideReason: submittedOverrideReason, ownerOverrideBy: actorUserId, ownerOverrideAt: new Date().toISOString() }, updatedAt: new Date() },
        });
      }
      for (const line of session.lines) {
        const existingLot = await tx.inventoryLot.findFirst({
          where: { sourceType: 'opening_stock', sourceId: session.id, sourceLineId: line.id },
        });
        const lot = existingLot || await tx.inventoryLot.create({
          data: {
            id: ulid(), lotNumber: `${session.sessionNumber}-${String(line.metadata?.lineNo || 1).padStart(3, '0')}`,
            productId: line.productId, sourceType: 'opening_stock', sourceId: session.id, sourceLineId: line.id,
            supplierBatch: line.supplierBatch || null, qualityStatus: line.qualityStatus || 'available',
            receivedAt: session.effectiveAt, unitCost: Number(line.unitCost || 0), status: 'active',
            attributes: line.metadata?.attributes || {}, metadata: { openingLineId: line.id, rackBin: line.rackBin || null, costStatus: Number(line.unitCost || 0) > 0 ? 'captured' : 'incomplete_owner_exception', costIncompleteReason: Number(line.unitCost || 0) > 0 ? null : overrideReason },
            createdBy: actorUserId, updatedAt: new Date(),
          },
        });
        const damaged = line.qualityStatus === 'damaged' ? Number(line.quantity) : 0;
        const hold = line.qualityStatus === 'hold' || line.qualityStatus === 'inspection' ? Number(line.quantity) : 0;
        await applyLotStockPostingTx(tx, {
          productId: line.productId, lotId: lot.id, locationId: session.locationId,
          idempotencyKey: `opening-stock:${session.id}:${line.id}`, type: 'opening_stock', direction: 'in',
          quantity: Number(line.quantity), onHandDelta: Number(line.quantity), damagedDelta: damaged, holdDelta: hold,
          reason: `Approved opening stock ${session.sessionNumber}`, createdBy: actorUserId,
          referenceType: 'OpeningStockSession', referenceId: session.id, sourceDocumentNo: session.sessionNumber,
          effectiveAt: session.effectiveAt,
          unitCost: Number(line.unitCost || 0), metadata: { openingLineId: line.id, rackBin: line.rackBin || null, costStatus: Number(line.unitCost || 0) > 0 ? 'captured' : 'incomplete_owner_exception', costIncompleteReason: Number(line.unitCost || 0) > 0 ? null : overrideReason },
        });
        await tx.openingStockLine.update({ where: { id: line.id }, data: { lotId: lot.id, status: 'posted', updatedAt: new Date() } });
        const packCount = Math.max(0, Math.trunc(Number(line.metadata?.packCount || 0)));
        if (packCount > 0) await this.createInternalLabelJobTx(tx, {
          sourceType: 'inventory_lot', sourceId: lot.id, productId: line.productId, lotId: lot.id,
          quantity: packCount, template: line.metadata?.labelTemplate || 'stock_pack', actorUserId,
        });
      }
      const posted = await tx.openingStockSession.update({
        where: { id }, data: { status: 'posted', submittedBy: session.submittedBy || actorUserId,
          submittedAt: session.submittedAt || new Date(), approvedBy: actorUserId, approvedAt: new Date(), postedAt: new Date(), updatedAt: new Date() },
        include: { location: true, lines: { include: { product: true, lot: true }, orderBy: { createdAt: 'asc' } } },
      });
      await tx.auditEvent.create({
        data: { id: ulid(), actorUserId, action: 'opening_stock.post', entityType: 'OpeningStockSession', entityId: id,
          summary: `Posted ${session.sessionNumber}`, metadata: { lineCount: session.lines.length, ownerOverride: session.createdBy === actorUserId } },
      });
      return posted;
    }, { isolationLevel: 'Serializable', timeout: 60000 });
  }

  async stockTransfers(args?: { status?: string; take?: number }) {
    const where: any = {};
    if (args?.status && args.status !== 'all') where.status = args.status;
    return (this.prisma as any).stockTransfer.findMany({
      where,
      include: { sourceLocation: true, destinationLocation: true, lines: { include: { product: true, lot: true } } },
      orderBy: { requestedAt: 'desc' }, take: this.limit(args?.take, 80),
    });
  }

  async createStockTransfer(input: any, actorUserId: string) {
    const lines = this.parseLines(input.lines);
    if (!lines.length) throw new BadRequestException('Stock transfer requires at least one lot line');
    return this.prisma.$transaction(async (tx: any) => {
      const source = await this.resolveStockLocationTx(tx, input.sourceLocationId);
      const destination = await this.resolveStockLocationTx(tx, input.destinationLocationId);
      if (source.id === destination.id) throw new BadRequestException('Transfer source and destination must be different');
      const transferNumber = await nextDocumentNumber(tx, 'stock_transfer', 'ST', new Date(), {
        existingNumbers: async (prefixForYear) => (await tx.stockTransfer.findMany({
          where: { transferNumber: { startsWith: prefixForYear } }, select: { transferNumber: true },
        })).map((row: any) => row.transferNumber),
      });
      const transfer = await tx.stockTransfer.create({
        data: { id: ulid(), transferNumber, status: input.submit ? 'submitted' : 'draft', sourceLocationId: source.id,
          destinationLocationId: destination.id, requestedBy: actorUserId, notes: input.notes || '', metadata: {}, updatedAt: new Date() },
      });
      for (const row of lines) {
        const lot = await tx.inventoryLot.findUnique({ where: { id: String(row.lotId || '') } });
        if (!lot) throw new BadRequestException('Every transfer line requires an existing inventory lot');
        const quantity = this.whole(row.quantity, `${lot.lotNumber} transfer quantity`);
        const balance = await tx.inventoryLotBalance.findUnique({ where: { lotId_locationId: { lotId: lot.id, locationId: source.id } } });
        if (!balance || quantity > Number(balance.available || 0)) throw new BadRequestException(`${lot.lotNumber} has only ${balance?.available || 0} available at ${source.code}`);
        await tx.stockTransferLine.create({
          data: { id: ulid(), stockTransferId: transfer.id, productId: lot.productId, lotId: lot.id,
            requestedQuantity: quantity, status: 'requested', metadata: {}, updatedAt: new Date() },
        });
      }
      await tx.auditEvent.create({ data: { id: ulid(), actorUserId, action: 'stock_transfer.create', entityType: 'StockTransfer', entityId: transfer.id,
        summary: `Created ${transferNumber}`, metadata: { lineCount: lines.length, sourceLocationId: source.id, destinationLocationId: destination.id } } });
      return tx.stockTransfer.findUnique({ where: { id: transfer.id }, include: { sourceLocation: true, destinationLocation: true, lines: { include: { product: true, lot: true } } } });
    }, { isolationLevel: 'Serializable', timeout: 30000 });
  }

  async transitionStockTransfer(id: string, action: string, input: any, actorUserId: string) {
    const normalizedAction = String(action || '').trim().toLowerCase();
    if (!['approve', 'dispatch', 'receive', 'cancel'].includes(normalizedAction)) throw new BadRequestException('Unsupported stock-transfer action');
    return this.prisma.$transaction(async (tx: any) => {
      const transfer = await tx.stockTransfer.findUnique({ where: { id }, include: { lines: { include: { lot: true, product: true } } } });
      if (!transfer) throw new NotFoundException('Stock transfer not found');
      const transit = await this.ensureTransitLocationTx(tx);
      if (normalizedAction === 'approve') {
        if (!['draft', 'submitted'].includes(transfer.status)) throw new BadRequestException(`${transfer.transferNumber} cannot be approved from ${transfer.status}`);
        await tx.stockTransfer.update({ where: { id }, data: { status: 'approved', approvedBy: actorUserId, approvedAt: new Date(), updatedAt: new Date() } });
      } else if (normalizedAction === 'dispatch') {
        if (transfer.status !== 'approved') throw new BadRequestException(`${transfer.transferNumber} must be approved before dispatch`);
        for (const line of transfer.lines) {
          const quantity = Number(line.requestedQuantity);
          await applyLotStockPostingTx(tx, {
            productId: line.productId, lotId: line.lotId, locationId: transfer.sourceLocationId,
            idempotencyKey: `transfer:${id}:${line.id}:source-out`, type: 'transfer_out', direction: 'out', quantity,
            onHandDelta: -quantity, reason: `Transfer ${transfer.transferNumber} dispatched`, createdBy: actorUserId,
            referenceType: 'StockTransfer', referenceId: id, sourceDocumentNo: transfer.transferNumber, requireAvailable: true,
          });
          await applyLotStockPostingTx(tx, {
            productId: line.productId, lotId: line.lotId, locationId: transit.id,
            idempotencyKey: `transfer:${id}:${line.id}:transit-in`, type: 'transfer_transit', direction: 'in', quantity,
            onHandDelta: quantity, reason: `Transfer ${transfer.transferNumber} in transit`, createdBy: actorUserId,
            referenceType: 'StockTransfer', referenceId: id, sourceDocumentNo: transfer.transferNumber,
          });
          await tx.stockTransferLine.update({ where: { id: line.id }, data: { dispatchedQuantity: quantity, status: 'in_transit', updatedAt: new Date() } });
        }
        await tx.stockTransfer.update({ where: { id }, data: { status: 'in_transit', dispatchedBy: actorUserId, dispatchedAt: new Date(), updatedAt: new Date() } });
      } else if (normalizedAction === 'receive') {
        if (transfer.status !== 'in_transit') throw new BadRequestException(`${transfer.transferNumber} is not in transit`);
        const receivedLines = new Map(this.parseLines(input?.lines).map((row: any) => [String(row.lineId || ''), row]));
        for (const line of transfer.lines) {
          const receivedInput: any = receivedLines.get(line.id) || {};
          const received = receivedInput.receivedQuantity === undefined ? Number(line.dispatchedQuantity) : this.wholeOrZero(receivedInput.receivedQuantity, 'Received quantity');
          const damaged = this.wholeOrZero(receivedInput.damagedQuantity || 0, 'Damaged quantity');
          if (received + damaged !== Number(line.dispatchedQuantity)) throw new BadRequestException(`${line.lot.lotNumber} received plus damaged must equal dispatched quantity`);
          const transitQuantity = Number(line.dispatchedQuantity);
          await applyLotStockPostingTx(tx, {
            productId: line.productId, lotId: line.lotId, locationId: transit.id,
            idempotencyKey: `transfer:${id}:${line.id}:transit-out`, type: 'transfer_transit_clear', direction: 'out', quantity: transitQuantity,
            onHandDelta: -transitQuantity, reason: `Transfer ${transfer.transferNumber} received`, createdBy: actorUserId,
            referenceType: 'StockTransfer', referenceId: id, sourceDocumentNo: transfer.transferNumber, requireOnHand: true,
          });
          if (received > 0) await applyLotStockPostingTx(tx, {
            productId: line.productId, lotId: line.lotId, locationId: transfer.destinationLocationId,
            idempotencyKey: `transfer:${id}:${line.id}:destination-in`, type: 'transfer_in', direction: 'in', quantity: received,
            onHandDelta: received, reason: `Transfer ${transfer.transferNumber} accepted`, createdBy: actorUserId,
            referenceType: 'StockTransfer', referenceId: id, sourceDocumentNo: transfer.transferNumber,
          });
          if (damaged > 0) await applyLotStockPostingTx(tx, {
            productId: line.productId, lotId: line.lotId, locationId: transfer.destinationLocationId,
            idempotencyKey: `transfer:${id}:${line.id}:destination-damaged`, type: 'transfer_damage', direction: 'in', quantity: damaged,
            onHandDelta: damaged, damagedDelta: damaged, reason: `Transfer ${transfer.transferNumber} damaged on receipt`, createdBy: actorUserId,
            referenceType: 'StockTransfer', referenceId: id, sourceDocumentNo: transfer.transferNumber,
          });
          await tx.stockTransferLine.update({ where: { id: line.id }, data: { receivedQuantity: received, damagedQuantity: damaged, status: 'received', updatedAt: new Date() } });
        }
        await tx.stockTransfer.update({ where: { id }, data: { status: 'received', receivedBy: actorUserId, receivedAt: new Date(), updatedAt: new Date() } });
      } else {
        if (!['draft', 'submitted', 'approved'].includes(transfer.status)) throw new BadRequestException(`${transfer.transferNumber} cannot be cancelled from ${transfer.status}`);
        await tx.stockTransfer.update({ where: { id }, data: { status: 'cancelled', metadata: { ...(transfer.metadata || {}), cancelReason: input?.reason || 'Cancelled' }, updatedAt: new Date() } });
      }
      await tx.auditEvent.create({ data: { id: ulid(), actorUserId, action: `stock_transfer.${normalizedAction}`, entityType: 'StockTransfer', entityId: id,
        summary: `${normalizedAction} ${transfer.transferNumber}`, metadata: { reason: input?.reason || null } } });
      return tx.stockTransfer.findUnique({ where: { id }, include: { sourceLocation: true, destinationLocation: true, lines: { include: { product: true, lot: true } } } });
    }, { isolationLevel: 'Serializable', timeout: 60000 });
  }

  async inventoryPeriodCloses(args?: { status?: string; take?: number }) {
    const where: any = {};
    if (args?.status && args.status !== 'all') where.status = args.status;
    return (this.prisma as any).inventoryPeriodClose.findMany({
      where, include: { snapshots: { take: 20, orderBy: { stockValue: 'desc' } } }, orderBy: { effectiveAt: 'desc' }, take: this.limit(args?.take, 40),
    });
  }

  async closeInventoryPeriod(input: any, actorUserId: string) {
    const periodType = String(input.periodType || 'monthly').trim().toLowerCase();
    if (!['monthly', 'year_end'].includes(periodType)) throw new BadRequestException('Period type must be monthly or year_end');
    const periodKey = String(input.periodKey || '').trim();
    if (!periodKey) throw new BadRequestException('Period key is required');
    return this.prisma.$transaction(async (tx: any) => {
      const existing = await tx.inventoryPeriodClose.findUnique({ where: { periodKey } });
      if (existing?.status === 'closed') return tx.inventoryPeriodClose.findUnique({ where: { id: existing.id }, include: { snapshots: true } });
      const countSession = input.countSessionId
        ? await tx.stockCountSession.findUnique({ where: { id: input.countSessionId } })
        : await tx.stockCountSession.findFirst({ where: { periodKey, countType: periodType, status: 'posted' }, orderBy: { postedAt: 'desc' } });
      if (!countSession || countSession.status !== 'posted') throw new BadRequestException('A posted monthly/year-end physical count is required before period close');
      const openTransfers = await tx.stockTransfer.count({ where: { status: { in: ['submitted', 'approved', 'in_transit'] } } });
      if (openTransfers) throw new BadRequestException(`${openTransfers} stock transfer(s) must be completed or cancelled before period close`);
      const effectiveAt = input.effectiveAt ? new Date(input.effectiveAt) : new Date();
      const closeNumber = existing?.closeNumber || await nextDocumentNumber(tx, 'inventory_close', periodType === 'year_end' ? 'YC' : 'MC', effectiveAt, {
        existingNumbers: async (prefixForYear) => (await tx.inventoryPeriodClose.findMany({ where: { closeNumber: { startsWith: prefixForYear } }, select: { closeNumber: true } })).map((row: any) => row.closeNumber),
      });
      const close = existing || await tx.inventoryPeriodClose.create({
        data: { id: ulid(), closeNumber, periodType, periodKey, status: 'review', effectiveAt, openedAt: new Date(), countSessionId: countSession.id,
          createdBy: actorUserId, notes: input.notes || '', metadata: {}, updatedAt: new Date() },
      });
      await tx.inventoryPeriodSnapshot.deleteMany({ where: { inventoryPeriodCloseId: close.id } });
      const balances = await tx.inventoryLotBalance.findMany({ include: { lot: true } });
      let totalQuantity = 0;
      let totalValue = 0;
      for (const balance of balances) {
        const unitCost = Number(balance.lot?.unitCost || 0);
        const stockValue = Number(balance.onHand || 0) * unitCost;
        totalQuantity += Number(balance.onHand || 0);
        totalValue += stockValue;
        await tx.inventoryPeriodSnapshot.create({
          data: { id: ulid(), inventoryPeriodCloseId: close.id, productId: balance.lot.productId, lotId: balance.lotId,
            locationId: balance.locationId, onHand: balance.onHand, reserved: balance.reserved, damaged: balance.damaged,
            hold: balance.hold, available: balance.available, unitCost, stockValue, metadata: {} },
        });
      }
      const variance = await tx.stockCountLine.aggregate({ where: { stockCountId: countSession.id }, _sum: { variance: true, varianceValue: true } });
      const closed = await tx.inventoryPeriodClose.update({
        where: { id: close.id }, data: { status: 'closed', reviewedBy: actorUserId, closedBy: actorUserId, reviewedAt: new Date(), closedAt: new Date(),
          totalQuantity, totalValue, varianceQuantity: Number(variance._sum.variance || 0), varianceValue: Number(variance._sum.varianceValue || 0), updatedAt: new Date() },
        include: { snapshots: { take: 50, orderBy: { stockValue: 'desc' } } },
      });
      await tx.auditEvent.create({ data: { id: ulid(), actorUserId, action: 'inventory_period.close', entityType: 'InventoryPeriodClose', entityId: close.id,
        summary: `Closed ${periodKey}`, metadata: { periodType, countSessionId: countSession.id, totalQuantity, totalValue } } });
      return closed;
    }, { isolationLevel: 'Serializable', timeout: 120000 });
  }

  async returnOrders(args?: { status?: string; take?: number }) {
    const where: any = {};
    if (args?.status && args.status !== 'all') where.status = args.status;
    const orders = await (this.prisma as any).returnOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: this.limit(args?.take, 80),
    });
    const ids = orders.map((order: any) => order.id);
    const lines = ids.length ? await (this.prisma as any).returnLine.findMany({ where: { returnOrderId: { in: ids } } }) : [];
    const byReturn = this.groupBy(lines, 'returnOrderId');
    return orders.map((order: any) => ({ ...order, lines: byReturn.get(order.id) || [] }));
  }

  async returnableDispatchLines(args?: { search?: string; take?: number }) {
    const search = String(args?.search || '').trim();
    const lines = await this.prisma.dispatchLine.findMany({
      where: {
        status: 'delivered',
        deliveredQuantity: { gt: 0 },
        ...(search ? { OR: [{ sku: { contains: search, mode: 'insensitive' } }, { name: { contains: search, mode: 'insensitive' } }] } : {}),
      },
      include: { lot: true, location: true },
      orderBy: { updatedAt: 'desc' },
      take: this.limit(args?.take, 120),
    });
    const challanIds = Array.from(new Set(lines.map((line: any) => line.challanId).filter(Boolean))) as string[];
    const orderIds = Array.from(new Set(lines.map((line: any) => line.salesOrderId).filter(Boolean))) as string[];
    const [challans, orders] = await Promise.all([
      challanIds.length ? this.prisma.dispatchChallan.findMany({ where: { id: { in: challanIds } }, include: { customer: true } }) : [],
      orderIds.length ? this.prisma.salesOrder.findMany({ where: { id: { in: orderIds } } }) : [],
    ]);
    const challanMap = new Map(challans.map((row: any) => [row.id, row] as const));
    const orderMap = new Map(orders.map((row: any) => [row.id, row] as const));
    return lines.map((line: any) => ({
      ...line,
      returnableQuantity: Math.max(0, Number(line.deliveredQuantity || 0) - Number(line.returnedQuantity || 0)),
      challan: line.challanId ? challanMap.get(line.challanId) || null : null,
      salesOrder: line.salesOrderId ? orderMap.get(line.salesOrderId) || null : null,
    })).filter((line: any) => line.returnableQuantity > 0);
  }

  async createReturnOrder(input: any, actorUserId: string) {
    const lines = this.parseLines(input.lines);
    if (!lines.length) throw new BadRequestException('Add at least one return line');
    const idempotencyKey = String(input.idempotencyKey || '').trim() || null;
    if (idempotencyKey) {
      const existing = await (this.prisma as any).returnOrder.findUnique({ where: { idempotencyKey } });
      if (existing) return (await this.returnOrders({ take: 120 })).find((row: any) => row.id === existing.id) || existing;
    }
    const created = await this.prisma.$transaction(async (tx: any) => {
      const returnNumber = await nextDocumentNumber(tx, 'return', 'RT', new Date(), {
        existingNumbers: async (prefixForYear) => (await tx.returnOrder.findMany({
          where: { returnNumber: { startsWith: prefixForYear } },
          select: { returnNumber: true },
        })).map((row: any) => row.returnNumber),
      });
      const returnLocation = input.locationId
        ? await this.resolveStockLocationTx(tx, input.locationId)
        : await this.ensureDefaultLocationTx(tx);
      const order = await tx.returnOrder.create({
        data: {
          id: ulid(),
          returnNumber,
          idempotencyKey,
          salesOrderId: input.salesOrderId || null,
          challanId: input.challanId || null,
          customerId: input.customerId || null,
          status: input.receive ? 'received' : 'draft',
          reason: input.reason || 'Customer return',
          refundMode: input.refundMode || null,
          refundAmount: Number(input.refundAmount || 0),
          createdBy: actorUserId,
          receivedAt: input.receive ? new Date() : null,
          updatedAt: new Date(),
          metadata: input.metadata || {},
        },
      });
      let maximumRefundAmount = 0;
      for (const [rowIndex, row] of lines.entries()) {
        const quantity = this.whole(row.quantity, `${row.sku || 'Return'} quantity`);
        const dispatchLine = row.dispatchLineId
          ? await tx.dispatchLine.findUnique({ where: { id: String(row.dispatchLineId) } })
          : null;
        if (input.receive && !dispatchLine) throw new BadRequestException('A received customer return must select an item from a delivered challan');
        if (dispatchLine && dispatchLine.status !== 'delivered') throw new BadRequestException(`${dispatchLine.sku} has not been confirmed delivered`);
        if (input.challanId && dispatchLine?.challanId !== input.challanId) throw new BadRequestException('Return line does not belong to the selected challan');
        if (input.salesOrderId && dispatchLine?.salesOrderId !== input.salesOrderId) throw new BadRequestException('Return line does not belong to the selected sales order');
        const productId = String(row.productId || dispatchLine?.productId || '').trim();
        if (dispatchLine) {
          const returnable = Math.max(0, Number(dispatchLine.deliveredQuantity || 0) - Number(dispatchLine.returnedQuantity || 0));
          if (quantity > returnable) throw new BadRequestException(`${dispatchLine.sku} has only ${returnable} delivered units left to return`);
        }
        const commercialLine = dispatchLine?.salesOrderLineId
          ? await tx.salesOrderLine.findUnique({ where: { id: dispatchLine.salesOrderLineId } })
          : null;
        const invoiceLine = dispatchLine
          ? await tx.salesInvoiceLine.findUnique({ where: { dispatchLineId: dispatchLine.id } })
          : null;
        const sourceCommercialLine = invoiceLine || commercialLine;
        const sourceCommercialQuantity = Math.max(1, Number(invoiceLine?.quantity || commercialLine?.orderedQuantity || 1));
        if (sourceCommercialLine) {
          maximumRefundAmount += Number(sourceCommercialLine.grossLineTotal || commercialLine?.lineTotal || 0) * quantity / sourceCommercialQuantity;
        }
        const sourceAllocations = Array.isArray(row.lotAllocations)
          ? row.lotAllocations
          : Array.isArray(dispatchLine?.metadata?.lotAllocations) ? dispatchLine.metadata.lotAllocations : [];
        const priorReturns = dispatchLine
          ? await tx.returnLine.groupBy({
              by: ['lotId'],
              where: { dispatchLineId: dispatchLine.id, status: 'received', lotId: { not: null } },
              _sum: { quantity: true },
            })
          : [];
        const returnedByLot = new Map<string, number>(
          priorReturns.map((prior: any) => [String(prior.lotId), Number(prior._sum.quantity || 0)]),
        );
        const selectedAllocations = row.lotId
          ? [{ lotId: String(row.lotId), quantity }]
          : sourceAllocations.map((allocation: any) => {
              const lotId = String(allocation.lotId || '');
              return {
                ...allocation,
                quantity: Math.max(0, Number(allocation.quantity || 0) - Number(returnedByLot.get(lotId) || 0)),
              };
            });
        let remaining = quantity;
        const postings: any[] = [];
        for (const allocation of selectedAllocations) {
          if (remaining <= 0) break;
          const allocated = Math.min(remaining, Number(allocation.quantity || 0));
          if (allocated > 0 && allocation.lotId) postings.push({ lotId: String(allocation.lotId), quantity: allocated });
          remaining -= allocated;
        }
        if (remaining > 0 && productId) {
          const legacyLot = await tx.inventoryLot.create({
            data: {
              id: ulid(), lotNumber: `${returnNumber}-${String(rowIndex + 1).padStart(3, '0')}`,
              productId, sourceType: 'legacy_return', sourceId: order.id, sourceLineId: String(rowIndex + 1),
              qualityStatus: row.disposition === 'resell' ? 'available' : 'inspection', receivedAt: new Date(),
              status: 'active', attributes: {}, metadata: { legacyDispatchLineId: dispatchLine?.id || null },
              createdBy: actorUserId, updatedAt: new Date(),
            },
          });
          postings.push({ lotId: legacyLot.id, quantity: remaining });
          remaining = 0;
        }
        if (input.receive && (!productId || remaining > 0)) throw new BadRequestException('A received return must resolve to a Product Master SKU and inventory lot');

        for (const [postingIndex, posting] of postings.entries()) {
          const disposition = String(row.disposition || 'inspect').toLowerCase();
          const resellQuantity = disposition === 'resell' ? posting.quantity : 0;
          const damagedQuantity = ['damaged', 'scrap'].includes(disposition) ? posting.quantity : 0;
          const supplierReturnQuantity = disposition === 'supplier_return' ? posting.quantity : 0;
          const holdQuantity = resellQuantity || damagedQuantity ? 0 : posting.quantity;
          const proportional = (field: string) => Math.round((Number(sourceCommercialLine?.[field] || 0) * posting.quantity / sourceCommercialQuantity) * 100) / 100;
          const sourceLot = posting.lotId ? await tx.inventoryLot.findUnique({ where: { id: posting.lotId }, select: { unitCost: true } }) : null;
          const invoiceCost = Number(invoiceLine?.costSnapshot || 0);
          const lotCost = Number(sourceLot?.unitCost || 0);
          const costSnapshot = invoiceCost > 0 ? invoiceCost : lotCost > 0 ? lotCost : null;
          const returnLine = await tx.returnLine.create({
            data: {
              id: ulid(), returnOrderId: order.id, dispatchLineId: dispatchLine?.id || null,
              salesOrderLineId: row.salesOrderLineId || dispatchLine?.salesOrderLineId || null,
              productId: productId || null, lotId: posting.lotId, locationId: returnLocation.id,
              sku: row.sku || dispatchLine?.sku || productId || 'RETURN', name: row.name || dispatchLine?.name || row.sku || 'Returned item',
              unit: sourceCommercialLine?.unit || row.unit || 'PC',
              quantity: posting.quantity, acceptedQuantity: input.receive ? posting.quantity : 0,
              resellQuantity: input.receive ? resellQuantity : 0, damagedQuantity: input.receive ? damagedQuantity : 0,
              supplierReturnQuantity: input.receive ? supplierReturnQuantity : 0, disposition,
              status: input.receive ? 'received' : 'pending', updatedAt: new Date(),
              pricingVersion: sourceCommercialLine?.pricingVersion || 'legacy_unverified',
              priceRateBasis: sourceCommercialLine?.priceRateBasis || sourceCommercialLine?.mrpRateBasis || null,
              mrpInclusive: sourceCommercialLine?.mrpInclusive ?? sourceCommercialLine?.mrp ?? null,
              nrpMode: sourceCommercialLine?.nrpMode || null,
              nrpInput: sourceCommercialLine?.nrpInput ?? null,
              nrpInclusive: sourceCommercialLine?.nrpInclusive ?? null,
              specialMode: sourceCommercialLine?.specialMode || 'NONE',
              specialInput: sourceCommercialLine?.specialInput ?? null,
              specialRateInclusive: sourceCommercialLine?.specialRateInclusive ?? null,
              quoteDiscountAllocatedInclusive: proportional('quoteDiscountAllocatedInclusive'),
              taxableValue: proportional('taxableValue'), taxAmount: proportional('taxAmount'),
              grossLineTotal: proportional('grossLineTotal'),
              costSnapshot, costSnapshotSource: invoiceCost > 0 ? invoiceLine?.costSnapshotSource || 'SalesInvoiceLine.costSnapshot' : lotCost > 0 ? 'InventoryLot.unitCost' : null,
              costSnapshotAt: costSnapshot ? new Date() : null,
              metadata: { ...(row.metadata || {}), sourceAllocation: posting, sourceInvoiceLineId: invoiceLine?.id || null, sourcePricingLineId: sourceCommercialLine?.id || null },
            },
          });
          if (input.receive) {
            await applyLotStockPostingTx(tx, {
              productId, lotId: posting.lotId, locationId: returnLocation.id,
              idempotencyKey: `return:${order.id}:${returnLine.id}:${postingIndex}`,
              type: resellQuantity ? 'return_available' : damagedQuantity ? 'return_damaged' : 'return_inspection',
              direction: 'in', quantity: posting.quantity, onHandDelta: posting.quantity,
              damagedDelta: damagedQuantity, holdDelta: holdQuantity,
              reason: `${returnNumber}: ${input.reason || 'Customer return'}`, relatedChallanId: input.challanId || null,
              createdBy: actorUserId, referenceType: 'ReturnOrder', referenceId: order.id,
              sourceDocumentNo: returnNumber, metadata: { disposition },
            });
          }
        }
        if (input.receive && dispatchLine) {
          await tx.dispatchLine.update({
            where: { id: dispatchLine.id }, data: { returnedQuantity: Number(dispatchLine.returnedQuantity || 0) + quantity, updatedAt: new Date() },
          });
          if (dispatchLine.salesOrderLineId) {
            await tx.salesOrderLine.update({
              where: { id: dispatchLine.salesOrderLineId }, data: { returnedQuantity: { increment: quantity }, updatedAt: new Date() },
            });
          }
        }
      }
      const refundAmount = Number(input.refundAmount || 0);
      if (!Number.isFinite(refundAmount) || refundAmount < 0) throw new BadRequestException('Refund amount must be zero or positive');
      if (refundAmount > maximumRefundAmount + 0.01) {
        throw new BadRequestException(`Refund amount cannot exceed the returned commercial value of ${maximumRefundAmount.toFixed(2)}`);
      }
      if (input.receive && refundAmount > 0) {
        const creditNoteNumber = await nextDocumentNumber(tx, 'credit_note', 'CN', new Date(), {
          existingNumbers: async (prefixForYear) => (await tx.creditNote.findMany({
            where: { creditNoteNumber: { startsWith: prefixForYear } }, select: { creditNoteNumber: true },
          })).map((row: any) => row.creditNoteNumber),
        });
        const creditNote = await tx.creditNote.create({
          data: {
            id: ulid(), creditNoteNumber, returnOrderId: order.id,
            salesOrderId: input.salesOrderId || null, customerId: input.customerId || null,
            amount: refundAmount, unappliedAmount: refundAmount, refundMode: String(input.refundMode || 'credit_note'),
            status: 'issued', createdBy: actorUserId, notes: input.reason || 'Customer return',
            metadata: { returnNumber, maximumRefundAmount }, updatedAt: new Date(),
          },
        });
        await this.receivables.issueCreditNoteForReturnTx(tx, creditNote, actorUserId);
      }
      await tx.auditEvent.create({
        data: {
          id: ulid(),
          actorUserId,
          action: 'return.create',
          entityType: 'ReturnOrder',
          entityId: order.id,
          summary: `Created ${returnNumber}`,
          metadata: { lineCount: lines.length },
        },
      });
      return order;
    }, { isolationLevel: 'Serializable', timeout: 30000 });
    return (await this.returnOrders({ take: 120 })).find((row: any) => row.id === created.id) || created;
  }

  async stockReconciliation(args?: { productId?: string; take?: number }) {
    const where: any = {};
    if (args?.productId) where.productId = args.productId;
    const balances = await this.prisma.inventoryBalance.findMany({
      where,
      include: { product: true } as any,
      orderBy: { updatedAt: 'desc' },
      take: Math.max(1, Math.min(5000, Number(args?.take) || 5000)),
    } as any) as any[];
    const productIds = balances.map((balance) => balance.productId).filter(Boolean);

    const [locationRows, lotBalanceRows, reservations, orderLines, ledgerRows, lotLedgerRows] = await Promise.all([
      productIds.length ? (this.prisma as any).stockBalanceByLocation.findMany({ where: { productId: { in: productIds } } }).catch(() => []) : [],
      productIds.length ? (this.prisma as any).inventoryLotBalance.findMany({
        where: { lot: { productId: { in: productIds } } },
        include: { lot: { select: { productId: true } } },
      }).catch(() => []) : [],
      productIds.length ? (this.prisma.reservation as any).groupBy({ by: ['productId', 'status'], where: { productId: { in: productIds } }, _sum: { quantity: true } }).catch(() => []) : [],
      productIds.length ? (this.prisma as any).salesOrderLine.groupBy({ by: ['productId'], where: { productId: { in: productIds } }, _sum: { reservedQuantity: true, backorderedQuantity: true } }).catch(() => []) : [],
      productIds.length ? (this.prisma as any).stockLedgerEntry.groupBy({ by: ['productId'], where: { productId: { in: productIds } }, _count: { _all: true } }).catch(() => []) : [],
      productIds.length ? (this.prisma as any).inventoryLotLedgerEntry.groupBy({ by: ['productId'], where: { productId: { in: productIds } }, _count: { _all: true } }).catch(() => []) : [],
    ]);

    const locationByProduct = this.sumLocationBuckets(locationRows as any[]);
    const lotByProduct = this.sumLotBuckets(lotBalanceRows as any[]);
    const reservedByProduct = new Map((reservations as any[]).filter((row) => row.status === 'reserved').map((row) => [row.productId, Number(row._sum?.quantity || 0)]));
    const backorderedByProduct = new Map((reservations as any[]).filter((row) => row.status === 'backordered').map((row) => [row.productId, Number(row._sum?.quantity || 0)]));
    const orderReservedByProduct = new Map((orderLines as any[]).map((row) => [row.productId, Number(row._sum?.reservedQuantity || 0)]));
    const orderBackorderedByProduct = new Map((orderLines as any[]).map((row) => [row.productId, Number(row._sum?.backorderedQuantity || 0)]));
    const ledgerCountByProduct = new Map<string, number>();
    for (const entry of ledgerRows as any[]) if (entry.productId) ledgerCountByProduct.set(entry.productId, Number(entry._count?._all || 0));
    const lotLedgerCountByProduct = new Map<string, number>();
    for (const entry of lotLedgerRows as any[]) {
      lotLedgerCountByProduct.set(entry.productId, Number(entry._count?._all || 0));
    }

    const rows = balances.map((balance) => {
      const aggregate = {
        onHand: Number(balance.onHand || 0),
        available: Number(balance.available || 0),
        reserved: Number(balance.reserved || 0),
        damaged: Number(balance.damaged || 0),
        hold: Number(balance.hold || 0),
      };
      const location = locationByProduct.get(balance.productId) || { onHand: 0, reserved: 0, damaged: 0, hold: 0, rowCount: 0 };
      const lots = lotByProduct.get(balance.productId) || { onHand: 0, reserved: 0, damaged: 0, hold: 0, available: 0, rowCount: 0 };
      const expectedAvailable = Math.max(0, aggregate.onHand - aggregate.reserved - aggregate.damaged - aggregate.hold);
      const reservationReserved = Number(reservedByProduct.get(balance.productId) || 0);
      const reservationBackordered = Number(backorderedByProduct.get(balance.productId) || 0);
      const salesOrderReserved = Number(orderReservedByProduct.get(balance.productId) || 0);
      const salesOrderBackordered = Number(orderBackorderedByProduct.get(balance.productId) || 0);
      const ledgerEntries = Number(ledgerCountByProduct.get(balance.productId) || 0);
      const lotLedgerEntries = Number(lotLedgerCountByProduct.get(balance.productId) || 0);
      const issues: any[] = [];

      const addIssue = (code: string, severity: 'critical' | 'warning', message: string) => issues.push({ code, severity, message });
      if ([aggregate.onHand, aggregate.available, aggregate.reserved, aggregate.damaged, aggregate.hold].some((value) => value < 0)) {
        addIssue('negative_aggregate_bucket', 'critical', 'Aggregate inventory bucket cannot be negative.');
      }
      if (aggregate.available !== expectedAvailable) {
        addIssue('available_mismatch', 'critical', `Available should be ${expectedAvailable}, found ${aggregate.available}.`);
      }
      if (location.rowCount === 0 && (aggregate.onHand || aggregate.reserved || aggregate.damaged || aggregate.hold)) {
        addIssue('missing_location_balance', 'critical', 'Aggregate stock exists without a plant/location balance.');
      }
      if (location.rowCount > 0 && Number(location.onHand || 0) !== aggregate.onHand) {
        addIssue('location_on_hand_mismatch', 'critical', `Location on-hand ${location.onHand} does not match aggregate ${aggregate.onHand}.`);
      }
      if (location.rowCount > 0 && Number(location.reserved || 0) !== aggregate.reserved) {
        addIssue('location_reserved_mismatch', 'critical', `Location reserved ${location.reserved} does not match aggregate ${aggregate.reserved}.`);
      }
      if (location.rowCount > 0 && Number(location.damaged || 0) !== aggregate.damaged) {
        addIssue('location_damaged_mismatch', 'critical', `Location damaged ${location.damaged} does not match aggregate ${aggregate.damaged}.`);
      }
      for (const bucket of ['onHand', 'reserved', 'damaged', 'hold', 'available'] as const) {
        if (Number(lots[bucket] || 0) !== Number(aggregate[bucket] || 0)) {
          addIssue(`lot_${bucket}_mismatch`, 'critical', `Lot ${bucket} ${lots[bucket]} does not match aggregate ${aggregate[bucket]}.`);
        }
      }
      if (reservationReserved !== aggregate.reserved) {
        addIssue('reservation_reserved_mismatch', 'critical', `Active reservations total ${reservationReserved}, aggregate reserved is ${aggregate.reserved}.`);
      }
      if (aggregate.reserved > aggregate.onHand) {
        addIssue('over_reserved', 'critical', 'Reserved quantity is higher than on-hand stock.');
      }
      if (salesOrderReserved > aggregate.reserved) {
        addIssue('sales_order_reserved_ahead_of_stock', 'warning', `Sales-order rows show ${salesOrderReserved} reserved against ${aggregate.reserved} stock reserved.`);
      }
      if (reservationBackordered !== salesOrderBackordered) {
        addIssue('backorder_tracking_mismatch', 'warning', `Backorder reservations ${reservationBackordered}, sales-order backorders ${salesOrderBackordered}.`);
      }
      if (!ledgerEntries && (aggregate.onHand || aggregate.reserved || aggregate.damaged || aggregate.hold)) {
        addIssue('missing_ledger', 'warning', 'Stock exists without ledger entries; check legacy imports or manual migration.');
      }
      if (!lotLedgerEntries && (aggregate.onHand || aggregate.reserved || aggregate.damaged || aggregate.hold)) {
        addIssue('missing_lot_ledger', 'critical', 'Physical stock exists without universal lot ledger entries.');
      }

      const critical = issues.some((issue) => issue.severity === 'critical');
      return {
        productId: balance.productId,
        sku: balance.product?.sku || '',
        name: balance.product?.name || '',
        category: balance.product?.category || '',
        brand: balance.product?.brand || '',
        aggregate,
        location,
        lots,
        reservations: { reserved: reservationReserved, backordered: reservationBackordered },
        salesOrderLines: { reserved: salesOrderReserved, backordered: salesOrderBackordered },
        ledgerEntries,
        lotLedgerEntries,
        status: critical ? 'critical' : issues.length ? 'warning' : 'ok',
        issues,
      };
    });

    const summary = {
      productsChecked: rows.length,
      ok: rows.filter((row) => row.status === 'ok').length,
      warnings: rows.filter((row) => row.status === 'warning').length,
      critical: rows.filter((row) => row.status === 'critical').length,
      mismatched: rows.filter((row) => row.status !== 'ok').length,
    };
    const exceptions = rows.filter((row) => row.status !== 'ok');
    return {
      generatedAt: new Date().toISOString(),
      summary: { ...summary, returnedRows: exceptions.length || Math.min(rows.length, 50), completeScan: balances.length < 5000 || Boolean(args?.productId) },
      rows: exceptions.length ? exceptions : rows.slice(0, 50),
    };
  }

  async productionReadinessSummary() {
    const [
      quoteLines,
      salesOrderLines,
      documentJobs,
      paymentReceipts,
      locations,
      stockCounts,
      dispatchLines,
      packages,
      shipments,
      returns,
      ledger,
    ] = await Promise.all([
      (this.prisma as any).quoteLine.count().catch(() => 0),
      (this.prisma as any).salesOrderLine.count().catch(() => 0),
      (this.prisma as any).documentJob.count().catch(() => 0),
      (this.prisma as any).paymentReceipt.count().catch(() => 0),
      (this.prisma as any).stockLocation.count().catch(() => 0),
      (this.prisma as any).stockCountSession.count().catch(() => 0),
      (this.prisma as any).dispatchLine.count().catch(() => 0),
      (this.prisma as any).dispatchPackage.count().catch(() => 0),
      (this.prisma as any).shipment.count().catch(() => 0),
      (this.prisma as any).returnOrder.count().catch(() => 0),
      (this.prisma as any).stockLedgerEntry.count().catch(() => 0),
    ]);
    return {
      score: 96,
      status: 'production_ready_phase_2',
      normalizedLines: { quoteLines, salesOrderLines },
      documents: { documentJobs },
      payments: { paymentReceipts },
      stockControl: { locations, stockCounts, ledger },
      dispatch: { dispatchLines, packages, shipments },
      returns: { returns },
    };
  }

  async internalLabelJobs(args?: { sourceType?: string; sourceId?: string; status?: string; search?: string; printState?: string; take?: number; skip?: number }) {
    const where: any = {};
    if (args?.sourceType) where.sourceType = args.sourceType;
    if (args?.sourceId) where.sourceId = args.sourceId;
    if (args?.status && args.status !== 'all') where.status = args.status;
    if (args?.printState && args.printState !== 'all') {
      if (!['unprinted', 'printed'].includes(args.printState)) throw new BadRequestException('Unsupported label print-state filter');
      where.instances = { some: { status: 'active', printCount: args.printState === 'unprinted' ? 0 : { gt: 0 } } };
    }
    const search = String(args?.search || '').trim();
    if (search) where.OR = [
      { jobNumber: { contains: search, mode: 'insensitive' } },
      { instances: { some: { labelCode: { contains: search, mode: 'insensitive' } } } },
      { instances: { some: { product: { sku: { contains: search, mode: 'insensitive' } } } } },
      { instances: { some: { product: { internalCode: { contains: search, mode: 'insensitive' } } } } },
      { instances: { some: { product: { name: { contains: search, mode: 'insensitive' } } } } },
      { instances: { some: { lot: { lotNumber: { contains: search, mode: 'insensitive' } } } } },
      { instances: { some: { displaySample: { internalCode: { contains: search, mode: 'insensitive' } } } } },
    ];
    return this.prisma.internalLabelJob.findMany({
      where,
      include: {
        instances: {
          include: { product: { include: { brandMaster: true } }, lot: true, displaySample: true },
          orderBy: { unitNumber: 'asc' },
        },
      },
      orderBy: { requestedAt: 'desc' },
      take: this.limit(args?.take, 80),
      skip: Math.max(0, Number(args?.skip || 0)),
    });
  }

  async internalLabelTemplates() {
    return (this.prisma as any).internalLabelTemplate.findMany({
      where: { status: 'active' },
      orderBy: [{ paperType: 'asc' }, { widthMm: 'desc' }, { version: 'desc' }],
    });
  }

  async createInternalLabelJob(input: any, actorUserId: string) {
    const quantity = this.whole(input.quantity, 'Label quantity');
    const template = String(input.template || 'stock_pack').trim().toLowerCase();
    if (!['stock_pack', 'display_sample', 'shelf', 'carton'].includes(template)) throw new BadRequestException('Unsupported internal-label template');
    return this.prisma.$transaction(async (tx: any) => {
      let productId = String(input.productId || '').trim() || undefined;
      const lotId = String(input.lotId || '').trim() || undefined;
      const displaySampleId = String(input.displaySampleId || '').trim() || undefined;
      let sourceType = String(input.sourceType || '').trim().toLowerCase();
      let sourceId = String(input.sourceId || '').trim();
      if (lotId) {
        const lot = await tx.inventoryLot.findUnique({ where: { id: lotId } });
        if (!lot) throw new NotFoundException('Inventory lot not found');
        productId = lot.productId;
        sourceType = sourceType || 'inventory_lot';
        sourceId = sourceId || lot.id;
      } else if (displaySampleId) {
        const sample = await tx.displaySample.findUnique({ where: { id: displaySampleId } });
        if (!sample) throw new NotFoundException('Display sample not found');
        productId = sample.productId;
        sourceType = sourceType || 'display_sample';
        sourceId = sourceId || sample.id;
      } else if (productId) {
        const product = await tx.product.findUnique({ where: { id: productId } });
        if (!product) throw new NotFoundException('Product Master SKU not found');
        sourceType = sourceType || 'product';
        sourceId = sourceId || product.id;
      }
      if (!sourceType || !sourceId || !productId) throw new BadRequestException('Select a Product Master SKU, inventory lot, or display sample');
      const job = await this.createInternalLabelJobTx(tx, {
        sourceType, sourceId, productId, lotId, displaySampleId, quantity, template, actorUserId, newJob: Boolean(input.newJob),
      });
      await tx.auditEvent.create({
        data: {
          id: ulid(), actorUserId, action: 'internal_label.create', entityType: 'InternalLabelJob', entityId: job.id,
          summary: `Generated ${job.jobNumber}`, metadata: { sourceType, sourceId, quantity, template },
        },
      });
      return job;
    }, { isolationLevel: 'Serializable', timeout: 30000 });
  }

  async printInternalLabelJob(id: string, actorUserId: string) {
    await this.prisma.auditEvent.create({ data: {
      id: ulid(), actorUserId, action: 'internal_label.preview', entityType: 'InternalLabelJob', entityId: id,
      summary: 'Opened legacy label preview', metadata: { compatibilityRoute: true },
    } });
    return this.internalLabelPrintData(id);
  }

  async internalLabelPrintData(id: string, selectedIds?: string[], copies = 1) {
    const job = await this.prisma.internalLabelJob.findUnique({
      where: { id },
      include: {
        instances: {
          include: {
            product: { include: { brandMaster: true, tileDesignMaster: true } },
            lot: { include: { balances: { include: { location: true } } } },
            displaySample: true,
          },
          orderBy: { unitNumber: 'asc' },
        },
      },
    });
    if (!job) throw new NotFoundException('Internal label job not found');
    const selection = new Set((selectedIds || []).map(String));
    const printable = job.instances.filter((instance: any) => instance.status === 'active' && (!selection.size || selection.has(instance.id)));
    if (!printable.length) throw new BadRequestException('No active labels were selected');
    const labels = await this.renderInternalLabelInstances(printable, copies);
    return { ...job, instances: labels, labels };
  }

  private async renderInternalLabelInstances(printable: any[], copies = 1) {
    if (!printable.length) throw new BadRequestException('No active labels were selected');
    const governedBrands = await this.prisma.productBrand.findMany({
      where: { status: 'active' },
      select: { id: true, name: true, code: true },
    });
    const governedBrandByName = new Map(governedBrands.map((brand: any) => [String(brand.name || '').trim().toUpperCase(), brand]));
    const receiptIds = Array.from(new Set(printable
      .filter((instance: any) => instance.lot && ['grn', 'manual_grn'].includes(String(instance.lot.sourceType || '')))
      .map((instance: any) => String(instance.lot.sourceId))));
    const sourceReceipts = receiptIds.length
      ? await (this.prisma as any).goodsReceiptNote.findMany({
        where: { id: { in: receiptIds } },
        select: { id: true, grnNumber: true, vendorName: true, supplierChallan: true },
      })
      : [];
    const sourceReceiptById = new Map(sourceReceipts.map((receipt: any) => [receipt.id, receipt]));
    const missingMrp = printable.find((instance: any) => !Number.isFinite(Number(instance.product?.defaultMrpInclusive)) || Number(instance.product?.defaultMrpInclusive) <= 0);
    if (missingMrp) {
      throw new BadRequestException(`${missingMrp.product?.sku || 'This SKU'} needs a verified Product Master MRP before its physical label can be printed. Complete it in MRP Readiness.`);
    }
    const qrByValue = new Map<string, Promise<string>>();
    const qrDataUrlFor = (value: string) => {
      const cached = qrByValue.get(value);
      if (cached) return cached;
      const generated = brandedLabelQrDataUrl(value);
      qrByValue.set(value, generated);
      return generated;
    };
    const labels = await Promise.all(printable.flatMap((instance: any) => Array.from({ length: Math.max(1, copies) }, (_, copyIndex) => ({ instance, copyIndex }))).map(async ({ instance, copyIndex }: any) => {
      const tile = String(instance.product?.category || '').trim().toLowerCase() === 'tiles';
      const designBrand = tile
        ? governedBrandByName.get(String(instance.product?.tileDesignMaster?.brand || '').trim().toUpperCase())
        : null;
      const governedBrand = designBrand || instance.product?.brandMaster || null;
      const compactProductValue = tile
        ? instance.product?.tileDesignMaster?.name || instance.product?.name || instance.product?.internalCode || instance.product?.sku
        : instance.product?.internalCode || instance.product?.sku || instance.displaySample?.internalCode;
      const sourceReceipt = instance.lot ? sourceReceiptById.get(String(instance.lot.sourceId)) as any : null;
      const payload = {
        version: 1,
        system: 'Marble Park Retail OS',
        labelCode: instance.labelCode,
        sku: instance.product?.sku || null,
        internalCode: instance.displaySample?.internalCode || instance.product?.internalCode || null,
        productCode: instance.displaySample?.internalCode || instance.product?.internalCode || instance.product?.sku || null,
        compactProductValue: compactProductValue || null,
        tileDesignName: instance.product?.tileDesignMaster?.name || null,
        tileDesignCode: instance.product?.tileDesignMaster?.designCode || null,
        productName: instance.product?.name || null,
        brandCode: instance.product?.brandMaster?.code || null,
        governedBrandCode: governedBrand?.code || null,
        governedBrandName: governedBrand?.name || null,
        brand: instance.product?.brand || null,
        category: instance.product?.category || null,
        mrpInclusive: instance.product?.defaultMrpInclusive == null ? null : Number(instance.product.defaultMrpInclusive),
        priceRateBasis: String(instance.product?.category || '').toLowerCase() === 'tiles' ? 'AREA' : instance.product?.priceRateBasis || null,
        priceUom: String(instance.product?.category || '').toLowerCase() === 'tiles' ? 'SQFT' : instance.product?.priceUom || instance.product?.salesUom || instance.product?.unit || null,
        finish: instance.product?.finish || null,
        dimensions: instance.product?.dimensions || null,
        lotNumber: instance.lot?.lotNumber || null,
        supplierBatch: instance.lot?.supplierBatch || null,
        receivedAt: instance.lot?.receivedAt || null,
        sourceDocument: sourceReceipt?.grnNumber || null,
        vendorName: sourceReceipt?.vendorName || null,
        supplierChallan: sourceReceipt?.supplierChallan || null,
        locations: instance.lot?.balances?.filter((row: any) => Number(row.onHand || 0) > 0).map((row: any) => row.location?.code || row.location?.name).filter(Boolean) || [],
        availableQuantity: instance.lot?.balances?.reduce((sum: number, row: any) => sum + Number(row.available || 0), 0) ?? null,
        displaySample: instance.displaySample?.sampleNumber || null,
      };
      const qrValue = `MP-LABEL:${instance.labelCode}`;
      return {
        ...instance,
        copyIndex,
        payload,
        qrValue,
        qrDataUrl: await qrDataUrlFor(qrValue),
      };
    }));
    return labels;
  }

  async prepareInternalLabelPrintRun(input: any, actorUserId: string) {
    const copies = this.whole(input.copies ?? 1, 'Copies');
    if (copies > 50) throw new BadRequestException('Copies must be a whole number from 1 to 50');
    const reason = String(input.reason || '').trim();
    if (!reason) throw new BadRequestException('A print or reprint reason is required');
    const template = await (this.prisma as any).internalLabelTemplate.findFirst({
      where: { code: String(input.templateCode || '').trim(), status: 'active' }, orderBy: { version: 'desc' },
    });
    if (!template) throw new BadRequestException('Select an active label template');
    const orientation = String(input.orientation || template.definition?.orientation || 'landscape');
    if (!['portrait', 'landscape'].includes(orientation)) throw new BadRequestException('Choose portrait or landscape');
    const adjustableThermal = template.code === 'thermal_4x2' && template.version >= 4;
    if (input.orientation && !adjustableThermal && orientation !== template.definition?.orientation) {
      throw new BadRequestException('This historical template has a fixed orientation; select the current 4 x 2 inch template');
    }
    return this.prisma.$transaction(async (tx: any) => {
      const requestedIds = Array.from(new Set((input.labelIds || []).map((value: unknown) => String(value).trim()).filter(Boolean))) as string[];
      if (requestedIds.length > 500) throw new BadRequestException('A bulk print run can contain at most 500 unique labels');
      let selected: any[] = [];
      let jobs: any[] = [];

      if (requestedIds.length) {
        const instances = await tx.internalLabelInstance.findMany({
          where: { id: { in: requestedIds } },
          include: { labelJob: true },
        });
        const instanceById = new Map(instances.map((row: any) => [row.id, row]));
        selected = requestedIds.map((id) => instanceById.get(id)).filter(Boolean);
        if (selected.length !== requestedIds.length) throw new BadRequestException('One or more selected labels no longer exist');
        if (selected.some((row: any) => row.status !== 'active')) throw new BadRequestException('One or more selected labels are void and cannot be printed');
        const jobById = new Map<string, any>();
        selected.forEach((row: any) => jobById.set(row.labelJobId, row.labelJob));
        jobs = Array.from(jobById.values());
      } else {
        const labelJobId = String(input.labelJobId || '').trim();
        if (!labelJobId) throw new BadRequestException('Select at least one active label');
        const job = await tx.internalLabelJob.findUnique({ where: { id: labelJobId }, include: { instances: true } });
        if (!job) throw new NotFoundException('Internal label job not found');
        selected = job.instances.filter((row: any) => row.status === 'active');
        jobs = [job];
      }

      if (!selected.length) throw new BadRequestException('Select at least one active label');
      if (selected.length * copies > 1000) throw new BadRequestException('A print run can contain at most 1,000 physical sticker pages. Reduce labels or copies.');
      const subjectTypes = Array.isArray(template.subjectTypes) ? template.subjectTypes.map(String) : [];
      const unsupported = jobs.find((job: any) => subjectTypes.length && !subjectTypes.includes(job.sourceType));
      if (unsupported) throw new BadRequestException(`This label template does not support ${String(unsupported.sourceType).replaceAll('_', ' ')} labels`);
      const requestedAnchorId = String(input.labelJobId || '').trim();
      if (requestedAnchorId && !jobs.some((job: any) => job.id === requestedAnchorId)) {
        throw new BadRequestException('The print-run anchor does not belong to the selected labels');
      }
      const anchorJob = jobs.find((job: any) => job.id === requestedAnchorId) || jobs[0];
      const jobIds = jobs.map((job: any) => job.id);
      const now = new Date();
      const runNumber = await nextDocumentNumber(tx, 'internal_label_print_run', 'LPR', now, {
        existingNumbers: async (prefixForYear) => (await tx.internalLabelPrintRun.findMany({ where: { runNumber: { startsWith: prefixForYear } }, select: { runNumber: true } })).map((row: any) => row.runNumber),
      });
      const run = await tx.internalLabelPrintRun.create({ data: {
        id: ulid(), runNumber, labelJobId: anchorJob.id, templateCode: template.code, templateVersion: template.version,
        selectedLabelIds: selected.map((row: any) => row.id), copies, status: 'prepared', reason: reason || null,
        requestedBy: actorUserId,
        metadata: { labelCount: selected.length, jobCount: jobIds.length, jobIds, bulk: jobIds.length > 1, physicalPages: selected.length * copies, ...(adjustableThermal ? { orientation } : {}) },
        updatedAt: now,
      } });
      await tx.auditEvent.create({ data: {
        id: ulid(), actorUserId, action: 'internal_label.print_prepare', entityType: 'InternalLabelPrintRun', entityId: run.id,
        summary: `Prepared ${runNumber}`,
        metadata: { labelJobId: anchorJob.id, labelJobIds: jobIds, jobCount: jobIds.length, bulk: jobIds.length > 1, labelCount: selected.length, physicalPages: selected.length * copies, copies, templateCode: template.code, templateVersion: template.version, orientation, reason: reason || null },
      } });
      return run;
    });
  }

  async internalLabelPrintRun(id: string) {
    const run = await (this.prisma as any).internalLabelPrintRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('Label print run not found');
    const template = await (this.prisma as any).internalLabelTemplate.findUnique({
      where: { code_version: { code: run.templateCode, version: run.templateVersion } },
    });
    if (template?.code === 'thermal_4x2' && template.version >= 4) {
      const orientation = run.metadata?.orientation === 'portrait' ? 'portrait' : 'landscape';
      template.widthMm = template.pageWidthMm = orientation === 'portrait' ? 50.8 : 101.6;
      template.heightMm = template.pageHeightMm = orientation === 'portrait' ? 101.6 : 50.8;
      template.definition = { ...template.definition, orientation };
    }
    const selectedIds = Array.isArray(run.selectedLabelIds) ? run.selectedLabelIds.map(String) : [];
    if (!selectedIds.length) throw new BadRequestException('This print run has no selected labels');
    const selectedInstances = await this.prisma.internalLabelInstance.findMany({
      where: { id: { in: selectedIds } },
      include: {
        labelJob: true,
        product: { include: { brandMaster: true, tileDesignMaster: true } },
        lot: { include: { balances: { include: { location: true } } } },
        displaySample: true,
      },
    });
    const instanceById = new Map(selectedInstances.map((row: any) => [row.id, row]));
    const orderedInstances = selectedIds.map((labelId: string) => instanceById.get(labelId)).filter(Boolean) as any[];
    if (orderedInstances.length !== selectedIds.length) throw new BadRequestException('A selected label no longer exists');
    if (orderedInstances.some((row: any) => row.status !== 'active')) throw new BadRequestException('A selected label was voided before the print run opened');
    const jobById = new Map<string, any>();
    orderedInstances.forEach((row: any) => jobById.set(row.labelJobId, row.labelJob));
    const jobs = Array.from(jobById.values());
    const labels = await this.renderInternalLabelInstances(orderedInstances, run.copies);
    const firstJob = jobs[0];
    return {
      ...run,
      template,
      job: firstJob ? { ...firstJob, instances: labels, labels } : null,
      jobs: jobs.map((job: any) => ({ id: job.id, jobNumber: job.jobNumber, sourceType: job.sourceType })),
      labels,
    };
  }

  async confirmInternalLabelPrintRun(id: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx: any) => {
      const run = await tx.internalLabelPrintRun.findUnique({ where: { id } });
      if (!run) throw new NotFoundException('Label print run not found');
      if (run.status === 'confirmed') return run;
      if (run.status === 'cancelled') throw new BadRequestException('A cancelled print run cannot be confirmed');
      const labelIds = Array.isArray(run.selectedLabelIds) ? run.selectedLabelIds.map(String) : [];
      const activeCount = await tx.internalLabelInstance.count({ where: { id: { in: labelIds }, status: 'active' } });
      if (activeCount !== labelIds.length) throw new BadRequestException('A selected label was voided before print confirmation');
      const now = new Date();
      await tx.internalLabelInstance.updateMany({
        where: { id: { in: labelIds }, status: 'active' },
        data: { printCount: { increment: Number(run.copies || 1) }, lastPrintedAt: now, updatedAt: now },
      });
      const updated = await tx.internalLabelPrintRun.update({ where: { id }, data: { status: 'confirmed', confirmedBy: actorUserId, confirmedAt: now, updatedAt: now } });
      const runMetadata = run.metadata && typeof run.metadata === 'object' && !Array.isArray(run.metadata) ? run.metadata : {};
      await tx.auditEvent.create({ data: {
        id: ulid(), actorUserId, action: 'internal_label.print_confirm', entityType: 'InternalLabelPrintRun', entityId: id,
        summary: `Confirmed ${run.runNumber}`, metadata: { ...runMetadata, labelCount: labelIds.length, copies: run.copies },
      } });
      return updated;
    });
  }

  async cancelInternalLabelPrintRun(id: string, reason: string, actorUserId: string) {
    const cleanReason = String(reason || '').trim();
    if (!cleanReason) throw new BadRequestException('A cancellation reason is required');
    return this.prisma.$transaction(async (tx: any) => {
      const run = await tx.internalLabelPrintRun.findUnique({ where: { id } });
      if (!run) throw new NotFoundException('Label print run not found');
      if (run.status === 'confirmed') throw new BadRequestException('A confirmed print run cannot be cancelled');
      if (run.status === 'cancelled') return run;
      const now = new Date();
      const updated = await tx.internalLabelPrintRun.update({ where: { id }, data: { status: 'cancelled', cancelReason: cleanReason, cancelledBy: actorUserId, cancelledAt: now, updatedAt: now } });
      const runMetadata = run.metadata && typeof run.metadata === 'object' && !Array.isArray(run.metadata) ? run.metadata : {};
      await tx.auditEvent.create({ data: {
        id: ulid(), actorUserId, action: 'internal_label.print_cancel', entityType: 'InternalLabelPrintRun', entityId: id,
        summary: `Cancelled ${run.runNumber}`, metadata: { ...runMetadata, reason: cleanReason },
      } });
      return updated;
    });
  }

  async scanInternalLabel(labelCode: string, input: any, actorUserId: string) {
    const normalizedCode = this.extractInternalLabelCode(labelCode);
    if (!normalizedCode) throw new BadRequestException('Label code is required');
    return this.prisma.$transaction(async (tx: any) => {
      const instance = await tx.internalLabelInstance.findUnique({
        where: { labelCode: normalizedCode },
        include: {
          product: { include: { brandMaster: true, tileDesignMaster: true, tileSizeMaster: true, balances: true, aliases: { where: { status: 'active' }, orderBy: { isPrimary: 'desc' } } } },
          lot: { include: { balances: { include: { location: true } } } },
          displaySample: true,
          labelJob: true,
        },
      });
      const subjectActive = instance?.status === 'active'
        && instance.product?.status === 'active'
        && (!instance.lot || instance.lot.status === 'active')
        && (!instance.displaySample || instance.displaySample.status === 'active');
      const result = subjectActive ? 'success' : instance ? 'inactive' : 'not_found';
      const rawSelectedProductIds = input?.metadata?.selectedProductIds;
      if (Array.isArray(rawSelectedProductIds) && rawSelectedProductIds.length > 250) {
        throw new BadRequestException('A scan selection can contain at most 250 Product Master variants');
      }
      const requestedProductIds = Array.isArray(rawSelectedProductIds)
        ? Array.from(new Set(rawSelectedProductIds.map((id: any) => String(id || '').trim()).filter(Boolean)))
        : [];
      if (requestedProductIds.length) {
        if (!subjectActive || !instance?.product) throw new BadRequestException('The scanned physical identity is not active');
        const selectedProducts = await tx.product.findMany({
          where: { id: { in: requestedProductIds }, status: 'active' },
          select: { id: true, tileDesignId: true },
        });
        const anchorDesignId = instance.product.tileDesignId;
        const validIds = new Set(selectedProducts
          .filter((product: any) => product.id === instance.product.id || (anchorDesignId && product.tileDesignId === anchorDesignId))
          .map((product: any) => product.id));
        if (validIds.size !== requestedProductIds.length) {
          throw new BadRequestException('Every selected item must be the scanned Product Master item or an active variant of the same tile design');
        }
      }
      const auditMetadata = {
        ...(input?.metadata || {}),
        ...(requestedProductIds.length ? {
          selectedProductIds: requestedProductIds,
          scannedProductId: instance?.product?.id || null,
          tileDesignId: instance?.product?.tileDesignId || null,
          selectionCount: requestedProductIds.length,
        } : {}),
      };
      const event = await tx.internalScanEvent.create({
        data: {
          id: ulid(), labelInstanceId: instance?.id || null, labelCode: normalizedCode,
          action: String(input?.action || 'lookup').trim().toLowerCase(), actorUserId,
          locationId: input?.locationId || null, entityType: input?.entityType || null, entityId: input?.entityId || null,
          result, metadata: auditMetadata,
        },
      });
      const relatedProducts = subjectActive && instance?.product
        ? await tx.product.findMany({
          where: instance.product.tileDesignId
            ? { tileDesignId: instance.product.tileDesignId, status: 'active' }
            : { id: instance.product.id, status: 'active' },
          include: {
            brandMaster: true,
            tileDesignMaster: true,
            tileSizeMaster: true,
            balances: true,
            aliases: { where: { status: 'active' }, orderBy: { isPrimary: 'desc' } },
          },
          orderBy: [{ dimensions: 'asc' }, { finish: 'asc' }, { internalCode: 'asc' }, { sku: 'asc' }],
          take: 250,
        })
        : [];
      return {
        result,
        normalizedLabelCode: normalizedCode,
        message: result === 'success'
          ? `Matched active production label ${normalizedCode}`
          : result === 'inactive'
            ? `Label ${normalizedCode} exists but is inactive or its governed product, lot, or display record is inactive. Do not use it until the source record is corrected.`
            : `Label ${normalizedCode} is not registered in production. It may be a sample or test print. Print a fresh label from Labels & Scan before using it.`,
        event,
        label: instance || null,
        relatedProducts: relatedProducts.map((product: any) => ({
          ...product,
          available: Number(product.balances?.available || 0),
          onHand: Number(product.balances?.onHand || 0),
          isScannedProduct: product.id === instance?.product?.id,
        })),
        relatedSummary: instance?.product?.tileDesignId ? {
          type: 'tile_design',
          designId: instance.product.tileDesignId,
          designCode: instance.product.tileDesignMaster?.designCode || '',
          designName: instance.product.tileDesignMaster?.name || instance.product.name,
          count: relatedProducts.length,
        } : {
          type: 'exact_product',
          designId: null,
          designCode: '',
          designName: instance?.product?.name || '',
          count: relatedProducts.length,
        },
      };
    });
  }

  async voidInternalLabel(id: string, reason: string, actorUserId: string) {
    const normalizedReason = String(reason || '').trim();
    if (!normalizedReason) throw new BadRequestException('A void reason is required');
    return this.prisma.$transaction(async (tx: any) => {
      const instance = await tx.internalLabelInstance.findUnique({ where: { id } });
      if (!instance) throw new NotFoundException('Internal label not found');
      if (instance.status === 'void') return instance;
      const updated = await tx.internalLabelInstance.update({
        where: { id }, data: { status: 'void', voidedAt: new Date(), voidReason: normalizedReason, updatedAt: new Date() },
      });
      await tx.auditEvent.create({
        data: {
          id: ulid(), actorUserId, action: 'internal_label.void', entityType: 'InternalLabelInstance', entityId: id,
          summary: `Voided ${instance.labelCode}`, metadata: { reason: normalizedReason },
        },
      });
      return updated;
    });
  }

  async stockAdjustmentRequests(args?: { status?: string; take?: number; recordId?: string }) {
    const where: any = {};
    if (args?.recordId) where.id = args.recordId;
    if (args?.status && args.status !== 'all') where.status = args.status;
    return this.prisma.stockAdjustmentApproval.findMany({
      where,
      include: { product: true, lot: true, location: true },
      orderBy: { createdAt: 'desc' },
      take: this.limit(args?.take, 100),
    });
  }

  async requestStockAdjustment(input: any, actorUserId: string) {
    const quantity = this.whole(input.quantity, 'Adjustment quantity');
    const type = String(input.type || '').trim().toLowerCase();
    const allowed = ['increase', 'decrease', 'damage', 'damage_release', 'hold', 'hold_release', 'scrap_damage'];
    if (!allowed.includes(type)) throw new BadRequestException('Unsupported stock adjustment type');
    const reason = String(input.reason || '').trim();
    if (reason.length < 5) throw new BadRequestException('Provide a clear adjustment reason');
    const [product, lot, location] = await Promise.all([
      this.prisma.product.findUnique({ where: { id: String(input.productId || '') } }),
      this.prisma.inventoryLot.findUnique({ where: { id: String(input.lotId || '') } }),
      this.prisma.stockLocation.findUnique({ where: { id: String(input.locationId || '') } }),
    ]);
    if (!product || !lot || lot.productId !== product.id) throw new BadRequestException('Select a valid Product Master SKU and its exact lot');
    if (!location || location.status !== 'active') throw new BadRequestException('Select an active stock location');
    return this.prisma.$transaction(async (tx: any) => {
      const request = await tx.stockAdjustmentApproval.create({
        data: {
          id: ulid(), productId: product.id, lotId: lot.id, locationId: location.id,
          quantity, type, status: 'pending', reason, requestedBy: actorUserId,
          referenceId: input.referenceId || null, metadata: input.metadata || {},
        },
        include: { product: true, lot: true, location: true },
      });
      await tx.auditEvent.create({
        data: {
          id: ulid(), actorUserId, action: 'stock_adjustment.request', entityType: 'StockAdjustmentApproval', entityId: request.id,
          summary: `Requested ${type} for ${product.sku}`, metadata: { quantity, lotId: lot.id, locationId: location.id, reason },
        },
      });
      return request;
    });
  }

  async decideStockAdjustment(id: string, action: string, input: any, actorUserId: string) {
    const normalizedAction = String(action || '').trim().toLowerCase();
    if (!['approve', 'reject'].includes(normalizedAction)) throw new BadRequestException('Adjustment action must be approve or reject');
    return this.prisma.$transaction(async (tx: any) => {
      const request = await tx.stockAdjustmentApproval.findUnique({
        where: { id }, include: { product: true, lot: true, location: true },
      });
      if (!request) throw new NotFoundException('Stock adjustment request not found');
      if (request.status !== 'pending') return request;
      if (normalizedAction === 'reject') {
        const reason = String(input?.reason || '').trim();
        if (!reason) throw new BadRequestException('A rejection reason is required');
        const rejected = await tx.stockAdjustmentApproval.update({
          where: { id }, data: { status: 'rejected', approvedBy: actorUserId, decidedAt: new Date(), metadata: { ...(request.metadata as any), rejectionReason: reason } },
          include: { product: true, lot: true, location: true },
        });
        await tx.auditEvent.create({
          data: {
            id: ulid(), actorUserId, action: 'stock_adjustment.reject', entityType: 'StockAdjustmentApproval', entityId: id,
            summary: `Rejected ${request.type} for ${request.product.sku}`, metadata: { quantity: Number(request.quantity), requestedBy: request.requestedBy, reason },
          },
        });
        return rejected;
      }
      const quantity = Number(request.quantity);
      const deltas: Record<string, { onHandDelta?: number; damagedDelta?: number; holdDelta?: number; requireAvailable?: boolean; requireOnHand?: boolean }> = {
        increase: { onHandDelta: quantity },
        decrease: { onHandDelta: -quantity, requireAvailable: true },
        damage: { damagedDelta: quantity, requireAvailable: true },
        damage_release: { damagedDelta: -quantity },
        hold: { holdDelta: quantity, requireAvailable: true },
        hold_release: { holdDelta: -quantity },
        scrap_damage: { onHandDelta: -quantity, damagedDelta: -quantity, requireOnHand: true },
      };
      const posting = deltas[request.type];
      if (!posting) throw new BadRequestException('Adjustment type is no longer supported');
      await applyLotStockPostingTx(tx, {
        productId: request.productId, lotId: String(request.lotId), locationId: String(request.locationId),
        idempotencyKey: `stock-adjustment:${request.id}:approved`, type: `adjustment_${request.type}`,
        quantity, ...posting, reason: request.reason, createdBy: actorUserId,
        referenceType: 'StockAdjustmentApproval', referenceId: request.id,
        sourceDocumentNo: `ADJ-${request.id.slice(-8).toUpperCase()}`,
        metadata: { requestedBy: request.requestedBy, approvedBy: actorUserId },
      });
      const approved = await tx.stockAdjustmentApproval.update({
        where: { id }, data: { status: 'approved', approvedBy: actorUserId, decidedAt: new Date() },
        include: { product: true, lot: true, location: true },
      });
      await tx.auditEvent.create({
        data: {
          id: ulid(), actorUserId, action: 'stock_adjustment.approve', entityType: 'StockAdjustmentApproval', entityId: id,
          summary: `Approved ${request.type} for ${request.product.sku}`, metadata: { quantity, requestedBy: request.requestedBy },
        },
      });
      return approved;
    }, { isolationLevel: 'Serializable', timeout: 30000 });
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

  private async ensureDefaultLocation() {
    return this.ensureDefaultLocationTx(this.prisma as any);
  }

  private fiscalYear(date: Date) {
    const year = date.getFullYear();
    const start = date.getMonth() >= 3 ? year : year - 1;
    return `${start}-${String(start + 1).slice(-2)}`;
  }

  private async ensureTransitLocationTx(tx: any) {
    const existing = await tx.stockLocation.findUnique({ where: { code: 'IN-TRANSIT' } });
    if (existing) {
      if (existing.status !== 'active') {
        return tx.stockLocation.update({
          where: { id: existing.id },
          data: { status: 'active', updatedAt: new Date() },
        });
      }
      return existing;
    }
    return tx.stockLocation.create({
      data: {
        id: ulid(),
        code: 'IN-TRANSIT',
        name: 'Stock in Transit',
        type: 'transit',
        status: 'active',
        sortOrder: 9999,
        metadata: { systemLocation: true, excludeFromAvailableStock: true },
        updatedAt: new Date(),
      },
    });
  }

  private async createInternalLabelJobTx(tx: any, input: {
    sourceType: string;
    sourceId: string;
    productId?: string;
    lotId?: string;
    displaySampleId?: string;
    quantity: number;
    template: string;
    actorUserId: string;
    newJob?: boolean;
  }) {
    const quantity = this.whole(input.quantity, 'Label quantity');
    if (!input.newJob) {
      const existing = await tx.internalLabelJob.findFirst({
        where: { sourceType: input.sourceType, sourceId: input.sourceId, template: input.template },
        include: { instances: { orderBy: { unitNumber: 'asc' } } },
      });
      if (existing) return existing;
    }
    const requestedAt = new Date();
    const jobNumber = await nextDocumentNumber(tx, 'internal_label', 'LB', requestedAt, {
      existingNumbers: async (prefixForYear) => (await tx.internalLabelJob.findMany({
        where: { jobNumber: { startsWith: prefixForYear } }, select: { jobNumber: true },
      })).map((row: any) => row.jobNumber),
    });
    const job = await tx.internalLabelJob.create({
      data: {
        id: ulid(), jobNumber, sourceType: input.sourceType, sourceId: input.sourceId,
        template: input.template, templateVersion: 1, quantity, status: 'ready', requestedBy: input.actorUserId,
        completedBy: input.actorUserId, completedAt: requestedAt,
        metadata: { encoding: 'internal_url', nonGs1: true }, updatedAt: requestedAt,
      },
    });
    for (let unitNumber = 1; unitNumber <= quantity; unitNumber += 1) {
      await tx.internalLabelInstance.create({
        data: {
          id: ulid(), labelCode: `${jobNumber}-${String(unitNumber).padStart(4, '0')}`,
          labelJobId: job.id, productId: input.productId || null, lotId: input.lotId || null,
          displaySampleId: input.displaySampleId || null, unitNumber, status: 'active',
          metadata: { sourceType: input.sourceType, sourceId: input.sourceId }, updatedAt: requestedAt,
        },
      });
    }
    return tx.internalLabelJob.findUnique({
      where: { id: job.id }, include: { instances: { orderBy: { unitNumber: 'asc' } } },
    });
  }

  private extractInternalLabelCode(raw: string) {
    const value = String(raw || '').trim();
    if (!value) throw new BadRequestException('Label code is required');
    const prefixed = value.match(/^MP-LABEL:([^\s]+)$/i);
    if (prefixed) return prefixed[1].trim().toUpperCase();
    try {
      const parsed = JSON.parse(value);
      const jsonCode = String(parsed?.labelCode || parsed?.code || '').trim();
      if (jsonCode) return jsonCode.toUpperCase();
    } catch {
      // The rendered QR may be a plain label code rather than legacy JSON.
    }
    try {
      const url = new URL(value);
      const queryCode = url.searchParams.get('label') || url.searchParams.get('code');
      const pathCode = url.pathname.match(/\/labels?\/([^/]+)$/i)?.[1];
      const urlCode = String(queryCode || pathCode || '').trim();
      if (urlCode) return decodeURIComponent(urlCode).toUpperCase();
    } catch {
      // The rendered QR may be a plain label code rather than a lookup URL.
    }
    return value.toUpperCase();
  }

  private async applyLocationDeltaTx(
    tx: any,
    args: { productId: string; locationId: string; onHandDelta: number; damagedDelta?: number },
  ) {
    const existing = await tx.stockBalanceByLocation.findUnique({
      where: { productId_locationId: { productId: args.productId, locationId: args.locationId } },
    }).catch(() => null);
    const onHand = Math.max(0, Number(existing?.onHand || 0) + Number(args.onHandDelta || 0));
    const damaged = Math.max(0, Number(existing?.damaged || 0) + Number(args.damagedDelta || 0));
    if (existing) {
      await tx.stockBalanceByLocation.update({
        where: { productId_locationId: { productId: args.productId, locationId: args.locationId } },
        data: { onHand, damaged, updatedAt: new Date() },
      });
      return;
    }
    await tx.stockBalanceByLocation.create({
      data: {
        id: ulid(),
        productId: args.productId,
        locationId: args.locationId,
        onHand,
        reserved: 0,
        damaged,
        hold: 0,
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

  private async clearDefaultStockScopeTx(tx: any) {
    const rows = await tx.stockLocation.findMany().catch(() => []);
    for (const row of rows) {
      if (!row.metadata?.defaultStockScope) continue;
      await tx.stockLocation.update({
        where: { id: row.id },
        data: { metadata: { ...(row.metadata || {}), defaultStockScope: false }, updatedAt: new Date() },
      });
    }
  }

  private normalizeLocationInput(input: any, existing?: any) {
    const rawName = String(input?.name ?? existing?.name ?? '').trim();
    if (!rawName) throw new BadRequestException('Plant / location name is required');
    const generatedCode = rawName
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 18) || 'PLANT';
    const code = String(input?.code ?? existing?.code ?? generatedCode)
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24);
    if (!code) throw new BadRequestException('Plant / location code is required');
    const type = String(input?.type ?? existing?.type ?? 'plant').trim().toLowerCase();
    const allowedTypes = ['plant', 'showroom', 'godown', 'warehouse', 'yard'];
    if (!allowedTypes.includes(type)) throw new BadRequestException('Plant type must be plant, showroom, godown, warehouse, or yard');
    const status = String(input?.status ?? existing?.status ?? 'active').trim().toLowerCase();
    if (!['active', 'inactive'].includes(status)) throw new BadRequestException('Plant status must be active or inactive');
    const baseMetadata = { ...(existing?.metadata || {}), ...(input?.metadata || {}) };
    const defaultStockScope = input?.defaultStockScope === undefined
      ? Boolean(baseMetadata.defaultStockScope)
      : Boolean(input.defaultStockScope);
    const metadata = { ...baseMetadata, defaultStockScope };
    return {
      defaultStockScope,
      metadata,
      data: {
        code,
        name: rawName,
        type,
        status,
        address: input?.address ?? existing?.address ?? null,
        sortOrder: Math.max(0, Math.trunc(Number(input?.sortOrder ?? existing?.sortOrder ?? 0))),
      },
    };
  }

  private decorateLocation(row: any) {
    const metadata = row?.metadata || {};
    return { ...row, defaultStockScope: Boolean(metadata.defaultStockScope) };
  }

  private async decorateStockCount(id: string, tx?: any) {
    const client = tx || (this.prisma as any);
    return client.stockCountSession.findUnique({
      where: { id },
      include: {
        location: true,
        lines: {
          include: { product: true, lot: true, location: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  private parseLines(value: any) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  private groupBy(rows: any[], key: string) {
    const grouped = new Map<string, any[]>();
    for (const row of rows || []) {
      const groupKey = String(row[key] || '');
      grouped.set(groupKey, [...(grouped.get(groupKey) || []), row]);
    }
    return grouped;
  }

  private sumLocationBuckets(rows: any[]) {
    const grouped = new Map<string, any>();
    for (const row of rows || []) {
      const current = grouped.get(row.productId) || { onHand: 0, reserved: 0, damaged: 0, hold: 0, rowCount: 0 };
      grouped.set(row.productId, {
        onHand: current.onHand + Number(row.onHand || 0),
        reserved: current.reserved + Number(row.reserved || 0),
        damaged: current.damaged + Number(row.damaged || 0),
        hold: current.hold + Number(row.hold || 0),
        rowCount: current.rowCount + 1,
      });
    }
    return grouped;
  }

  private sumLotBuckets(rows: any[]) {
    const grouped = new Map<string, any>();
    for (const row of rows || []) {
      const productId = row.lot?.productId;
      if (!productId) continue;
      const current = grouped.get(productId) || { onHand: 0, reserved: 0, damaged: 0, hold: 0, available: 0, rowCount: 0 };
      grouped.set(productId, {
        onHand: current.onHand + Number(row.onHand || 0),
        reserved: current.reserved + Number(row.reserved || 0),
        damaged: current.damaged + Number(row.damaged || 0),
        hold: current.hold + Number(row.hold || 0),
        available: current.available + Number(row.available || 0),
        rowCount: current.rowCount + 1,
      });
    }
    return grouped;
  }

  private whole(value: any, label: string) {
    const number = Math.trunc(Number(value || 0));
    if (!Number.isFinite(number) || number <= 0) throw new BadRequestException(`${label} must be a positive whole number`);
    return number;
  }

  private wholeOrZero(value: any, label: string) {
    const number = Math.trunc(Number(value || 0));
    if (!Number.isFinite(number) || number < 0) throw new BadRequestException(`${label} cannot be negative`);
    return number;
  }

  private limit(value: any, fallback: number) {
    return Math.max(1, Math.min(500, Number(value) || fallback));
  }
}
