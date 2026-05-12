import { Args, Context, Field, InputType, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-scalars';
import { GraphqlRequestContext, requireRoles } from '../auth/session-context';
import { PrismaService } from '../prisma/prisma.service';
import { SystemService } from './system.service';

@ObjectType()
class SystemJsonOutput {
  @Field(() => GraphQLJSON)
  data!: any;
}

@InputType()
class UpdateSettingsInput {
  @Field({ nullable: true }) canonicalAppUrl?: string;
  @Field({ nullable: true }) quotePrefix?: string;
  @Field({ nullable: true }) challanPrefix?: string;
  @Field(() => Number, { nullable: true }) approvalDiscountThreshold?: number;
  @Field({ nullable: true }) companyName?: string;
  @Field({ nullable: true }) supportPhone?: string;
  @Field({ nullable: true }) supportEmail?: string;
}

@InputType()
class ProductCategoryInput {
  @Field({ nullable: true }) id?: string;
  @Field() name!: string;
  @Field({ nullable: true }) code?: string;
  @Field({ nullable: true }) description?: string;
  @Field({ nullable: true }) status?: string;
  @Field(() => Number, { nullable: true }) sortOrder?: number;
  @Field(() => GraphQLJSON, { nullable: true }) metadata?: any;
}

@InputType()
class ProductBrandInput {
  @Field({ nullable: true }) id?: string;
  @Field() name!: string;
  @Field({ nullable: true }) code?: string;
  @Field({ nullable: true }) description?: string;
  @Field({ nullable: true }) status?: string;
  @Field(() => Number, { nullable: true }) sortOrder?: number;
  @Field(() => GraphQLJSON, { nullable: true }) metadata?: any;
}

@InputType()
class ProductFinishInput {
  @Field({ nullable: true }) id?: string;
  @Field() name!: string;
  @Field({ nullable: true }) code?: string;
  @Field({ nullable: true }) description?: string;
  @Field({ nullable: true }) status?: string;
  @Field(() => Number, { nullable: true }) sortOrder?: number;
  @Field(() => GraphQLJSON, { nullable: true }) metadata?: any;
}

@InputType()
class VendorInput {
  @Field({ nullable: true }) id?: string;
  @Field() name!: string;
  @Field({ nullable: true }) phone?: string;
  @Field({ nullable: true }) email?: string;
  @Field({ nullable: true }) gstNo?: string;
  @Field({ nullable: true }) address?: string;
  @Field({ nullable: true }) city?: string;
  @Field({ nullable: true }) state?: string;
  @Field({ nullable: true }) contactPerson?: string;
  @Field({ nullable: true }) category?: string;
  @Field({ nullable: true }) status?: string;
  @Field({ nullable: true }) notes?: string;
  @Field(() => GraphQLJSON, { nullable: true }) metadata?: any;
}

@Resolver()
export class SystemResolver {
  constructor(private system: SystemService, private prisma: PrismaService) {}

  @Query(() => SystemJsonOutput)
  async appSettings(@Context() ctx: GraphqlRequestContext) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner']);
    return { data: await this.system.getSettings() };
  }

  @Mutation(() => SystemJsonOutput)
  async updateAppSettings(@Args('input') input: UpdateSettingsInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner']);
    return { data: await this.system.updateSettings(input, user.id) };
  }

  @Mutation(() => SystemJsonOutput)
  async resetClientWorkspace(@Args('confirm') confirm: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['admin']);
    return { data: await this.system.resetClientWorkspace(confirm, user.id) };
  }

  @Query(() => [GraphQLJSON], { name: 'legacyAuditEvents' })
  async legacyAuditEvents(
    @Context() ctx: GraphqlRequestContext,
    @Args('entityType', { nullable: true }) entityType?: string,
    @Args('entityId', { nullable: true }) entityId?: string,
    @Args('take', { nullable: true }) take?: number,
  ) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner']);
    return this.system.auditEvents({ entityType, entityId, take });
  }

  @Query(() => [GraphQLJSON])
  async catalogReviewTasks(
    @Context() ctx: GraphqlRequestContext,
    @Args('status', { nullable: true }) status?: string,
    @Args('take', { nullable: true }) take?: number,
  ) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner', 'inventory_manager']);
    return this.system.reviewTasks({ status, take });
  }

  @Mutation(() => SystemJsonOutput)
  async mapCatalogReviewTask(
    @Args('id') id: string,
    @Args('productId') productId: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'inventory_manager']);
    return { data: await this.system.mapReviewTask(id, productId, user.id) };
  }

  @Mutation(() => SystemJsonOutput)
  async submitCatalogReviewTaskForApproval(
    @Args('id') id: string,
    @Args('productId') productId: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'inventory_manager']);
    return { data: await this.system.submitReviewTaskForApproval(id, productId, user.id) };
  }

  @Mutation(() => SystemJsonOutput)
  async approveCatalogReviewTask(
    @Args('id') id: string,
    @Context() ctx: GraphqlRequestContext,
    @Args('note', { nullable: true }) note?: string,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner']);
    return { data: await this.system.approveReviewTask(id, user.id, note) };
  }

  @Query(() => [GraphQLJSON])
  async masterProductCategories(
    @Context() ctx: GraphqlRequestContext,
    @Args('status', { nullable: true }) status?: string,
  ) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner', 'inventory_manager', 'sales_manager', 'sales']);
    return this.system.productCategories({ status });
  }

  @Mutation(() => SystemJsonOutput)
  async saveProductCategory(@Args('input') input: ProductCategoryInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'inventory_manager']);
    return { data: await this.system.upsertProductCategory(input, user.id) };
  }

  @Query(() => [GraphQLJSON])
  async masterProductBrands(
    @Context() ctx: GraphqlRequestContext,
    @Args('status', { nullable: true }) status?: string,
  ) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner', 'inventory_manager', 'sales_manager', 'sales']);
    return this.system.productBrands({ status });
  }

  @Mutation(() => SystemJsonOutput)
  async saveProductBrand(@Args('input') input: ProductBrandInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'inventory_manager']);
    return { data: await this.system.upsertProductBrand(input, user.id) };
  }

  @Query(() => [GraphQLJSON])
  async masterProductFinishes(
    @Context() ctx: GraphqlRequestContext,
    @Args('status', { nullable: true }) status?: string,
  ) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner', 'inventory_manager', 'sales_manager', 'sales']);
    return this.system.productFinishes({ status });
  }

  @Mutation(() => SystemJsonOutput)
  async saveProductFinish(@Args('input') input: ProductFinishInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'inventory_manager']);
    return { data: await this.system.upsertProductFinish(input, user.id) };
  }

  @Query(() => [GraphQLJSON])
  async vendors(
    @Context() ctx: GraphqlRequestContext,
    @Args('search', { nullable: true }) search?: string,
    @Args('status', { nullable: true }) status?: string,
    @Args('take', { nullable: true }) take?: number,
  ) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner', 'inventory_manager', 'sales_manager', 'sales', 'dispatch']);
    return this.system.vendors({ search, status, take });
  }

  @Mutation(() => SystemJsonOutput)
  async saveVendor(@Args('input') input: VendorInput, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'inventory_manager']);
    return { data: await this.system.upsertVendor(input, user.id) };
  }
}
