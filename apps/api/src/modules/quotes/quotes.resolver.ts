import { Resolver, Query, Mutation, Args, ID, InputType, Field, ObjectType, Context } from '@nestjs/graphql';
import { QuotesService } from './quotes.service';
import { PrismaService } from '../prisma/prisma.service';
import { GraphqlRequestContext, isPrivileged, requireRoles, requireSession } from '../auth/session-context';
import { GraphQLJSON } from 'graphql-scalars';

@ObjectType()
export class QuoteOutput {
  @Field()
  id!: string;

  @Field({ nullable: true })
  quoteNumber?: string;

  @Field({ nullable: true })
  title?: string;

  @Field({ nullable: true })
  status?: string;

  @Field({ nullable: true })
  approvalStatus?: string;

  @Field(() => Number, { nullable: true })
  discountPercent?: number;

  @Field({ nullable: true })
  displayMode?: string;

  @Field({ nullable: true })
  projectName?: string;

  @Field(() => Date, { nullable: true })
  createdAt?: Date;

  @Field(() => Date, { nullable: true })
  validUntil?: Date;

  @Field(() => Date, { nullable: true })
  sentAt?: Date;

  @Field(() => Date, { nullable: true })
  confirmedAt?: Date;

  @Field({ nullable: true })
  notes?: string;

  @Field(() => GraphQLJSON, { nullable: true })
  lines?: any;

  @Field(() => GraphQLJSON, { nullable: true })
  quoteMeta?: any;

  @Field(() => GraphQLJSON, { nullable: true })
  customer?: any;

  @Field(() => GraphQLJSON, { nullable: true })
  owner?: any;

  @Field(() => GraphQLJSON, { nullable: true })
  lead?: any;

  @Field(() => GraphQLJSON, { nullable: true })
  approval?: any;
}

@InputType()
export class CreateQuoteInput {
  @Field(() => String, { nullable: true })
  leadId?: string;

  @Field(() => String, { nullable: true })
  customerId?: string;

  @Field(() => String, { nullable: true })
  ownerId?: string;

  @Field(() => String, { nullable: true })
  title?: string;

  @Field(() => String, { nullable: true })
  projectName?: string;

  @Field(() => Date, { nullable: true })
  validUntil?: Date;

  @Field(() => String, { nullable: true })
  notes?: string;

  @Field(() => String, { nullable: true })
  lines?: string;

  @Field(() => String, { nullable: true })
  displayMode?: string;

  @Field(() => String, { nullable: true })
  quoteMeta?: string;
}

@InputType()
export class UpdateQuoteInput {
  @Field(() => String, { nullable: true })
  title?: string;

  @Field(() => String, { nullable: true })
  projectName?: string;

  @Field(() => Date, { nullable: true })
  validUntil?: Date;

  @Field(() => String, { nullable: true })
  notes?: string;

  @Field(() => String, { nullable: true })
  lines?: string;

  @Field(() => Number, { nullable: true })
  discountPercent?: number;

  @Field(() => String, { nullable: true })
  displayMode?: string;

  @Field(() => String, { nullable: true })
  quoteMeta?: string;
}

@InputType()
export class CreateSalesOrderInput {
  @Field(() => String)
  quoteId!: string;

  @Field(() => String)
  paymentMode!: string;

  @Field(() => Number, { nullable: true })
  advanceAmount?: number;

  @Field(() => String, { nullable: true })
  notes?: string;
}

@Resolver()
export class QuotesResolver {
  constructor(
    private quotes: QuotesService,
    private prisma: PrismaService,
  ) {}

  @Query(() => [QuoteOutput], { name: 'quotes' })
  getQuotes(
    @Context() ctx: GraphqlRequestContext,
    @Args('leadId', { nullable: true }) leadId?: string,
    @Args('customerId', { nullable: true }) customerId?: string,
    @Args('ownerId', { nullable: true }) ownerId?: string,
    @Args('status', { nullable: true }) status?: string,
  ) {
    return requireSession(this.prisma, ctx).then((user) =>
      this.quotes.findAll({ leadId, customerId, ownerId: isPrivileged(user) ? ownerId : user.id, status }),
    );
  }

