import { Resolver, Query, Mutation, Args, ID, InputType, Field, ObjectType, Int, Context, GraphQLISODateTime } from '@nestjs/graphql';
import { ProductsService } from './products.service';
import { GraphQLJSON } from 'graphql-scalars';
import { GraphqlRequestContext, requirePermission, requireRoles, requireSession } from '../auth/session-context';
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

  @Field(() => Number, { nullable: true }) defaultMrpInclusive?: number;
  @Field(() => Number, { nullable: true }) defaultNrpInclusive?: number;
  @Field(() => Number, { nullable: true }) floorPriceInclusive?: number;
  @Field({ nullable: true }) priceRateBasis?: string;
  @Field({ nullable: true }) priceUom?: string;
  @Field(() => GraphQLISODateTime, { nullable: true }) mrpVerifiedAt?: Date;
  @Field({ nullable: true }) mrpVerifiedById?: string;
  @Field({ nullable: true }) mrpSource?: string;
  @Field(() => GraphQLISODateTime, { nullable: true }) pricingEffectiveFrom?: Date;
  @Field({ nullable: true }) pricingVersion?: string;

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
  @Field({ nullable: true }) tileDesignId?: string;
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

  @Field(() => Number, { nullable: true }) defaultMrpInclusive?: number;
  @Field(() => Number, { nullable: true }) defaultNrpInclusive?: number;
  @Field(() => Number, { nullable: true }) floorPriceInclusive?: number;
  @Field({ nullable: true }) priceRateBasis?: string;
  @Field({ nullable: true }) priceUom?: string;
  @Field({ nullable: true }) mrpSource?: string;
  @Field(() => String, { nullable: true }) pricingEffectiveFrom?: string;

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
  @Field({ nullable: true }) tileDesignId?: string;
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

  @Field(() => Number, { nullable: true }) defaultMrpInclusive?: number;
  @Field(() => Number, { nullable: true }) defaultNrpInclusive?: number;
  @Field(() => Number, { nullable: true }) floorPriceInclusive?: number;
  @Field({ nullable: true }) priceRateBasis?: string;
  @Field({ nullable: true }) priceUom?: string;
  @Field({ nullable: true }) mrpSource?: string;
  @Field({ nullable: true }) mrpChangeReason?: string;
  @Field(() => String, { nullable: true }) pricingEffectiveFrom?: string;

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
  @Field({ nullable: true }) tileDesignId?: string;
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
  @Field({ nullable: true }) sourceLotId?: string;
  @Field(() => Int, { nullable: true }) issuedQuantity?: number;
  @Field({ nullable: true }) condition?: string;
  @Field({ nullable: true }) nextInspectionAt?: string;
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
  @Field({ nullable: true }) condition?: string;
  @Field({ nullable: true }) lastInspectedAt?: string;
  @Field({ nullable: true }) nextInspectionAt?: string;
  @Field({ nullable: true }) removalReason?: string;
  @Field(() => GraphQLJSON, { nullable: true }) metadata?: any;
}

@InputType()
class DisplaySampleTransitionInput {
  @Field() action!: string;
  @Field() reason!: string;
  @Field({ nullable: true }) condition?: string;
  @Field(() => Int, { nullable: true }) returnQuantity?: number;
  @Field({ nullable: true }) nextInspectionAt?: string;
}

@InputType()
class ProductAliasInput {
  @Field(() => ID) productId!: string;
  @Field() type!: string;
  @Field() value!: string;
  @Field({ nullable: true }) isPrimary?: boolean;
}

@InputType()
class TileDesignInput {
  @Field({ nullable: true }) id?: string;
  @Field() designCode!: string;
  @Field() name!: string;
  @Field({ nullable: true }) brand?: string;
  @Field({ nullable: true }) collection?: string;
  @Field({ nullable: true }) material?: string;
  @Field({ nullable: true }) surface?: string;
  @Field({ nullable: true }) style?: string;
  @Field({ nullable: true }) colour?: string;
  @Field({ nullable: true }) pattern?: string;
  @Field(() => GraphQLJSON, { nullable: true }) usage?: any;
  @Field({ nullable: true }) origin?: string;
  @Field({ nullable: true }) description?: string;
  @Field(() => GraphQLJSON, { nullable: true }) media?: any;
  @Field(() => GraphQLJSON, { nullable: true }) tags?: any;
  @Field({ nullable: true }) status?: string;
  @Field(() => GraphQLJSON, { nullable: true }) metadata?: any;
}

@InputType()
class TileVariantInput {
  @Field({ nullable: true }) id?: string;
  @Field() tileDesignId!: string;
  @Field() tileSizeId!: string;
  @Field({ nullable: true }) sku?: string;
  @Field({ nullable: true }) internalCode?: string;
  @Field({ nullable: true }) finish?: string;
  @Field({ nullable: true }) piecesPerPack?: number;
  @Field({ nullable: true }) purchaseUom?: string;
  @Field({ nullable: true }) salesUom?: string;
  @Field({ nullable: true }) allowLoose?: boolean;
  @Field({ nullable: true }) hsnCode?: string;
  @Field({ nullable: true }) defaultMrpInclusive?: number;
  @Field({ nullable: true }) defaultNrpInclusive?: number;
  @Field({ nullable: true }) floorPriceInclusive?: number;
  @Field({ nullable: true }) priceRateBasis?: string;
  @Field({ nullable: true }) priceUom?: string;
  @Field({ nullable: true }) mrpSource?: string;
  @Field({ nullable: true }) mrpChangeReason?: string;
  @Field({ nullable: true }) pricingEffectiveFrom?: string;
  @Field({ nullable: true }) expectedUpdatedAt?: string;
  @Field({ nullable: true }) status?: string;
  @Field({ nullable: true }) alias?: string;
}

