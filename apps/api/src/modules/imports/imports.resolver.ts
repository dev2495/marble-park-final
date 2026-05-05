import { Resolver, Mutation, Args, ObjectType, Field, Query, Context, InputType } from '@nestjs/graphql';
import { ImportsService } from './imports.service';
import { GraphQLJSON } from 'graphql-scalars';
import { GraphqlRequestContext, requireRoles } from '../auth/session-context';
import { PrismaService } from '../prisma/prisma.service';

@ObjectType()
export class ImportOutput {
  @Field()
  id!: string;

  @Field(() => GraphQLJSON, { nullable: true })
  result?: any;
}

@InputType()
class UpdateImportRowInput {
  @Field({ nullable: true }) sku?: string;
  @Field({ nullable: true }) name?: string;
  @Field({ nullable: true }) category?: string;
  @Field({ nullable: true }) brand?: string;
  @Field({ nullable: true }) finish?: string;
  @Field({ nullable: true }) dimensions?: string;
  @Field(() => Number, { nullable: true }) sellPrice?: number;
  @Field({ nullable: true }) description?: string;
}

@Resolver()
export class ImportsResolver {
  constructor(
    private imports: ImportsService,
    private prisma: PrismaService,
  ) {}

  @Query(() => [GraphQLJSON])
  async importBatches(@Context() ctx: GraphqlRequestContext) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner', 'inventory_manager']);
    return this.imports.listBatches();
  }

  @Query(() => [GraphQLJSON])
  async importRows(@Args('importBatchId') importBatchId: string, @Context() ctx: GraphqlRequestContext) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner', 'inventory_manager']);
    return this.imports.listRows(importBatchId);
  }

  @Mutation(() => ImportOutput)
  async processExcelImport(@Args('filePath') filePath: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'inventory_manager']);
    const result = await this.imports.processExcelImport(filePath, user.id);
    return { id: `excel-${Date.now()}`, result };
  }

  @Mutation(() => ImportOutput)
  async processPdfImport(@Args('filePath') filePath: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'inventory_manager']);
    const result = await this.imports.processPdfImport(filePath, user.id);
    return { id: `pdf-${Date.now()}`, result };
  }

  @Mutation(() => ImportOutput)
  async updateImportRow(
    @Args('id') id: string,
    @Args('input') input: UpdateImportRowInput,
    @Context() ctx: GraphqlRequestContext,
  ) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner', 'inventory_manager']);
    const result = await this.imports.updateImportRow(id, input);
    return { id, result };
  }

  @Mutation(() => ImportOutput)
  async applyImportBatch(@Args('importBatchId') importBatchId: string, @Context() ctx: GraphqlRequestContext) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner', 'inventory_manager']);
    const result = await this.imports.applyImportBatch(importBatchId);
    return { id: importBatchId, result };
  }

  @Mutation(() => ImportOutput)
  async submitImportBatchForApproval(@Args('importBatchId') importBatchId: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'inventory_manager']);
    const result = await this.imports.submitImportBatchForApproval(importBatchId, user.id);
    return { id: importBatchId, result };
  }

  @Mutation(() => ImportOutput)
  async approveImportBatch(
    @Args('importBatchId') importBatchId: string,
    @Context() ctx: GraphqlRequestContext,
    @Args('note', { nullable: true }) note?: string,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner']);
    const result = await this.imports.approveImportBatch(importBatchId, user.id, note);
    return { id: importBatchId, result };
  }
}
