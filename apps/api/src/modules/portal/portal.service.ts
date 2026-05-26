import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { ulid } from 'ulid';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

@Injectable()
export class PortalService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async issueToken(customerId: string, actorUserId: string, ttlDays = 30) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('Customer not found');
    const plain = `${ulid()}${ulid()}`;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + Math.max(1, Math.min(120, ttlDays)));
    const record = await this.prisma.portalToken.create({
      data: {
        id: ulid(),
        token: hashToken(plain),
        customerId,
        scope: 'read',
        expiresAt,
        createdBy: actorUserId,
      } as any,
    });
    await this.audit.record({
      actorUserId,
      action: 'portal.token.issue',
      entityType: 'PortalToken',
      entityId: record.id,
      summary: `Portal access issued for ${customer.name} (expires ${expiresAt.toISOString().slice(0, 10)})`,
      metadata: { customerId },
    });
    return { token: plain, expiresAt };
  }

  async revoke(id: string, actorUserId: string) {
    const tok = await this.prisma.portalToken.findUnique({ where: { id } });
    if (!tok) throw new NotFoundException('Token not found');
    await this.prisma.portalToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      actorUserId,
      action: 'portal.token.revoke',
      entityType: 'PortalToken',
      entityId: id,
      summary: `Portal access revoked`,
      metadata: { customerId: tok.customerId },
    });
    return { success: true };
  }

  async listForCustomer(customerId: string) {
    return this.prisma.portalToken.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  // Resolve a plaintext token to a customer view (quotes, orders, payments,
  // dispatch). Throws UnauthorizedException on bad/expired/revoked tokens.
  async snapshot(plainToken: string) {
    if (!plainToken || plainToken.length < 16) throw new UnauthorizedException('Invalid portal link');
    const tok = await this.prisma.portalToken.findUnique({ where: { token: hashToken(plainToken) } });
    if (!tok) throw new UnauthorizedException('Invalid portal link');
    if (tok.revokedAt) throw new UnauthorizedException('Portal link revoked');
    if (tok.expiresAt < new Date()) throw new UnauthorizedException('Portal link expired');

    const customerId = tok.customerId;
    const [customer, quotes, salesOrders, payments, challans] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: customerId } }),
      this.prisma.quote.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' }, take: 30 }),
      this.prisma.salesOrder.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' }, take: 30 }),
      this.prisma.payment.findMany({ where: { customerId }, orderBy: { paidAt: 'desc' }, take: 100 }),
      this.prisma.dispatchChallan.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' }, take: 30 }),
    ]);

    if (!customer) throw new NotFoundException('Customer not found');

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        mobile: customer.mobile,
        email: customer.email,
        city: customer.city,
        siteAddress: customer.siteAddress,
      },
      quotes: quotes.map((q) => ({
        id: q.id,
        quoteNumber: q.quoteNumber,
        title: q.title,
        status: q.status,
        validUntil: q.validUntil,
        createdAt: q.createdAt,
      })),
      salesOrders: salesOrders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        paymentStatus: o.paymentStatus,
        totalAmount: o.totalAmount,
        advanceAmount: o.advanceAmount,
        createdAt: o.createdAt,
      })),
      payments: payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        mode: p.mode,
        direction: p.direction,
        paidAt: p.paidAt,
        reference: p.reference,
      })),
      dispatches: challans.map((c) => ({
        id: c.id,
        challanNumber: c.challanNumber,
        status: c.status,
        dispatchedAt: c.dispatchedAt,
        deliveredAt: c.deliveredAt,
      })),
      meta: { expiresAt: tok.expiresAt },
    };
  }
}
