import { NextRequest } from 'next/server';
import { servePdf } from '@/lib/pdf-route';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return servePdf({
    id,
    request: req,
    scriptName: 'render-dispatch-slip-pdf.cjs',
    filename: `Dispatch_Slip_${id}.pdf`,
    action: 'GenerateDispatchSlipPdf',
    errorMessage: 'Dispatch slip could not be generated.',
    includeApiUrl: true,
  });
}
