import { Resolver, Query, Mutation, Args, ID, InputType, Field, ObjectType, Context, ResolveField, Parent } from '@nestjs/graphql';
import { QuotesService } from './quotes.service';
import { PrismaService } from '../prisma/prisma.service';
import { GraphqlRequestContext, isPrivileged, requireRoles, requireSession } from '../auth/session-context';
import { GraphQLJSON } from 'graphql-scalars';
import { loadOrNull } from '../common/dataloaders';

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

  @Field({ nullable: true })
  coverImage?: string;

  // Foreign keys are exposed so resolveField below can hydrate the related
  // objects via DataLoader. Plain row payloads from QuotesService include them.
  @Field({ nullable: true })
  customerId?: string;

  @Field({ nullable: true })
  ownerId?: string;

  @Field({ nullable: true })
  leadId?: string;

  @Field({ nullable: true })
  intentId?: string;

  @Field({ nullable: true })
  supersedesQuoteId?: string;

  @Field({ nullable: true })
  supersededByQuoteId?: string;

  @Field(() => Number, { nullable: true })
  versionNumber?: number;

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

  @Field(() => String, { nullable: true })
  intentId?: string;

  @Field(() => String, { nullable: true })
  supersedesQuoteId?: string;
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

  @Field(() => String, { nullable: true, description: 'Hero image shown on the PDF cover page (URL or /uploaded path)' })
  coverImage?: string;
}

@InputType()
export class UpdateQuotePresentationInput {
  @Field(() => String, { nullable: true })
  displayMode?: string;

  @Field(() => String, { nullable: true })
  quoteMeta?: string;

  @Field(() => String, { nullable: true, description: 'Hero image shown on the PDF cover page (URL or /uploaded path)' })
  coverImage?: string;

  @Field(() => String, { nullable: true, description: 'JSON array of non-commercial line presentation fields' })
  linePresentation?: string;
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

  @Field(() => String, { nullable: true, description: 'JSON array of selected quoteLineId/lineKey and quantity rows' })
  lines?: string;

  @Field(() => String, { nullable: true, description: 'Client retry key. Repeating it returns the original order.' })
  idempotencyKey?: string;

  @Field(() => Date, { nullable: true })
  promisedDate?: Date;

  @Field(() => String, { nullable: true })
  paymentTerms?: string;
}

@Resolver(() => QuoteOutput)
export class QuotesResolver {
  constructor(
    private quotes: QuotesService,
    private prisma: PrismaService,
  ) {}

  // ----- DataLoader-backed field resolvers -----
  // For a list of N quotes, GraphQL would otherwise issue N findUnique() per
  // relation field. The loader collapses them into one batched findMany() per
  // relation per request.

  @ResolveField('customer', () => GraphQLJSON, { nullable: true })
  async resolveCustomer(@Parent() quote: any, @Context() ctx: GraphqlRequestContext) {
    // If the row already carries a populated `customer` (e.g. mutation responses
    // that did `include: quoteInclude`), just pass it through.
    if (quote?.customer) return quote.customer;
    if (!ctx.loaders) return null;
    return loadOrNull(ctx.loaders.customerById, quote?.customerId);
  }

  @ResolveField('owner', () => GraphQLJSON, { nullable: true })
  async resolveOwner(@Parent() quote: any, @Context() ctx: GraphqlRequestContext) {
    if (quote?.owner) return quote.owner;
    if (!ctx.loaders) return null;
    return loadOrNull(ctx.loaders.userById, quote?.ownerId);
  }

  @ResolveField('lead', () => GraphQLJSON, { nullable: true })
  async resolveLead(@Parent() quote: any, @Context() ctx: GraphqlRequestContext) {
    if (quote?.lead) return quote.lead;
    if (!ctx.loaders) return null;
    return loadOrNull(ctx.loaders.leadById, quote?.leadId);
  }

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
  async updateQuotePresentation(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateQuotePresentationInput,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff']);
    const quote = await this.quotes.findById(id);
    if (!isPrivileged(user) && user.role !== 'office_staff' && quote.ownerId !== user.id) throw new Error('This quote is restricted');
    return this.quotes.updatePresentation(id, input as any, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async createQuoteShare(
    @Args('quoteId', { type: () => ID }) quoteId: string,
    @Context() ctx: GraphqlRequestContext,
    @Args('expiresInDays', { nullable: true }) expiresInDays?: number,
    @Args('allowDownload', { nullable: true }) allowDownload?: boolean,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff']);
    const quote = await this.quotes.findById(quoteId);
    if (!isPrivileged(user) && user.role !== 'office_staff' && quote.ownerId !== user.id) throw new Error('This quote is restricted');
    return this.quotes.createShare(quoteId, user.id, expiresInDays, allowDownload ?? true);
  }

  @Query(() => [GraphQLJSON])
  async quoteShares(@Args('quoteId', { type: () => ID }) quoteId: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff']);
    const quote = await this.quotes.findById(quoteId);
    if (!isPrivileged(user) && user.role !== 'office_staff' && quote.ownerId !== user.id) throw new Error('This quote is restricted');
    return this.quotes.quoteShares(quoteId);
  }

  @Mutation(() => GraphQLJSON)
  async revokeQuoteShare(
    @Args('quoteId', { type: () => ID }) quoteId: string,
    @Args('shareId', { type: () => ID }) shareId: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff']);
    const quote = await this.quotes.findById(quoteId);
    if (!isPrivileged(user) && user.role !== 'office_staff' && quote.ownerId !== user.id) throw new Error('This quote is restricted');
    return this.quotes.revokeShare(quoteId, shareId, user.id);
  }

  @Query(() => GraphQLJSON)
  async publicQuoteShareDocument(@Args('token') token: string) {
    return this.quotes.publicQuoteShareDocument(token);
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

  @Query(() => GraphQLJSON)
  async quoteFulfillment(@Args('quoteId', { type: () => ID }) quoteId: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff', 'dispatch_ops']);
    const quote = await this.quotes.findById(quoteId);
    if (!isPrivileged(user) && user.role !== 'office_staff' && user.role !== 'dispatch_ops' && quote.ownerId !== user.id) throw new Error('This quote is restricted');
    return this.quotes.quoteFulfillment(quoteId);
  }

  @Mutation(() => QuoteOutput)
  async closeQuoteRemainder(
    @Args('quoteId', { type: () => ID }) quoteId: string,
    @Args('reason') reason: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'office_staff']);
    const quote = await this.quotes.findById(quoteId);
    if (!isPrivileged(user) && user.role !== 'office_staff' && quote.ownerId !== user.id) throw new Error('This quote is restricted');
    return this.quotes.closeQuoteRemainder(quoteId, user.id, reason);
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
  async salesOrder(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff', 'dispatch_ops']);
    const order = await this.quotes.salesOrder(id);
    if (!isPrivileged(user) && user.role !== 'office_staff' && user.role !== 'dispatch_ops' && order.ownerId !== user.id) {
      throw new Error('This sales order is restricted');
    }
    return order;
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
