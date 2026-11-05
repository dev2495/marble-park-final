import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ulid } from 'ulid';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { cleanToken, publicToken, VISIT_TOKEN_LENGTH } from '../products/public-catalogue.service';

const STATUSES = ['open', 'quoting', 'closed'] as const;
// A phone that checks in twice in one day continues the same visit.
const SAME_VISIT_MS = 12 * 60 * 60 * 1000;

function tenDigitMobile(input: unknown) {
  const digits = String(input || '').replace(/\D/g, '');
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  return /^[6-9]\d{9}$/.test(local) ? local : '';
}

function clean(input: unknown, max: number) {
  return String(input || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Showroom days run on India time.
function dayRange(day?: string) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const start = new Date(`${day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : today}T00:00:00+05:30`);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

@Injectable()
export class ShowroomVisitsService {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  /** Public: a visitor checks in from the showroom scan page. */
  async checkIn(input: { name?: string; mobile?: string; city?: string; note?: string; visitToken?: string }) {
    const name = clean(input.name, 80);
    const mobile = tenDigitMobile(input.mobile);
    if (name.length < 2) throw new BadRequestException('Please enter your name.');
    if (!mobile) throw new BadRequestException('Please enter a 10-digit mobile number.');
    const city = clean(input.city, 80);
    const note = clean(input.note, 300);
    const now = new Date();
    const existing: any = await (this.prisma as any).showroomVisit.findFirst({
      where: { mobile, createdAt: { gt: new Date(now.getTime() - SAME_VISIT_MS) } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      const updated = await (this.prisma as any).showroomVisit.update({
        where: { id: existing.id },
        data: { name, city: city || existing.city, note: note || existing.note, lastSeenAt: now, updatedAt: now },
      });
      return { visitToken: updated.token, name: updated.name };
    }
    const customer = await this.customerByMobile(mobile);
    const visit = await (this.prisma as any).showroomVisit.create({
      data: { id: ulid(), token: publicToken(VISIT_TOKEN_LENGTH), name, mobile, city, note, customerId: customer?.id || null, updatedAt: now },
    });
    const message = `${name}${city ? ` from ${city}` : ''} checked in at the showroom${customer ? ' (existing customer)' : ''}.`;
    await this.notifications.createMany(['sales', 'sales_manager', 'owner_admin'].map((targetRole) => ({
      title: 'New showroom walk-in', message, type: 'walk_in', entityType: 'ShowroomVisit', entityId: visit.id,
      href: '/dashboard/walk-ins', targetRole,
    })));
    return { visitToken: visit.token, name: visit.name };
  }

  /** Public: lets the scan page confirm a stored check-in is still valid. */
  async visitSummary(tokenInput: string) {
    const token = cleanToken(tokenInput, VISIT_TOKEN_LENGTH);
    const visit: any = token ? await (this.prisma as any).showroomVisit.findUnique({ where: { token }, include: { scans: true } }) : null;
    if (!visit || Date.now() - new Date(visit.createdAt).getTime() > SAME_VISIT_MS) return { active: false };
    return { active: true, name: visit.name, scanned: visit.scans.length };
  }

  private async customerByMobile(mobile: string) {
    const candidates = await this.prisma.customer.findMany({ where: { mobile: { contains: mobile } }, select: { id: true, name: true, mobile: true }, take: 5 });
    return candidates.find((row) => tenDigitMobile(row.mobile) === mobile) || null;
  }

  async list(args: { day?: string; status?: string }) {
    const { start, end } = dayRange(args.day);
    const status = STATUSES.includes(args.status as any) ? args.status : undefined;
    const visits: any[] = await (this.prisma as any).showroomVisit.findMany({
      where: { createdAt: { gte: start, lt: end }, ...(status ? { status } : {}) },
      include: { scans: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const productIds = Array.from(new Set(visits.flatMap((visit) => visit.scans.map((scan: any) => scan.productId))));
    const customerIds = Array.from(new Set(visits.map((visit) => visit.customerId).filter(Boolean)));
    const userIds = Array.from(new Set(visits.map((visit) => visit.handledBy).filter(Boolean)));
    const [products, customers, users] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, sku: true, internalCode: true, brand: true, category: true, dimensions: true, finish: true, media: true, defaultMrpInclusive: true, status: true } }),
      this.prisma.customer.findMany({ where: { id: { in: customerIds as string[] } }, select: { id: true, name: true, city: true } }),
      this.prisma.user.findMany({ where: { id: { in: userIds as string[] } }, select: { id: true, name: true } }),
    ]);
    const productById = new Map(products.map((row) => [row.id, row]));
    const customerById = new Map(customers.map((row) => [row.id, row]));
    const userById = new Map(users.map((row) => [row.id, row]));
    return visits.map((visit) => ({
      id: visit.id,
      name: visit.name,
      mobile: visit.mobile,
      city: visit.city,
      note: visit.note,
      status: visit.status,
      createdAt: visit.createdAt,
      lastSeenAt: visit.lastSeenAt,
      customer: visit.customerId ? customerById.get(visit.customerId) || null : null,
      handledBy: visit.handledBy ? userById.get(visit.handledBy)?.name || '' : '',
      products: visit.scans.map((scan: any) => {
        const product: any = productById.get(scan.productId);
        return product ? {
          id: product.id, name: product.name, code: product.internalCode || product.sku, brand: product.brand, category: product.category,
          size: product.dimensions, finish: product.finish, media: product.media, mrp: product.defaultMrpInclusive == null ? null : Number(product.defaultMrpInclusive),
          active: product.status === 'active', scanCount: scan.scanCount, scannedAt: scan.createdAt,
        } : null;
      }).filter(Boolean),
    }));
  }

  /** Links or creates the customer, marks the visit as being quoted, and hands back what the quote needs. */
  async startQuote(visitId: string, actorUserId: string) {
    const visit: any = await (this.prisma as any).showroomVisit.findUnique({ where: { id: visitId }, include: { scans: true } });
    if (!visit) throw new NotFoundException('Walk-in not found');
    let customerId = visit.customerId;
    if (customerId && !(await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } }))) customerId = null;
    let created = false;
    if (!customerId) {
      const match = await this.customerByMobile(visit.mobile);
      if (match) customerId = match.id;
      else {
        const now = new Date();
        const customer = await this.prisma.customer.create({ data: {
          id: ulid(), name: visit.name, mobile: visit.mobile, city: visit.city || '', siteAddress: visit.city || '',
          notes: visit.note ? `Showroom walk-in: ${visit.note}` : 'Showroom walk-in', tags: ['walk-in'], updatedAt: now,
        } });
        customerId = customer.id;
        created = true;
        await this.audit(actorUserId, 'customer.create', 'Customer', customer.id, `Customer ${customer.name} created from showroom walk-in`, { visitId });
      }
    }
    const now = new Date();
    await (this.prisma as any).showroomVisit.update({
      where: { id: visitId },
      data: { customerId, status: 'quoting', handledBy: visit.handledBy || actorUserId, updatedAt: now },
    });
    await this.audit(actorUserId, 'walk_in.quote_start', 'ShowroomVisit', visitId, `Started a quote for walk-in ${visit.name}`, { customerId, customerCreated: created });
    const active = await this.prisma.product.findMany({ where: { id: { in: visit.scans.map((scan: any) => scan.productId) }, status: 'active' }, select: { id: true } });
    return { customerId, customerCreated: created, productIds: active.map((row) => row.id) };
  }

  async setStatus(visitId: string, statusInput: string, actorUserId: string) {
    const status = String(statusInput || '').trim().toLowerCase();
    if (!STATUSES.includes(status as any)) throw new BadRequestException('Status must be open, quoting or closed');
    const visit: any = await (this.prisma as any).showroomVisit.findUnique({ where: { id: visitId } });
    if (!visit) throw new NotFoundException('Walk-in not found');
    const updated = await (this.prisma as any).showroomVisit.update({ where: { id: visitId }, data: { status, handledBy: visit.handledBy || actorUserId, updatedAt: new Date() } });
    await this.audit(actorUserId, 'walk_in.status', 'ShowroomVisit', visitId, `Marked walk-in ${visit.name} as ${status}`, {});
    return { id: updated.id, status: updated.status };
  }

  private async audit(actorUserId: string, action: string, entityType: string, entityId: string, summary: string, metadata: Record<string, unknown>) {
    await this.prisma.auditEvent.create({ data: { id: ulid(), actorUserId, action, entityType, entityId, summary, metadata: metadata as any } }).catch(() => null);
  }
}
