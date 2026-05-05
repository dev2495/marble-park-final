import { Resolver, Query, Mutation, Args, ID, InputType, Field, ObjectType, Context } from '@nestjs/graphql';
import { DispatchService } from './dispatch.service';
import { GraphQLJSON } from 'graphql-scalars';
import { GraphqlRequestContext, requireRoles, requireSession } from '../auth/session-context';
import { PrismaService } from '../prisma/prisma.service';

@ObjectType()
export class DispatchOutput {
  @Field()
  id!: string;

  @Field({ nullable: true })
  quoteId?: string;

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
    await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'dispatch_ops', 'inventory_manager', 'office_staff']);
    return this.dispatch.findAllChallans({ status, dispatchJobId });
  }

  @Mutation(() => DispatchOutput)
  async createDispatchJob(@Args('input') input: CreateDispatchJobInput, @Context() ctx: GraphqlRequestContext) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'dispatch_ops', 'office_staff']);
    return this.dispatch.createJob(input as any);
  }

  @Mutation(() => DispatchOutput)
  async updateDispatchJob(
    @Args('id', { type: () => ID }) id: string,
    @Args('status') status: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner', 'dispatch_ops']);
    return this.dispatch.updateJobStatus(id, status);
  }

  @Mutation(() => DispatchOutput)
  async createChallan(@Args('input') input: CreateChallanInput, @Context() ctx: GraphqlRequestContext) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner', 'dispatch_ops']);
    return this.dispatch.createChallan(input as any);
  }

  @Mutation(() => DispatchOutput)
  async updateChallanStatus(
    @Args('id', { type: () => ID }) id: string,
    @Args('status') status: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner', 'dispatch_ops']);
    return this.dispatch.updateChallanStatus(id, status);
  }
}
