import { BadRequestException } from '@nestjs/common';
import { Resolver, Mutation, Args, ObjectType, Field, Context, Query } from '@nestjs/graphql';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ImportsService } from './imports.service';
import { GraphQLJSON } from 'graphql-scalars';
import { GraphqlRequestContext, requirePermission, requireSession } from '../auth/session-context';
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
  fs.writeFileSync(filePath, decodeBase64Upload(contentBase64, MAX_EXCEL_UPLOAD_BYTES, 'Excel upload'));
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

const MAX_MANUAL_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_EXCEL_UPLOAD_BYTES = 25 * 1024 * 1024;

function decodeBase64Upload(contentBase64: string, maxBytes: number, label: string) {
  const encoded = String(contentBase64 || '').trim();
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length > Math.ceil(maxBytes * 4 / 3) + 4) {
    throw new BadRequestException(`${label} is invalid or exceeds the allowed size`);
  }
  const content = Buffer.from(encoded, 'base64');
  if (!content.length || content.length > maxBytes) throw new BadRequestException(`${label} is invalid or exceeds the allowed size`);
  return content;
}

function persistentManualAssetPath(extension: string) {
  const catalogueImageRoot = process.env.CATALOGUE_IMAGE_STORAGE_DIR || path.resolve(process.cwd(), '../../apps/web/public/catalogue-images');
  const safeName = `${ulid()}${extension}`;
  const directory = path.join(catalogueImageRoot, 'manual');
  fs.mkdirSync(directory, { recursive: true });
  return { filePath: path.join(directory, safeName), safeName };
}

function decodeManualImage(filename: string, contentBase64: string) {
  const extension = path.extname(filename || '').toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) {
    throw new BadRequestException('Only JPG, PNG, and WebP images can be uploaded');
  }
  const content = decodeBase64Upload(contentBase64, MAX_MANUAL_IMAGE_BYTES, 'Image upload');
  const isPng = content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
  const isWebp = content.length >= 12 && content.subarray(0, 4).toString('ascii') === 'RIFF' && content.subarray(8, 12).toString('ascii') === 'WEBP';
  const detectedExtension = isPng ? '.png' : isJpeg ? '.jpg' : isWebp ? '.webp' : '';
  if (!detectedExtension) throw new BadRequestException('The upload contents are not a valid JPG, PNG, or WebP image');
  return { content, extension: detectedExtension };
}

function assertManagedImportPath(filePath: string) {
  const resolved = path.resolve(filePath || '');
  const temporaryRoot = path.resolve(os.tmpdir());
  if (!resolved.startsWith(`${temporaryRoot}${path.sep}`) || !path.basename(resolved).startsWith('marble-excel-import-')) {
    throw new BadRequestException('Direct server file paths are not accepted. Start an Excel upload session instead.');
  }
  return resolved;
}

function cataloguePublicUrl(fileName: string) {
  const baseUrl = String(process.env.PUBLIC_CATALOGUE_IMAGE_BASE_URL || '').replace(/\/+$/, '');
  return `${baseUrl}/catalogue-images/manual/${fileName}`;
}

function cleanupExpiredImportUploads() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(os.tmpdir())) {
    if (!name.startsWith('marble-excel-import-')) continue;
    const filePath = path.join(os.tmpdir(), name);
    try {
      if (fs.statSync(filePath).mtimeMs < cutoff) fs.rmSync(filePath, { force: true });
    } catch { /* Another request may have removed it. */ }
  }
}

@Resolver()
export class ImportsResolver {
  constructor(
    private imports: ImportsService,
    private prisma: PrismaService,
  ) {}

  @Query(() => GraphQLJSON)
  async productImportTemplate(@Context() ctx: GraphqlRequestContext) {
    await requirePermission(this.prisma, ctx, 'catalogue.import');
    return this.imports.productImportTemplate();
  }

  @Query(() => GraphQLJSON)
  async productImportReadiness(@Context() ctx: GraphqlRequestContext) {
    await requirePermission(this.prisma, ctx, 'catalogue.import');
    return this.imports.productImportReadiness();
  }

