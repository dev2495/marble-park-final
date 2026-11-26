import { Args, Context, Field, ID, InputType, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-scalars';
import { ForbiddenException } from '@nestjs/common';
import { GraphqlRequestContext, isPrivileged, requirePermission, requireRoles } from '../auth/session-context';
import { PrismaService } from '../prisma/prisma.service';
import { MoneyAmount, TextLimit } from '../common/input-rules';
import { ReceivablesService } from './receivables.service';

@InputType()
class IssueSalesInvoiceInput {
  @Field(() => ID) salesOrderId!: string;
  @Field(() => [ID], { nullable: true }) dispatchLineIds?: string[];
  @Field({ nullable: true }) dueDate?: string;
  @Field({ nullable: true }) notes?: string;
  @Field({ nullable: true }) idempotencyKey?: string;
}

@InputType()
class CustomerPaymentInput {
  @Field(() => ID) customerId!: string;
  @Field(() => ID, { nullable: true }) salesOrderId?: string;
  @Field(() => ID, { nullable: true }) salesInvoiceId?: string;
  @Field() paymentMode!: string;
  @Field({ nullable: true }) moneyAccount?: string;
  @MoneyAmount() @Field() amount!: number;
  @Field({ nullable: true }) receivedAt?: string;
  @Field({ nullable: true }) valueDate?: string;
  @TextLimit(120) @Field({ nullable: true }) reference?: string;
  @TextLimit(2000) @Field({ nullable: true }) notes?: string;
  @Field(() => [String], { nullable: true }) attachmentUrls?: string[];
  @Field({ nullable: true }) autoAllocate?: boolean;
  @Field({ nullable: true }) idempotencyKey?: string;
}

@InputType()
class CustomerCreditProfileInput {
  @MoneyAmount() @Field({ nullable: true }) creditLimit?: number;
  @Field({ nullable: true }) defaultPaymentTerms?: string;
  @Field({ nullable: true }) creditHold?: boolean;
  @Field({ nullable: true }) holdReason?: string;
  @Field(() => ID, { nullable: true }) collectionOwnerId?: string;
}

@InputType()
class CollectionTaskInput {
  @Field(() => ID) customerId!: string;
  @Field(() => ID, { nullable: true }) salesInvoiceId?: string;
  @Field(() => ID, { nullable: true }) ownerId?: string;
  @Field({ nullable: true }) priority?: string;
  @Field({ nullable: true }) dueAt?: string;
  @Field({ nullable: true }) note?: string;
}

@Resolver()
export class ReceivablesResolver {
  constructor(private receivables: ReceivablesService, private prisma: PrismaService) {}

  @Query(() => GraphQLJSON)
  async receivablesDashboard(
    @Context() ctx: GraphqlRequestContext,
    @Args('search', { nullable: true }) search?: string,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
    @Args('skip', { type: () => Int, nullable: true }) skip?: number,
  ) {
    await requirePermission(this.prisma, ctx, 'payments.manage');
    return this.receivables.dashboard({ search, take, skip });
  }

  @Query(() => GraphQLJSON)
  async customerAccount(@Args('customerId', { type: () => ID }) customerId: string, @Context() ctx: GraphqlRequestContext) {
    await requirePermission(this.prisma, ctx, 'payments.manage');
    return this.receivables.customerAccount(customerId);
  }

  @Query(() => [GraphQLJSON])
  async invoiceableOrders(@Context() ctx: GraphqlRequestContext, @Args('take', { type: () => Int, nullable: true }) take?: number) {
    await requirePermission(this.prisma, ctx, 'payments.manage');
    return this.receivables.invoiceableOrders({ take });
  }

  @Query(() => GraphQLJSON)
  async salesInvoice(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    await requirePermission(this.prisma, ctx, 'payments.manage');
    return this.receivables.salesInvoice(id);
  }

  @Query(() => GraphQLJSON)
  async customerPayment(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    await requirePermission(this.prisma, ctx, 'payments.manage');
    return this.receivables.customerPayment(id);
  }

  @Mutation(() => GraphQLJSON)
  async issueSalesInvoice(@Args('input') input: IssueSalesInvoiceInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'payments.manage');
    return this.receivables.issueSalesInvoice(input, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async recordCustomerPayment(@Args('input') input: CustomerPaymentInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'payments.manage');
    return this.receivables.recordCustomerPayment(input, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async allocateCustomerPayment(
    @Args('paymentId', { type: () => ID }) paymentId: string,
    @Args('salesInvoiceId', { type: () => ID }) salesInvoiceId: string,
    @Args('amount') amount: number,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requirePermission(this.prisma, ctx, 'payments.manage');
    return this.receivables.allocateCustomerPayment(paymentId, salesInvoiceId, amount, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async voidCustomerPayment(
    @Args('id', { type: () => ID }) id: string,
    @Context() ctx: GraphqlRequestContext,
    @Args('reason', { type: () => String, nullable: true }) reason?: string,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner']);
    return this.receivables.voidCustomerPayment(id, user.id, reason);
  }

  /** Money going out, so the same roles as voiding a receipt. */
  @Mutation(() => GraphQLJSON)
  async refundOrderAdvance(
    @Args('paymentId', { type: () => ID }) paymentId: string,
    @Args('reason', { type: () => String }) reason: string,
    @Context() ctx: GraphqlRequestContext,
    @Args('refundMode', { type: () => String, nullable: true }) refundMode?: string,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner']);
    return this.receivables.refundOrderAdvance(paymentId, reason, user.id, refundMode);
  }

  /** Re-applies a receipt, so the same right as allocating one. */
  @Mutation(() => GraphQLJSON)
  async moveAdvanceToAccount(
    @Args('paymentId', { type: () => ID }) paymentId: string,
    @Args('reason', { type: () => String }) reason: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requirePermission(this.prisma, ctx, 'payments.manage');
    return this.receivables.moveAdvanceToAccount(paymentId, reason, user.id);
  }

  /** Same roles as voiding a receipt (its closest sibling). */
  @Mutation(() => GraphQLJSON)
  async voidSalesInvoice(
    @Args('id', { type: () => ID }) id: string,
    @Args('reason', { type: () => String }) reason: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner']);
    return this.receivables.voidSalesInvoice(id, reason, user.id);
  }

  @Query(() => GraphQLJSON)
  async customerStatement(
    @Args('customerId', { type: () => ID }) customerId: string,
    @Context() ctx: GraphqlRequestContext,
    @Args('from', { type: () => String, nullable: true }) from?: string,
    @Args('to', { type: () => String, nullable: true }) to?: string,
    @Args('skip', { type: () => Int, nullable: true }) skip?: number,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    await requirePermission(this.prisma, ctx, 'payments.manage');
    return this.receivables.customerStatement(customerId, { from, to, skip, take });
  }

  /** For the sales order PDF "Sent" and "Bal" columns: same access as reading the order. */
  @Query(() => [GraphQLJSON])
  async salesOrderDispatchedQuantities(@Args('salesOrderId', { type: () => ID }) salesOrderId: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff', 'dispatch_ops']);
    if (!isPrivileged(user) && user.role !== 'office_staff' && user.role !== 'dispatch_ops') {
      const order = await this.prisma.salesOrder.findUnique({ where: { id: salesOrderId }, select: { ownerId: true } });
      if (!order || order.ownerId !== user.id) throw new ForbiddenException('This sales order is restricted');
    }
    return this.receivables.salesOrderDispatchedQuantities(salesOrderId);
  }

  @Mutation(() => GraphQLJSON)
  async updateCustomerCreditProfile(
    @Args('customerId', { type: () => ID }) customerId: string,
    @Args('input') input: CustomerCreditProfileInput,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager']);
    return this.receivables.upsertCreditProfile(customerId, input, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async createCollectionTask(@Args('input') input: CollectionTaskInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'payments.manage');
    return this.receivables.createCollectionTask(input, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async completeCollectionTask(
    @Args('id', { type: () => ID }) id: string,
    @Args('outcome', { type: () => String, nullable: true }) outcome: string | undefined,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requirePermission(this.prisma, ctx, 'payments.manage');
    return this.receivables.completeCollectionTask(id, outcome || '', user.id);
  }
}
