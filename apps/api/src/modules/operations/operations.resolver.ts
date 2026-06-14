import { Args, Context, Field, ID, InputType, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-scalars';
import { GraphqlRequestContext, requirePermission, requireSession } from '../auth/session-context';
import { PrismaService } from '../prisma/prisma.service';
import { OperationsService } from './operations.service';

@InputType()
class StockCountInput {
  @Field({ nullable: true }) scope?: string;
  @Field({ nullable: true }) locationId?: string;
  @Field({ nullable: true }) notes?: string;
  @Field(() => String) lines!: string;
  @Field({ nullable: true }) submit?: boolean;
}

@InputType()
class ReturnOrderInput {
  @Field({ nullable: true }) salesOrderId?: string;
  @Field({ nullable: true }) challanId?: string;
  @Field({ nullable: true }) customerId?: string;
  @Field({ nullable: true }) locationId?: string;
  @Field() reason!: string;
  @Field({ nullable: true }) refundMode?: string;
  @Field({ nullable: true }) refundAmount?: number;
  @Field(() => String) lines!: string;
  @Field({ nullable: true }) receive?: boolean;
  @Field(() => GraphQLJSON, { nullable: true }) metadata?: any;
}

@InputType()
class StockLocationInput {
  @Field({ nullable: true }) code?: string;
  @Field() name!: string;
  @Field({ nullable: true }) type?: string;
  @Field({ nullable: true }) status?: string;
  @Field({ nullable: true }) address?: string;
  @Field({ nullable: true }) sortOrder?: number;
  @Field({ nullable: true }) defaultStockScope?: boolean;
  @Field(() => GraphQLJSON, { nullable: true }) metadata?: any;
}

@Resolver()
export class OperationsResolver {
  constructor(private operations: OperationsService, private prisma: PrismaService) {}

  @Query(() => [GraphQLJSON])
  async documentJobs(
    @Context() ctx: GraphqlRequestContext,
    @Args('entityType', { nullable: true }) entityType?: string,
    @Args('entityId', { nullable: true }) entityId?: string,
    @Args('status', { nullable: true }) status?: string,
    @Args('take', { nullable: true }) take?: number,
  ) {
    await requireSession(this.prisma, ctx);
    return this.operations.documentJobs({ entityType, entityId, status, take });
  }

  @Query(() => [GraphQLJSON])
  async paymentReceipts(
    @Context() ctx: GraphqlRequestContext,
    @Args('salesOrderId', { nullable: true }) salesOrderId?: string,
    @Args('customerId', { nullable: true }) customerId?: string,
    @Args('status', { nullable: true }) status?: string,
    @Args('take', { nullable: true }) take?: number,
  ) {
    await requireSession(this.prisma, ctx);
    return this.operations.paymentReceipts({ salesOrderId, customerId, status, take });
  }

  @Query(() => [GraphQLJSON])
  async stockLocations(@Context() ctx: GraphqlRequestContext, @Args('status', { nullable: true }) status?: string) {
    await requireSession(this.prisma, ctx);
    return this.operations.stockLocations({ status });
  }

  @Query(() => [GraphQLJSON])
  async stockLocationBalances(
    @Context() ctx: GraphqlRequestContext,
    @Args('locationId', { nullable: true }) locationId?: string,
    @Args('productId', { nullable: true }) productId?: string,
    @Args('take', { nullable: true }) take?: number,
  ) {
    await requireSession(this.prisma, ctx);
    return this.operations.stockLocationBalances({ locationId, productId, take });
  }

  @Mutation(() => GraphQLJSON)
  async createStockLocation(@Args('input') input: StockLocationInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'stock_locations.manage');
    return this.operations.createStockLocation(input as any, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async updateStockLocation(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: StockLocationInput,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requirePermission(this.prisma, ctx, 'stock_locations.manage');
    return this.operations.updateStockLocation(id, input as any, user.id);
  }

  @Query(() => [GraphQLJSON])
  async stockLedgerEntries(
    @Context() ctx: GraphqlRequestContext,
    @Args('productId', { nullable: true }) productId?: string,
    @Args('referenceId', { nullable: true }) referenceId?: string,
    @Args('take', { nullable: true }) take?: number,
  ) {
    await requireSession(this.prisma, ctx);
    return this.operations.stockLedgerEntries({ productId, referenceId, take });
  }

  @Query(() => [GraphQLJSON])
  async stockCountSessions(
    @Context() ctx: GraphqlRequestContext,
    @Args('status', { nullable: true }) status?: string,
    @Args('take', { nullable: true }) take?: number,
  ) {
    await requireSession(this.prisma, ctx);
    return this.operations.stockCountSessions({ status, take });
  }

  @Mutation(() => GraphQLJSON)
  async createStockCountSession(@Args('input') input: StockCountInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'stock_counts.manage');
    return this.operations.createStockCountSession(input as any, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async approveStockCountSession(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'stock_counts.manage');
    return this.operations.approveStockCountSession(id, user.id);
  }

  @Query(() => [GraphQLJSON])
  async returnOrders(
    @Context() ctx: GraphqlRequestContext,
    @Args('status', { nullable: true }) status?: string,
    @Args('take', { nullable: true }) take?: number,
  ) {
    await requireSession(this.prisma, ctx);
    return this.operations.returnOrders({ status, take });
  }

  @Mutation(() => GraphQLJSON)
  async createReturnOrder(@Args('input') input: ReturnOrderInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'returns.manage');
    return this.operations.createReturnOrder(input as any, user.id);
  }

  @Query(() => GraphQLJSON)
  async stockReconciliation(
    @Context() ctx: GraphqlRequestContext,
    @Args('productId', { nullable: true }) productId?: string,
    @Args('take', { nullable: true }) take?: number,
  ) {
    await requirePermission(this.prisma, ctx, 'inventory.manage');
    return this.operations.stockReconciliation({ productId, take });
  }

  @Query(() => GraphQLJSON)
  async productionReadinessSummary(@Context() ctx: GraphqlRequestContext) {
    await requirePermission(this.prisma, ctx, 'reports.view');
    return this.operations.productionReadinessSummary();
  }
}
