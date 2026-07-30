import { Resolver, Query, Mutation, Args, ID, InputType, Field, ObjectType, Int, Context, GraphQLISODateTime } from '@nestjs/graphql';
import { ProductsService } from './products.service';
import { GraphQLJSON } from 'graphql-scalars';
import { GraphqlRequestContext, requirePermission, requireSession } from '../auth/session-context';
import { PrismaService } from '../prisma/prisma.service';

@ObjectType()
export class ProductOutput {
  @Field()
  id!: string;

  @Field({ nullable: true })
  sku?: string;

  @Field({ nullable: true }) internalCode?: string;

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

  @Field(() => Number, { nullable: true })
  costPrice?: number;

  @Field({ nullable: true })
  taxClass?: string;

  @Field({ nullable: true })
  status?: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => GraphQLJSON, { nullable: true })
  media?: any;

  @Field({ nullable: true }) categoryId?: string;
  @Field({ nullable: true }) brandId?: string;
  @Field({ nullable: true }) finishId?: string;
  @Field({ nullable: true }) materialId?: string;
  @Field({ nullable: true }) tileSizeId?: string;
  @Field({ nullable: true }) baseUom?: string;
  @Field({ nullable: true }) purchaseUom?: string;
  @Field({ nullable: true }) salesUom?: string;
  @Field(() => Number, { nullable: true }) piecesPerPack?: number;
  @Field(() => Number, { nullable: true }) coveragePerPack?: number;
  @Field({ nullable: true }) hsnCode?: string;
  @Field({ nullable: true }) allowLoose?: boolean;

  @Field(() => GraphQLISODateTime, { nullable: true })
  updatedAt?: Date;
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

  @Field(() => Number, { nullable: true })
  costPrice?: number;

  @Field(() => String, { nullable: true })
  taxClass?: string;

  @Field(() => String, { nullable: true })
  description?: string;

  @Field(() => String, { nullable: true })
  status?: string;

  @Field(() => GraphQLJSON, { nullable: true })
  media?: any;

  @Field({ nullable: true }) internalCode?: string;
  @Field({ nullable: true }) materialId?: string;
  @Field({ nullable: true }) tileSizeId?: string;
  @Field({ nullable: true }) baseUom?: string;
  @Field({ nullable: true }) purchaseUom?: string;
  @Field({ nullable: true }) salesUom?: string;
  @Field(() => Number, { nullable: true }) piecesPerPack?: number;
  @Field(() => Number, { nullable: true }) coveragePerPack?: number;
  @Field({ nullable: true }) hsnCode?: string;
  @Field({ nullable: true }) allowLoose?: boolean;

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

  @Field(() => Number, { nullable: true })
  costPrice?: number;

  @Field(() => String, { nullable: true })
  taxClass?: string;

  @Field(() => String, { nullable: true })
  description?: string;

  @Field(() => String, { nullable: true })
  status?: string;

  @Field(() => GraphQLJSON, { nullable: true })
  media?: any;

  @Field(() => String, { nullable: true })
  expectedUpdatedAt?: string;

  @Field({ nullable: true }) internalCode?: string;
  @Field({ nullable: true }) materialId?: string;
  @Field({ nullable: true }) tileSizeId?: string;
  @Field({ nullable: true }) baseUom?: string;
  @Field({ nullable: true }) purchaseUom?: string;
  @Field({ nullable: true }) salesUom?: string;
  @Field(() => Number, { nullable: true }) piecesPerPack?: number;
  @Field(() => Number, { nullable: true }) coveragePerPack?: number;
  @Field({ nullable: true }) hsnCode?: string;
  @Field({ nullable: true }) allowLoose?: boolean;
}

@InputType()
class DisplaySampleInput {
  @Field() productId!: string;
  @Field({ nullable: true }) internalCode?: string;
  @Field({ nullable: true }) locationId?: string;
  @Field({ nullable: true }) displayZone?: string;
  @Field({ nullable: true }) displayPosition?: string;
  @Field({ nullable: true }) imageUrl?: string;
  @Field({ nullable: true }) installedAt?: string;
  @Field(() => GraphQLJSON, { nullable: true }) metadata?: any;
}

@InputType()
class UpdateDisplaySampleInput {
  @Field({ nullable: true }) internalCode?: string;
  @Field({ nullable: true }) locationId?: string;
  @Field({ nullable: true }) displayZone?: string;
  @Field({ nullable: true }) displayPosition?: string;
  @Field({ nullable: true }) imageUrl?: string;
  @Field({ nullable: true }) status?: string;
  @Field(() => GraphQLJSON, { nullable: true }) metadata?: any;
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
    @Args('skip', { type: () => Int, nullable: true }) skip?: number,
    @Args('includeInactive', { nullable: true }) includeInactive?: boolean,
  ) {
    await requireSession(this.prisma, ctx);
    return this.products.findAll({ search, category, take, skip, includeInactive });
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

  @Query(() => GraphQLJSON)
  async productMasters(@Context() ctx: GraphqlRequestContext) {
    await requireSession(this.prisma, ctx);
    return this.products.getMasters();
  }

  @Query(() => [GraphQLJSON])
  async displaySamples(
    @Context() ctx: GraphqlRequestContext,
    @Args('productId', { nullable: true }) productId?: string,
    @Args('locationId', { nullable: true }) locationId?: string,
    @Args('status', { nullable: true }) status?: string,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    await requireSession(this.prisma, ctx);
    return this.products.displaySamples({ productId, locationId, status, take });
  }

  @Query(() => GraphQLJSON)
  async tileDesignStats(@Context() ctx: GraphqlRequestContext) {
    await requireSession(this.prisma, ctx);
    return this.products.tileDesignStats();
  }

  @Mutation(() => GraphQLJSON)
  async createDisplaySample(@Args('input') input: DisplaySampleInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'products.manage');
    return this.products.createDisplaySample(input, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async updateDisplaySample(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateDisplaySampleInput,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requirePermission(this.prisma, ctx, 'products.manage');
    return this.products.updateDisplaySample(id, input, user.id);
  }

  @Mutation(() => ProductOutput)
  async createProduct(@Args('input') input: CreateProductInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'products.manage');
    return this.products.create(input as any, user.id);
  }

  @Mutation(() => ProductOutput)
  async updateProduct(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateProductInput,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requirePermission(this.prisma, ctx, 'products.manage');
    return this.products.update(id, input as any, user.id);
  }

  @Mutation(() => ProductOutput)
  async deleteProduct(@Args('id', { type: () => ID }) id: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'products.manage');
    return this.products.delete(id, user.id);
  }
}
