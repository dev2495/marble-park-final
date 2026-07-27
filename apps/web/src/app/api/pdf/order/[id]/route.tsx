import { NextRequest } from 'next/server';
import { servePdf } from '@/lib/pdf-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return servePdf({
    id,
    request: req,
    scriptName: 'render-sales-order-pdf.cjs',
    filename: `MarblePark_SalesOrder_${id}.pdf`,
    action: 'GenerateSalesOrderPdf',
    errorMessage: 'Sales order document could not be generated.',
    includeApiUrl: true,
  });
}
