import { Resolver, Query, Mutation, Args, ID, InputType, Field, ObjectType, Context } from '@nestjs/graphql';
import { CustomersService } from './customers.service';
import { GraphqlRequestContext, requireRoles, requireSession } from '../auth/session-context';
import { PrismaService } from '../prisma/prisma.service';

@ObjectType()
export class CustomerOutput {
  @Field()
  id!: string;

  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  mobile?: string;

  @Field({ nullable: true })
  email?: string;

  @Field({ nullable: true })
  architectName?: string;

  @Field({ nullable: true })
  siteAddress?: string;

  @Field({ nullable: true })
  city?: string;

  @Field({ nullable: true })
  companyName?: string;

  @Field({ nullable: true })
  phone?: string;

  @Field({ nullable: true })
  state?: string;

  @Field({ nullable: true })
  architect?: string;

  @Field({ nullable: true })
  designer?: string;

  @Field({ nullable: true })
  gstNo?: string;

  @Field({ nullable: true })
  notes?: string;
}

@InputType()
export class CreateCustomerInput {
  @Field(() => String, { nullable: true })
  name?: string;

  @Field(() => String, { nullable: true })
  companyName?: string;

  @Field(() => String, { nullable: true })
  email?: string;

  @Field(() => String, { nullable: true })
  phone?: string;

  @Field(() => String, { nullable: true })
  gstNo?: string;

  @Field(() => String, { nullable: true })
  address?: string;

  @Field(() => String, { nullable: true })
  city?: string;

  @Field(() => String, { nullable: true })
  state?: string;

  @Field(() => String, { nullable: true })
  architect?: string;

  @Field(() => String, { nullable: true })
  designer?: string;

  @Field(() => String, { nullable: true })
  notes?: string;

  @Field(() => String, { nullable: true })
  tags?: string;
}

@InputType()
export class UpdateCustomerInput {
  @Field(() => String, { nullable: true })
  name?: string;

  @Field(() => String, { nullable: true })
  companyName?: string;

  @Field(() => String, { nullable: true })
  email?: string;

  @Field(() => String, { nullable: true })
  phone?: string;

  @Field(() => String, { nullable: true })
  gstNo?: string;

  @Field(() => String, { nullable: true })
  address?: string;

  @Field(() => String, { nullable: true })
  city?: string;

  @Field(() => String, { nullable: true })
  state?: string;

  @Field(() => String, { nullable: true })
  architect?: string;

  @Field(() => String, { nullable: true })
  designer?: string;

  @Field(() => String, { nullable: true })
  notes?: string;

  @Field(() => String, { nullable: true })
  tags?: string;
}

@Resolver()
export class CustomersResolver {
  constructor(
    private customers: CustomersService,
    private prisma: PrismaService,
  ) {}

  @Query(() => [CustomerOutput], { name: 'customers' })
  async getCustomers(@Args('search', { type: () => String, nullable: true }) search: string | undefined, @Context() ctx: GraphqlRequestContext) {
    await requireSession(this.prisma, ctx);
    return this.customers.findAll({ search });
  }

  @Query(() => CustomerOutput)
  async customer(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    await requireSession(this.prisma, ctx);
    return this.customers.findById(id);
  }

  @Mutation(() => CustomerOutput)
  async createCustomer(@Args('input') input: CreateCustomerInput, @Context() ctx: GraphqlRequestContext) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff']);
    return this.customers.create(input as any);
  }

  @Mutation(() => CustomerOutput)
  async updateCustomer(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateCustomerInput,
    @Context() ctx: GraphqlRequestContext,
  ) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff']);
    return this.customers.update(id, input as any);
  }

  @Mutation(() => CustomerOutput)
  async deleteCustomer(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner']);
    return this.customers.delete(id);
  }
}
