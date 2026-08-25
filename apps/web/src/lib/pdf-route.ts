import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

const MAX_PDF_BYTES = 80 * 1024 * 1024;
const PDF_RENDER_TIMEOUT_MS = 60_000;

type RenderPdfInput = {
  id: string;
  request: NextRequest;
  scriptName: string;
  filename: string;
  action: string;
  errorMessage: string;
  includeApiUrl?: boolean;
  publicShareToken?: string;
  validationRedirectPath?: string;
};

function rendererPath(scriptName: string) {
  const candidates = [
    path.join(process.cwd(), 'scripts', scriptName),
    path.join(process.cwd(), '..', '..', 'scripts', scriptName),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`${scriptName} renderer script not found`);
  return found;
}

function requestSessionToken(request: NextRequest) {
  const cookieToken = request.cookies.get('mp_session')?.value?.trim();
  if (cookieToken) return cookieToken;
  const authorization = request.headers.get('authorization') || '';
  return authorization.replace(/^Bearer\s+/i, '').trim();
}

function rendererErrorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/login required|session expired|unauthenticated|unauthorized|account is disabled/i.test(message)) return 401;
  if (/not found|restricted|permission required|forbidden/i.test(message)) return 404;
  if (/MRP is required|exceeds MRP|PDF blocked|incomplete pricing|commercial.*not ready/i.test(message)) return 422;
  return 500;
}

function errorCode(status: number) {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 404) return 'NOT_FOUND';
  if (status === 422) return 'COMMERCIAL_VALIDATION_FAILED';
  return 'PDF_GENERATION_FAILED';
}

function rendererUserMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || '');
  const firstLine = raw.split(/\n\s*at\s+/i)[0].replace(/^Error:\s*/i, '').trim();
  if (!firstLine) return 'Complete quote pricing and MRP before generating this document.';
  return firstLine.length > 360 ? `${firstLine.slice(0, 357)}...` : firstLine;
}

async function executeRenderer(input: RenderPdfInput, sessionToken: string) {
  const apiUrl = process.env.QUOTE_PDF_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/graphql';
  const args = [rendererPath(input.scriptName), input.id, input.request.url];
  if (input.includeApiUrl) args.push(apiUrl);

  return new Promise<Buffer>((resolve, reject) => {
    execFile(
      process.execPath,
      args,
      {
        encoding: 'buffer',
        maxBuffer: MAX_PDF_BYTES,
        timeout: PDF_RENDER_TIMEOUT_MS,
        env: {
          ...process.env,
          PDF_SESSION_TOKEN: sessionToken,
          PDF_PUBLIC_SHARE_TOKEN: input.publicShareToken || '',
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.toString().trim() || error.message));
          return;
        }
        const buffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
        if (buffer.subarray(0, 4).toString() !== '%PDF') {
          reject(new Error('Renderer returned an invalid PDF payload'));
          return;
        }
        resolve(buffer);
      },
    );
  });
}

export async function servePdf(input: RenderPdfInput) {
  const requestId = randomUUID();
  const sessionToken = requestSessionToken(input.request);
  if (!sessionToken && !input.publicShareToken) {
    return NextResponse.json(
      {
        error: 'Sign in again before opening this document.',
        code: 'UNAUTHENTICATED',
        action: input.action,
        ref: requestId,
      },
      { status: 401, headers: { 'Cache-Control': 'private, no-store', 'X-Request-Id': requestId } },
    );
  }

  try {
    const buffer = await executeRenderer(input, sessionToken);
    const disposition = input.request.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline';
    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${disposition}; filename="${input.filename}"`,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Request-Id': requestId,
      },
    });
  } catch (error) {
    const status = rendererErrorStatus(error);
    console.error(`[${input.action}] ref=${requestId}`, error);
    if (status === 422 && input.validationRedirectPath && input.request.headers.get('accept')?.includes('text/html')) {
      const redirectUrl = new URL(input.validationRedirectPath, input.request.url);
      redirectUrl.searchParams.set('pdfError', 'commercial-pricing');
      const response = NextResponse.redirect(redirectUrl, 303);
      response.headers.set('Cache-Control', 'private, no-store');
      response.headers.set('X-Request-Id', requestId);
      return response;
    }
    return NextResponse.json(
      {
        error: status === 401
          ? 'Your session expired. Sign in again and retry.'
          : status === 422
            ? rendererUserMessage(error)
            : input.errorMessage,
        code: errorCode(status),
        action: input.action,
        ref: requestId,
      },
      { status, headers: { 'Cache-Control': 'private, no-store', 'X-Request-Id': requestId } },
    );
  }
}
