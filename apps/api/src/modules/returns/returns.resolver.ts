import { Args, Context, Field, Float, ID, InputType, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-scalars';
import { ReturnsService } from './returns.service';
import { PrismaService } from '../prisma/prisma.service';
import { GraphqlRequestContext, requireRoles } from '../auth/session-context';

@ObjectType()
export class ReturnOutput {
  @Field(() => ID) id!: string;
  @Field() returnNumber!: string;
  @Field({ nullable: true }) salesOrderId?: string;
  @Field({ nullable: true }) challanId?: string;
  @Field() customerId!: string;
  @Field() status!: string;
  @Field() reason!: string;
  @Field({ nullable: true }) reasonCategory?: string;
  @Field(() => Float) refundAmount!: number;
  @Field({ nullable: true }) refundPaymentId?: string;
  @Field({ nullable: true }) notes?: string;
  @Field() recordedBy!: string;
  @Field() receivedAt!: Date;
  @Field() createdAt!: Date;
  @Field(() => GraphQLJSON, { nullable: true }) lines?: any;
}

@InputType()
export class CreateReturnInputDto {
  @Field({ nullable: true }) salesOrderId?: string;
  @Field({ nullable: true }) challanId?: string;
  @Field() customerId!: string;
  @Field() reason!: string;
  @Field({ nullable: true }) reasonCategory?: string;
  @Field(() => Float, { nullable: true }) refundAmount?: number;
  @Field({ nullable: true }) refundMode?: string;
  @Field({ nullable: true }) notes?: string;
  @Field(() => GraphQLJSON) lines!: any;
  @Field({ nullable: true, description: 'Restock returned units (default true). False = write-off / damaged.' })
  restock?: boolean;
}

@Resolver()
export class ReturnsResolver {
  constructor(private returns: ReturnsService, private prisma: PrismaService) {}

  @Mutation(() => ReturnOutput)
  async createReturn(@Args('input') input: CreateReturnInputDto, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['owner', 'admin', 'sales_manager', 'dispatch_ops', 'office_staff', 'inventory_manager']);
    return this.returns.create(input as any, user.id);
  }

  @Query(() => [ReturnOutput], { name: 'returns' })
  async returnsList(
    @Context() ctx: GraphqlRequestContext,
    @Args('customerId', { nullable: true }) customerId?: string,
    @Args('status', { nullable: true }) status?: string,
  ) {
    await requireRoles(this.prisma, ctx, ['owner', 'admin', 'sales_manager', 'sales', 'office_staff', 'inventory_manager', 'dispatch_ops']);
    return this.returns.listAll({ customerId, status });
  }

  @Query(() => ReturnOutput, { name: 'returnRecord' })
  async returnRecord(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    await requireRoles(this.prisma, ctx, ['owner', 'admin', 'sales_manager', 'sales', 'office_staff', 'inventory_manager', 'dispatch_ops']);
    return this.returns.findById(id);
  }
}
