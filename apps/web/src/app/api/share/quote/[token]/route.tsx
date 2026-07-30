import { NextRequest } from 'next/server';
import { servePdf } from '@/lib/pdf-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
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
