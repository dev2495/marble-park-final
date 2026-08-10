import {
  BadRequestException, CanActivate, Controller, ExecutionContext, ForbiddenException, Get,
  Injectable, NotFoundException, Param, Post, Query, Req, Res, UnauthorizedException,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { ulid } from 'ulid';
import { DocumentsService } from './documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { getSessionUser } from '../auth/session-context';

function incomingRoot() {
  const root = process.env.DOCUMENT_VAULT_STORAGE_DIR
    || path.join(process.env.CATALOGUE_IMAGE_STORAGE_DIR || path.resolve(process.cwd(), '../../apps/web/public/catalogue-images'), 'document-vault');
  const incoming = path.join(root, '.incoming');
  fs.mkdirSync(incoming, { recursive: true });
  return incoming;
}

function safeDisposition(filename: string, disposition: 'inline' | 'attachment') {
  const fallback = path.basename(filename || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160) || 'file';
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(path.basename(filename || 'file'))}`;
}

function sendStoredFile(res: any, asset: any, filePath: string, asDownload: boolean) {
  const inlineKinds = new Set(['pdf', 'image', 'video', 'audio']);
  res.setHeader('Content-Type', asset.contentType);
  res.setHeader('Content-Disposition', safeDisposition(asset.originalName, asDownload || !inlineKinds.has(asset.mediaKind) ? 'attachment' : 'inline'));
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Use an explicit root so Express resolves and contains the stored filename
  // without depending on URL-encoding an absolute workspace path.
  return res.sendFile(path.basename(filePath), { root: path.dirname(filePath), dotfiles: 'deny', cacheControl: false }, (error: any) => {
    if (error && !res.headersSent) {
      console.error('Vault file stream failed', { code: error.code || 'unknown', statusCode: error.statusCode || 500 });
      res.status(error.statusCode || 500).json({ error: 'The stored file could not be read.' });
    }
  });
}

@Injectable()
class VaultViewGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const user = await getSessionUser(this.prisma, { req: request });
    if (!user) throw new UnauthorizedException('Login required');
    if (!user.effectivePermissions.includes('documents.view')) throw new ForbiddenException('This action is restricted');
    request.vaultUser = user;
    return true;
  }
}

@Injectable()
class VaultManageGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const user = await getSessionUser(this.prisma, { req: request });
    if (!user) throw new UnauthorizedException('Login required');
    if (!user.effectivePermissions.includes('documents.manage')) throw new ForbiddenException('This action is restricted');
    request.vaultUser = user;
    return true;
  }
}

@Controller('api/document-vault')
export class DocumentsController {
  constructor(private documents: DocumentsService) {}

  @Post('files')
  @UseGuards(VaultManageGuard)
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: (_req, _file, callback) => callback(null, incomingRoot()),
      filename: (_req, file, callback) => callback(null, `${ulid()}${path.extname(file.originalname || '').toLowerCase()}.uploading`),
    }),
    limits: { files: 1, fileSize: Math.min(Number(process.env.DOCUMENT_VAULT_MAX_FILE_BYTES || 1024 * 1024 * 1024), 2_000_000_000), fields: 8, fieldSize: 16 * 1024 },
  }))
  async upload(@UploadedFile() file: any, @Req() req: any) {
    if (!file?.path) throw new BadRequestException('Choose a file to upload.');
    try {
      return await this.documents.registerUpload({
        temporaryPath: file.path,
        originalName: file.originalname,
        sizeBytes: file.size,
        title: req.body?.title,
        description: req.body?.description,
        category: req.body?.category,
        uploadedBy: req.vaultUser.id,
      });
    } finally {
      fs.rmSync(file.path, { force: true });
    }
  }

  @Get('files/:id/content')
  @UseGuards(VaultViewGuard)
  async content(@Param('id') id: string, @Query('download') download: string, @Res() res: any) {
    const { asset, filePath } = await this.documents.vaultAssetForContent(id);
    return sendStoredFile(res, asset, filePath, download === '1');
  }

  @Get('public/:token/meta')
  async publicMetadata(@Param('token') token: string) {
    const { share, asset } = await this.documents.resolvePublicShare(token, true);
    return {
      title: asset.title,
      description: asset.description,
      category: asset.category,
      originalName: asset.originalName,
      contentType: asset.contentType,
      mediaKind: asset.mediaKind,
      sizeBytes: asset.sizeBytes,
      allowDownload: share.allowDownload,
      expiresAt: share.expiresAt?.toISOString() || null,
      contentUrl: `/api/document-vault/public/${token}/content`,
      downloadUrl: share.allowDownload ? `/api/document-vault/public/${token}/content?download=1` : null,
    };
  }

  @Get('public/:token/content')
  async publicContent(@Param('token') token: string, @Query('download') download: string, @Res() res: any) {
    const { share, asset, filePath } = await this.documents.resolvePublicShare(token, false);
    if (download === '1' && !share.allowDownload) throw new NotFoundException('Download is disabled for this share link');
    return sendStoredFile(res, asset, filePath, download === '1');
  }
}

export const DocumentsHttpProviders = [VaultViewGuard, VaultManageGuard];
