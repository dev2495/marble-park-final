import { ExpressAdapter } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppModule } from './app.module';

async function bootstrap() {
  const express = require('express');
  const fs = require('fs');
  const path = require('path');
  const server = express();
  // The API is reachable only through the single internal Caddy hop in
  // production, so trusting one proxy preserves the real client IP for
  // login throttling and audit metadata without trusting arbitrary headers.
  server.set('trust proxy', 1);
  server.disable('x-powered-by');
  server.use((req: any, res: any, next: () => void) => {
    const requestId = randomUUID();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    next();
  });
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), { bodyParser: false });
  // A 5 MB image is base64-expanded to about 6.7 MB in the GraphQL payload.
  // Keep the global cap bounded while allowing the explicitly validated image path.
  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '8mb' }));
  app.use(express.urlencoded({ extended: true, limit: process.env.JSON_BODY_LIMIT || '8mb' }));
  const catalogueImageRoot = process.env.CATALOGUE_IMAGE_STORAGE_DIR || path.resolve(process.cwd(), '../../apps/web/public/catalogue-images');
  const manualImageDir = path.join(catalogueImageRoot, 'manual');
  fs.mkdirSync(manualImageDir, { recursive: true });
  // Asset names are immutable ULIDs or content hashes. Long-lived caching keeps
  // catalogue scrolling fast without risking stale replacements.
  app.use('/catalogue-images/manual', express.static(manualImageDir, { maxAge: '30d', immutable: true, etag: true }));

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
  if (!allowLocalDevOrigins && configuredOrigins.length === 0) {
    throw new Error('CORS_ORIGIN is required in production');
  }
  const allowedOrigins = Array.from(new Set([
    ...configuredOrigins,
    ...(allowLocalDevOrigins ? defaultLocalOrigins : []),
  ]));
  const configuredForLocalhost = allowedOrigins.some((origin) => /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin));

  // Run the CSRF boundary before CORS. This gives cookie-authenticated
  // cross-site requests a deterministic 403 and guarantees the GraphQL
  // operation never reaches a resolver even when CORS rejects the origin.
  app.use((req: any, res: any, next: () => void) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || '').toUpperCase())) return next();
    const hasSessionCookie = String(req.headers.cookie || '').split(';').some((entry: string) => entry.trim().startsWith('mp_session='));
    const hasBearer = /^Bearer\s+\S+/i.test(String(req.headers.authorization || ''));
    if (!hasSessionCookie || hasBearer) return next();
    const origin = String(req.headers.origin || '').trim();
    const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
    if (!allowedOrigins.includes(origin) || (fetchSite && !['same-origin', 'same-site'].includes(fetchSite))) {
      res.status(403).json({ error: 'Cross-site authenticated request blocked' });
      return;
    }
    next();
  });

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
