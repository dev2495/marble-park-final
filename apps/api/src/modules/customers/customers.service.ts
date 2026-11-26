import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { customersByMobileKey, maskedMobile, mobileForStorage, mobileKey } from '../common/phone';

export interface CreateCustomerInput {
  name: string;
  companyName?: string;
  email?: string;
  phone?: string;
  gstNo?: string;
  address?: string;
  city?: string;
  state?: string;
  architect?: string;
  designer?: string;
  notes?: string;
  tags?: any;
  /**
   * When `true`, bypass the duplicate guard and create even if a likely
   * duplicate exists. Callers (e.g. owner/admin override flow) must opt in.
   */
  forceCreate?: boolean;
  /** Why a phone that already belongs to someone is being reused (owner/admin override). */
  overrideReason?: string;
}

export interface UpdateCustomerInput {
  name?: string;
  companyName?: string;
  email?: string;
  phone?: string;
  gstNo?: string;
  address?: string;
  city?: string;
  state?: string;
  architect?: string;
  designer?: string;
  notes?: string;
  tags?: any;
}

/**
 * Normalise a string for fuzzy duplicate matching. Lowercases, collapses
 * whitespace, strips most punctuation. "M/s. ABC Corp." and "M/S ABC CORP" should
 * both reduce to "m/s abc corp".
 */
function normaliseForMatch(input: string | null | undefined): string {
  if (!input) return '';
  return String(input)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;]/g, '')
    .trim();
}

function normaliseGst(input: string | null | undefined): string {
  if (!input) return '';
  return String(input).toUpperCase().replace(/\s+/g, '');
}

function normaliseEmail(input: string | null | undefined): string {
  if (!input) return '';
  return String(input).toLowerCase().trim();
}

export interface DuplicateCandidate {
  id: string;
  name: string;
  mobile: string;
  email: string | null;
  gstNo: string | null;
  city: string;
  maskedMobile: string;
  matchedOn: Array<'gstNo' | 'email' | 'mobile' | 'name+city' | 'name'>;
  /** Phone, GST or email: the same customer, so a new one is not allowed. Name matches only warn. */
  blocking: boolean;
}

const BLOCKING_MATCHES = new Set(['gstNo', 'email', 'mobile']);

function duplicateMessage(top: DuplicateCandidate) {
  const where = [top.city, top.maskedMobile].filter(Boolean).join(' · ');
  if (top.matchedOn.includes('mobile')) return `This mobile already belongs to ${top.name}${where ? ` (${where})` : ''}. Use that customer instead of adding a new one.`;
  if (top.matchedOn.includes('gstNo')) return `This GST number already belongs to ${top.name}${where ? ` (${where})` : ''}.`;
  return `This email already belongs to ${top.name}${where ? ` (${where})` : ''}.`;
}

