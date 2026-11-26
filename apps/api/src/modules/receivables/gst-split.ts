// Settings > "Show GST split on invoices" (off by default, waiting for the accountant).
// When on, an invoice shows CGST + SGST for a customer in the company's state and
// IGST for any other state, the HSN code on each line, and a bill without GST is
// titled "BILL OF SUPPLY". When off, the invoice prints exactly as before.

const STATE_CODES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '25': 'Daman and Diu', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra',
  '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
};

const normalise = (value: unknown) => String(value || '').toLowerCase().replace(/[^a-z]/g, '').replace(/^and|and/g, '');

function codeFromGstin(gstin: unknown): string | null {
  const code = String(gstin || '').trim().slice(0, 2);
  return /^\d{2}$/.test(code) && STATE_CODES[code] ? code : null;
}

function codeFromStateName(state: unknown): string | null {
  const wanted = normalise(state);
  if (!wanted) return null;
  const aliases: Record<string, string> = { gujrat: '24', guj: '24', mh: '27', maharastra: '27', newdelhi: '07', orissa: '21', pondicherry: '34', jk: '01' };
  if (aliases[wanted]) return aliases[wanted];
  const hit = Object.entries(STATE_CODES).find(([, name]) => normalise(name) === wanted);
  return hit ? hit[0] : null;
}

const paise = (value: unknown) => Math.round((Number(value || 0) || 0) * 100);
const rupees = (value: number) => value / 100;

export type InvoiceGstSplit = {
  enabled: boolean;
  documentTitle: string;
  withoutGst: boolean;
  companyStateCode: string | null;
  companyState: string | null;
  placeOfSupplyCode: string | null;
  placeOfSupply: string | null;
  placeOfSupplyAssumed: boolean;
  interState: boolean;
  cgst: number;
  sgst: number;
  igst: number;
  lines: Array<{ id: string; hsnCode: string | null; cgst: number; sgst: number; igst: number }>;
};

export function invoiceGstSplit(args: {
  enabled: boolean;
  companyGstin?: string | null;
  customer?: { gstNo?: string | null; state?: string | null } | null;
  withoutGst: boolean;
  lines: Array<{ id: string; taxAmount?: unknown; hsnCode?: string | null }>;
}): InvoiceGstSplit {
  const companyStateCode = codeFromGstin(args.companyGstin);
  const customerCode = codeFromGstin(args.customer?.gstNo) || codeFromStateName(args.customer?.state);
  // A walk-in with no GSTIN and no state is an over-the-counter sale: place of supply is the shop.
  const placeOfSupplyCode = customerCode || companyStateCode;
  const interState = Boolean(companyStateCode && placeOfSupplyCode && companyStateCode !== placeOfSupplyCode);
  let cgst = 0; let sgst = 0; let igst = 0;
  const lines = args.lines.map((line) => {
    const tax = paise(line.taxAmount);
    const lineIgst = interState ? tax : 0;
    const lineCgst = interState ? 0 : Math.floor(tax / 2);
    const lineSgst = interState ? 0 : tax - lineCgst;
    cgst += lineCgst; sgst += lineSgst; igst += lineIgst;
    return { id: line.id, hsnCode: line.hsnCode || null, cgst: rupees(lineCgst), sgst: rupees(lineSgst), igst: rupees(lineIgst) };
  });
  return {
    enabled: args.enabled,
    documentTitle: args.enabled ? (args.withoutGst ? 'BILL OF SUPPLY' : 'TAX INVOICE') : 'TAX INVOICE',
    withoutGst: args.withoutGst,
    companyStateCode, companyState: companyStateCode ? STATE_CODES[companyStateCode] : null,
    placeOfSupplyCode, placeOfSupply: placeOfSupplyCode ? STATE_CODES[placeOfSupplyCode] : null,
    placeOfSupplyAssumed: !customerCode,
    interState, cgst: rupees(cgst), sgst: rupees(sgst), igst: rupees(igst), lines,
  };
}
