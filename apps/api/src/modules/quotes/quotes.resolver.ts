import { Resolver, Query, Mutation, Args, ID, InputType, Field, ObjectType, Context, ResolveField, Parent } from '@nestjs/graphql';
import { QuotesService } from './quotes.service';
import { PrismaService } from '../prisma/prisma.service';
import { GraphqlRequestContext, isPrivileged, requirePermission, requireRoles, requireSession, type SessionUser } from '../auth/session-context';
import { GraphQLJSON } from 'graphql-scalars';
import { loadOrNull } from '../common/dataloaders';

const QUOTE_ROLES = ['admin', 'owner', 'sales_manager', 'sales', 'office_staff'];
function canManageQuotes(user: SessionUser) {
  return isPrivileged(user) || user.role === 'office_staff' || user.effectivePermissions.includes('quotes.manage');
}

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

  @Field(() => Number, { nullable: true })
  commercialTotal?: number;

  @Field({ nullable: true }) quoteDiscountMode?: string;
  @Field(() => Number, { nullable: true }) quoteDiscountValue?: number;
  @Field({ nullable: true }) pricingVersion?: string;
  @Field({ nullable: true }) pricingStatus?: string;

  @Field({ nullable: true })
  displayMode?: string;

  @Field({ nullable: true })
  quoteType?: string;

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
  architectId?: string;

  @Field({ nullable: true })
  architectName?: string;

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
  architect?: any;

  @Field(() => GraphQLJSON, { nullable: true })
  approval?: any;
}

@InputType()
export class CreateQuoteInput {
  @Field(() => String, { nullable: true, description: 'Commercial family: tile or cp_sanitary.' })
  quoteType?: string;

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

  @Field(() => Number, { nullable: true })
  discountPercent?: number;

  @Field(() => String, { nullable: true })
  intentId?: string;

  @Field(() => String, { nullable: true })
  supersedesQuoteId?: string;

  @Field(() => String, { nullable: true })
  architectId?: string;

  @Field(() => Boolean, { nullable: true, description: 'Save an incomplete commercial draft without enabling send, PDF, share, approval, or conversion.' })
  saveAsDraft?: boolean;
}

@InputType()
export class UpdateQuoteInput {
  @Field(() => String, { nullable: true, description: 'Commercial family: tile or cp_sanitary.' })
  quoteType?: string;

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

  @Field(() => String, { nullable: true })
  architectId?: string;

  @Field(() => Boolean, { nullable: true, description: 'Keep incomplete pricing as a draft. Commercial actions still require valid MRP.' })
  saveAsDraft?: boolean;
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

@InputType()
export class CreateDirectSalesOrderInput {
  @Field(() => ID) customerId!: string;
  @Field(() => ID) ownerId!: string;
  @Field() paymentMode!: string;
  @Field(() => Number, { nullable: true }) advanceAmount?: number;
  @Field({ nullable: true }) paymentTerms?: string;
  @Field(() => Date, { nullable: true }) promisedDate?: Date;
  @Field({ nullable: true }) notes?: string;
  @Field({ description: 'JSON array of fully priced order lines' }) lines!: string;
  @Field({ nullable: true }) idempotencyKey?: string;
}

@Resolver(() => QuoteOutput)
export class QuotesResolver {
  constructor(
    private quotes: QuotesService,
    private prisma: PrismaService,
  ) {}

  @Query(() => [GraphQLJSON])
  async salesAssignees(@Context() ctx: GraphqlRequestContext) {
    await requirePermission(this.prisma, ctx, 'quotes.manage', QUOTE_ROLES);
    return this.prisma.user.findMany({
      where: { active: true, role: { in: ['sales', 'sales_manager', 'owner', 'admin'] } as any },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, email: true, role: true },
    });
  }

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

  @ResolveField('architect', () => GraphQLJSON, { nullable: true })
  async resolveArchitect(@Parent() quote: any, @Context() ctx: GraphqlRequestContext) {
    if (quote?.architect) return quote.architect;
    if (!ctx.loaders) return null;
    return loadOrNull(ctx.loaders.architectById, quote?.architectId);
  }

