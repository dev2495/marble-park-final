import { Args, Context, Field, ID, InputType, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-scalars';
import { GraphqlRequestContext, requirePermission, requireSession } from '../auth/session-context';
import { PrismaService } from '../prisma/prisma.service';
import { OperationsService } from './operations.service';

@InputType()
class StockCountInput {
  @Field({ nullable: true }) scope?: string;
  @Field({ nullable: true }) locationId?: string;
  @Field({ nullable: true }) countType?: string;
  @Field({ nullable: true }) periodKey?: string;
  @Field({ nullable: true }) effectiveAt?: string;
  @Field({ nullable: true }) device?: string;
  @Field({ nullable: true }) notes?: string;
  @Field(() => String) lines!: string;
  @Field({ nullable: true }) submit?: boolean;
}

@InputType()
class OpeningStockInput {
  @Field({ nullable: true }) locationId?: string;
  @Field({ nullable: true }) effectiveAt?: string;
  @Field({ nullable: true }) fiscalYear?: string;
  @Field({ nullable: true }) valuationMode?: string;
  @Field({ nullable: true }) notes?: string;
  @Field({ nullable: true }) ownerOverrideReason?: string;
  @Field(() => String) lines!: string;
  @Field({ nullable: true }) submit?: boolean;
}

@InputType()
class StockTransferInput {
  @Field() sourceLocationId!: string;
  @Field() destinationLocationId!: string;
  @Field({ nullable: true }) notes?: string;
  @Field(() => String) lines!: string;
  @Field({ nullable: true }) submit?: boolean;
}

@InputType()
class StockTransferTransitionInput {
  @Field(() => String, { nullable: true }) lines?: string;
  @Field({ nullable: true }) reason?: string;
}

@InputType()
class InventoryPeriodCloseInput {
  @Field() periodType!: string;
  @Field() periodKey!: string;
  @Field({ nullable: true }) countSessionId?: string;
  @Field({ nullable: true }) effectiveAt?: string;
  @Field({ nullable: true }) notes?: string;
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
  @Field({ nullable: true }) idempotencyKey?: string;
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

@InputType()
class InternalLabelJobInput {
  @Field({ nullable: true }) sourceType?: string;
  @Field({ nullable: true }) sourceId?: string;
  @Field({ nullable: true }) productId?: string;
  @Field({ nullable: true }) lotId?: string;
  @Field({ nullable: true }) displaySampleId?: string;
  @Field({ nullable: true }) template?: string;
  @Field({ nullable: true }) newJob?: boolean;
  @Field() quantity!: number;
}

@InputType()
class InternalLabelPrintRunInput {
  @Field(() => ID) labelJobId!: string;
  @Field() templateCode!: string;
  @Field(() => [ID], { nullable: true }) labelIds?: string[];
  @Field(() => Int, { nullable: true }) copies?: number;
  @Field({ nullable: true }) reason?: string;
}

@InputType()
class InternalLabelScanInput {
  @Field({ nullable: true }) action?: string;
  @Field({ nullable: true }) locationId?: string;
  @Field({ nullable: true }) entityType?: string;
  @Field({ nullable: true }) entityId?: string;
  @Field(() => GraphQLJSON, { nullable: true }) metadata?: any;
}

@InputType()
class StockAdjustmentRequestInput {
  @Field() productId!: string;
  @Field() lotId!: string;
  @Field() locationId!: string;
  @Field() quantity!: number;
  @Field() type!: string;
  @Field() reason!: string;
  @Field({ nullable: true }) referenceId?: string;
  @Field(() => GraphQLJSON, { nullable: true }) metadata?: any;
}

@InputType()
class StockAdjustmentDecisionInput {
  @Field({ nullable: true }) reason?: string;
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
    @Args('take', { type: () => Int, nullable: true }) take?: number,
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
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    await requireSession(this.prisma, ctx);
    return this.operations.paymentReceipts({ salesOrderId, customerId, status, take });
  }

  @Query(() => [GraphQLJSON])
  async creditNotes(
    @Context() ctx: GraphqlRequestContext,
    @Args('salesOrderId', { nullable: true }) salesOrderId?: string,
    @Args('customerId', { nullable: true }) customerId?: string,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    await requirePermission(this.prisma, ctx, 'reports.view');
    return this.operations.creditNotes({ salesOrderId, customerId, take });
  }

  @Query(() => GraphQLJSON)
  async managementReport(
    @Context() ctx: GraphqlRequestContext,
    @Args('from', { nullable: true }) from?: string,
    @Args('to', { nullable: true }) to?: string,
  ) {
    await requirePermission(this.prisma, ctx, 'reports.view');
    return this.operations.managementReport({ from, to });
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
    @Args('take', { type: () => Int, nullable: true }) take?: number,
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
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    await requireSession(this.prisma, ctx);
    return this.operations.stockLedgerEntries({ productId, referenceId, take });
  }

  @Query(() => [GraphQLJSON])
  async stockCountSessions(
    @Context() ctx: GraphqlRequestContext,
    @Args('status', { nullable: true }) status?: string,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    await requireSession(this.prisma, ctx);
    return this.operations.stockCountSessions({ status, take });
  }

  @Query(() => [GraphQLJSON])
  async inventoryLots(
    @Context() ctx: GraphqlRequestContext,
    @Args('productId', { nullable: true }) productId?: string,
    @Args('locationId', { nullable: true }) locationId?: string,
    @Args('status', { nullable: true }) status?: string,
    @Args('search', { nullable: true }) search?: string,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    await requirePermission(this.prisma, ctx, 'inventory.manage');
    return this.operations.inventoryLots({ productId, locationId, status, search, take });
  }

  @Query(() => [GraphQLJSON])
  async openingStockSessions(
    @Context() ctx: GraphqlRequestContext,
    @Args('status', { nullable: true }) status?: string,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    await requirePermission(this.prisma, ctx, 'inventory.manage');
    return this.operations.openingStockSessions({ status, take });
  }

  @Mutation(() => GraphQLJSON)
  async createOpeningStockSession(@Args('input') input: OpeningStockInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'inventory.manage');
    return this.operations.createOpeningStockSession(input as any, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async approveOpeningStockSession(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'inventory.manage');
    return this.operations.approveOpeningStockSession(id, user.id);
  }

  @Query(() => [GraphQLJSON])
  async stockTransfers(
    @Context() ctx: GraphqlRequestContext,
    @Args('status', { nullable: true }) status?: string,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    await requirePermission(this.prisma, ctx, 'inventory.manage');
    return this.operations.stockTransfers({ status, take });
  }

  @Mutation(() => GraphQLJSON)
  async createStockTransfer(@Args('input') input: StockTransferInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'inventory.manage');
    return this.operations.createStockTransfer(input as any, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async transitionStockTransfer(
    @Args('id', { type: () => ID }) id: string,
    @Args('action') action: string,
    @Args('input', { type: () => StockTransferTransitionInput, nullable: true }) input: StockTransferTransitionInput | undefined,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requirePermission(this.prisma, ctx, 'inventory.manage');
    return this.operations.transitionStockTransfer(id, action, input as any, user.id);
  }

  @Query(() => [GraphQLJSON])
  async inventoryPeriodCloses(
    @Context() ctx: GraphqlRequestContext,
    @Args('status', { nullable: true }) status?: string,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    await requirePermission(this.prisma, ctx, 'stock_counts.manage');
    return this.operations.inventoryPeriodCloses({ status, take });
  }

  @Mutation(() => GraphQLJSON)
  async closeInventoryPeriod(@Args('input') input: InventoryPeriodCloseInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'stock_counts.manage');
    return this.operations.closeInventoryPeriod(input as any, user.id);
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
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    await requireSession(this.prisma, ctx);
    return this.operations.returnOrders({ status, take });
  }

  @Query(() => [GraphQLJSON])
  async returnableDispatchLines(
    @Context() ctx: GraphqlRequestContext,
    @Args('search', { nullable: true }) search?: string,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    await requirePermission(this.prisma, ctx, 'returns.manage');
    return this.operations.returnableDispatchLines({ search, take });
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
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    await requirePermission(this.prisma, ctx, 'inventory.manage');
    return this.operations.stockReconciliation({ productId, take });
  }

  @Query(() => [GraphQLJSON])
  async internalLabelJobs(
    @Context() ctx: GraphqlRequestContext,
    @Args('sourceType', { nullable: true }) sourceType?: string,
    @Args('sourceId', { nullable: true }) sourceId?: string,
    @Args('status', { nullable: true }) status?: string,
    @Args('search', { nullable: true }) search?: string,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
    @Args('skip', { type: () => Int, nullable: true }) skip?: number,
  ) {
    await requirePermission(this.prisma, ctx, 'inventory.manage');
    return this.operations.internalLabelJobs({ sourceType, sourceId, status, search, take, skip });
  }

  @Query(() => [GraphQLJSON])
  async internalLabelTemplates(@Context() ctx: GraphqlRequestContext) {
    await requirePermission(this.prisma, ctx, 'inventory.manage');
    return this.operations.internalLabelTemplates();
  }

  @Query(() => GraphQLJSON)
  async internalLabelPrintRun(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    await requirePermission(this.prisma, ctx, 'inventory.manage');
    return this.operations.internalLabelPrintRun(id);
  }

  @Query(() => GraphQLJSON)
  async internalLabelPrintData(
    @Args('id', { type: () => ID }) id: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    await requirePermission(this.prisma, ctx, 'inventory.manage');
    return this.operations.internalLabelPrintData(id);
  }

  @Mutation(() => GraphQLJSON)
  async createInternalLabelJob(@Args('input') input: InternalLabelJobInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'inventory.manage');
    return this.operations.createInternalLabelJob(input as any, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async printInternalLabelJob(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'inventory.manage');
    return this.operations.printInternalLabelJob(id, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async prepareInternalLabelPrintRun(@Args('input') input: InternalLabelPrintRunInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'inventory.manage');
    return this.operations.prepareInternalLabelPrintRun(input as any, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async confirmInternalLabelPrintRun(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'inventory.manage');
    return this.operations.confirmInternalLabelPrintRun(id, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async cancelInternalLabelPrintRun(
    @Args('id', { type: () => ID }) id: string,
    @Args('reason') reason: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requirePermission(this.prisma, ctx, 'inventory.manage');
    return this.operations.cancelInternalLabelPrintRun(id, reason, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async scanInternalLabel(
    @Args('labelCode') labelCode: string,
    @Args('input', { type: () => InternalLabelScanInput, nullable: true }) input: InternalLabelScanInput | undefined,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requireSession(this.prisma, ctx);
    return this.operations.scanInternalLabel(labelCode, input as any, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async voidInternalLabel(
    @Args('id', { type: () => ID }) id: string,
    @Args('reason') reason: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requirePermission(this.prisma, ctx, 'inventory.manage');
    return this.operations.voidInternalLabel(id, reason, user.id);
  }

  @Query(() => [GraphQLJSON])
  async stockAdjustmentRequests(
    @Context() ctx: GraphqlRequestContext,
    @Args('status', { nullable: true }) status?: string,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    await requirePermission(this.prisma, ctx, 'inventory.manage');
    return this.operations.stockAdjustmentRequests({ status, take });
  }

  @Mutation(() => GraphQLJSON)
  async requestStockAdjustment(@Args('input') input: StockAdjustmentRequestInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'inventory.manage');
    return this.operations.requestStockAdjustment(input as any, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async decideStockAdjustment(
    @Args('id', { type: () => ID }) id: string,
    @Args('action') action: string,
    @Args('input', { type: () => StockAdjustmentDecisionInput, nullable: true }) input: StockAdjustmentDecisionInput | undefined,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requirePermission(this.prisma, ctx, 'stock_counts.manage');
    return this.operations.decideStockAdjustment(id, action, input as any, user.id);
  }

  @Query(() => GraphQLJSON)
  async productionReadinessSummary(@Context() ctx: GraphqlRequestContext) {
    await requirePermission(this.prisma, ctx, 'reports.view');
    return this.operations.productionReadinessSummary();
  }
}
