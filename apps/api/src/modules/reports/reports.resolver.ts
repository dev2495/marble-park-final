import { Args, Context, Int, Query, Resolver } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-scalars';
import { ReportsService } from './reports.service';
import { PrismaService } from '../prisma/prisma.service';
import { GraphqlRequestContext, requireRoles } from '../auth/session-context';

@Resolver()
export class ReportsResolver {
  constructor(private reports: ReportsService, private prisma: PrismaService) {}

  private async gate(ctx: GraphqlRequestContext) {
    return requireRoles(this.prisma, ctx, ['owner', 'admin', 'sales_manager', 'inventory_manager', 'office_staff']);
  }

  // New comprehensive reports board — single query per tab returns everything
  // needed to render that tab. 30s cache, parallel sub-queries inside.
  @Query(() => GraphQLJSON, { name: 'reportsBoard' })
  async reportsBoard(
    @Context() ctx: GraphqlRequestContext,
    @Args('tab') tab: string,
    @Args('from', { nullable: true }) from?: Date,
    @Args('to', { nullable: true }) to?: Date,
    @Args('compare', { nullable: true }) compare?: boolean,
    @Args('segment', { nullable: true }) segment?: string,
  ) {
    await this.gate(ctx);
    return this.reports.boardData(tab as any, { from, to, compare, segment: segment as any });
  }

  @Query(() => GraphQLJSON, { name: 'reportMonthlySalesByCategory' })
  async reportMonthlySalesByCategory(
    @Context() ctx: GraphqlRequestContext,
    @Args('from', { nullable: true }) from?: Date,
    @Args('to', { nullable: true }) to?: Date,
  ) {
    await this.gate(ctx);
    return this.reports.monthlySalesByCategory({ from, to });
  }

  @Query(() => GraphQLJSON, { name: 'reportTopCustomers' })
  async reportTopCustomers(
    @Context() ctx: GraphqlRequestContext,
    @Args('from', { nullable: true }) from?: Date,
    @Args('to', { nullable: true }) to?: Date,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
  ) {
    await this.gate(ctx);
    return this.reports.topCustomers({ from, to }, limit || 25);
  }

  @Query(() => GraphQLJSON, { name: 'reportDeadStock' })
  async reportDeadStock(
    @Context() ctx: GraphqlRequestContext,
    @Args('days', { type: () => Int, nullable: true }) days?: number,
  ) {
    await this.gate(ctx);
    return this.reports.deadStock(days || 90);
  }

  @Query(() => GraphQLJSON, { name: 'reportConversionFunnel' })
  async reportConversionFunnel(
    @Context() ctx: GraphqlRequestContext,
    @Args('from', { nullable: true }) from?: Date,
    @Args('to', { nullable: true }) to?: Date,
  ) {
    await this.gate(ctx);
    return this.reports.conversionFunnel({ from, to });
  }

  @Query(() => GraphQLJSON, { name: 'reportPendingDispatchAgeing' })
  async reportPendingDispatchAgeing(@Context() ctx: GraphqlRequestContext) {
    await this.gate(ctx);
    return this.reports.pendingDispatchAgeing();
  }

  @Query(() => GraphQLJSON, { name: 'reportReceivablesAgeing' })
  async reportReceivablesAgeing(@Context() ctx: GraphqlRequestContext) {
    await this.gate(ctx);
    return this.reports.receivablesAgeing();
  }

  // CSV exporters — return a string with the CSV body. Client streams to file.
  @Query(() => String, { name: 'reportCsv' })
  async reportCsv(
    @Args('kind') kind: string,
    @Context() ctx: GraphqlRequestContext,
    @Args('from', { nullable: true }) from?: Date,
    @Args('to', { nullable: true }) to?: Date,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
    @Args('days', { type: () => Int, nullable: true }) days?: number,
  ) {
    await this.gate(ctx);
    let rows: any[];
    switch (kind) {
      case 'monthly_sales_by_category':
        rows = await this.reports.monthlySalesByCategory({ from, to });
        break;
      case 'top_customers':
        rows = await this.reports.topCustomers({ from, to }, limit || 50);
        break;
      case 'dead_stock':
        rows = await this.reports.deadStock(days || 90);
        break;
      case 'conversion_funnel':
        rows = await this.reports.conversionFunnel({ from, to });
        break;
      case 'pending_dispatch_ageing':
        rows = await this.reports.pendingDispatchAgeing();
        break;
      case 'receivables_ageing':
        rows = await this.reports.receivablesAgeing();
        break;
      default:
        rows = [];
    }
    return this.reports.toCsv(rows);
  }
}