  @Query(() => [QuoteOutput], { name: 'quotes' })
  getQuotes(
    @Context() ctx: GraphqlRequestContext,
    @Args('leadId', { nullable: true }) leadId?: string,
    @Args('customerId', { nullable: true }) customerId?: string,
    @Args('ownerId', { nullable: true }) ownerId?: string,
    @Args('status', { nullable: true }) status?: string,
    @Args('quoteType', { nullable: true }) quoteType?: string,
    @Args('architectId', { nullable: true }) architectId?: string,
    @Args('take', { type: () => Number, nullable: true }) take?: number,
    @Args('skip', { type: () => Number, nullable: true }) skip?: number,
  ) {
    return requireSession(this.prisma, ctx).then((user) =>
      this.quotes.findAll({ leadId, customerId, ownerId: canManageQuotes(user) ? ownerId : user.id, status, quoteType, architectId, take, skip }),
    );
  }

  @Query(() => GraphQLJSON)
  async quotePage(
    @Context() ctx: GraphqlRequestContext,
    @Args('search', { nullable: true }) search?: string,
    @Args('customerSearch', { nullable: true }) customerSearch?: string,
    @Args('ownerSearch', { nullable: true }) ownerSearch?: string,
    @Args('ownerId', { nullable: true }) ownerId?: string,
    @Args('architectId', { nullable: true }) architectId?: string,
    @Args('status', { nullable: true }) status?: string,
    @Args('quoteType', { nullable: true }) quoteType?: string,
    @Args('dateFrom', { type: () => Date, nullable: true }) dateFrom?: Date,
    @Args('dateTo', { type: () => Date, nullable: true }) dateTo?: Date,
    @Args('sort', { nullable: true }) sort?: string,
    @Args('skip', { type: () => Number, nullable: true }) skip?: number,
    @Args('take', { type: () => Number, nullable: true }) take?: number,
  ) {
    const user = await requireSession(this.prisma, ctx);
    return this.quotes.quotePage({
      search, customerSearch, ownerSearch, architectId, status, quoteType, dateFrom, dateTo, sort, skip, take,
      ownerId: canManageQuotes(user) ? ownerId : user.id,
    });
  }

  @Query(() => QuoteOutput)
  async quote(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requireSession(this.prisma, ctx);
    const quote = await this.quotes.findById(id);
    if (!canManageQuotes(user) && quote.ownerId !== user.id) throw new Error('This quote is restricted');
    return quote;
  }

  @Mutation(() => Boolean)
  async recordCommercialPdfResult(
    @Args('entityType') entityType: string,
    @Args('id', { type: () => ID }) id: string,
    @Args('success') success: boolean,
    @Context() ctx: GraphqlRequestContext,
  ) {
    // Reuse the exact source-read scope; a guessed document ID is not authority.
    if (entityType === 'Quote') await this.quote(id, ctx);
    else if (entityType === 'SalesOrder') await this.salesOrder(id, ctx);
    else throw new Error('Unsupported commercial document');
    const user = await requireSession(this.prisma, ctx);
    await this.quotes.recordCommercialPdfResult(entityType, id, success, user.id);
    return true;
  }

  @Mutation(() => QuoteOutput)
  async createQuote(
    @Args('input') input: CreateQuoteInput,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const sessionUser = await requirePermission(this.prisma, ctx, 'quotes.manage', QUOTE_ROLES);
    const quoteInput = { ...input };
    const canAssignOwner = canManageQuotes(sessionUser);
    quoteInput.ownerId = canAssignOwner && input.ownerId ? input.ownerId : sessionUser.id;
    return this.quotes.create(quoteInput as any, sessionUser.id);
  }

  @Mutation(() => QuoteOutput)
  async updateQuote(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateQuoteInput,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requirePermission(this.prisma, ctx, 'quotes.manage', QUOTE_ROLES);
    const quote = await this.quotes.findById(id);
    if (!canManageQuotes(user) && quote.ownerId !== user.id) throw new Error('This quote is restricted');
    return this.quotes.update(id, input as any, user.id);
  }

