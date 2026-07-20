import '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const express = require('express');
  const fs = require('fs');
  const path = require('path');
  app.use((req: any, res: any, next: () => void) => {
    const requestId = randomUUID();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    next();
  });
  // A 5 MB image is base64-expanded to about 6.7 MB in the GraphQL payload.
  // Keep the global cap bounded while allowing the explicitly validated image path.
  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '8mb' }));
  app.use(express.urlencoded({ extended: true, limit: process.env.JSON_BODY_LIMIT || '8mb' }));
  const catalogueImageRoot = process.env.CATALOGUE_IMAGE_STORAGE_DIR || path.resolve(process.cwd(), '../../apps/web/public/catalogue-images');
  const manualImageDir = path.join(catalogueImageRoot, 'manual');
  fs.mkdirSync(manualImageDir, { recursive: true });
  app.use('/catalogue-images/manual', express.static(manualImageDir));

  const configuredOrigins = process.env.CORS_ORIGIN?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean) ?? [];
  const defaultLocalOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3011',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:3011',
  ];
  const allowLocalDevOrigins = process.env.NODE_ENV !== 'production';
  const allowedOrigins = Array.from(new Set([
    ...configuredOrigins,
    ...(allowLocalDevOrigins ? defaultLocalOrigins : configuredOrigins.length ? [] : defaultLocalOrigins),
  ]));
  const configuredForLocalhost = allowedOrigins.some((origin) => /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin));

  app.enableCors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      if ((allowLocalDevOrigins || configuredForLocalhost) && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS`), false);
    },
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });
  
  app.useGlobalPipes(new ValidationPipe({
    // GraphQL input classes in this app use @Field decorators but not class-validator decorators.
    // Enabling whitelist here strips valid mutation payloads before resolvers receive them.
    whitelist: false,
    transform: true,
  }));
  
  const port = process.env.PORT || 4000;
  await app.listen(port);
  console.log(`🚀 API running on http://localhost:${port}`);
}
bootstrap();
