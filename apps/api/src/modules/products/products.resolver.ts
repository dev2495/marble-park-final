import { Resolver, Query, Mutation, Args, ID, InputType, Field, ObjectType, Int, Context } from '@nestjs/graphql';
import { ProductsService } from './products.service';
import { GraphQLJSON } from 'graphql-scalars';
import { GraphqlRequestContext, requireRoles, requireSession } from '../auth/session-context';
import { PrismaService } from '../prisma/prisma.service';

@ObjectType()
export class ProductOutput {
  @Field()
  id!: string;

  @Field({ nullable: true })
  sku?: string;

  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  category?: string;

  @Field({ nullable: true })
  brand?: string;

  @Field({ nullable: true })
  finish?: string;

  @Field({ nullable: true })
  dimensions?: string;

  @Field({ nullable: true })
  unit?: string;

  @Field(() => Number, { nullable: true })
  sellPrice?: number;

  @Field(() => Number, { nullable: true })
  floorPrice?: number;

  @Field({ nullable: true })
  taxClass?: string;

  @Field({ nullable: true })
  status?: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => GraphQLJSON, { nullable: true })
  media?: any;
}

@InputType()
export class CreateProductInput {
  @Field(() => String, { nullable: true })
  sku?: string;

  @Field(() => String, { nullable: true })
  name?: string;

  @Field(() => String, { nullable: true })
  category?: string;

  @Field(() => String, { nullable: true })
  brand?: string;

  @Field(() => String, { nullable: true })
  finish?: string;

  @Field(() => String, { nullable: true })
  dimensions?: string;

  @Field(() => String, { nullable: true })
  unit?: string;

  @Field(() => Number, { nullable: true })
  sellPrice?: number;

  @Field(() => Number, { nullable: true })
  floorPrice?: number;

  @Field(() => String, { nullable: true })
  taxClass?: string;

  @Field(() => String, { nullable: true })
  description?: string;

  @Field(() => GraphQLJSON, { nullable: true })
  media?: any;
}

@InputType()
export class UpdateProductInput {
  @Field(() => String, { nullable: true })
  name?: string;

  @Field(() => String, { nullable: true })
  category?: string;

  @Field(() => String, { nullable: true })
  brand?: string;

  @Field(() => String, { nullable: true })
  finish?: string;

  @Field(() => String, { nullable: true })
  dimensions?: string;

  @Field(() => String, { nullable: true })
  unit?: string;

  @Field(() => Number, { nullable: true })
  sellPrice?: number;

  @Field(() => Number, { nullable: true })
  floorPrice?: number;

  @Field(() => String, { nullable: true })
  taxClass?: string;

  @Field(() => String, { nullable: true })
  description?: string;

  @Field(() => String, { nullable: true })
  status?: string;

  @Field(() => GraphQLJSON, { nullable: true })
  media?: any;
}

@Resolver()
export class ProductsResolver {
  constructor(
    private products: ProductsService,
    private prisma: PrismaService,
  ) {}

  @Query(() => [ProductOutput], { name: 'products' })
  async getProducts(
    @Context() ctx: GraphqlRequestContext,
    @Args('search', { nullable: true }) search?: string,
    @Args('category', { nullable: true }) category?: string,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    await requireSession(this.prisma, ctx);
    return this.products.findAll({ search, category, take });
  }

  @Query(() => ProductOutput)
  async product(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    await requireSession(this.prisma, ctx);
    return this.products.findById(id);
  }

  @Query(() => [String])
  async productCategories(@Context() ctx: GraphqlRequestContext) {
    await requireSession(this.prisma, ctx);
    return this.products.getCategories();
  }

  @Query(() => [String])
  async productBrands(@Context() ctx: GraphqlRequestContext) {
    await requireSession(this.prisma, ctx);
    return this.products.getBrands();
  }

  @Query(() => [String])
  async productFinishes(@Context() ctx: GraphqlRequestContext) {
    await requireSession(this.prisma, ctx);
    return this.products.getFinishes();
  }

  @Query(() => GraphQLJSON)
  async productStats(@Context() ctx: GraphqlRequestContext) {
    await requireSession(this.prisma, ctx);
    return this.products.getStats();
  }

  @Mutation(() => ProductOutput)
  async createProduct(@Args('input') input: CreateProductInput, @Context() ctx: GraphqlRequestContext) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner', 'inventory_manager']);
    return this.products.create(input as any);
  }

  @Mutation(() => ProductOutput)
  async updateProduct(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateProductInput,
    @Context() ctx: GraphqlRequestContext,
  ) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner', 'inventory_manager']);
    return this.products.update(id, input as any);
  }

  @Mutation(() => ProductOutput)
  async deleteProduct(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner']);
    return this.products.delete(id);
  }
}
