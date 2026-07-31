import { NextRequest } from 'next/server';
import { servePdf } from '@/lib/pdf-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return servePdf({ id, request: req, scriptName: 'render-customer-receipt-pdf.cjs', filename: `Payment_Receipt_${id}.pdf`, action: 'GenerateCustomerReceiptPdf', errorMessage: 'Payment receipt could not be generated.', includeApiUrl: true });
}
