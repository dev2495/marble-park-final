import '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { initSentry, captureException } from './modules/common/sentry';

async function bootstrap() {
  initSentry();

  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const express = require('express');
  const fs = require('fs');
  const path = require('path');
  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '100mb' }));
  app.use(express.urlencoded({ extended: true, limit: process.env.JSON_BODY_LIMIT || '100mb' }));

  // Catalogue images.
  const importImageDir = process.env.CATALOGUE_IMPORT_IMAGE_DIR || path.resolve(process.cwd(), '../../apps/web/public/catalogue-images/imports');
  const catalogueImageRoot = process.env.CATALOGUE_IMAGE_STORAGE_DIR || path.dirname(importImageDir);
  const manualImageDir = path.join(catalogueImageRoot, 'manual');
  fs.mkdirSync(importImageDir, { recursive: true });
  fs.mkdirSync(manualImageDir, { recursive: true });
  app.use('/catalogue-images/imports', express.static(importImageDir));
  app.use('/catalogue-images/manual', express.static(manualImageDir));

  // Persistent uploads (avatars + proof-of-delivery + attachments). Defaults
  // to a sibling `uploads` directory in the repo for dev; Railway should
  // mount a volume at /data and set UPLOADS_DIR=/data/uploads so files
  // survive deploys.
  const uploadsDir = process.env.UPLOADS_DIR || path.resolve(process.cwd(), '../../uploads');
  const avatarsDir = path.join(uploadsDir, 'avatars');
  const proofsDir = path.join(uploadsDir, 'proofs');
  const docsDir = path.join(uploadsDir, 'docs');
  fs.mkdirSync(avatarsDir, { recursive: true });
  fs.mkdirSync(proofsDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });
  app.use('/uploads/avatars', express.static(avatarsDir, { maxAge: '7d' }));
  app.use('/uploads/proofs', express.static(proofsDir, { maxAge: '7d' }));
  app.use('/uploads/docs', express.static(docsDir, { maxAge: '7d' }));

  // Lightweight healthcheck for load-balancers / Railway.
  app.use('/healthz', (_req: any, res: any) => res.status(200).json({ ok: true, ts: Date.now() }));

  const configuredOrigins = process.env.CORS_ORIGIN?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean) ?? [];
  const defaultLocalOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://localhost:3011',
    'http://127.0.0.1:3011',
  ];
  const allowLocalDevOrigins = process.env.NODE_ENV !== 'production';
  const allowedOrigins = Array.from(new Set([
    ...configuredOrigins,
    ...(allowLocalDevOrigins ? defaultLocalOrigins : configuredOrigins.length ? [] : defaultLocalOrigins),
  ]));

  app.enableCors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      if (allowLocalDevOrigins && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS`), false);
    },
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({
    // GraphQL input classes in this app use @Field decorators but not class-validator decorators.
    // Enabling whitelist here strips valid mutation payloads before resolvers receive them.
    whitelist: false,
    transform: true,
  }));

  process.on('unhandledRejection', (reason) => {
    captureException(reason, { hint: 'unhandledRejection' });
  });
  process.on('uncaughtException', (err) => {
    captureException(err, { hint: 'uncaughtException' });
  });

  const port = process.env.PORT || 4000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`🚀 API running on http://localhost:${port}`);
}
bootstrap();
