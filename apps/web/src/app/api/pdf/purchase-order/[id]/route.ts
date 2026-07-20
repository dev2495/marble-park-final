import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function rendererPath() {
  const candidates = [path.join(process.cwd(), 'scripts/render-purchase-order-pdf.cjs'), path.join(process.cwd(), '..', '..', 'scripts/render-purchase-order-pdf.cjs')];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('Purchase order PDF renderer script not found');
  return found;
}

function render(id: string, requestUrl: string, apiUrl: string) {
  return new Promise<Buffer>((resolve, reject) => execFile(process.execPath, [rendererPath(), id, requestUrl, apiUrl], { encoding: 'buffer', maxBuffer: 80 * 1024 * 1024 }, (error, stdout, stderr) => error ? reject(new Error(stderr?.toString() || error.message)) : resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout))));
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const apiUrl = process.env.QUOTE_PDF_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/graphql';
    const buffer = await render(id, req.url, apiUrl);
    return new NextResponse(buffer as unknown as BodyInit, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="Purchase_Order_${id}.pdf"`, 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('Purchase order PDF error:', error);
    return NextResponse.json({ error: 'Purchase order document could not be generated.' }, { status: 500 });
  }
}
