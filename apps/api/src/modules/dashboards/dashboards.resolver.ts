import { Resolver, Query, Args, ObjectType, Field, Context } from '@nestjs/graphql';
import { DashboardsService } from './dashboards.service';
import { GraphQLJSON } from 'graphql-scalars';
import { GraphqlRequestContext, isPrivileged, requireAnyPermission, requireSession } from '../auth/session-context';
import { hasPermission } from '../auth/rbac';
import { PrismaService } from '../prisma/prisma.service';

@ObjectType()
export class DashboardOutput {
  @Field(() => GraphQLJSON)
  stats!: any;

  @Field(() => [GraphQLJSON], { nullable: true })
  recentQuotes?: any[];

  @Field(() => [GraphQLJSON], { nullable: true })
  recentLeads?: any[];

  @Field(() => [GraphQLJSON], { nullable: true })
  pendingFollowups?: any[];

  @Field(() => [GraphQLJSON], { nullable: true })
  userPerformance?: any[];

  @Field(() => GraphQLJSON, { nullable: true })
  summary?: any;

  @Field(() => GraphQLJSON, { nullable: true })
  analytics?: any;
}

@Resolver()
export class DashboardsResolver {
  constructor(
    private dashboards: DashboardsService,
    private prisma: PrismaService,
  ) {}

  // Callers today: owner/admin command centre, sales manager dashboard, Users
  // page (users.manage), and the office staff dashboard (recent quotes only).
  @Query(() => DashboardOutput)
  async ownerDashboard(@Context() ctx: GraphqlRequestContext) {
    const user = await requireAnyPermission(this.prisma, ctx, ['users.manage', 'reports.executive'], ['admin', 'owner', 'sales_manager', 'office_staff']);
    const full = isPrivileged(user) || hasPermission(user, 'users.manage') || hasPermission(user, 'reports.executive');
    const result = await this.dashboards.getOwnerDashboard();
    // Office staff use only the recent quotes list; company totals and per-salesperson figures stay with managers.
    return (full ? result : { stats: {}, recentQuotes: result.recentQuotes, recentLeads: [], userPerformance: [], analytics: {} }) as any;
  }

  @Query(() => DashboardOutput)
  async salesDashboard(@Args('ownerId') ownerId: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requireSession(this.prisma, ctx);
    return this.dashboards.getSalesDashboard(isPrivileged(user) ? ownerId : user.id) as any;
  }

  @Query(() => DashboardOutput)
  async inventoryDashboard(@Context() ctx: GraphqlRequestContext) {
    // Same rule as the Inventory menu entry and the stock reports.
    await requireAnyPermission(this.prisma, ctx, ['inventory.manage', 'reports.inventory'], ['admin', 'owner', 'inventory_manager']);
    return this.dashboards.getInventoryDashboard() as any;
  }
}