@InputType()
class ProductPricingCompletionInput {
  @Field() productId!: string;
  @Field(() => Number) defaultMrpInclusive!: number;
  @Field(() => Number, { nullable: true }) defaultNrpInclusive?: number;
  @Field(() => Number, { nullable: true }) floorPriceInclusive?: number;
  @Field({ nullable: true }) priceRateBasis?: string;
  @Field({ nullable: true }) priceUom?: string;
  @Field({ nullable: true }) mrpSource?: string;
  @Field({ nullable: true }) mrpChangeReason?: string;
  @Field({ nullable: true }) pricingEffectiveFrom?: string;
  @Field({ nullable: true }) expectedUpdatedAt?: string;
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

  @Query(() => [ProductOutput])
  async productsByIds(@Args('ids', { type: () => [ID] }) ids: string[], @Context() ctx: GraphqlRequestContext) {
    await requireSession(this.prisma, ctx);
    return this.products.findByIds(ids);
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
  async displaySamplesPage(
    @Context() ctx: GraphqlRequestContext,
    @Args('search', { nullable: true }) search?: string,
    @Args('locationId', { nullable: true }) locationId?: string,
    @Args('status', { nullable: true }) status?: string,
    @Args('sort', { nullable: true }) sort?: string,
    @Args('skip', { type: () => Int, nullable: true }) skip?: number,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    await requireSession(this.prisma, ctx);
    return this.products.displaySamplesPage({ search, locationId, status, sort, skip, take });
  }

  @Query(() => GraphQLJSON)
  async tileDesignStats(@Context() ctx: GraphqlRequestContext) {
    await requireSession(this.prisma, ctx);
    return this.products.tileDesignStats();
  }

  @Query(() => GraphQLJSON)
  async tileDesignsPage(
    @Context() ctx: GraphqlRequestContext,
    @Args('search', { nullable: true }) search?: string,
    @Args('status', { nullable: true }) status?: string,
    @Args('sort', { nullable: true }) sort?: string,
    @Args('skip', { type: () => Int, nullable: true }) skip?: number,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    await requireSession(this.prisma, ctx);
    return this.products.tileDesignsPage({ search, status, sort, skip, take });
  }

  @Query(() => GraphQLJSON)
  async tileVariantsPage(
    @Context() ctx: GraphqlRequestContext,
    @Args('search', { nullable: true }) search?: string,
    @Args('tileDesignId', { nullable: true }) tileDesignId?: string,
    @Args('tileSizeId', { nullable: true }) tileSizeId?: string,
    @Args('status', { nullable: true }) status?: string,
    @Args('sort', { nullable: true }) sort?: string,
    @Args('skip', { type: () => Int, nullable: true }) skip?: number,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    await requireSession(this.prisma, ctx);
    return this.products.tileVariantsPage({ search, tileDesignId, tileSizeId, status, sort, skip, take });
  }

  @Mutation(() => GraphQLJSON)
  async saveTileDesign(@Args('input') input: TileDesignInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'products.manage');
    return this.products.saveTileDesign(input, user.id);
  }

  @Mutation(() => ProductOutput)
  async saveTileVariant(@Args('input') input: TileVariantInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'products.manage');
    return this.products.saveTileVariant(input, user.id);
  }

  @Query(() => GraphQLJSON)
  async productPricingReadinessPage(
    @Context() ctx: GraphqlRequestContext,
    @Args('search', { nullable: true }) search?: string,
    @Args('status', { nullable: true }) status?: string,
    @Args('sort', { nullable: true }) sort?: string,
    @Args('skip', { type: () => Int, nullable: true }) skip?: number,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner']);
    return this.products.pricingReadinessPage({ search, status, sort, skip, take });
  }

  @Query(() => GraphQLJSON)
  async productMrpHistoryPage(
    @Context() ctx: GraphqlRequestContext,
    @Args('productId', { nullable: true }) productId?: string,
    @Args('search', { nullable: true }) search?: string,
    @Args('actorUserId', { nullable: true }) actorUserId?: string,
    @Args('from', { nullable: true }) from?: string,
    @Args('to', { nullable: true }) to?: string,
    @Args('skip', { type: () => Int, nullable: true }) skip?: number,
    @Args('take', { type: () => Int, nullable: true }) take?: number,
  ) {
    await requireSession(this.prisma, ctx);
    return this.products.mrpHistoryPage({ productId, search, actorUserId, from, to, skip, take });
  }

  @Mutation(() => ProductOutput)
  async completeProductPricing(@Args('input') input: ProductPricingCompletionInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner']);
    return this.products.completePricing(input, user.id);
  }

  @Query(() => [GraphQLJSON])
  async productAliases(@Args('productId', { type: () => ID }) productId: string, @Context() ctx: GraphqlRequestContext) {
    await requireSession(this.prisma, ctx);
    return this.products.productAliases(productId);
  }

  @Mutation(() => GraphQLJSON)
  async saveProductAlias(@Args('input') input: ProductAliasInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'products.manage');
    return this.products.saveProductAlias(input, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async archiveProductAlias(
    @Args('id', { type: () => ID }) id: string,
    @Args('reason') reason: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requirePermission(this.prisma, ctx, 'products.manage');
    return this.products.archiveProductAlias(id, reason, user.id);
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

  @Mutation(() => GraphQLJSON)
  async transitionDisplaySample(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: DisplaySampleTransitionInput,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requirePermission(this.prisma, ctx, 'products.manage');
    return this.products.transitionDisplaySample(id, input, user.id);
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
