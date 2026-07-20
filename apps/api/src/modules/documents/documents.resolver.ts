import { Resolver, Mutation, Query, Args, ID, InputType, Field, ObjectType, Context } from '@nestjs/graphql';
import { DocumentsService } from './documents.service';
import { GraphqlRequestContext, requirePermission, requireRoles, requireSession } from '../auth/session-context';
import { PrismaService } from '../prisma/prisma.service';
import { GraphQLJSON } from 'graphql-scalars';

@ObjectType()
export class DocumentOutput {
  @Field({ nullable: true })
  id?: string;

  @Field({ nullable: true })
  data?: string;

  @Field({ nullable: true })
  contentType?: string;

  @Field({ nullable: true })
  url?: string;

  @Field(() => Boolean, { nullable: true })
  success?: boolean;

  @Field({ nullable: true })
  messageId?: string;
}

@InputType()
export class SendEmailInput {
  @Field()
  to: string;

  @Field()
  subject: string;

  @Field()
  body: string;

  @Field(() => ID, { nullable: true })
  quoteId?: string;
}

@Resolver()
export class DocumentsResolver {
  constructor(
    private documents: DocumentsService,
    private prisma: PrismaService,
  ) {}

  @Mutation(() => DocumentOutput)
  async generateQuotePdf(@Args('quoteId', { type: () => ID }) quoteId: string, @Context() ctx: GraphqlRequestContext) {
    await requireSession(this.prisma, ctx);
    return this.documents.generateQuotePdf(quoteId);
  }

  @Mutation(() => DocumentOutput)
  async sendQuoteEmail(@Args('input') input: SendEmailInput, @Context() ctx: GraphqlRequestContext) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner', 'sales_manager', 'sales']);
    return this.documents.sendQuoteEmail(input);
  }

  @Query(() => [GraphQLJSON])
  async vaultAssets(
    @Context() ctx: GraphqlRequestContext,
    @Args('search', { nullable: true }) search?: string,
    @Args('category', { nullable: true }) category?: string,
    @Args('mediaKind', { nullable: true }) mediaKind?: string,
    @Args('status', { nullable: true }) status?: string,
    @Args('take', { nullable: true }) take?: number,
  ) {
    await requirePermission(this.prisma, ctx, 'documents.view');
    return this.documents.listVaultAssets({ search, category, mediaKind, status, take });
  }

  @Query(() => GraphQLJSON)
  async vaultSummary(@Context() ctx: GraphqlRequestContext) {
    await requirePermission(this.prisma, ctx, 'documents.view');
    return this.documents.vaultSummary();
  }

  @Mutation(() => GraphQLJSON)
  async updateVaultAsset(
    @Args('assetId', { type: () => ID }) assetId: string,
    @Args('input', { type: () => GraphQLJSON }) input: any,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requirePermission(this.prisma, ctx, 'documents.manage');
    return this.documents.updateVaultAsset(assetId, input, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async setVaultAssetArchived(
    @Args('assetId', { type: () => ID }) assetId: string,
    @Args('archived') archived: boolean,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requirePermission(this.prisma, ctx, 'documents.manage');
    return this.documents.setVaultAssetArchived(assetId, archived, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async createVaultShare(
    @Args('assetId', { type: () => ID }) assetId: string,
    @Args('input', { type: () => GraphQLJSON }) input: any,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requirePermission(this.prisma, ctx, 'documents.manage');
    return this.documents.createVaultShare(assetId, input, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async revokeVaultShare(
    @Args('shareId', { type: () => ID }) shareId: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requirePermission(this.prisma, ctx, 'documents.manage');
    return this.documents.revokeVaultShare(shareId, user.id);
  }

  @Mutation(() => GraphQLJSON)
  async deleteVaultAssetPermanently(
    @Args('assetId', { type: () => ID }) assetId: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner']);
    return this.documents.purgeVaultAsset(assetId, user.id);
  }
}
