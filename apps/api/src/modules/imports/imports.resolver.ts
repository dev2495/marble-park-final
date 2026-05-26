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

const SCOPE_PATHS: Record<string, { dir: string; route: string }> = {
  avatar: { dir: 'avatars', route: '/uploads/avatars' },
  proof: { dir: 'proofs', route: '/uploads/proofs' },
  doc: { dir: 'docs', route: '/uploads/docs' },
  attachment: { dir: 'docs', route: '/uploads/docs' },
};

const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg',
  '.pdf', '.csv', '.xlsx', '.xls', '.txt', '.json',
]);

const MAX_UPLOAD_BYTES = parseInt(process.env.MAX_UPLOAD_BYTES || `${25 * 1024 * 1024}`, 10);

function persistentManualAssetPath(filename: string, scope?: string) {
  const ext = (path.extname(filename || '').toLowerCase().replace(/[^a-zA-Z0-9.]/g, '').slice(0, 12)) || '.bin';
  if (ext !== '.bin' && !ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported file type ${ext}. Allowed: ${Array.from(ALLOWED_UPLOAD_EXTENSIONS).join(', ')}`);
  }
  const safeName = `${ulid()}${ext}`;

  const scopeMap = scope ? SCOPE_PATHS[scope] : null;
  if (scopeMap) {
    const uploadsRoot = process.env.UPLOADS_DIR || path.resolve(process.cwd(), '../../uploads');
    const directory = path.join(uploadsRoot, scopeMap.dir);
    fs.mkdirSync(directory, { recursive: true });
    return { filePath: path.join(directory, safeName), safeName, publicRoute: `${scopeMap.route}/${safeName}` };
  }

  const importImageDir = process.env.CATALOGUE_IMPORT_IMAGE_DIR || path.resolve(process.cwd(), '../../apps/web/public/catalogue-images/imports');
  const catalogueImageRoot = process.env.CATALOGUE_IMAGE_STORAGE_DIR || path.dirname(importImageDir);
  const directory = path.join(catalogueImageRoot, 'manual');
  fs.mkdirSync(directory, { recursive: true });
  return { filePath: path.join(directory, safeName), safeName, publicRoute: `/catalogue-images/manual/${safeName}` };
}

function publicUrlFor(publicRoute: string) {
  const raw = String(
    process.env.PUBLIC_API_BASE_URL ||
    process.env.PUBLIC_CATALOGUE_IMAGE_BASE_URL ||
    process.env.API_PUBLIC_BASE_URL ||
    process.env.RAILWAY_PUBLIC_DOMAIN ||
    '',
  ).trim();
  const baseUrl = raw
    ? (raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`).replace(/\/+$/, '')
    : '';
  return `${baseUrl}${publicRoute.startsWith('/') ? publicRoute : `/${publicRoute}`}`;
}

function cataloguePublicUrl(fileName: string) {
  return publicUrlFor(`/catalogue-images/manual/${fileName}`);
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

    const buffer = Buffer.from(contentBase64, 'base64');
    if (buffer.byteLength > MAX_UPLOAD_BYTES) {
      throw new Error(`File too large (${Math.round(buffer.byteLength / 1024 / 1024)}MB). Max ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB.`);
    }
    const { filePath, safeName, publicRoute } = persistentManualAssetPath(filename, scope || undefined);
    fs.writeFileSync(filePath, buffer);
    return {
      id: safeName,
      result: {
        scope: scope || 'asset',
        filePath,
        publicUrl: publicUrlFor(publicRoute),
        publicRoute,
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
