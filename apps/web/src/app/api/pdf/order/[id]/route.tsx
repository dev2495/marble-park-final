import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function rendererPath() {
  const candidates = [
    path.join(process.cwd(), 'scripts/render-sales-order-pdf.cjs'),
    path.join(process.cwd(), '..', '..', 'scripts/render-sales-order-pdf.cjs'),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('Sales order PDF renderer script not found');
  return found;
}

function renderSalesOrderPdf(id: string, requestUrl: string) {
  return new Promise<Buffer>((resolve, reject) => {
    execFile(
      process.execPath,
      [rendererPath(), id, requestUrl],
      { encoding: 'buffer', maxBuffer: 80 * 1024 * 1024, env: { ...process.env, ...localApiEnv() } },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.toString() || error.message));
          return;
        }
        resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
      },
    );
  });
}

function localApiEnv() {
  if (process.env.DATABASE_URL) return {};
  const candidates = new Set<string>([
    path.join(process.cwd(), 'apps/api/.env'),
    path.join(process.cwd(), '..', '..', 'apps/api/.env'),
    path.join(process.cwd(), '..', 'api/.env'),
  ]);
  let cursor = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    candidates.add(path.join(cursor, 'apps/api/.env'));
    const next = path.dirname(cursor);
    if (next === cursor) break;
    cursor = next;
  }
  const env: Record<string, string> = {};
  for (const file of Array.from(candidates)) {
    if (!existsSync(file)) continue;
    const content = readFileSync(file, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const key = match[1];
      if (key !== 'DATABASE_URL') continue;
      env[key] = match[2].replace(/^['"]|['"]$/g, '');
    }
    if (env.DATABASE_URL) return env;
  }
  return {};
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const buffer = await renderSalesOrderPdf(id, req.url);

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="MarblePark_SalesOrder_${id}.pdf"`,
      },
    });
  } catch (error) {
    console.error('Sales Order PDF Gen Error:', error);
    return new NextResponse('Error generating sales order PDF', { status: 500 });
  }
}
