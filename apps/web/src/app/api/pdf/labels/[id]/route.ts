import { NextRequest } from 'next/server';
import { servePdf } from '@/lib/pdf-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return servePdf({
    id,
    request: req,
    scriptName: 'render-labels-pdf.cjs',
    filename: `Sticker_Run_${id}.pdf`,
    action: 'GenerateLabelPrintRunPdf',
    errorMessage: 'Sticker PDF could not be generated. Keep this run open and retry; print counts were not changed.',
    includeApiUrl: true,
  });
}
