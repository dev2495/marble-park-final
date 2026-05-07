import { Resolver, Query, Mutation, Args, ID, InputType, Field, ObjectType, Context } from '@nestjs/graphql';
import { LeadsService } from './leads.service';
import { GraphQLJSON } from 'graphql-scalars';
import { GraphqlRequestContext, isPrivileged, requireRoles, requireSession } from '../auth/session-context';
import { PrismaService } from '../prisma/prisma.service';

@ObjectType()
export class LeadOutput {
  @Field()
  id!: string;

  @Field({ nullable: true })
  title?: string;

  @Field({ nullable: true })
  source?: string;

  @Field({ nullable: true })
  stage?: string;

  @Field(() => Number, { nullable: true })
  expectedValue?: number;

  @Field({ nullable: true })
  notes?: string;

  @Field(() => Date, { nullable: true })
  nextActionAt?: Date;

  @Field(() => GraphQLJSON, { nullable: true })
  customer?: any;

  @Field(() => GraphQLJSON, { nullable: true })
  owner?: any;

  @Field(() => GraphQLJSON, { nullable: true })
  quotes?: any;

  @Field(() => GraphQLJSON, { nullable: true })
  followUps?: any;

  @Field(() => GraphQLJSON, { nullable: true })
  intents?: any;

  @Field(() => GraphQLJSON, { nullable: true })
  activities?: any;
}

@InputType()
export class CreateLeadInput {
  @Field(() => String, { nullable: true })
  customerId?: string;

  @Field(() => String, { nullable: true })
  title?: string;

  @Field(() => String, { nullable: true })
  source?: string;

  @Field(() => String, { nullable: true })
  ownerId?: string;

  @Field(() => String, { nullable: true })
  stage?: string;

  @Field(() => Number, { nullable: true })
  expectedValue?: number;

  @Field(() => String, { nullable: true })
  notes?: string;

  @Field(() => Date, { nullable: true })
  nextActionAt?: Date;

  @Field(() => String, { nullable: true })
  intentRows?: string;

  @Field(() => String, { nullable: true })
  intentNotes?: string;
}

@InputType()
export class UpdateLeadInput {
  @Field(() => String, { nullable: true })
  title?: string;

  @Field(() => String, { nullable: true })
  source?: string;

  @Field(() => String, { nullable: true })
  ownerId?: string;

  @Field(() => String, { nullable: true })
  stage?: string;

  @Field(() => Number, { nullable: true })
  expectedValue?: number;

  @Field(() => String, { nullable: true })
  notes?: string;

  @Field(() => Date, { nullable: true })
  nextActionAt?: Date;
}

@InputType()
export class CreateLeadIntentInput {
  @Field(() => String)
  leadId!: string;

  @Field(() => String, { nullable: true })
  rows?: string;

  @Field(() => String, { nullable: true })
  notes?: string;

  @Field(() => String, { nullable: true })
  intentType?: string;

  @Field(() => String, { nullable: true })
  followUpReason?: string;
}

@Resolver()
export class LeadsResolver {
  constructor(
    private leads: LeadsService,
    private prisma: PrismaService,
  ) {}

  @Query(() => [LeadOutput], { name: 'leads' })
  async getLeads(
    @Context() ctx: GraphqlRequestContext,
    @Args('ownerId', { nullable: true }) ownerId?: string,
    @Args('stage', { nullable: true }) stage?: string,
    @Args('search', { nullable: true }) search?: string,
  ) {
    const user = await requireSession(this.prisma, ctx);
    const canSeeAll = isPrivileged(user) || user.role === 'office_staff';
    return this.leads.findAll({ ownerId: canSeeAll ? ownerId : user.id, stage, search });
  }

  @Query(() => LeadOutput)
  async lead(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requireSession(this.prisma, ctx);
    const lead = await this.leads.findById(id);
    if (!isPrivileged(user) && user.role !== 'office_staff' && lead.ownerId !== user.id) {
      throw new Error('This lead is restricted');
    }
    return lead;
  }

  @Mutation(() => LeadOutput)
  async createLead(@Args('input') input: CreateLeadInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff']);
    const leadInput = { ...input, ownerId: isPrivileged(user) && input.ownerId ? input.ownerId : user.id };
    return this.leads.create(leadInput as any, user.id);
  }

  @Mutation(() => LeadOutput)
  async updateLead(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateLeadInput,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff']);
    const existing = await this.leads.findById(id);
    if (!isPrivileged(user) && user.role !== 'office_staff' && existing.ownerId !== user.id) throw new Error('This lead is restricted');
    const leadInput = { ...input };
    if (!isPrivileged(user)) delete leadInput.ownerId;
    return this.leads.update(id, leadInput as any);
  }

  @Mutation(() => LeadOutput)
  async updateLeadStage(
    @Args('id', { type: () => ID }) id: string,
    @Args('stage') stage: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff']);
    const existing = await this.leads.findById(id);
    if (!isPrivileged(user) && user.role !== 'office_staff' && existing.ownerId !== user.id) throw new Error('This lead is restricted');
    return this.leads.updateStage(id, stage);
  }

  @Query(() => [GraphQLJSON])
  async leadIntents(
    @Context() ctx: GraphqlRequestContext,
    @Args('status', { nullable: true }) status?: string,
    @Args('leadId', { nullable: true }) leadId?: string,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff']);
    return this.leads.findIntents({ status, leadId, ownerId: isPrivileged(user) || user.role === 'office_staff' ? undefined : user.id });
  }

  @Mutation(() => GraphQLJSON)
  async createLeadIntent(@Args('input') input: CreateLeadIntentInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff']);
    return this.leads.createIntent(input as any, user.id, user.role);
  }

  @Mutation(() => GraphQLJSON)
  async generateQuoteFromIntent(
    @Args('intentId') intentId: string,
    @Context() ctx: GraphqlRequestContext,
    @Args('note', { nullable: true }) note?: string,
    @Args('displayMode', { nullable: true }) displayMode?: string,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'office_staff']);
    return this.leads.generateQuoteFromIntent(intentId, user.id, note, displayMode);
  }

  @Mutation(() => LeadOutput)
  async deleteLead(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager']);
    return this.leads.delete(id);
  }
}
