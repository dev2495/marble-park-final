import { Args, Context, Field, ID, InputType, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-scalars';
import { IntentsService } from './intents.service';
import { PrismaService } from '../prisma/prisma.service';
import { GraphqlRequestContext, requireRoles, requireSession } from '../auth/session-context';

@InputType()
export class CreateIntentInputDto {
  @Field() leadId!: string;
  @Field(() => GraphQLJSON, { nullable: true }) rows?: any;
  @Field({ nullable: true }) notes?: string;
  @Field({ nullable: true }) intentType?: string;
  @Field({ nullable: true }) followUpReason?: string;
  @Field({ nullable: true }) referencesQuoteId?: string;
  @Field({ nullable: true, description: 'Submit immediately (skips draft state).' }) submit?: boolean;
}

@InputType()
export class UpdateIntentInputDto {
  @Field(() => GraphQLJSON, { nullable: true }) rows?: any;
  @Field({ nullable: true }) notes?: string;
  @Field({ nullable: true }) followUpReason?: string;
}

@Resolver()
export class IntentsResolver {
  constructor(private intents: IntentsService, private prisma: PrismaService) {}

  // ----- queries -----

  @Query(() => GraphQLJSON, { name: 'intent', nullable: true })
  async intent(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    await requireSession(this.prisma, ctx);
    return this.intents.findOne(id);
  }

  @Query(() => [GraphQLJSON], { name: 'intents' })
  async intentsList(
    @Context() ctx: GraphqlRequestContext,
    @Args('status', { nullable: true }) status?: string,
    @Args('leadId', { nullable: true }) leadId?: string,
    @Args('pendingOnly', { nullable: true }) pendingOnly?: boolean,
    @Args('mineOnly', { nullable: true }) mineOnly?: boolean,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff']);
    const isPrivileged = ['admin', 'owner', 'sales_manager', 'office_staff'].includes(user.role);
    return this.intents.list({
      status,
      leadId,
      pendingOnly,
      mineOnly: !!mineOnly || !isPrivileged,
      userId: user.id,
    });
  }

  // ----- mutations -----

  @Mutation(() => GraphQLJSON)
  async createIntent(@Args('input') input: CreateIntentInputDto, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff']);
    return this.intents.create(input as any, { id: user.id, role: user.role });
  }

  @Mutation(() => GraphQLJSON)
  async updateIntent(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateIntentInputDto,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff']);
    return this.intents.update(id, input as any, { id: user.id, role: user.role });
  }

  @Mutation(() => GraphQLJSON)
  async submitIntent(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff']);
    return this.intents.submit(id, { id: user.id, role: user.role });
  }

  @Mutation(() => GraphQLJSON)
  async pickUpIntent(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'office_staff']);
    return this.intents.pickUp(id, { id: user.id, role: user.role });
  }

  @Mutation(() => GraphQLJSON)
  async releaseIntent(
    @Args('id', { type: () => ID }) id: string,
    @Context() ctx: GraphqlRequestContext,
    @Args('force', { nullable: true }) force?: boolean,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'office_staff']);
    return this.intents.release(id, { id: user.id, role: user.role }, !!force);
  }

  @Mutation(() => GraphQLJSON)
  async requestIntentChanges(
    @Args('id', { type: () => ID }) id: string,
    @Context() ctx: GraphqlRequestContext,
    @Args('message', { nullable: true }) message?: string,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales']);
    return this.intents.requestChanges(id, { id: user.id, role: user.role }, message);
  }

  @Mutation(() => GraphQLJSON)
  async cancelIntent(
    @Args('id', { type: () => ID }) id: string,
    @Context() ctx: GraphqlRequestContext,
    @Args('reason', { nullable: true }) reason?: string,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff']);
    return this.intents.cancel(id, { id: user.id, role: user.role }, reason);
  }

  @Mutation(() => GraphQLJSON)
  async startQuoteRevision(@Args('quoteId') quoteId: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff']);
    return this.intents.startRevisionFromQuote(quoteId, { id: user.id, role: user.role });
  }
}
