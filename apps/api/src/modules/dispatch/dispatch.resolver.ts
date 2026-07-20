import { Resolver, Query, Mutation, Args, ID, InputType, Field, ObjectType, Context } from '@nestjs/graphql';
import { DispatchService } from './dispatch.service';
import { GraphQLJSON } from 'graphql-scalars';
import { GraphqlRequestContext, requirePermission, requireSession } from '../auth/session-context';
import { PrismaService } from '../prisma/prisma.service';

@ObjectType()
export class DispatchOutput {
  @Field()
  id!: string;

  @Field({ nullable: true })
  quoteId?: string;

  @Field({ nullable: true })
  salesOrderId?: string;

  @Field({ nullable: true })
  customerId?: string;

  @Field({ nullable: true })
  dispatchJobId?: string;

  @Field({ nullable: true })
  siteAddress?: string;

  @Field({ nullable: true })
  status?: string;

  @Field(() => Date, { nullable: true })
  dueDate?: Date;

  @Field(() => GraphQLJSON, { nullable: true })
  customer?: any;

  @Field(() => GraphQLJSON, { nullable: true })
  quote?: any;

  @Field(() => GraphQLJSON, { nullable: true })
  lines?: any;

  @Field({ nullable: true })
  challanNumber?: string;
}

@InputType()
export class CreateDispatchJobInput {
  @Field(() => String, { nullable: true })
  quoteId?: string;

  @Field(() => String, { nullable: true })
  salesOrderId?: string;

  @Field(() => String, { nullable: true })
  customerId?: string;

  @Field(() => Date, { nullable: true })
  scheduledAt?: Date;

  @Field(() => String, { nullable: true })
  notes?: string;
}

@InputType()
export class CreateChallanInput {
  @Field(() => String, { nullable: true })
  jobId?: string;

  @Field(() => String, { nullable: true })
  salesOrderId?: string;

  @Field(() => String, { nullable: true })
  transporter?: string;

  @Field(() => String, { nullable: true })
  vehicleNo?: string;

  @Field(() => String, { nullable: true })
  driverName?: string;

  @Field(() => String, { nullable: true })
  driverPhone?: string;

  @Field(() => Number, { nullable: true })
  packages?: number;

  @Field(() => String, { nullable: true })
  lines?: string;

  @Field(() => String, { nullable: true })
  pickListId?: string;
}

@InputType()
export class CreatePickListInput {
  @Field() salesOrderId!: string;
  @Field() locationId!: string;
  @Field({ nullable: true }) assignedTo?: string;
  @Field({ nullable: true }) notes?: string;
  @Field(() => String, { nullable: true }) lines?: string;
}

@InputType()
export class PickListTransitionInput {
  @Field(() => String, { nullable: true }) lines?: string;
  @Field({ nullable: true }) assignedTo?: string;
  @Field({ nullable: true }) reason?: string;
}

@InputType()
export class ConfirmDeliveryInput {
  @Field() receivedByName!: string;
  @Field({ nullable: true }) receivedByPhone?: string;
  @Field({ nullable: true }) proofType?: string;
  @Field({ nullable: true }) proofUrl?: string;
  @Field({ nullable: true }) latitude?: number;
  @Field({ nullable: true }) longitude?: number;
  @Field({ nullable: true }) notes?: string;
}

@Resolver()
export class DispatchResolver {
  constructor(
    private dispatch: DispatchService,
    private prisma: PrismaService,
  ) {}

  @Query(() => [DispatchOutput])
  async dispatchJobs(@Args('status', { type: () => String, nullable: true }) status: string | undefined, @Context() ctx: GraphqlRequestContext) {
    await requireSession(this.prisma, ctx);
    return this.dispatch.findAllJobs({ status });
  }

  @Query(() => [GraphQLJSON])
  async dispatchQueue(@Args('status', { type: () => String, nullable: true }) status: string | undefined, @Context() ctx: GraphqlRequestContext) {
    await requireSession(this.prisma, ctx);
    return this.dispatch.dispatchQueue({ status });
  }

  @Query(() => DispatchOutput)
  async dispatchJob(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    await requireSession(this.prisma, ctx);
    return this.dispatch.findJobById(id);
  }

  @Query(() => [DispatchOutput])
  async dispatchChallans(
    @Context() ctx: GraphqlRequestContext,
    @Args('status', { nullable: true }) status?: string,
    @Args('dispatchJobId', { nullable: true }) dispatchJobId?: string,
  ) {
    await requirePermission(this.prisma, ctx, 'dispatch.manage', ['admin', 'owner', 'sales_manager', 'dispatch_ops', 'inventory_manager', 'office_staff']);
    return this.dispatch.findAllChallans({ status, dispatchJobId });
  }

  @Query(() => GraphQLJSON)
  async dispatchChallan(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    await requirePermission(this.prisma, ctx, 'dispatch.manage', ['admin', 'owner', 'sales_manager', 'dispatch_ops', 'inventory_manager', 'office_staff']);
    return this.dispatch.findChallanById(id);
  }

  @Query(() => [GraphQLJSON])
  async pickLists(
    @Context() ctx: GraphqlRequestContext,
    @Args('salesOrderId', { nullable: true }) salesOrderId?: string,
    @Args('status', { nullable: true }) status?: string,
    @Args('take', { nullable: true }) take?: number,
  ) {
    await requirePermission(this.prisma, ctx, 'dispatch.manage');
    return this.dispatch.pickLists({ salesOrderId, status, take });
  }

  @Mutation(() => DispatchOutput)
  async createDispatchJob(@Args('input') input: CreateDispatchJobInput, @Context() ctx: GraphqlRequestContext) {
    await requirePermission(this.prisma, ctx, 'dispatch.manage');
    return this.dispatch.createJob(input as any);
  }

  @Mutation(() => DispatchOutput)
  async updateDispatchJob(
    @Args('id', { type: () => ID }) id: string,
    @Args('status') status: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    await requirePermission(this.prisma, ctx, 'dispatch.manage');
    return this.dispatch.updateJobStatus(id, status);
  }

  @Mutation(() => DispatchOutput)
  async createChallan(@Args('input') input: CreateChallanInput, @Context() ctx: GraphqlRequestContext) {
    await requirePermission(this.prisma, ctx, 'dispatch.manage');
    return this.dispatch.createChallan(input as any);
  }

  @Mutation(() => GraphQLJSON)
  async createPickList(@Args('input') input: CreatePickListInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'dispatch.manage');
    return this.dispatch.createPickList(input as any, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async transitionPickList(
    @Args('id', { type: () => ID }) id: string,
    @Args('action') action: string,
    @Args('input', { type: () => PickListTransitionInput, nullable: true }) input: PickListTransitionInput | undefined,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requirePermission(this.prisma, ctx, 'dispatch.manage');
    return this.dispatch.transitionPickList(id, action, input as any, user.id);
  }

  @Mutation(() => DispatchOutput)
  async updateChallanStatus(
    @Args('id', { type: () => ID }) id: string,
    @Args('status') status: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requirePermission(this.prisma, ctx, 'dispatch.manage');
    return this.dispatch.updateChallanStatus(id, status, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async confirmDelivery(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: ConfirmDeliveryInput,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requirePermission(this.prisma, ctx, 'dispatch.manage');
    return this.dispatch.confirmDelivery(id, input as any, user.id);
  }
}
