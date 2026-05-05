import { Resolver, Query, Args, ObjectType, Field, Context } from '@nestjs/graphql';
import { DashboardsService } from './dashboards.service';
import { GraphQLJSON } from 'graphql-scalars';
import { GraphqlRequestContext, isPrivileged, requireSession } from '../auth/session-context';
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

  @Query(() => DashboardOutput)
  async ownerDashboard(@Context() ctx: GraphqlRequestContext) {
    await requireSession(this.prisma, ctx);
    return this.dashboards.getOwnerDashboard() as any;
  }

  @Query(() => DashboardOutput)
  async salesDashboard(@Args('ownerId') ownerId: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requireSession(this.prisma, ctx);
    return this.dashboards.getSalesDashboard(isPrivileged(user) ? ownerId : user.id) as any;
  }

  @Query(() => DashboardOutput)
  async inventoryDashboard(@Context() ctx: GraphqlRequestContext) {
    await requireSession(this.prisma, ctx);
    return this.dashboards.getInventoryDashboard() as any;
  }
}
