import { Resolver, Query, Mutation, Args, ID, InputType, Field, ObjectType, Context } from '@nestjs/graphql';
import { CustomersService } from './customers.service';
import { GraphqlRequestContext, requireRoles, requireSession } from '../auth/session-context';
import { PrismaService } from '../prisma/prisma.service';
import { GraphQLJSON } from 'graphql-scalars';

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

  @Field(() => Boolean, { nullable: true, description: 'Bypass duplicate-customer guard. Owners/admins only.' })
  forceCreate?: boolean;
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
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff']);
    // Only owners/admins may force-create past the duplicate guard.
    const sanitized = { ...input };
    if (sanitized.forceCreate && !['admin', 'owner'].includes(user.role)) {
      sanitized.forceCreate = false;
    }
    return this.customers.create(sanitized as any);
  }

  @Query(() => [GraphQLJSON], { name: 'customerDuplicateCandidates', description: 'Probe for existing customers that look like duplicates of the provided fields.' })
  async customerDuplicateCandidates(
    @Context() ctx: GraphqlRequestContext,
    @Args('gstNo', { nullable: true }) gstNo?: string,
    @Args('email', { nullable: true }) email?: string,
    @Args('phone', { nullable: true }) phone?: string,
    @Args('name', { nullable: true }) name?: string,
    @Args('city', { nullable: true }) city?: string,
    @Args('excludeId', { nullable: true }) excludeId?: string,
  ) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales', 'office_staff']);
    return this.customers.findDuplicateCandidates({ gstNo, email, phone, name, city, excludeId });
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