  @Mutation(() => ImportOutput)
  async processExcelImport(
    @Args('filePath') filePath: string,
    @Args('confirmationToken') confirmationToken: string,
    @Args('reviewRows', { type: () => GraphQLJSON, nullable: true }) reviewRows: any[] | undefined,
    @Context() ctx: GraphqlRequestContext,
  ) {
    const user = await requirePermission(this.prisma, ctx, 'catalogue.import');
    assertExcelFile(filePath);
    const result = await this.imports.processExcelImport(assertManagedImportPath(filePath), user.id, confirmationToken, reviewRows || []);
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
    try {
      const result = await this.imports.previewExcelImport(filePath, user.id);
      return { id: `excel-${Date.now()}`, result: { ...result, compatibilityMode: 'preview_only', nextAction: 'beginImportUpload' } };
    } finally {
      fs.rmSync(filePath, { force: true });
    }
  }

  @Mutation(() => ImportOutput)
  async beginImportUpload(@Args('filename') filename: string, @Context() ctx: GraphqlRequestContext) {
    await requirePermission(this.prisma, ctx, 'catalogue.import');
    assertExcelFile(filename);
    cleanupExpiredImportUploads();
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
    const chunk = decodeBase64Upload(contentBase64, MAX_EXCEL_UPLOAD_BYTES, 'Excel upload chunk');
    const currentSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
    if (currentSize + chunk.length > MAX_EXCEL_UPLOAD_BYTES) throw new BadRequestException('Excel uploads are limited to 25 MB');
    fs.appendFileSync(filePath, chunk);
    return { id: uploadId, result: { uploadedBytes: currentSize + chunk.length } };
  }

  @Mutation(() => ImportOutput)
  async cancelImportUpload(
    @Args('uploadId') uploadId: string,
    @Args('filename') filename: string,
    @Context() ctx: GraphqlRequestContext,
  ) {
    await requirePermission(this.prisma, ctx, 'catalogue.import');
    const filePath = uploadTempPath(uploadId, filename);
    fs.rmSync(filePath, { force: true });
    return { id: uploadId, result: { status: 'discarded' } };
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
    @Args('reviewRows', { type: () => GraphQLJSON, nullable: true }) reviewRows: any[] | undefined,
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
    const result = await this.imports.previewExcelImport(filePath, user.id, reviewRows || []);
    return { id: uploadId, result };
  }

  @Mutation(() => ImportOutput)
  async applyUploadedImport(
    @Args('uploadId') uploadId: string,
    @Args('filename') filename: string,
    @Args('kind') kind: string,
    @Args('confirmationToken') confirmationToken: string,
    @Args('reviewRows', { type: () => GraphQLJSON, nullable: true }) reviewRows: any[] | undefined,
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
    const result = await this.imports.processExcelImport(filePath, user.id, confirmationToken, reviewRows || []);
    if (result.status === 'applied') {
      fs.rmSync(filePath, { force: true });
    }
    return { id: uploadId, result };
  }

  @Mutation(() => ImportOutput)
  async uploadStoredAsset(
    @Args('filename') filename: string,
    @Args('contentBase64') contentBase64: string,
    @Context() ctx: GraphqlRequestContext,
    @Args('scope', { nullable: true }) scope?: string,
  ) {
    const effectiveScope = scope || 'product-image';
    if (effectiveScope === 'profile-avatar') {
      await requireSession(this.prisma, ctx);
    } else if (effectiveScope === 'product-image') {
      await requirePermission(this.prisma, ctx, 'products.manage');
    } else if (effectiveScope === 'brand-logo') {
      await requirePermission(this.prisma, ctx, 'master_data.manage');
    } else if (effectiveScope === 'company-logo') {
      await requirePermission(this.prisma, ctx, 'settings.manage');
    } else if (effectiveScope === 'delivery-proof') {
      await requirePermission(this.prisma, ctx, 'dispatch.manage');
    } else {
      throw new BadRequestException('Unsupported asset upload scope');
    }
    const image = decodeManualImage(filename, contentBase64);
    const { filePath, safeName } = persistentManualAssetPath(image.extension);
    fs.writeFileSync(filePath, image.content, { mode: 0o640 });
    return {
      id: safeName,
      result: {
        scope: effectiveScope,
        publicUrl: cataloguePublicUrl(safeName),
      },
    };
  }
}