  @Mutation(() => QuoteOutput)
  async updateQuotePresentation(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateQuotePresentationInput,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requirePermission(this.prisma, ctx, 'quotes.manage', QUOTE_ROLES);
    const quote = await this.quotes.findById(id);
    if (!canManageQuotes(user) && quote.ownerId !== user.id) throw new Error('This quote is restricted');
    return this.quotes.updatePresentation(id, input as any, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async createQuoteShare(
    @Args('quoteId', { type: () => ID }) quoteId: string,
    @Context() ctx: GraphqlRequestContext,
    @Args('expiresInDays', { nullable: true }) expiresInDays?: number,
    @Args('allowDownload', { nullable: true }) allowDownload?: boolean,
  ) {
    const user = await requirePermission(this.prisma, ctx, 'quotes.manage', QUOTE_ROLES);
    const quote = await this.quotes.findById(quoteId);
    if (!canManageQuotes(user) && quote.ownerId !== user.id) throw new Error('This quote is restricted');
    return this.quotes.createShare(quoteId, user.id, expiresInDays, allowDownload ?? true);
  }

  @Query(() => [GraphQLJSON])
  async quoteShares(@Args('quoteId', { type: () => ID }) quoteId: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'quotes.manage', QUOTE_ROLES);
    const quote = await this.quotes.findById(quoteId);
    if (!canManageQuotes(user) && quote.ownerId !== user.id) throw new Error('This quote is restricted');
    return this.quotes.quoteShares(quoteId);
  }

  @Mutation(() => GraphQLJSON)
  async revokeQuoteShare(
    @Args('quoteId', { type: () => ID }) quoteId: string,
    @Args('shareId', { type: () => ID }) shareId: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requirePermission(this.prisma, ctx, 'quotes.manage', QUOTE_ROLES);
    const quote = await this.quotes.findById(quoteId);
    if (!canManageQuotes(user) && quote.ownerId !== user.id) throw new Error('This quote is restricted');
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
    const user = await requirePermission(this.prisma, ctx, 'quotes.manage', QUOTE_ROLES);
    const quote = await this.quotes.findById(id);
    if (!canManageQuotes(user) && quote.ownerId !== user.id) throw new Error('This quote is restricted');
    return this.quotes.updateStatus(id, status);
  }

  @Mutation(() => QuoteOutput)
  async sendQuote(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'quotes.manage', QUOTE_ROLES);
    const quote = await this.quotes.findById(id);
    if (!canManageQuotes(user) && quote.ownerId !== user.id) throw new Error('This quote is restricted');
    return this.quotes.sendQuote(id);
  }

  @Mutation(() => QuoteOutput)
  async confirmQuote(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'quotes.manage', QUOTE_ROLES);
    const quote = await this.quotes.findById(id);
    if (!canManageQuotes(user) && quote.ownerId !== user.id) throw new Error('This quote is restricted');
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

  @Mutation(() => GraphQLJSON)
  async createDirectSalesOrder(@Args('input') input: CreateDirectSalesOrderInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'office_staff']);
    return this.quotes.createDirectSalesOrder(input as any, user.id);
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

  @Query(() => GraphQLJSON)
  async salesOrderControlTower(
    @Context() ctx: GraphqlRequestContext,
    @Args('search', { nullable: true }) search?: string,
    @Args('fulfillmentStatus', { nullable: true }) fulfillmentStatus?: string,
    @Args('paymentMode', { nullable: true }) paymentMode?: string,
    @Args('range', { nullable: true }) range?: string,
    @Args('brand', { nullable: true }) brand?: string,
    @Args('category', { nullable: true }) category?: string,
    @Args('locationId', { nullable: true }) locationId?: string,
    @Args('promisedRisk', { nullable: true }) promisedRisk?: string,
    @Args('completeness', { nullable: true }) completeness?: string,
    @Args('sort', { nullable: true }) sort?: string,
    @Args('cursor', { nullable: true }) cursor?: string,
    @Args('take', { type: () => Number, nullable: true }) take?: number,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff', 'dispatch_ops']);
    return this.quotes.salesOrderControlTower({
      search,
      fulfillmentStatus,
      paymentMode,
      range,
      brand,
      category,
      locationId,
      promisedRisk,
      completeness,
      sort,
      cursor,
      take,
      ownerId: isPrivileged(user) || user.role === 'office_staff' || user.role === 'dispatch_ops' ? undefined : user.id,
    });
  }

  @Mutation(() => QuoteOutput)
  async createQuoteVersion(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'quotes.manage', QUOTE_ROLES);
    const quote = await this.quotes.findById(id);
    if (!canManageQuotes(user) && quote.ownerId !== user.id) throw new Error('This quote is restricted');
    return this.quotes.createVersion(id);
  }

  @Mutation(() => QuoteOutput)
  async cancelQuote(
    @Args('id', { type: () => ID }) id: string,
    @Args('reason') reason: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager']);
    return this.quotes.cancelQuote(id, reason, user.id);
  }
}
