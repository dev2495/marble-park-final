import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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

/**
 * Reduce a phone/mobile to its trailing 10 digits (typical India retail).
 * Strips +, spaces, dashes, country prefix variations, etc.
 */
function normaliseMobile(input: string | null | undefined): string {
  if (!input) return '';
  const digits = String(input).replace(/[^0-9]/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
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
  matchedOn: Array<'gstNo' | 'email' | 'mobile' | 'name+city'>;
}

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  async findAll(args?: { search?: string }): Promise<any[]> {
    const where = args?.search
      ? {
          OR: [
            { name: { contains: args.search, mode: 'insensitive' as const } },
            { email: { contains: args.search, mode: 'insensitive' as const } },
            { mobile: { contains: args.search, mode: 'insensitive' as const } },
            { city: { contains: args.search, mode: 'insensitive' as const } },
          ],
        }
      : {};
    const customers = await this.prisma.customer.findMany({
      where,
      orderBy: { name: 'asc' },
    });
    return customers.map((customer) => this.toApiCustomer(customer));
  }

  async findById(id: string): Promise<any> {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('Customer not found');
    return this.toApiCustomer(customer);
  }

  async create(data: CreateCustomerInput): Promise<any> {
    if (!data.forceCreate) {
      const duplicates = await this.findDuplicateCandidates({
        gstNo: data.gstNo,
        email: data.email,
        phone: data.phone,
        name: data.name || data.companyName,
        city: data.city,
      });
      if (duplicates.length > 0) {
        const top = duplicates[0];
        throw new ConflictException({
          message: `A customer that looks like a duplicate already exists (${top.name}, ${top.city || 'no city'}). Set forceCreate: true to bypass.`,
          code: 'CUSTOMER_DUPLICATE',
          matched: duplicates.map((c) => ({ id: c.id, name: c.name, city: c.city, matchedOn: c.matchedOn })),
        });
      }
    }
    const customer = await this.prisma.customer.create({
      data: this.toDbCustomer(data, true) as any,
    });
    return this.toApiCustomer(customer);
  }

  /**
   * Look for likely-duplicate customers based on identity-strong fields:
   *   1. Same GST number (strongest — legal identity)
   *   2. Same email
   *   3. Same trailing-10-digit mobile
   *   4. Same normalised name + same city (fuzzy fallback for walk-ins)
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
    const mobile = normaliseMobile(input.phone);
    const name = normaliseForMatch(input.name);
    const city = normaliseForMatch(input.city);

    const orFilters: any[] = [];
    if (gst) orFilters.push({ gstNo: { equals: gst, mode: 'insensitive' as const } });
    if (email) orFilters.push({ email: { equals: email, mode: 'insensitive' as const } });
    if (mobile) orFilters.push({ mobile: { contains: mobile } });
    if (name) orFilters.push({ name: { equals: input.name || '', mode: 'insensitive' as const } });
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
      if (mobile && normaliseMobile(c.mobile) === mobile) matchedOn.push('mobile');
      if (
        name &&
        city &&
        normaliseForMatch(c.name) === name &&
        normaliseForMatch(c.city) === city
      ) {
        matchedOn.push('name+city');
      }
      if (matchedOn.length === 0) continue;
      ranked.push({
        id: c.id,
        name: c.name,
        mobile: c.mobile,
        email: c.email,
        gstNo: c.gstNo,
        city: c.city,
        matchedOn,
      });
    }
    // Sort: more match dimensions first; gstNo/email beat mobile/name.
    const weight = (m: DuplicateCandidate['matchedOn'][number]) =>
      m === 'gstNo' ? 4 : m === 'email' ? 3 : m === 'mobile' ? 2 : 1;
    ranked.sort((a, b) => {
      const sa = a.matchedOn.reduce((s, m) => s + weight(m), 0);
      const sb = b.matchedOn.reduce((s, m) => s + weight(m), 0);
      return sb - sa;
    });
    return ranked.slice(0, 5);
  }

  async update(id: string, data: UpdateCustomerInput): Promise<any> {
    await this.findById(id);
    // On update, also check that the new GST/email/mobile doesn't clash with a
    // *different* existing customer (mostly to catch operator typos).
    const duplicates = await this.findDuplicateCandidates({
      gstNo: data.gstNo,
      email: data.email,
      phone: data.phone,
      excludeId: id,
    });
    const blocking = duplicates.find((d) => d.matchedOn.includes('gstNo') || d.matchedOn.includes('email'));
    if (blocking) {
      throw new ConflictException({
        message: `Another customer already uses this ${blocking.matchedOn.includes('gstNo') ? 'GST number' : 'email'} (${blocking.name}).`,
        code: 'CUSTOMER_DUPLICATE',
        matched: duplicates.map((c) => ({ id: c.id, name: c.name, city: c.city, matchedOn: c.matchedOn })),
      });
    }
    const customer = await this.prisma.customer.update({
      where: { id },
      data: this.toDbCustomer(data, false) as any,
    });
    return this.toApiCustomer(customer);
  }

  async delete(id: string) {
    await this.findById(id);
    return this.prisma.customer.delete({ where: { id } });
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
      mapped.mobile = data.phone || (data as any).mobile;
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
