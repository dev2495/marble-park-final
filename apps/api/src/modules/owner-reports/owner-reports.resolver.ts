import { Args, Context, Field, InputType, Mutation, Query, Resolver } from '@nestjs/graphql';
import { ForbiddenException } from '@nestjs/common';
import { GraphQLJSON } from 'graphql-scalars';
import { GraphqlRequestContext, requireSession } from '../auth/session-context';
import { canViewCommercialCost } from '../common/cost-visibility';
import { PrismaService } from '../prisma/prisma.service';
import { OwnerReportsService, REPORT_PERMISSIONS } from './owner-reports.service';

@InputType()
class OwnerReportFilters {
  @Field({ nullable: true }) preset?: string;
  @Field({ nullable: true }) from?: string;
  @Field({ nullable: true }) to?: string;
  @Field({ nullable: true }) brand?: string;
  @Field({ nullable: true }) category?: string;
  @Field({ nullable: true }) ownerId?: string;
  @Field({ nullable: true }) locationId?: string;
  @Field({ nullable: true }) tab?: string;
}

@Resolver()
export class OwnerReportsResolver {
  constructor(private reports: OwnerReportsService, private prisma: PrismaService) {}

  private async viewer(ctx: GraphqlRequestContext) {
    const user = await requireSession(this.prisma, ctx);
    return { user, viewer: { id: user.id, role: user.role, canCost: canViewCommercialCost(user) } };
  }

  private assertAccess(user: any, kind: string) {
    const needed = REPORT_PERMISSIONS[kind];
    if (!needed) throw new ForbiddenException('Unknown report');
    if (!['owner', 'admin'].includes(user.role) && !needed.some((key) => user.effectivePermissions.includes(key))) throw new ForbiddenException('You do not have access to this report');
  }

  @Query(() => GraphQLJSON)
  async ownerReportOptions(@Context() ctx: GraphqlRequestContext) {
    const { user, viewer } = await this.viewer(ctx);
    const allowed = Object.keys(REPORT_PERMISSIONS).filter((kind) => ['owner', 'admin'].includes(user.role) || REPORT_PERMISSIONS[kind].some((key) => user.effectivePermissions.includes(key as any)));
    return { ...(await this.reports.options(viewer)), allowed, canCost: viewer.canCost };
  }

  @Query(() => GraphQLJSON)
  async ownerReport(@Args('kind') kind: string, @Context() ctx: GraphqlRequestContext, @Args('filters', { type: () => OwnerReportFilters, nullable: true }) filters?: OwnerReportFilters) {
    const { user, viewer } = await this.viewer(ctx);
    this.assertAccess(user, kind);
    return this.reports.report(kind, filters || {}, viewer);
  }

  @Query(() => GraphQLJSON)
  async ownerCommandCenter(@Context() ctx: GraphqlRequestContext, @Args('filters', { type: () => OwnerReportFilters, nullable: true }) filters?: OwnerReportFilters) {
    const { user, viewer } = await this.viewer(ctx);
    if (!['owner', 'admin'].includes(user.role)) throw new ForbiddenException('This dashboard is for owners');
    return this.reports.dashboard(filters || {}, viewer);
  }

  @Mutation(() => GraphQLJSON)
  async exportOwnerReport(@Args('kind') kind: string, @Context() ctx: GraphqlRequestContext, @Args('filters', { type: () => OwnerReportFilters, nullable: true }) filters?: OwnerReportFilters) {
    const { user, viewer } = await this.viewer(ctx);
    this.assertAccess(user, kind);
    if (!['owner', 'admin'].includes(user.role) && !user.effectivePermissions.includes('reports.export')) throw new ForbiddenException('You do not have permission to download reports');
    return this.reports.exportFile(kind, filters || {}, viewer);
  }
}
