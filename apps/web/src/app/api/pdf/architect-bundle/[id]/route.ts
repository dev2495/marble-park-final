import { NextRequest } from 'next/server';
import { servePdf } from '@/lib/pdf-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Pictures of the items on the quote, for the architect. Built from the live
// quote on every request, so it always matches the latest revision.
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return servePdf({
    id,
    request: req,
    scriptName: 'render-quote-pdf.cjs',
    filename: `MarblePark_Architect_Selection_${id}.pdf`,
    action: 'GenerateArchitectBundlePdf',
    errorMessage: 'Architect selection document could not be generated.',
    includeApiUrl: true,
    rendererEnv: { PDF_ARCHITECT_BUNDLE: '1' },
    skipCommercialRecord: true,
  });
}
