import { BadRequestException } from '@nestjs/common';
import { Resolver, Mutation, Args, ObjectType, Field, Context } from '@nestjs/graphql';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ImportsService } from './imports.service';
import { GraphQLJSON } from 'graphql-scalars';
import { GraphqlRequestContext, requirePermission, requireRoles } from '../auth/session-context';
import { PrismaService } from '../prisma/prisma.service';
import { ulid } from 'ulid';

@ObjectType()
export class ImportOutput {
  @Field()
  id!: string;

  @Field(() => GraphQLJSON, { nullable: true })
  result?: any;
}

function writeUploadToTemp(filename: string, contentBase64: string) {
  assertExcelFile(filename);
  const safeName = path.basename(filename || `catalogue-${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, '-');
  const filePath = path.join(os.tmpdir(), `marble-excel-import-${Date.now()}-${safeName}`);
  fs.writeFileSync(filePath, Buffer.from(contentBase64, 'base64'));
  return filePath;
}

function uploadTempPath(uploadId: string, filename: string) {
  assertExcelFile(filename);
  const safeUploadId = uploadId.replace(/[^a-zA-Z0-9_-]/g, '');
  const safeName = path.basename(filename || 'catalogue-upload.xlsx').replace(/[^a-zA-Z0-9._-]/g, '-');
  return path.join(os.tmpdir(), `marble-excel-import-${safeUploadId}-${safeName}`);
}

function assertExcelFile(filename: string) {
  if (!/\.xlsx$/i.test(filename || '')) {
    throw new BadRequestException('Only .xlsx catalogue imports are supported. PDF catalogue extraction/review has been removed. Use Product Master for manual SKU and image entry.');
  }
}

function persistentManualAssetPath(filename: string) {
  const catalogueImageRoot = process.env.CATALOGUE_IMAGE_STORAGE_DIR || path.resolve(process.cwd(), '../../apps/web/public/catalogue-images');
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

  @Mutation(() => ImportOutput)
  async processExcelImport(@Args('filePath') filePath: string, @Context() ctx: GraphqlRequestContext) {
    const user = await requirePermission(this.prisma, ctx, 'catalogue.import');
    assertExcelFile(filePath);
    const result = await this.imports.processExcelImport(filePath, user.id);
    return { id: `excel-${Date.now()}`, result };
  }

  @Mutation(() => ImportOutput)
  async processExcelUpload(
    @Args('filename') filename: string,
    @Args('contentBase64') contentBase64: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requirePermission(this.prisma, ctx, 'catalogue.import');
    const filePath = writeUploadToTemp(filename, contentBase64);
    const result = await this.imports.processExcelImport(filePath, user.id);
    return { id: `excel-${Date.now()}`, result };
  }

  @Mutation(() => ImportOutput)
  async beginImportUpload(@Args('filename') filename: string, @Context() ctx: GraphqlRequestContext) {
    await requirePermission(this.prisma, ctx, 'catalogue.import');
    assertExcelFile(filename);
    const uploadId = ulid();
    const filePath = uploadTempPath(uploadId, filename);
    fs.rmSync(filePath, { force: true });
    fs.writeFileSync(filePath, '');
    return { id: uploadId, result: { uploadId, mode: 'excel-preview-then-apply' } };
  }

  @Mutation(() => ImportOutput)
  async appendImportUpload(
    @Args('uploadId') uploadId: string,
    @Args('filename') filename: string,
    @Args('contentBase64') contentBase64: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    await requirePermission(this.prisma, ctx, 'catalogue.import');
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
    if (kind !== 'excel') {
      throw new BadRequestException('Only .xlsx catalogue imports are supported. PDF extraction and approval queues have been removed.');
    }
    const user = await requirePermission(this.prisma, ctx, 'catalogue.import');
    const filePath = uploadTempPath(uploadId, filename);
    if (!fs.existsSync(filePath)) {
      throw new BadRequestException('Uploaded file was not found. Please upload again.');
    }
    const result = await this.imports.previewExcelImport(filePath, user.id);
    return { id: uploadId, result: { ...result, compatibilityMode: 'preview_only', nextAction: 'applyUploadedImport' } };
  }

  @Mutation(() => ImportOutput)
  async previewUploadedImport(
    @Args('uploadId') uploadId: string,
    @Args('filename') filename: string,
    @Args('kind') kind: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    if (kind !== 'excel') {
      throw new BadRequestException('Only .xlsx catalogue imports are supported. PDF extraction and approval queues have been removed.');
    }
    const user = await requirePermission(this.prisma, ctx, 'catalogue.import');
    const filePath = uploadTempPath(uploadId, filename);
    if (!fs.existsSync(filePath)) {
      throw new BadRequestException('Uploaded file was not found. Please upload again.');
    }
    const result = await this.imports.previewExcelImport(filePath, user.id);
    return { id: uploadId, result };
  }

  @Mutation(() => ImportOutput)
  async applyUploadedImport(
    @Args('uploadId') uploadId: string,
    @Args('filename') filename: string,
    @Args('kind') kind: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    if (kind !== 'excel') {
      throw new BadRequestException('Only .xlsx catalogue imports are supported. PDF extraction and approval queues have been removed.');
    }
    const user = await requirePermission(this.prisma, ctx, 'catalogue.import');
    const filePath = uploadTempPath(uploadId, filename);
    if (!fs.existsSync(filePath)) {
      throw new BadRequestException('Uploaded file was not found. Please upload again.');
    }
    const result = await this.imports.processExcelImport(filePath, user.id);
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
}
