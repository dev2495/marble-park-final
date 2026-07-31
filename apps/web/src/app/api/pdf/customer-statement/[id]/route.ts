import { NextRequest } from 'next/server';
import { servePdf } from '@/lib/pdf-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return servePdf({ id, request: req, scriptName: 'render-customer-statement-pdf.cjs', filename: `Customer_Statement_${id}.pdf`, action: 'GenerateCustomerStatementPdf', errorMessage: 'Customer statement could not be generated.', includeApiUrl: true });
}
