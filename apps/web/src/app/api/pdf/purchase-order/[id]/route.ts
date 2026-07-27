import { NextRequest } from 'next/server';
import { servePdf } from '@/lib/pdf-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return servePdf({
    id,
    request: req,
    scriptName: 'render-purchase-order-pdf.cjs',
    filename: `Purchase_Order_${id}.pdf`,
    action: 'GeneratePurchaseOrderPdf',
    errorMessage: 'Purchase order document could not be generated.',
    includeApiUrl: true,
  });
}
