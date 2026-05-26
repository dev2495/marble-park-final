import { Args, Context, Field, Float, ID, InputType, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-scalars';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { GraphqlRequestContext, requireRoles } from '../auth/session-context';

@ObjectType()
export class PaymentOutput {
  @Field(() => ID) id!: string;
  @Field() salesOrderId!: string;
  @Field({ nullable: true }) customerId?: string;
  @Field(() => Float) amount!: number;
  @Field() mode!: string;
  @Field({ nullable: true }) reference?: string;
  @Field({ nullable: true }) notes?: string;
  @Field() recordedBy!: string;
  @Field() direction!: string;
  @Field() paidAt!: Date;
  @Field() createdAt!: Date;
}

@InputType()
export class RecordPaymentInput {
  @Field() salesOrderId!: string;
  @Field(() => Float) amount!: number;
  @Field() mode!: string;
  @Field({ nullable: true }) reference?: string;
  @Field({ nullable: true }) notes?: string;
  @Field({ nullable: true, description: 'incoming (default) or refund' }) direction?: string;
  @Field({ nullable: true }) paidAt?: Date;
}

@Resolver()
export class PaymentsResolver {
  constructor(private payments: PaymentsService, private prisma: PrismaService) {}

  @Mutation(() => PaymentOutput)
  async recordPayment(@Args('input') input: RecordPaymentInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['owner', 'admin', 'sales_manager', 'sales', 'office_staff']);
    return this.payments.record({ ...input, direction: (input.direction as any) || 'incoming' }, user.id);
  }

  @Mutation(() => Boolean)
  async deletePayment(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['owner', 'admin']);
    await this.payments.remove(id, user.id);
    return true;
  }

  @Query(() => [PaymentOutput], { name: 'paymentsForOrder' })
  async paymentsForOrder(@Args('salesOrderId') salesOrderId: string, @Context() ctx: GraphqlRequestContext) {
    await requireRoles(this.prisma, ctx, ['owner', 'admin', 'sales_manager', 'sales', 'office_staff', 'inventory_manager', 'dispatch_ops']);
    return this.payments.listForOrder(salesOrderId);
  }

  @Query(() => [PaymentOutput], { name: 'paymentsForCustomer' })
  async paymentsForCustomer(@Args('customerId') customerId: string, @Context() ctx: GraphqlRequestContext) {
    await requireRoles(this.prisma, ctx, ['owner', 'admin', 'sales_manager', 'sales', 'office_staff']);
    return this.payments.listForCustomer(customerId);
  }

  @Query(() => GraphQLJSON, { name: 'orderPaymentSummary' })
  async orderPaymentSummary(@Args('salesOrderId') salesOrderId: string, @Context() ctx: GraphqlRequestContext) {
    await requireRoles(this.prisma, ctx, ['owner', 'admin', 'sales_manager', 'sales', 'office_staff', 'inventory_manager', 'dispatch_ops']);
    return this.payments.orderPaymentSummary(salesOrderId);
  }

  @Query(() => [PaymentOutput], { name: 'payments' })
  async paymentsList(
    @Context() ctx: GraphqlRequestContext,
    @Args('from', { nullable: true }) from?: Date,
    @Args('to', { nullable: true }) to?: Date,
    @Args('mode', { nullable: true }) mode?: string,
  ) {
    await requireRoles(this.prisma, ctx, ['owner', 'admin', 'sales_manager', 'office_staff']);
    return this.payments.listAll({ from, to, mode });
  }
}