  @Query(() => QuoteOutput)
  async quote(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requireSession(this.prisma, ctx);
    const quote = await this.quotes.findById(id);
    if (!isPrivileged(user) && user.role !== 'office_staff' && quote.ownerId !== user.id) throw new Error('This quote is restricted');
    return quote;
  }

  @Mutation(() => QuoteOutput)
  async createQuote(
    @Args('input') input: CreateQuoteInput,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const sessionUser = await requireSession(this.prisma, ctx);
    const quoteInput = { ...input };
    const canAssignOwner = ['admin', 'owner', 'sales_manager', 'office_staff'].includes(sessionUser.role);
    quoteInput.ownerId = canAssignOwner && input.ownerId ? input.ownerId : sessionUser.id;
    return this.quotes.create(quoteInput as any);
  }

  @Mutation(() => QuoteOutput)
  async updateQuote(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateQuoteInput,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff']);
    const quote = await this.quotes.findById(id);
    if (!isPrivileged(user) && user.role !== 'office_staff' && quote.ownerId !== user.id) throw new Error('This quote is restricted');
    return this.quotes.update(id, input as any);
  }

  @Mutation(() => QuoteOutput)
  async updateQuoteStatus(
    @Args('id', { type: () => ID }) id: string,
    @Args('status') status: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff']);
    const quote = await this.quotes.findById(id);
    if (!isPrivileged(user) && user.role !== 'office_staff' && quote.ownerId !== user.id) throw new Error('This quote is restricted');
    return this.quotes.updateStatus(id, status);
  }

  @Mutation(() => QuoteOutput)
  async sendQuote(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff']);
    const quote = await this.quotes.findById(id);
    if (!isPrivileged(user) && user.role !== 'office_staff' && quote.ownerId !== user.id) throw new Error('This quote is restricted');
    return this.quotes.sendQuote(id);
  }

  @Mutation(() => QuoteOutput)
  async confirmQuote(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff']);
    const quote = await this.quotes.findById(id);
    if (!isPrivileged(user) && user.role !== 'office_staff' && quote.ownerId !== user.id) throw new Error('This quote is restricted');
    return this.quotes.confirmQuote(id);
  }

  @Mutation(() => QuoteOutput)
  async approveQuote(
    @Args('id', { type: () => ID }) id: string,
    @Context() ctx: GraphqlRequestContext,
    @Args('note', { nullable: true }) note?: string,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner']);
    return this.quotes.approveQuote(id, user.id, note);
  }

  @Mutation(() => GraphQLJSON)
  async createSalesOrderFromQuote(@Args('input') input: CreateSalesOrderInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'office_staff']);
    return this.quotes.createSalesOrderFromQuote(input as any, user.id);
  }

  @Query(() => [GraphQLJSON])
  async salesOrders(
    @Context() ctx: GraphqlRequestContext,
    @Args('paymentMode', { nullable: true }) paymentMode?: string,
    @Args('range', { nullable: true }) range?: string,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff', 'dispatch_ops']);
    return this.quotes.salesOrders({ paymentMode, range, ownerId: isPrivileged(user) || user.role === 'office_staff' || user.role === 'dispatch_ops' ? undefined : user.id });
  }

  @Query(() => GraphQLJSON)
  async salesOrderStats(@Context() ctx: GraphqlRequestContext, @Args('range', { nullable: true }) range?: string) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff', 'dispatch_ops']);
    return this.quotes.salesOrderStats({ range });
  }

  @Mutation(() => QuoteOutput)
  async createQuoteVersion(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff']);
    const quote = await this.quotes.findById(id);
    if (!isPrivileged(user) && user.role !== 'office_staff' && quote.ownerId !== user.id) throw new Error('This quote is restricted');
    return this.quotes.createVersion(id);
  }

  @Mutation(() => QuoteOutput)
  async deleteQuote(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager']);
    return this.quotes.delete(id);
  }
}
