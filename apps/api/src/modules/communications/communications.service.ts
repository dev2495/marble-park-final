import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ulid } from 'ulid';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const ALLOWED_TYPES = ['call', 'email', 'sms', 'whatsapp', 'visit', 'note', 'meeting'];

export interface CreateCommunicationInput {
  customerId?: string | null;
  leadId?: string | null;
  type: string;
  direction?: 'inbound' | 'outbound' | null;
  summary: string;
  body?: string | null;
  occurredAt?: Date | null;
  attachments?: any[] | null;
}

@Injectable()
export class CommunicationsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async create(input: CreateCommunicationInput, actorUserId: string) {
    if (!input.customerId && !input.leadId) {
      throw new BadRequestException('A customer or lead is required');
    }
    const type = (input.type || '').toLowerCase().trim();
    if (!ALLOWED_TYPES.includes(type)) {
      throw new BadRequestException(`Unsupported communication type. Allowed: ${ALLOWED_TYPES.join(', ')}.`);
    }
    if (!input.summary?.trim()) {
      throw new BadRequestException('Summary is required');
    }
    const direction = input.direction === 'inbound' ? 'inbound' : 'outbound';
    const created = await this.prisma.communication.create({
      data: {
        id: ulid(),
        customerId: input.customerId || null,
        leadId: input.leadId || null,
        type,
        direction,
        summary: input.summary.trim().slice(0, 500),
        body: input.body || null,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
        recordedBy: actorUserId,
        attachments: Array.isArray(input.attachments) ? input.attachments : [],
      } as any,
    });

    await this.audit.record({
      actorUserId,
      action: 'communication.create',
      entityType: 'Communication',
      entityId: created.id,
      summary: `${direction === 'inbound' ? 'Logged inbound' : 'Logged outbound'} ${type}: ${created.summary}`,
      metadata: { customerId: created.customerId, leadId: created.leadId, type },
    });
    return created;
  }

  async listForCustomer(customerId: string) {
    return this.prisma.communication.findMany({
      where: { customerId },
      orderBy: { occurredAt: 'desc' },
      take: 200,
    });
  }

  async listForLead(leadId: string) {
    return this.prisma.communication.findMany({
      where: { leadId },
      orderBy: { occurredAt: 'desc' },
      take: 200,
    });
  }

  async remove(id: string, actorUserId: string) {
    const row = await this.prisma.communication.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Communication not found');
    await this.prisma.communication.delete({ where: { id } });
    await this.audit.record({
      actorUserId,
      action: 'communication.delete',
      entityType: 'Communication',
      entityId: id,
      summary: `Removed ${row.type} note: ${row.summary}`,
    });
    return { success: true };
  }
}
