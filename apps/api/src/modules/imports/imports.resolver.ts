import { Resolver, Mutation, Args, ObjectType, Field, Query, Context, InputType } from '@nestjs/graphql';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ImportsService } from './imports.service';
import { GraphQLJSON } from 'graphql-scalars';
import { GraphqlRequestContext, requireRoles } from '../auth/session-context';
import { PrismaService } from '../prisma/prisma.service';
import { ulid } from 'ulid';

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

function writeUploadToTemp(filename: string, contentBase64: string) {
  const safeName = path.basename(filename || `catalogue-${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, '-');
  const filePath = path.join(os.tmpdir(), `marble-import-${Date.now()}-${safeName}`);
  fs.writeFileSync(filePath, Buffer.from(contentBase64, 'base64'));
  return filePath;
}

function uploadTempPath(uploadId: string, filename: string) {
  const safeUploadId = uploadId.replace(/[^a-zA-Z0-9_-]/g, '');
  const safeName = path.basename(filename || 'catalogue-upload').replace(/[^a-zA-Z0-9._-]/g, '-');
  return path.join(os.tmpdir(), `marble-import-${safeUploadId}-${safeName}`);
}

function persistentManualAssetPath(filename: string) {
  const importImageDir = process.env.CATALOGUE_IMPORT_IMAGE_DIR || path.resolve(process.cwd(), '../../apps/web/public/catalogue-images/imports');
  const catalogueImageRoot = process.env.CATALOGUE_IMAGE_STORAGE_DIR || path.dirname(importImageDir);
  const ext = path.extname(filename || '').replace(/[^a-zA-Z0-9.]/g, '').slice(0, 12) || '.bin';
  const safeName = `${ulid()}${ext}`;
  const directory = path.join(catalogueImageRoot, 'manual');
  fs.mkdirSync(directory, { recursive: true });
  return { filePath: path.join(directory, safeName), safeName };
}

function cataloguePublicUrl(fileName: string) {
  const baseUrl = String(process.env.PUBLIC_CATALOGUE_IMAGE_BASE_URL || '').replace(/\/+$/, '');
  return `${baseUrl}/catalogue-images/manual/${fileName}`;
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
  async processExcelUpload(
    @Args('filename') filename: string,
    @Args('contentBase64') contentBase64: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'inventory_manager']);
    const filePath = writeUploadToTemp(filename, contentBase64);
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
  async processPdfUpload(
    @Args('filename') filename: string,
    @Args('contentBase64') contentBase64: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'inventory_manager']);
    const filePath = writeUploadToTemp(filename, contentBase64);
    const result = await this.imports.processPdfImport(filePath, user.id);
    return { id: `pdf-${Date.now()}`, result };
  }

  @Mutation(() => ImportOutput)
  async beginImportUpload(@Args('filename') filename: string, @Context() ctx: GraphqlRequestContext) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner', 'inventory_manager']);
    const uploadId = ulid();
    const filePath = uploadTempPath(uploadId, filename);
    fs.rmSync(filePath, { force: true });
    fs.writeFileSync(filePath, '');
    return { id: uploadId, result: { uploadId } };
  }

  @Mutation(() => ImportOutput)
  async appendImportUpload(
    @Args('uploadId') uploadId: string,
    @Args('filename') filename: string,
    @Args('contentBase64') contentBase64: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner', 'inventory_manager']);
    const filePath = uploadTempPath(uploadId, filename);
    fs.appendFileSync(filePath, Buffer.from(contentBase64, 'base64'));
    return { id: uploadId, result: { uploadedBytes: fs.statSync(filePath).size } };
  }

  @Mutation(() => ImportOutput)
  async processUploadedImport(
    @Args('uploadId') uploadId: string,
    @Args('filename') filename: string,
    @Args('kind') kind: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requireRoles(this.prisma, ctx, ['admin', 'owner', 'inventory_manager']);
    const filePath = uploadTempPath(uploadId, filename);
    if (!fs.existsSync(filePath)) {
      throw new Error('Uploaded file was not found. Please upload again.');
    }
    const result = kind === 'pdf'
      ? await this.imports.processPdfImport(filePath, user.id)
      : await this.imports.processExcelImport(filePath, user.id);
    return { id: uploadId, result };
  }

  @Mutation(() => ImportOutput)
  async uploadStoredAsset(
    @Args('filename') filename: string,
    @Args('contentBase64') contentBase64: string,
    @Context() ctx: GraphqlRequestContext,
    @Args('scope', { nullable: true }) scope?: string,
  ) {
    await requireRoles(this.prisma, ctx, ['admin', 'owner', 'inventory_manager', 'sales_manager', 'sales', 'office_staff', 'dispatch_ops']);
    const { filePath, safeName } = persistentManualAssetPath(filename);
    fs.writeFileSync(filePath, Buffer.from(contentBase64, 'base64'));
    return {
      id: safeName,
      result: {
        scope: scope || 'asset',
        filePath,
        publicUrl: cataloguePublicUrl(safeName),
      },
    };
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
