import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { effectivePermissionsForUser } from '../auth/rbac';
import { computeStockAlertState } from '../inventory/stock-alerts';

type Work = {
  title: string; message: string; entityType: string; entityId: string; href: string;
  targetUserId?: string | null; targetRole?: string; targetPermission?: string;
  priority?: string; dueAt?: Date | null; actionLabel: string;
};

/** Database-backed inbox projector. Source scans heal missed action events. The transaction
 * advisory lock prevents duplicate work across API replicas; a failed scan cannot resolve tasks. */
@Injectable()
export class NotificationsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  lastSuccessAt: Date | null = null;
  lastError: string | null = null;
  constructor(private prisma: PrismaService) {}
  onModuleInit() {
    if (process.env.NOTIFICATIONS_WORKER_DISABLED === '1') return;
    this.timer = setInterval(() => void this.tick(), 60000);
    this.timer.unref();
    void this.tick();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.prisma.$transaction(async tx => {
        const lock: any = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(719091) AS acquired`;
        if (!lock[0]?.acquired) return;
        const now = new Date();
        const users = await tx.user.findMany({ where: { active: true }, select: { id: true, role: true, permissionOverrides: true } });
        const audience = (n: any) => users.filter(u => n.targetUserId ? n.targetUserId === u.id : n.targetPermission
          ? effectivePermissionsForUser(u).includes(n.targetPermission)
          : n.targetRole === u.role || (n.targetRole === 'owner_admin' && ['owner','admin'].includes(u.role)));
        const scan = async (model: string, where: any, include: any, each: (r: any) => Promise<void>) => {
          let cursor: string | undefined;
          for (;;) {
            const rows = await (tx as any)[model].findMany({ where, ...(include ? { include } : {}), orderBy: { id: 'asc' }, take: 200, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
            for (const row of rows) await each(row);
            if (rows.length < 200) break;
            cursor = rows[rows.length - 1].id;
          }
        };
        const upsert = async (rule: string, work: Work) => {
          // Missing assignees are routed to the explicit fallback team, never broadcast.
          const targetUserId = work.targetUserId && users.some(u => u.id === work.targetUserId) ? work.targetUserId : null;
          const targetRole = targetUserId ? null : (work.targetRole || (work.targetPermission ? null : 'owner_admin'));
          const taskKey = `${rule}:${work.entityId}`;
          const id = `work_${createHash('sha256').update(taskKey).digest('hex').slice(0, 32)}`;
          const old = await tx.notification.findUnique({ where: { taskKey } });
          const reopened = old?.status === 'resolved';
          const data = { title: work.title, message: work.message, entityType: work.entityType, entityId: work.entityId,
            href: work.href, targetUserId, targetRole, targetPermission: targetUserId ? null : work.targetPermission || null,
            priority: work.priority || 'normal', dueAt: work.dueAt || null, category: 'action', status: 'open', resolvedAt: null,
            reconciledAt: now, metadata: { actionLabel: work.actionLabel, rule },
          };
          const n = await tx.notification.upsert({ where: { taskKey }, create: { id, taskKey, type: rule, ...data },
            update: { ...data, ...(reopened ? { createdAt: now, assignedUserId: null } : {}) } });
          const eligible = audience(n);
          if (n.assignedUserId && !eligible.some(u => u.id === n.assignedUserId)) await tx.notification.update({ where: { id: n.id }, data: { assignedUserId: null } });
          await tx.notificationRecipient.createMany({ data: eligible.map(u => ({ notificationId: n.id, userId: u.id })), skipDuplicates: true });
          if (reopened || (old && old.priority !== n.priority)) await tx.notificationRecipient.updateMany({ where: { notificationId: n.id }, data: { readAt: null, archivedAt: null, snoozedUntil: null } });
          await tx.notification.update({ where: { id: n.id }, data: { deliveredAt: now, deliveryError: null } });
        };
        const source = async (model: string, where: any, include: any, rule: string, map: (r: any) => Work | null) => {
          await scan(model, where, include, async row => { const work = map(row); if (work) await upsert(rule, work); });
          await tx.notification.updateMany({ where: { type: rule, category: 'action', status: 'open', reconciledAt: { lt: now } }, data: { status: 'resolved', resolvedAt: now, assignedUserId: null } });
        };
        await source('leadIntent', { status: { in: ['pending_quote','in_quote'] } }, null, 'work_intent', r => ({
          title: r.status === 'in_quote' ? 'Quote preparation in progress' : 'Selection waiting for a quote',
          message: `${r.intentType.replaceAll('_',' ')} · ${Array.isArray(r.rows) ? r.rows.length : 0} selections. Open the intent to build the quotation.`,
          entityType: 'LeadIntent', entityId: r.id, targetUserId: r.lockedBy, targetPermission: 'quotes.manage',
          href: `/dashboard/intents?intentId=${r.id}`, actionLabel: 'Open selection',
        }));
        await source('quote', { status: { notIn: ['cancelled','rejected','expired','converted','confirmed'] }, OR: [{ pricingStatus: 'incomplete' }, { approvalStatus: 'pending' }] }, { customer: true }, 'work_quote', r => ({
          title: r.pricingStatus === 'incomplete' ? 'Complete quotation pricing' : 'Review below-floor quotation',
          message: `${r.quoteNumber} · ${r.customer.name}. ${r.pricingStatus === 'incomplete' ? 'Complete missing MRP before sharing.' : 'Price approval is required before confirmation.'}`,
          entityType: 'Quote', entityId: r.id, targetUserId: r.pricingStatus === 'incomplete' ? r.ownerId : null,
          targetRole: 'owner_admin', priority: 'high', href: `/dashboard/quotes/${r.id}`, actionLabel: r.pricingStatus === 'incomplete' ? 'Review pricing' : 'Review exception',
        }));
        await source('followUpTask', { status: { in: ['pending','open'] }, dueAt: { lte: now }, lead: { stage: { notIn: ['lost','cancelled'] } } }, { lead: true }, 'work_followup', r => ({
          title: 'Customer follow-up due', message: `${r.lead.title} · ${r.notes}`, entityType: 'FollowUpTask', entityId: r.id,
          targetUserId: r.ownerId, targetRole: 'owner_admin', dueAt: r.dueAt, href: `/dashboard/leads/${r.leadId}`, actionLabel: 'Record follow-up',
        }));
        await source('collectionTask', { status: 'open' }, null, 'work_collection', r => ({
          title: r.dueAt && r.dueAt < now ? 'Collection follow-up overdue' : 'Collection task assigned', message: r.note || 'Review the customer account and record the collection outcome.',
          entityType: 'CollectionTask', entityId: r.id, targetUserId: r.ownerId, targetPermission: 'payments.manage', priority: r.priority,
          dueAt: r.dueAt, href: `/dashboard/payments?customerId=${r.customerId}`, actionLabel: 'Open customer account',
        }));
        await source('salesInvoice', { status: { notIn: ['void','cancelled','draft'] }, openAmount: { gt: 0 }, dueDate: { lt: now } }, null, 'work_invoice', r => ({
          title: 'Invoice payment overdue', message: `${r.invoiceNumber} · ₹${Number(r.openAmount).toLocaleString('en-IN')} outstanding. Review allocations before contacting the customer.`,
          entityType: 'SalesInvoice', entityId: r.id, targetPermission: 'payments.manage', dueAt: r.dueDate,
          href: `/dashboard/payments?customerId=${r.customerId}`, actionLabel: 'Review outstanding invoice',
        }));
        await source('purchaseOrder', { status: { in: ['ordered','sent','partial_received'] }, expectedDate: { lt: now } }, null, 'work_po', r => ({
          title: 'Purchase order delivery overdue', message: `${r.poNumber} · ${r.vendorName}. Check the remaining delivery with the supplier.`, entityType: 'PurchaseOrder', entityId: r.id,
          targetPermission: 'procurement.manage', dueAt: r.expectedDate, href: `/dashboard/procurement?view=orders&search=${encodeURIComponent(r.poNumber)}`, actionLabel: 'Open purchase order',
        }));
        await source('purchaseOrder', { status: { not: 'cancelled' }, lines: { some: { OR: [{ costStatus: 'missing' }, { unitCost: { lte: 0 } }, { netUnitCost: { lte: 0 } }] } } }, null, 'work_po_cost', r => ({
          title: 'Purchase order rates pending', message: `${r.poNumber} · ${r.vendorName}. Add confirmed supplier rates when received. This does not block inward.`,
          entityType: 'PurchaseOrder', entityId: r.id, targetRole: 'owner_admin',
          href: `/dashboard/procurement/cost-readiness?search=${encodeURIComponent(r.poNumber)}`, actionLabel: 'Complete PO rates',
        }));
        await source('inventoryLot', { status: 'active', sourceType: { not: 'grn' }, OR: [{ unitCost: { lte: 0 } }, { costStatus: { in: ['pending','missing'] } }] }, { product: true }, 'work_cost', r => ({
          title: 'Supplier cost still pending', message: `${r.product.sku} · ${r.lotNumber}. Received ${r.receivedAt.toISOString().slice(0,10)}. Add the actual supplier cost when available; inward remains valid.`,
          entityType: 'InventoryLot', entityId: r.id, targetRole: 'owner_admin',
          dueAt: new Date(r.receivedAt.getTime() + 20 * 86400000), href: r.sourceType === 'grn'
            ? `/dashboard/procurement/cost-readiness?search=${encodeURIComponent(r.product.sku)}`
            : `/dashboard/inventory?search=${encodeURIComponent(r.product.sku)}&lotId=${r.id}`, actionLabel: 'Complete supplier cost',
        }));
        for (const [model, number, rule, href] of [
          ['stockCountSession','countNumber','work_count','/dashboard/inventory/stock-count'],
          ['openingStockSession','sessionNumber','work_opening','/dashboard/inventory/opening-stock'],
          ['stockAdjustmentApproval','reason','work_adjustment','/dashboard/inventory/control'],
        ]) await source(model, { status: model === 'stockAdjustmentApproval' ? 'pending' : 'submitted' }, null, rule, r => ({
          title: 'Stock approval required', message: `${r[number]} · Review the quantities and reasons before posting.`, entityType: model, entityId: r.id,
          targetRole: 'owner_admin', href: `${href}?recordId=${r.id}`, actionLabel: 'Review stock request', priority: 'high',
        }));
        await source('dispatchJob', { status: { notIn: ['delivered','cancelled','completed'] } }, { salesOrder: true, customer: true }, 'work_dispatch', r => ({
          title: r.dueDate < now ? 'Dispatch follow-up overdue' : 'Order awaiting fulfilment',
          message: `${r.salesOrder?.orderNumber || 'Order'} · ${r.customer.name} · ${r.status.replaceAll('_',' ')}. Check reserved and pending quantities before dispatch.`,
          entityType: 'DispatchJob', entityId: r.id, targetPermission: 'dispatch.manage', dueAt: r.dueDate,
          href: `/dashboard/dispatch?search=${encodeURIComponent(r.salesOrder?.orderNumber || r.customer.name)}`, actionLabel: 'Review fulfilment',
        }));
        await source('documentJob', { status: 'failed' }, null, 'work_document', r => ({
          title: 'Document generation needs attention', message: `${r.documentType.replaceAll('_',' ')} failed. Review the source record and try again after correcting the issue.`,
          entityType: 'DocumentJob', entityId: r.id, targetUserId: r.generatedBy, targetRole: 'owner_admin', priority: 'high',
          href: r.entityType === 'Quote' ? `/dashboard/quotes/${r.entityId}` : r.entityType === 'SalesOrder' ? `/dashboard/orders?search=${encodeURIComponent(r.entityId)}` : '/dashboard/documents', actionLabel: 'Review document',
        }));
        await source('inventoryBalance', { AND: [
          { OR: [{ lowStockThreshold: { gt: 0 } }, { criticalStockThreshold: { gt: 0 } }] },
          { OR: [{ onHand: { gt: 0 } }, { reserved: { gt: 0 } }, { product: { inventoryLots: { some: {} } } }] },
        ] }, { product: true }, 'work_stock', r => {
          const state = computeStockAlertState(r.available, r.lowStockThreshold, r.criticalStockThreshold);
          if (!['warning','critical'].includes(state) || r.product.status !== 'active') return null;
          return { title: state === 'critical' ? 'Critical stock shortage' : 'Low stock: review replenishment',
            message: `${r.product.sku} · ${r.available} available. Review existing inward orders before purchasing.`, entityType: 'Product', entityId: r.productId,
            targetPermission: 'procurement.manage', priority: state === 'critical' ? 'high' : 'normal',
            href: `/dashboard/procurement?view=demand&search=${encodeURIComponent(r.product.sku)}`, actionLabel: 'Review replenishment' };
        });
        // Audit-backed import outcomes are durable updates, not perpetually open tasks.
        await scan('auditEvent', { createdAt: { gte: new Date(now.getTime() - 30 * 86400000) }, action: { in: ['excel_import.blocked','excel_import.failed','tile_import.failed','catalogue_import.failed'] } }, null, async row => {
          const taskKey = `import-event:${row.id}`;
          await tx.notification.upsert({ where: { taskKey }, update: {}, create: {
            id: `import_${row.id}`, taskKey, type: 'import_attention', category: 'updates', targetUserId: row.actorUserId,
            title: 'Import requires review', message: row.summary, entityType: row.entityType, entityId: row.entityId,
            href: '/dashboard/master-data/imports', createdAt: row.createdAt, metadata: { actionLabel: 'Review import', auditEventId: row.id },
          } });
        });
        // Persist a worker heartbeat for all replicas and administrator diagnostics.
        await tx.notification.upsert({ where: { taskKey: 'system:notification-worker' },
          create: { id: 'notification-worker-heartbeat', taskKey: 'system:notification-worker', title: 'Notification service', message: 'Healthy', type: 'system_heartbeat', status: 'resolved', deliveredAt: now, reconciledAt: now },
          update: { reconciledAt: now, deliveredAt: now } });
      }, { timeout: 60000, maxWait: 3000 });
      this.lastSuccessAt = new Date(); this.lastError = null;
    } catch (error) {
      this.lastError = (error as Error).message;
      this.logger.error('Notification projection failed; existing work preserved; retry in 60 seconds', (error as Error).stack);
    } finally {
      // Delivery must continue even if a business-source query is temporarily broken.
      try { await this.deliver(); } catch (error) { this.logger.error('Notification delivery cycle failed; retry in 60 seconds', (error as Error).stack); }
      this.running = false;
    }
  }

  async deliver() {
    // Each event has its own atomic delivery and retry state. Unique receipts make retries safe.
    const pending = await this.prisma.notification.findMany({ where: { deliveredAt: null, OR: [{ retryAt: null }, { retryAt: { lte: new Date() } }] }, orderBy: { createdAt: 'asc' }, take: 200 });
    for (const n of pending) {
      try {
        await this.prisma.$transaction(async tx => {
          const users = await tx.user.findMany({ where: { active: true, ...(n.targetUserId ? { id: n.targetUserId } : n.targetRole ? { role: n.targetRole === 'owner_admin' ? { in: ['owner','admin'] } : n.targetRole } : { id: '__no_broadcast__' }) } });
          for (const u of users) {
            // Coalesce repeated informational updates for the same record, retaining history.
            if (n.entityId) await tx.notificationRecipient.updateMany({ where: { userId: u.id, archivedAt: null, notification: { category: 'updates', type: n.type, entityId: n.entityId, id: { not: n.id }, createdAt: { lte: n.createdAt } } }, data: { archivedAt: new Date() } });
            const archivedAt = ['stock_warning','stock_critical'].includes(n.type) ? new Date() : null;
            await tx.notificationRecipient.upsert({ where: { notificationId_userId: { notificationId: n.id, userId: u.id } }, create: { notificationId: n.id, userId: u.id, archivedAt }, update: archivedAt ? { archivedAt } : {} });
          }
          await tx.notification.update({ where: { id: n.id }, data: { deliveredAt: new Date(), deliveryError: null, retryAt: null } });
        });
      } catch (error) {
        await this.prisma.notification.update({ where: { id: n.id }, data: { deliveryAttempts: { increment: 1 }, deliveryError: 'Delivery failed; automatic retry scheduled', retryAt: new Date(Date.now() + Math.min(3600000, 60000 * 2 ** Math.min(n.deliveryAttempts,6))) } });
        this.logger.error(`Delivery failed for ${n.id}`, (error as Error).stack);
      }
    }
  }
}
