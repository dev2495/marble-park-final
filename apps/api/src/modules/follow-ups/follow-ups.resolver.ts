import { Args, Context, Field, Float, ID, InputType, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-scalars';
import { PrismaService } from '../prisma/prisma.service';
import { GraphqlRequestContext, requireAnyPermission, requirePermission, requireRoles } from '../auth/session-context';
import { FollowUpsService } from './follow-ups.service';

const DESK_ROLES = ['admin', 'owner', 'sales_manager', 'sales', 'office_staff', 'inventory_manager'];

@InputType()
export class QuickAddCustomerInput {
  @Field() name!: string;
  @Field() mobile!: string;
  @Field({ nullable: true }) city?: string;
}

@InputType()
export class QuickAddProductInput {
  @Field() name!: string;
  @Field() category!: string;
  @Field(() => Float) mrp!: number;
  @Field({ nullable: true }) brand?: string;
  @Field({ nullable: true }) unit?: string;
  @Field({ nullable: true }) finish?: string;
  @Field({ nullable: true }) mediaUrl?: string;
}

@InputType()
export class QuickAddMasterInput {
  @Field() name!: string;
  @Field({ nullable: true }) phone?: string;
  @Field({ nullable: true }) code?: string;
}

@Resolver()
export class FollowUpsResolver {
  constructor(private readonly prisma: PrismaService, private readonly followUps: FollowUpsService) {}

  @Query(() => [GraphQLJSON])
  async followUpQueue(@Context() ctx: GraphqlRequestContext) {
    await requireAnyPermission(this.prisma, ctx, ['follow_ups.manage'], DESK_ROLES);
    return this.followUps.queue();
  }

  @Mutation(() => GraphQLJSON)
  async quickAddCustomer(@Args('input') input: QuickAddCustomerInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff']);
    return this.followUps.quickAddCustomer(input, user.id);
  }

  // Staff who build quotes may add a new arrival with its MRP; it is flagged
  // so product managers complete HSN, photo and floor price later.
  @Mutation(() => GraphQLJSON)
  async quickAddProduct(@Args('input') input: QuickAddProductInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'quick_add.sku');
    return this.followUps.quickAddProduct(input, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async quickAddMaster(@Args('kind') kind: string, @Args('input') input: QuickAddMasterInput, @Context() ctx: GraphqlRequestContext) {
    const user = kind === 'architect'
      ? await requireAnyPermission(this.prisma, ctx, ['quick_add.masters', 'quotes.manage'])
      : await requirePermission(this.prisma, ctx, 'quick_add.masters');
    return this.followUps.quickAddMaster(kind, input, user.id);
  }

  @Mutation(() => Boolean)
  async completeFollowUp(
    @Args('entityType') entityType: string,
    @Args('id', { type: () => ID }) id: string,
    @Args('values', { type: () => GraphQLJSON }) values: any,
    @Args('markComplete') markComplete: boolean,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requirePermission(this.prisma, ctx, 'follow_ups.manage');
    return this.followUps.completeRecord(entityType, id, values, markComplete, { id: user.id, canPrice: user.effectivePermissions.includes('pricing.manage') });
  }

  @Mutation(() => Boolean)
  async setFollowUp(
    @Args('entityType') entityType: string,
    @Args('id', { type: () => ID }) id: string,
    @Args('flagged') flagged: boolean,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requirePermission(this.prisma, ctx, 'follow_ups.manage');
    return this.followUps.setFlag(entityType, id, flagged, user.id);
  }
}
