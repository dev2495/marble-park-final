import { NextRequest, NextResponse } from 'next/server';
import { servePdf } from '@/lib/pdf-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_URL = process.env.QUOTE_PDF_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/graphql';
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 20;
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 40;
const hits = new Map<string, { count: number; resetAt: number }>();
const cache = new Map<string, { at: number; body: ArrayBuffer; headers: [string, string][] }>();

function notAvailable(status = 404) {
  return NextResponse.json(
    { error: status === 429 ? 'Too many requests. Wait a minute and try again.' : status === 403 ? 'Downloading is turned off for this link. You can still view and print it.' : 'This quotation link is unavailable or has expired.' },
    { status, headers: { 'Cache-Control': 'private, no-store' } },
  );
}

function rateLimited(req: NextRequest) {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || entry.resetAt <= now) {
    if (hits.size > 5000) hits.clear();
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

/** Asks the API whether the link is live before any PDF renderer is started. */
async function shareStatus(token: string): Promise<{ ok: boolean; allowDownload?: boolean; version?: number }> {
  try {
    const response = await fetch(API_URL, {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'query ShareStatus($token: String!) { publicQuoteShareStatus(token: $token) }', variables: { token } }),
    });
    const payload = await response.json();
    return payload?.data?.publicQuoteShareStatus || { ok: false };
  } catch {
    return { ok: false };
  }
}

export async function GET(req: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(String(token || ''))) return notAvailable();
  if (rateLimited(req)) return notAvailable(429);
  const status = await shareStatus(token);
  if (!status.ok) return notAvailable();
  const download = req.nextUrl.searchParams.get('download') === '1';
  if (download && !status.allowDownload) return notAvailable(403);
  // The same quote version is rendered once and reused for a few minutes.
  const key = `${token}:${status.version || 0}:${download ? 'd' : 'v'}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return new NextResponse(hit.body.slice(0), { headers: new Headers(hit.headers) });
  const response = await renderShared(req, token);
  if (response.status === 200) {
    const body = await response.arrayBuffer();
    const headers = Array.from(response.headers.entries());
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: Date.now(), body, headers });
    return new NextResponse(body.slice(0), { headers: new Headers(headers) });
  }
  return response;
}

async function renderShared(req: NextRequest, token: string) {
  return servePdf({
    id: token,
    request: req,
    scriptName: 'render-quote-pdf.cjs',
    filename: 'MarblePark_Quotation.pdf',
    action: 'OpenSharedQuotePdf',
    errorMessage: 'This quotation link is unavailable or has expired.',
    includeApiUrl: true,
    publicShareToken: token,
  });
}
