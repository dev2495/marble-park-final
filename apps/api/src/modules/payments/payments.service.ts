import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ulid } from 'ulid';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

const ALLOWED_MODES = ['cash', 'upi', 'cheque', 'transfer', 'card', 'finance', 'other'];

export interface CreatePaymentInput {
  salesOrderId: string;
  amount: number;
  mode: string;
  reference?: string | null;
  paidAt?: Date | null;
  notes?: string | null;
  direction?: 'incoming' | 'refund' | null;
}

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
  ) {}

  async record(input: CreatePaymentInput, actorUserId: string) {
    if (!input.salesOrderId) throw new BadRequestException('Sales order is required');
    if (!input.amount || input.amount <= 0) throw new BadRequestException('Amount must be positive');
    const mode = (input.mode || '').toLowerCase().trim();
    if (!ALLOWED_MODES.includes(mode)) {
      throw new BadRequestException(`Unsupported payment mode (${input.mode}). Allowed: ${ALLOWED_MODES.join(', ')}.`);
    }

    const order = await this.prisma.salesOrder.findUnique({ where: { id: input.salesOrderId } });
    if (!order) throw new NotFoundException('Sales order not found');

    const direction = input.direction === 'refund' ? 'refund' : 'incoming';
    const payment = await this.prisma.payment.create({
      data: {
        id: ulid(),
        salesOrderId: order.id,
        customerId: order.customerId,
        amount: Number(input.amount),
        mode,
        reference: input.reference || null,
        paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
        notes: input.notes || null,
        recordedBy: actorUserId,
        direction,
      } as any,
    });

    await this.recomputeOrderPaymentStatus(order.id);

    await this.audit.record({
      actorUserId,
      action: direction === 'refund' ? 'payment.refund' : 'payment.recorded',
      entityType: 'Payment',
      entityId: payment.id,
      summary: `${direction === 'refund' ? 'Refunded' : 'Received'} ₹${input.amount.toLocaleString('en-IN')} via ${mode} on ${order.orderNumber}`,
      metadata: { salesOrderId: order.id, amount: input.amount, mode, reference: input.reference || null },
    });

    await this.notifications
      .create({
        title: direction === 'refund' ? 'Refund issued' : 'Payment received',
        message: `${direction === 'refund' ? 'Refund' : 'Payment'} ₹${input.amount.toLocaleString('en-IN')} on ${order.orderNumber}`,
        type: 'payment',
        entityType: 'SalesOrder',
        entityId: order.id,
        href: `/dashboard/sales/${order.id}`,
        targetRole: 'owner',
        metadata: { mode, amount: input.amount },
      })
      .catch(() => null);

    return payment;
  }

  async remove(id: string, actorUserId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) throw new NotFoundException('Payment not found');
    await this.prisma.payment.delete({ where: { id } });
    await this.recomputeOrderPaymentStatus(payment.salesOrderId);
    await this.audit.record({
      actorUserId,
      action: 'payment.delete',
      entityType: 'Payment',
      entityId: id,
      summary: `Deleted payment ₹${payment.amount.toLocaleString('en-IN')}`,
      metadata: { salesOrderId: payment.salesOrderId },
    });
    return { success: true };
  }

  async listForOrder(salesOrderId: string) {
    return this.prisma.payment.findMany({
      where: { salesOrderId },
      orderBy: { paidAt: 'desc' },
    });
  }

  async listForCustomer(customerId: string) {
    return this.prisma.payment.findMany({
      where: { customerId },
      orderBy: { paidAt: 'desc' },
    });
  }

  async listAll(args?: { from?: Date; to?: Date; mode?: string }) {
    const where: any = {};
    if (args?.mode) where.mode = args.mode;
    if (args?.from || args?.to) where.paidAt = {};
    if (args?.from) where.paidAt.gte = args.from;
    if (args?.to) where.paidAt.lte = args.to;
    return this.prisma.payment.findMany({ where, orderBy: { paidAt: 'desc' }, take: 500 });
  }

  async orderPaymentSummary(salesOrderId: string) {
    const order = await this.prisma.salesOrder.findUnique({ where: { id: salesOrderId } });
    if (!order) return null;
    const payments = await this.prisma.payment.findMany({ where: { salesOrderId } });
    const received = payments
      .filter((p) => p.direction !== 'refund')
      .reduce((s, p) => s + Number(p.amount || 0), 0);
    const refunded = payments
      .filter((p) => p.direction === 'refund')
      .reduce((s, p) => s + Number(p.amount || 0), 0);
    const netReceived = received - refunded;
    const total = Number(order.totalAmount || 0);
    return {
      salesOrderId,
      total,
      received,
      refunded,
      netReceived,
      balance: Math.max(0, total - netReceived),
      paymentCount: payments.length,
      lastPaymentAt: payments[0]?.paidAt || null,
      payments,
    };
  }

  // Quietly keep SalesOrder.paymentStatus accurate after each mutation.
  private async recomputeOrderPaymentStatus(salesOrderId: string) {
    const summary = await this.orderPaymentSummary(salesOrderId);
    if (!summary) return;
    let status: string;
    if (summary.netReceived <= 0) status = 'unpaid';
    else if (summary.netReceived < summary.total - 0.01) status = 'partial';
    else status = 'paid';
    await this.prisma.salesOrder.update({
      where: { id: salesOrderId },
      data: { paymentStatus: status, updatedAt: new Date() },
    }).catch(() => null);
  }
}
