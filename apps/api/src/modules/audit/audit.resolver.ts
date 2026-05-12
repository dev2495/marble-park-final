import { Args, Context, Field, InputType, ObjectType, Query, Resolver, Int } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-scalars';
import { AuditService } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { GraphqlRequestContext, requireRoles } from '../auth/session-context';

/**
 * Audit GraphQL surface.
 *
 * Both queries are restricted to admin + owner. The dashboard hits them in
 * parallel — `auditEvents` for the timeline (cursor-paginated) and
 * `auditStats` for the charts and KPI tiles.
 */

@InputType()
export class AuditFiltersInput {
  @Field({ nullable: true })
  actorUserId?: string;

  @Field({ nullable: true })
  action?: string;

  @Field({ nullable: true })
  actionPrefix?: string;

  @Field({ nullable: true })
  entityType?: string;

  @Field({ nullable: true })
  entityId?: string;

  @Field({ nullable: true })
  search?: string;

  @Field({ nullable: true })
  from?: Date;

  @Field({ nullable: true })
  to?: Date;

  @Field({ nullable: true, description: 'High-impact actions only (approve/confirm/delete/role-change/etc.).' })
  criticalOnly?: boolean;
}

@ObjectType()
export class AuditEventOutput {
  @Field()
  id!: string;

  @Field()
  actorUserId!: string;

  @Field()
  action!: string;

  @Field()
  entityType!: string;

  @Field()
  entityId!: string;

  @Field()
  summary!: string;

  @Field(() => GraphQLJSON, { nullable: true })
  metadata?: any;

  @Field()
  critical!: boolean;

  @Field(() => Date)
  createdAt!: Date;

  @Field(() => GraphQLJSON, { nullable: true })
  actor?: any;
}

@ObjectType()
export class AuditEventsPage {
  @Field(() => [AuditEventOutput])
  events!: AuditEventOutput[];

  @Field({ nullable: true })
  nextCursor?: string;

  @Field(() => Int)
  total!: number;
}

@Resolver()
export class AuditResolver {
  constructor(private audit: AuditService, private prisma: PrismaService) {}

  @Query(() => AuditEventsPage)
  async auditEvents(
    @Context() ctx: GraphqlRequestContext,
    @Args('filters', { nullable: true }) filters?: AuditFiltersInput,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
    @Args('cursor', { nullable: true }) cursor?: string,
  ): Promise<AuditEventsPage> {
    await requireRoles(this.prisma, ctx, ['admin', 'owner']);
    const result = await this.audit.findAll({ filters: filters as any, take, cursor });
    return result as any;
  }

  @Query(() => GraphQLJSON)
  async auditStats(
    @Context() ctx: GraphqlRequestContext,
    @Args('range', { nullable: true }) range?: string,
  ) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner']);
    return this.audit.getStats(range || 'week');
  }

  @Query(() => String, { description: 'CSV export of audit events. Filtered identically to auditEvents.' })
  async auditEventsCsv(
    @Context() ctx: GraphqlRequestContext,
    @Args('filters', { nullable: true }) filters?: AuditFiltersInput,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ): Promise<string> {
    await requireRoles(this.prisma, ctx, ['admin', 'owner']);
    return this.audit.exportCsv(filters as any, take);
  }
}
