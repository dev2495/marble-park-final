import { Args, Context, Field, ID, InputType, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-scalars';
import { GraphqlRequestContext, requireAnyPermission, requirePermission, requireRoles, requireSession } from '../auth/session-context';
import { PrismaService } from '../prisma/prisma.service';
import { ProcurementService } from './procurement.service';

@InputType()
class CreatePurchaseOrderInput {
  @Field(() => [String], { nullable: true })
  demandIds?: string[];

  @Field(() => String, { nullable: true })
  lines?: string;

  @Field({ nullable: true })
  vendorId?: string;

  @Field({ nullable: true })
  vendorName?: string;

  @Field(() => Date, { nullable: true })
  expectedDate?: Date;

  @Field({ nullable: true })
  notes?: string;

  @Field(() => Number, { nullable: true, description: 'Optional PO discount % (0–100). Blank/0 = none.' })
  discountPercent?: number;

  @Field(() => Number, { nullable: true, description: 'Optional GST % (0–100). Blank/0 = no GST.' })
  taxRate?: number;
}

@InputType()
class ReceivePurchaseOrderInput {
  @Field()
  purchaseOrderId!: string;

  @Field({ nullable: true })
  supplierChallan?: string;

  @Field({ nullable: true })
  supplierBill?: string;

  @Field(() => Date, { nullable: true })
  receivedDate?: Date;

  @Field({ nullable: true })
  notes?: string;

  @Field({ nullable: true })
  locationId?: string;

  @Field(() => String, { nullable: true })
  lines?: string;

  @Field({ nullable: true })
  idempotencyKey?: string;
}

@InputType()
class ManualGoodsReceiptInput {
  @Field({ nullable: true })
  vendorId?: string;

  @Field()
  vendorName!: string;

  @Field({ nullable: true })
  supplierChallan?: string;

  @Field({ nullable: true })
  supplierBill?: string;

  @Field(() => Date, { nullable: true })
  receivedDate?: Date;

  @Field({ nullable: true })
  reason?: string;

  @Field({ nullable: true })
  notes?: string;

  @Field({ nullable: true })
  locationId?: string;

  @Field(() => String, { nullable: true })
  lines?: string;

  @Field({ nullable: true })
  idempotencyKey?: string;
}

@Resolver()
export class ProcurementResolver {
  constructor(
    private procurement: ProcurementService,
    private prisma: PrismaService,
  ) {}

  @Query(() => [GraphQLJSON])
  async purchaseDemandQueue(
    @Context() ctx: GraphqlRequestContext,
    @Args('status', { nullable: true }) status?: string,
    @Args('take', { nullable: true }) take?: number,
  ) {
    await requireSession(this.prisma, ctx);
    return this.procurement.purchaseDemandQueue({ status, take });
  }

  @Query(() => [GraphQLJSON])
  async purchaseOrders(
    @Context() ctx: GraphqlRequestContext,
    @Args('status', { nullable: true }) status?: string,
    @Args('take', { nullable: true }) take?: number,
  ) {
    await requireSession(this.prisma, ctx);
    return this.procurement.purchaseOrders({ status, take });
  }

  @Query(() => GraphQLJSON)
  async purchaseOrder(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    await requireSession(this.prisma, ctx);
    return this.procurement.purchaseOrder(id);
  }

  @Query(() => [GraphQLJSON])
  async goodsReceiptNotes(
    @Context() ctx: GraphqlRequestContext,
    @Args('purchaseOrderId', { nullable: true }) purchaseOrderId?: string,
    @Args('take', { nullable: true }) take?: number,
  ) {
    await requireSession(this.prisma, ctx);
    return this.procurement.goodsReceiptNotes({ purchaseOrderId, take });
  }

  @Query(() => GraphQLJSON)
  async procurementSummary(@Context() ctx: GraphqlRequestContext) {
    await requireSession(this.prisma, ctx);
    return this.procurement.procurementSummary();
  }

  @Query(() => GraphQLJSON)
  async purchaseDemandPage(
    @Context() ctx: GraphqlRequestContext,
    @Args('search', { nullable: true }) search?: string,
    @Args('status', { nullable: true }) status?: string,
    @Args('sort', { nullable: true }) sort?: string,
    @Args('skip', { type: () => Int, nullable: true }) skip?: number,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    await requirePermission(this.prisma, ctx, 'procurement.manage', ['admin', 'owner', 'inventory_manager', 'sales_manager', 'sales', 'office_staff', 'dispatch_ops']);
    return this.procurement.purchaseDemandPage({ search, status, sort, skip, take });
  }

  @Query(() => GraphQLJSON)
  async purchaseOrderPage(
    @Context() ctx: GraphqlRequestContext,
    @Args('search', { nullable: true }) search?: string,
    @Args('status', { nullable: true }) status?: string,
    @Args('sort', { nullable: true }) sort?: string,
    @Args('dateFrom', { nullable: true }) dateFrom?: string,
    @Args('dateTo', { nullable: true }) dateTo?: string,
    @Args('skip', { type: () => Int, nullable: true }) skip?: number,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    await requirePermission(this.prisma, ctx, 'procurement.manage', ['admin', 'owner', 'inventory_manager', 'sales_manager', 'office_staff', 'dispatch_ops']);
    return this.procurement.purchaseOrderPage({ search, status, sort, dateFrom, dateTo, skip, take });
  }

  @Query(() => GraphQLJSON)
  async goodsReceiptPage(
    @Context() ctx: GraphqlRequestContext,
    @Args('search', { nullable: true }) search?: string,
    @Args('source', { nullable: true }) source?: string,
    @Args('sort', { nullable: true }) sort?: string,
    @Args('dateFrom', { nullable: true }) dateFrom?: string,
    @Args('dateTo', { nullable: true }) dateTo?: string,
    @Args('skip', { type: () => Int, nullable: true }) skip?: number,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    await requireAnyPermission(this.prisma, ctx, ['procurement.manage', 'goods_receipts.manage'], ['admin', 'owner', 'inventory_manager', 'sales_manager', 'office_staff', 'dispatch_ops']);
    return this.procurement.goodsReceiptPage({ search, source, sort, dateFrom, dateTo, skip, take });
  }

  @Mutation(() => GraphQLJSON)
  async createPurchaseOrder(@Args('input') input: CreatePurchaseOrderInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'procurement.manage');
    return this.procurement.createPurchaseOrder(input as any, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async updatePurchaseOrderStatus(
    @Args('id', { type: () => ID }) id: string,
    @Args('status') status: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requirePermission(this.prisma, ctx, 'procurement.manage');
    return this.procurement.updatePurchaseOrderStatus(id, status, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async cancelPurchaseOrder(
    @Args('id', { type: () => ID }) id: string,
    @Args('reason') reason: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner']);
    return this.procurement.cancelPurchaseOrder(id, reason, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async receivePurchaseOrder(@Args('input') input: ReceivePurchaseOrderInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'goods_receipts.manage');
    return this.procurement.receivePurchaseOrder(input as any, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async createManualGoodsReceipt(@Args('input') input: ManualGoodsReceiptInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'goods_receipts.manage');
    return this.procurement.createManualGoodsReceipt(input as any, user.id);
  }
}