function matchedPayload(duplicates: DuplicateCandidate[]) {
  return duplicates.map((c) => ({ id: c.id, name: c.name, city: c.city, mobile: c.mobile, maskedMobile: c.maskedMobile, matchedOn: c.matchedOn, blocking: c.blocking }));
}

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async findAll(args?: { search?: string; take?: number; skip?: number }): Promise<any[]> {
    const search = String(args?.search || '').trim();
    // "+91 98250 12345" should find a customer saved as 9825012345, and the reverse.
    const phoneIds = mobileKey(search) ? (await customersByMobileKey(this.prisma, search, { take: 20 })).map((row: any) => row.id) : [];
    const digits = search.replace(/\D/g, '');
    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { email: { contains: search, mode: 'insensitive' as const } },
            { mobile: { contains: search, mode: 'insensitive' as const } },
            ...(digits.length >= 4 && digits !== search ? [{ mobile: { contains: digits } }] : []),
            { city: { contains: search, mode: 'insensitive' as const } },
            { gstNo: { contains: search.replace(/\s+/g, ''), mode: 'insensitive' as const } },
            ...(phoneIds.length ? [{ id: { in: phoneIds } }] : []),
          ],
        }
      : {};
    const customers = await this.prisma.customer.findMany({
      where,
      orderBy: { name: 'asc' },
      take: Math.min(Math.max(Number(args?.take) || 50, 1), 101),
      skip: Math.max(Number(args?.skip) || 0, 0),
    });
    return customers.map((customer) => this.toApiCustomer(customer));
  }

  async findById(id: string): Promise<any> {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('Customer not found');
    return this.toApiCustomer(customer);
  }

  async create(data: CreateCustomerInput, actorUserId = 'system'): Promise<any> {
    // Phone, GST and email identify a customer. A same name (even in the same
    // city) is a different person until the number says otherwise, so it never blocks.
    const duplicates = (await this.findDuplicateCandidates({
      gstNo: data.gstNo,
      email: data.email,
      phone: data.phone,
    })).filter((c) => c.blocking);
    const overrideReason = String(data.overrideReason || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (duplicates.length > 0 && !data.forceCreate) {
      throw new ConflictException({
        message: duplicateMessage(duplicates[0]),
        code: 'CUSTOMER_DUPLICATE',
        matched: matchedPayload(duplicates),
      });
    }
    if (duplicates.length > 0 && overrideReason.length < 3) {
      throw new ConflictException({
        message: `${duplicateMessage(duplicates[0])} To add a separate customer with the same details, give a reason.`,
        code: 'CUSTOMER_DUPLICATE_REASON_REQUIRED',
        matched: matchedPayload(duplicates),
      });
    }
    // Two people adding the same number at the same moment: the second waits for the
    // first on a lock for that number, then sees it and is refused (there is no unique rule in the database yet).
    const lockKey = mobileKey(data.phone);
    const customer = await this.prisma.$transaction(async (tx) => {
      if (lockKey) {
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `customer-mobile:${lockKey}`);
        const [clash] = await customersByMobileKey(tx, lockKey, { take: 1 });
        if (clash && !(data.forceCreate && duplicates.some((row) => row.id === clash.id))) {
          throw new ConflictException({ message: `This mobile already belongs to ${clash.name}${clash.city ? ` (${clash.city})` : ''}.`, code: 'CUSTOMER_DUPLICATE', matched: [{ id: clash.id, name: clash.name, city: clash.city, mobile: clash.mobile, maskedMobile: maskedMobile(clash.mobile), matchedOn: ['mobile'], blocking: true }] });
        }
      }
      return tx.customer.create({ data: this.toDbCustomer(data, true) as any });
    });
    await this.audit.record({
      actorUserId,
      action: 'customer.create',
      entityType: 'Customer',
      entityId: customer.id,
      summary: `Customer ${customer.name} created${duplicates.length ? ` (same details as ${duplicates.map((c) => c.name).join(', ')}: ${overrideReason})` : ''}`,
      metadata: { city: customer.city, email: customer.email, gstNo: customer.gstNo, forceCreate: !!data.forceCreate, overriddenDuplicateIds: duplicates.map((c) => c.id), overrideReason: duplicates.length ? overrideReason : undefined },
    });
    return this.toApiCustomer(customer);
  }

  /**
   * Look for likely-duplicate customers based on identity-strong fields:
   *   1. Same GST number (strongest — legal identity)
   *   2. Same email
   *   3. Same trailing-10-digit mobile
   *   4. Same name (+ same city ranks higher) — a warning only, never blocking
   * Returns up to 5 ranked candidates, strongest match first.
   */
  async findDuplicateCandidates(input: {
    gstNo?: string | null;
    email?: string | null;
    phone?: string | null;
    name?: string | null;
    city?: string | null;
    excludeId?: string | null;
  }): Promise<DuplicateCandidate[]> {
    const gst = normaliseGst(input.gstNo);
    const email = normaliseEmail(input.email);
    const mobile = mobileKey(input.phone);
    const name = normaliseForMatch(input.name);
    const city = normaliseForMatch(input.city);

    const phoneIds = mobile ? (await customersByMobileKey(this.prisma, mobile, { excludeId: input.excludeId, take: 10 })).map((row: any) => row.id) : [];
    const orFilters: any[] = [];
    if (gst) orFilters.push({ gstNo: { equals: gst, mode: 'insensitive' as const } });
    if (email) orFilters.push({ email: { equals: email, mode: 'insensitive' as const } });
    if (phoneIds.length) orFilters.push({ id: { in: phoneIds } });
    if (name) orFilters.push({ name: { equals: String(input.name || '').trim(), mode: 'insensitive' as const } });
    if (orFilters.length === 0) return [];

    const candidates = await this.prisma.customer.findMany({
      where: {
        AND: [
          input.excludeId ? { id: { not: input.excludeId } } : {},
          { OR: orFilters },
        ],
      },
      take: 25,
    });

    const ranked: DuplicateCandidate[] = [];
    for (const c of candidates) {
      const matchedOn: DuplicateCandidate['matchedOn'] = [];
      if (gst && normaliseGst(c.gstNo) === gst) matchedOn.push('gstNo');
      if (email && normaliseEmail(c.email) === email) matchedOn.push('email');
      if (mobile && mobileKey(c.mobile) === mobile) matchedOn.push('mobile');
      if (name && normaliseForMatch(c.name) === name) {
        matchedOn.push(city && normaliseForMatch(c.city) === city ? 'name+city' : 'name');
      }
      if (matchedOn.length === 0) continue;
      ranked.push({
        id: c.id,
        name: c.name,
        mobile: c.mobile,
        maskedMobile: maskedMobile(c.mobile),
        email: c.email,
        gstNo: c.gstNo,
        city: c.city,
        matchedOn,
        blocking: matchedOn.some((m) => BLOCKING_MATCHES.has(m)),
      });
    }
    // Sort: blocking identity matches first; gstNo/email beat mobile/name.
    const weight = (m: DuplicateCandidate['matchedOn'][number]) =>
      m === 'gstNo' ? 8 : m === 'email' ? 6 : m === 'mobile' ? 5 : m === 'name+city' ? 1 : 0.5;
    ranked.sort((a, b) => {
      const sa = a.matchedOn.reduce((s, m) => s + weight(m), 0);
      const sb = b.matchedOn.reduce((s, m) => s + weight(m), 0);
      return sb - sa;
    });
    return ranked.slice(0, 5);
  }

  async update(id: string, data: UpdateCustomerInput, actorUserId = 'system'): Promise<any> {
    await this.findById(id);
    // On update, also check that the new GST/email/mobile doesn't clash with a
    // *different* existing customer (mostly to catch operator typos).
    const duplicates = await this.findDuplicateCandidates({
      gstNo: data.gstNo,
      email: data.email,
      phone: data.phone,
      excludeId: id,
    });
    const blocking = duplicates.find((d) => d.blocking);
    if (blocking) {
      throw new ConflictException({
        message: duplicateMessage(blocking).replace('already belongs to', 'already belongs to another customer,'),
        code: 'CUSTOMER_DUPLICATE',
        matched: matchedPayload(duplicates.filter((d) => d.blocking)),
      });
    }
    // Same lock as create (gaps lane): two people saving the same number at once on
    // different customers, or one adding and one editing, wait for each other and the second is refused.
    const lockKey = mobileKey(data.phone ?? (data as any).mobile);
    const customer = await this.prisma.$transaction(async (tx) => {
      if (lockKey) {
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `customer-mobile:${lockKey}`);
        const [clash] = await customersByMobileKey(tx, lockKey, { excludeId: id, take: 10 });
        if (clash) {
          throw new ConflictException({ message: `This mobile already belongs to another customer, ${clash.name}${clash.city ? ` (${clash.city})` : ''}.`, code: 'CUSTOMER_DUPLICATE', matched: [{ id: clash.id, name: clash.name, city: clash.city, mobile: clash.mobile, maskedMobile: maskedMobile(clash.mobile), matchedOn: ['mobile'], blocking: true }] });
        }
      }
      return tx.customer.update({
        where: { id },
        data: this.toDbCustomer(data, false) as any,
      });
    });
    await this.audit.record({
      actorUserId,
      action: 'customer.update',
      entityType: 'Customer',
      entityId: id,
      summary: `Customer ${customer.name} updated`,
      metadata: { changed: Object.keys(data) },
    });
    return this.toApiCustomer(customer);
  }

  async delete(id: string, actorUserId = 'system') {
    const customer = await this.findById(id);
    const result = await this.prisma.customer.delete({ where: { id } });
    await this.audit.record({
      actorUserId,
      action: 'customer.delete',
      entityType: 'Customer',
      entityId: id,
      summary: `Customer ${customer.name} deleted`,
    });
    return result;
  }

  private toApiCustomer(customer: any) {
    return {
      ...customer,
      companyName: customer.name,
      phone: customer.mobile,
      address: customer.siteAddress,
      architect: customer.architectName,
      state: customer.state || '',
      designer: customer.designerName || '',
    };
  }

  private toDbCustomer(data: CreateCustomerInput | UpdateCustomerInput, creating: boolean) {
    const mapped: any = {};
    if (data.name !== undefined || data.companyName !== undefined) {
      mapped.name = data.name || data.companyName;
    }
    if (data.email !== undefined) mapped.email = data.email;
    if (data.phone !== undefined || (data as any).mobile !== undefined) {
      mapped.mobile = mobileForStorage(data.phone || (data as any).mobile);
    }
    if (data.city !== undefined) mapped.city = data.city;
    if (data.state !== undefined) mapped.state = data.state;
    if (data.gstNo !== undefined) mapped.gstNo = data.gstNo;
    if (data.designer !== undefined) mapped.designerName = data.designer;
    if (data.notes !== undefined) mapped.notes = data.notes;
    if (data.tags !== undefined) mapped.tags = typeof data.tags === 'string' ? data.tags.split(',').map((tag) => tag.trim()).filter(Boolean) : data.tags;
    if (data.address !== undefined) mapped.siteAddress = data.address;
    if (data.architect !== undefined) mapped.architectName = data.architect;
    if (creating) {
      mapped.id = require('ulid').ulid();
      mapped.name = mapped.name || 'Walk-in Customer';
      mapped.mobile = mapped.mobile || '';
      mapped.siteAddress = mapped.siteAddress || '';
      mapped.city = mapped.city || '';
      mapped.tags = mapped.tags || [];
      mapped.updatedAt = new Date();
    } else {
      mapped.updatedAt = new Date();
    }
    return mapped;
  }
}
