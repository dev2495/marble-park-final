import { Args, Context, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-scalars';
import { requireAnyPermission, type GraphqlRequestContext } from '../auth/session-context';
import type { PermissionKey } from '../auth/rbac';
import { PrismaService } from '../prisma/prisma.service';
import { ReportingService } from './reporting.service';

const REPORT_PERMISSIONS: PermissionKey[] = [
  'reports.view', 'reports.executive', 'reports.sales', 'reports.inventory',
  'reports.procurement', 'reports.finance', 'reports.fulfilment', 'reports.audit',
];

@Resolver()
export class ReportingResolver {
  constructor(private reporting: ReportingService, private prisma: PrismaService) {}

  private user(ctx: GraphqlRequestContext) {
    return requireAnyPermission(this.prisma, ctx, REPORT_PERMISSIONS);
  }

  @Query(() => [GraphQLJSON])
  async reportCatalog(@Context() ctx: GraphqlRequestContext) {
    return this.reporting.catalog(await this.user(ctx));
  }

  @Query(() => GraphQLJSON)
  async reportingFilterOptions(@Context() ctx: GraphqlRequestContext) {
    return this.reporting.filterOptions(await this.user(ctx));
  }

  @Query(() => [GraphQLJSON])
  async reportPresets(@Context() ctx: GraphqlRequestContext, @Args('reportId', { nullable: true }) reportId?: string) {
    return this.reporting.presets(await this.user(ctx), reportId);
  }

  @Query(() => GraphQLJSON)
  async reportingReport(
    @Context() ctx: GraphqlRequestContext,
    @Args('reportId') reportId: string,
    @Args('from', { nullable: true }) from?: string,
    @Args('to', { nullable: true }) to?: string,
    @Args('search', { nullable: true }) search?: string,
    @Args('page', { type: () => Int, nullable: true }) page?: number,
    @Args('pageSize', { type: () => Int, nullable: true }) pageSize?: number,
    @Args('sortBy', { nullable: true }) sortBy?: string,
    @Args('sortDirection', { nullable: true }) sortDirection?: string,
    @Args('filters', { type: () => GraphQLJSON, nullable: true }) filters?: Record<string, unknown>,
  ) {
    return this.reporting.report(await this.user(ctx), { reportId, from, to, search, page, pageSize, sortBy, sortDirection, filters });
  }

  @Mutation(() => GraphQLJSON)
  async saveReportPreset(@Context() ctx: GraphqlRequestContext, @Args('input', { type: () => GraphQLJSON }) input: any) {
    return this.reporting.savePreset(await this.user(ctx), input);
  }

  @Mutation(() => Boolean)
  async deleteReportPreset(@Context() ctx: GraphqlRequestContext, @Args('id', { type: () => ID }) id: string) {
    return this.reporting.deletePreset(await this.user(ctx), id);
  }

  @Mutation(() => GraphQLJSON)
  async exportReportingCsv(
    @Context() ctx: GraphqlRequestContext,
    @Args('reportId') reportId: string,
    @Args('from', { nullable: true }) from?: string,
    @Args('to', { nullable: true }) to?: string,
    @Args('search', { nullable: true }) search?: string,
    @Args('sortBy', { nullable: true }) sortBy?: string,
    @Args('sortDirection', { nullable: true }) sortDirection?: string,
    @Args('filters', { type: () => GraphQLJSON, nullable: true }) filters?: Record<string, unknown>,
  ) {
    return this.reporting.exportCsv(await this.user(ctx), { reportId, from, to, search, sortBy, sortDirection, filters });
  }
}
