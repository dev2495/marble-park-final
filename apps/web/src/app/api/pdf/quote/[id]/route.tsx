import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function rendererPath() {
  const candidates = [
    path.join(process.cwd(), 'scripts/render-quote-pdf.cjs'),
    path.join(process.cwd(), '..', '..', 'scripts/render-quote-pdf.cjs'),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('Quote PDF renderer script not found');
  return found;
}

function renderQuotePdf(id: string, requestUrl: string, apiUrl: string) {
  return new Promise<Buffer>((resolve, reject) => {
    execFile(
      process.execPath,
      [rendererPath(), id, requestUrl, apiUrl],
      { encoding: 'buffer', maxBuffer: 80 * 1024 * 1024 },
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

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/graphql';
    const buffer = await renderQuotePdf(params.id, req.url, apiUrl);

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="MarblePark_Quote_${params.id}.pdf"`,
      },
    });
  } catch (error) {
    console.error('PDF Gen Error:', error);
    return new NextResponse('Error generating PDF', { status: 500 });
  }
}
