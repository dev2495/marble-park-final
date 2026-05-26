import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ulid } from 'ulid';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';

export interface CreateReturnInput {
  salesOrderId?: string | null;
  challanId?: string | null;
  customerId: string;
  reason: string;
  reasonCategory?: string | null;
  refundAmount?: number | null;
  refundMode?: string | null;
  notes?: string | null;
  lines: Array<{ productId?: string; sku?: string; name?: string; quantity: number; reason?: string }>;
  restock?: boolean | null;
}

const ALLOWED_REASON_CATEGORIES = ['damaged', 'wrong_item', 'customer_changed_mind', 'quality_issue', 'other'];

@Injectable()
export class ReturnsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private payments: PaymentsService,
  ) {}

  async create(input: CreateReturnInput, actorUserId: string) {
    if (!input.customerId) throw new BadRequestException('Customer is required');
    if (!input.reason?.trim()) throw new BadRequestException('Reason is required');
    if (!Array.isArray(input.lines) || input.lines.length === 0) {
      throw new BadRequestException('At least one return line is required');
    }
    if (input.reasonCategory && !ALLOWED_REASON_CATEGORIES.includes(input.reasonCategory)) {
      throw new BadRequestException(`Unknown reason category. Allowed: ${ALLOWED_REASON_CATEGORIES.join(', ')}`);
    }

    const customer = await this.prisma.customer.findUnique({ where: { id: input.customerId } });
    if (!customer) throw new NotFoundException('Customer not found');

    const returnNumber = await this.generateReturnNumber();
    const refundAmount = Number(input.refundAmount || 0);

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.returnRecord.create({
        data: {
          id: ulid(),
          returnNumber,
          salesOrderId: input.salesOrderId || null,
          challanId: input.challanId || null,
          customerId: input.customerId,
          status: refundAmount > 0 ? 'refunded' : 'received',
          reason: input.reason.trim().slice(0, 500),
          reasonCategory: input.reasonCategory || null,
          refundAmount,
          notes: input.notes || null,
          recordedBy: actorUserId,
          lines: input.lines as any,
          updatedAt: new Date(),
        } as any,
      });

      // Restock the returned items unless explicitly opted out (e.g. damaged).
      const restock = input.restock !== false;
      for (const line of input.lines) {
        const productId = (line.productId || '').trim();
        const qty = Math.max(0, Number(line.quantity || 0));
        if (!productId || qty <= 0) continue;

        if (restock) {
          const balance = await tx.inventoryBalance.findUnique({ where: { productId } });
          if (balance) {
            const onHand = Number(balance.onHand || 0) + qty;
            const reserved = Number(balance.reserved || 0);
            const damaged = Number(balance.damaged || 0);
            const hold = Number(balance.hold || 0);
            await tx.inventoryBalance.update({
              where: { productId },
              data: {
                onHand,
                available: Math.max(0, onHand - reserved - damaged - hold),
                updatedAt: new Date(),
              },
            });
          }
        }
        await tx.inventoryMovement.create({
          data: {
            id: ulid(),
            productId,
            type: restock ? 'return_restock' : 'return_writeoff',
            quantity: qty,
            reason: `Return ${returnNumber}: ${input.reason.slice(0, 80)}`,
            relatedChallanId: input.challanId || null,
            createdBy: actorUserId,
          },
        });
      }

      return created;
    }).then(async (created) => {
      // Refund payment recorded after the transaction (uses PaymentsService
      // which has its own audit/notification side effects).
      if (refundAmount > 0 && input.salesOrderId) {
        const payment = await this.payments.record(
          {
            salesOrderId: input.salesOrderId,
            amount: refundAmount,
            mode: input.refundMode || 'cash',
            reference: created.returnNumber,
            notes: `Refund for ${created.returnNumber}`,
            direction: 'refund',
          },
          actorUserId,
        );
        await this.prisma.returnRecord.update({
          where: { id: created.id },
          data: { refundPaymentId: payment.id, updatedAt: new Date() },
        });
      }

      await this.audit.record({
        actorUserId,
        action: 'return.create',
        entityType: 'ReturnRecord',
        entityId: created.id,
        summary: `Return ${created.returnNumber} created for ${customer.name}${refundAmount ? ` (refund ₹${refundAmount.toLocaleString('en-IN')})` : ''}`,
        metadata: {
          customerId: customer.id,
          salesOrderId: input.salesOrderId || null,
          refundAmount,
          lineCount: input.lines.length,
        },
      });

      return created;
    });
  }

  async listAll(args?: { customerId?: string; status?: string }) {
    const where: any = {};
    if (args?.customerId) where.customerId = args.customerId;
    if (args?.status) where.status = args.status;
    return this.prisma.returnRecord.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  async findById(id: string) {
    const row = await this.prisma.returnRecord.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Return not found');
    return row;
  }

  private async generateReturnNumber(): Promise<string> {
    const yyyymm = new Date().toISOString().slice(0, 7).replace('-', '');
    const tail = Date.now().toString(36).toUpperCase().slice(-5);
    return `RTN-${yyyymm}-${tail}`;
  }
}
