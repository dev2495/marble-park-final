// Help topic catalogue. One entry per major workspace area. The drawer
// surfaces this at the click of a `?` button on every page. Each topic ships
// with an illustrated SVG (purely declarative — no external assets so the
// help drawer works offline). Keep the copy short and instructional.

import {
  Bath,
  Boxes,
  Briefcase,
  ClipboardCheck,
  FileSpreadsheet,
  History,
  Inbox,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  MapPin,
  MessageSquare,
  PackageSearch,
  Receipt,
  RefreshCw,
  Settings,
  ShieldCheck,
  Truck,
  UserCircle2,
  Users,
  UserCog,
  Wallet,
} from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';

export type HelpTopic = {
  id: string;
  title: string;
  tagline: string;
  icon: ComponentType<any>;
  Illustration: ComponentType<{ className?: string }>;
  steps: Array<{ title: string; body: string }>;
  faq?: Array<{ q: string; a: string }>;
  glossary?: Array<{ term: string; meaning: string }>;
  relatedTopicIds?: string[];
};

function IllustrationFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-r5 border border-[var(--line)] bg-gradient-to-br from-[var(--brand-50)] via-white to-[var(--brand-50)]/40 p-5 ${className || ''}`}>
      <svg viewBox="0 0 240 140" className="h-32 w-full" aria-hidden>
        {children}
      </svg>
    </div>
  );
}

const PipelineIllustration = (props: { className?: string }) => (
  <IllustrationFrame className={props.className}>
    <defs>
      <linearGradient id="pipe" x1="0" x2="1">
        <stop offset="0%" stopColor="#3b82f6" />
        <stop offset="100%" stopColor="#10b981" />
      </linearGradient>
    </defs>
    <rect x="10" y="40" width="220" height="60" rx="14" fill="url(#pipe)" opacity="0.18" />
    {[16, 70, 124, 178].map((x, i) => (
      <g key={x}>
        <rect x={x} y="48" width="44" height="44" rx="8" fill="white" stroke="#bfdbfe" strokeWidth="1.5" />
        <circle cx={x + 22} cy="70" r="9" fill={i === 3 ? '#10b981' : '#3b82f6'} opacity="0.85" />
        <text x={x + 22} y="74" fontSize="10" fontWeight="700" textAnchor="middle" fill="white">{['L', 'Q', 'O', 'D'][i]}</text>
      </g>
    ))}
    <path d="M58 70 L72 70 M112 70 L126 70 M166 70 L180 70" stroke="#94a3b8" strokeWidth="2" strokeDasharray="3 3" />
  </IllustrationFrame>
);

const QuoteIllustration = (props: { className?: string }) => (
  <IllustrationFrame className={props.className}>
    <rect x="48" y="20" width="144" height="100" rx="10" fill="white" stroke="#e2e8f0" />
    <rect x="60" y="34" width="80" height="6" rx="3" fill="#1e293b" />
    <rect x="60" y="46" width="120" height="3" rx="1.5" fill="#cbd5e1" />
    <rect x="60" y="54" width="100" height="3" rx="1.5" fill="#cbd5e1" />
    <rect x="60" y="68" width="120" height="20" rx="4" fill="#eff6ff" />
    <text x="68" y="82" fontSize="9" fontWeight="700" fill="#1d4ed8">Item · ₹ · Qty · Total</text>
    <rect x="60" y="94" width="120" height="3" rx="1.5" fill="#cbd5e1" />
    <rect x="60" y="100" width="80" height="3" rx="1.5" fill="#cbd5e1" />
    <circle cx="186" cy="34" r="10" fill="#10b981" />
    <text x="186" y="38" fontSize="10" textAnchor="middle" fontWeight="700" fill="white">✓</text>
  </IllustrationFrame>
);

const InventoryIllustration = (props: { className?: string }) => (
  <IllustrationFrame className={props.className}>
    {[12, 56, 100, 144, 188].map((x, i) => (
      <g key={x}>
        <rect x={x} y="60" width="36" height="56" rx="4" fill="white" stroke="#e2e8f0" />
        <rect x={x + 4} y={64 + i * 6} width="28" height={48 - i * 6} rx="3" fill={i === 2 ? '#f59e0b' : i === 4 ? '#ef4444' : '#3b82f6'} opacity="0.75" />
        <text x={x + 18} y="128" fontSize="8" textAnchor="middle" fontWeight="700" fill="#475569">SKU·{i + 1}</text>
      </g>
    ))}
    <text x="12" y="44" fontSize="10" fontWeight="700" fill="#0f172a">Live stock balance</text>
  </IllustrationFrame>
);

const DispatchIllustration = (props: { className?: string }) => (
  <IllustrationFrame className={props.className}>
    <rect x="14" y="68" width="76" height="46" rx="8" fill="#e0f2fe" stroke="#bae6fd" />
    <rect x="22" y="76" width="60" height="30" rx="3" fill="white" stroke="#bae6fd" />
    <text x="52" y="96" fontSize="10" fontWeight="700" textAnchor="middle" fill="#0369a1">CHALLAN</text>
    <rect x="110" y="50" width="116" height="64" rx="10" fill="#1e293b" />
    <circle cx="138" cy="120" r="8" fill="#0f172a" stroke="white" strokeWidth="2" />
    <circle cx="200" cy="120" r="8" fill="#0f172a" stroke="white" strokeWidth="2" />
    <rect x="120" y="60" width="48" height="36" rx="4" fill="#94a3b8" />
    <rect x="172" y="60" width="48" height="36" rx="4" fill="#cbd5e1" />
    <path d="M104 92 L114 92" stroke="#475569" strokeWidth="2" />
  </IllustrationFrame>
);

const InwardIllustration = (props: { className?: string }) => (
  <IllustrationFrame className={props.className}>
    <rect x="20" y="40" width="200" height="60" rx="12" fill="white" stroke="#fde68a" />
    <rect x="32" y="56" width="34" height="28" rx="3" fill="#fbbf24" opacity="0.75" />
    <rect x="74" y="56" width="34" height="28" rx="3" fill="#10b981" opacity="0.75" />
    <rect x="116" y="56" width="34" height="28" rx="3" fill="#f59e0b" opacity="0.75" />
    <rect x="158" y="56" width="34" height="28" rx="3" fill="#34d399" opacity="0.75" />
    <text x="120" y="120" fontSize="11" fontWeight="700" textAnchor="middle" fill="#78350f">GRN auto-reserves to waiting quotes</text>
  </IllustrationFrame>
);

const PaymentIllustration = (props: { className?: string }) => (
  <IllustrationFrame className={props.className}>
    <rect x="32" y="40" width="80" height="60" rx="10" fill="#10b981" opacity="0.85" />
    <text x="72" y="74" fontSize="14" textAnchor="middle" fontWeight="700" fill="white">₹</text>
    <text x="72" y="92" fontSize="9" textAnchor="middle" fontWeight="700" fill="white">Received</text>
    <rect x="130" y="40" width="80" height="60" rx="10" fill="white" stroke="#94a3b8" strokeDasharray="4 3" />
    <text x="170" y="74" fontSize="14" textAnchor="middle" fontWeight="700" fill="#475569">₹</text>
    <text x="170" y="92" fontSize="9" textAnchor="middle" fontWeight="700" fill="#475569">Pending</text>
  </IllustrationFrame>
);

const CommunicationsIllustration = (props: { className?: string }) => (
  <IllustrationFrame className={props.className}>
    {[0, 1, 2].map((i) => (
      <g key={i} transform={`translate(0 ${i * 30})`}>
        <circle cx="32" cy="40" r="10" fill={['#3b82f6', '#10b981', '#f59e0b'][i]} opacity="0.85" />
        <rect x="52" y="32" width="156" height="16" rx="4" fill="white" stroke="#e2e8f0" />
        <rect x="60" y="38" width={[110, 90, 70][i]} height="4" rx="2" fill="#94a3b8" />
      </g>
    ))}
  </IllustrationFrame>
);

const ApprovalIllustration = (props: { className?: string }) => (
  <IllustrationFrame className={props.className}>
    <rect x="40" y="32" width="160" height="76" rx="12" fill="white" stroke="#e2e8f0" />
    <rect x="56" y="48" width="80" height="6" rx="3" fill="#0f172a" />
    <rect x="56" y="60" width="120" height="3" rx="1.5" fill="#cbd5e1" />
    <rect x="56" y="68" width="100" height="3" rx="1.5" fill="#cbd5e1" />
    <rect x="56" y="80" width="40" height="20" rx="6" fill="#10b981" />
    <text x="76" y="93" fontSize="10" textAnchor="middle" fontWeight="700" fill="white">Approve</text>
    <rect x="100" y="80" width="40" height="20" rx="6" fill="white" stroke="#ef4444" />
    <text x="120" y="93" fontSize="10" textAnchor="middle" fontWeight="700" fill="#ef4444">Reject</text>
  </IllustrationFrame>
);

const ReturnsIllustration = (props: { className?: string }) => (
  <IllustrationFrame className={props.className}>
    <rect x="40" y="36" width="160" height="72" rx="12" fill="white" stroke="#fecaca" />
    <text x="120" y="58" textAnchor="middle" fontSize="10" fontWeight="700" fill="#991b1b">Return / Refund</text>
    <rect x="56" y="68" width="120" height="14" rx="4" fill="#fee2e2" />
    <text x="116" y="78" textAnchor="middle" fontSize="9" fontWeight="700" fill="#b91c1c">Restock or write-off</text>
    <rect x="56" y="86" width="120" height="14" rx="4" fill="#dcfce7" />
    <text x="116" y="96" textAnchor="middle" fontSize="9" fontWeight="700" fill="#166534">Refund posted to order</text>
  </IllustrationFrame>
);

const AuditIllustration = (props: { className?: string }) => (
  <IllustrationFrame className={props.className}>
    {[0, 1, 2, 3].map((i) => (
      <g key={i}>
        <circle cx="24" cy={36 + i * 22} r="6" fill={['#0ea5e9', '#10b981', '#f59e0b', '#ef4444'][i]} />
        <rect x="40" y={28 + i * 22} width="180" height="16" rx="4" fill="white" stroke="#e2e8f0" />
        <rect x="48" y={34 + i * 22} width="100" height="4" rx="2" fill="#94a3b8" />
      </g>
    ))}
  </IllustrationFrame>
);

const PortalIllustration = (props: { className?: string }) => (
  <IllustrationFrame className={props.className}>
    <rect x="44" y="34" width="152" height="78" rx="14" fill="white" stroke="#bae6fd" />
    <text x="120" y="58" textAnchor="middle" fontSize="11" fontWeight="700" fill="#0369a1">customer.marblepark/portal/…</text>
    <rect x="56" y="68" width="128" height="14" rx="4" fill="#e0f2fe" />
    <text x="120" y="78" textAnchor="middle" fontSize="9" fontWeight="700" fill="#0369a1">Quotes · Orders · Payments</text>
    <rect x="56" y="86" width="128" height="14" rx="4" fill="#dcfce7" />
    <text x="120" y="96" textAnchor="middle" fontSize="9" fontWeight="700" fill="#166534">Read-only · 30 day link</text>
  </IllustrationFrame>
);

const TargetsIllustration = (props: { className?: string }) => (
  <IllustrationFrame className={props.className}>
    <rect x="20" y="80" width="40" height="40" rx="4" fill="#3b82f6" />
    <rect x="68" y="60" width="40" height="60" rx="4" fill="#10b981" />
    <rect x="116" y="40" width="40" height="80" rx="4" fill="#f59e0b" />
    <rect x="164" y="56" width="40" height="64" rx="4" fill="#8b5cf6" />
    <line x1="14" y1="36" x2="220" y2="36" stroke="#94a3b8" strokeDasharray="4 4" />
    <text x="222" y="32" fontSize="9" textAnchor="end" fontWeight="700" fill="#475569">Target</text>
  </IllustrationFrame>
);

const ReportsIllustration = (props: { className?: string }) => (
  <IllustrationFrame className={props.className}>
    <rect x="36" y="40" width="168" height="68" rx="12" fill="white" stroke="#e2e8f0" />
    <polyline points="52,90 80,68 112,80 144,54 178,72 196,64" fill="none" stroke="#2563eb" strokeWidth="2.5" />
    {[
      { x: 52, y: 90 }, { x: 80, y: 68 }, { x: 112, y: 80 }, { x: 144, y: 54 }, { x: 178, y: 72 }, { x: 196, y: 64 },
    ].map((p) => (
      <circle key={p.x} cx={p.x} cy={p.y} r="3" fill="#1d4ed8" />
    ))}
  </IllustrationFrame>
);

const CustomersIllustration = (props: { className?: string }) => (
  <IllustrationFrame className={props.className}>
    {[40, 100, 160].map((x, i) => (
      <g key={x}>
        <circle cx={x} cy="56" r="14" fill={['#3b82f6', '#10b981', '#8b5cf6'][i]} opacity="0.85" />
        <rect x={x - 22} y="78" width="44" height="6" rx="3" fill="#0f172a" />
        <rect x={x - 22} y="90" width="44" height="4" rx="2" fill="#cbd5e1" />
        <rect x={x - 22} y="100" width="32" height="4" rx="2" fill="#cbd5e1" />
      </g>
    ))}
  </IllustrationFrame>
);

const SettingsIllustration = (props: { className?: string }) => (
  <IllustrationFrame className={props.className}>
    <circle cx="120" cy="70" r="34" fill="white" stroke="#94a3b8" />
    {Array.from({ length: 8 }).map((_, i) => {
      const angle = (i / 8) * Math.PI * 2;
      const x1 = 120 + Math.cos(angle) * 36;
      const y1 = 70 + Math.sin(angle) * 36;
      const x2 = 120 + Math.cos(angle) * 46;
      const y2 = 70 + Math.sin(angle) * 46;
      return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#94a3b8" strokeWidth="3" strokeLinecap="round" />;
    })}
    <circle cx="120" cy="70" r="14" fill="#1e293b" />
    <circle cx="120" cy="70" r="6" fill="white" />
  </IllustrationFrame>
);

const ProfileIllustration = (props: { className?: string }) => (
  <IllustrationFrame className={props.className}>
    <circle cx="120" cy="62" r="22" fill="#3b82f6" />
    <text x="120" y="68" textAnchor="middle" fontSize="14" fontWeight="700" fill="white">U</text>
    <rect x="76" y="92" width="88" height="6" rx="3" fill="#0f172a" />
    <rect x="84" y="104" width="72" height="4" rx="2" fill="#cbd5e1" />
  </IllustrationFrame>
);

const VendorsIllustration = (props: { className?: string }) => (
  <IllustrationFrame className={props.className}>
    {[36, 100, 164].map((x, i) => (
      <g key={x}>
        <rect x={x} y="50" width="44" height="58" rx="6" fill={i === 1 ? '#fbbf24' : '#cbd5e1'} opacity="0.6" />
        <rect x={x + 6} y="60" width="32" height="6" rx="2" fill="#0f172a" />
        <rect x={x + 6} y="70" width="20" height="3" rx="1.5" fill="#1e293b" />
        <rect x={x + 6} y="78" width="32" height="3" rx="1.5" fill="#475569" />
      </g>
    ))}
    <text x="120" y="124" textAnchor="middle" fontSize="9" fontWeight="700" fill="#475569">Vendors · Purchase orders · GRN</text>
  </IllustrationFrame>
);

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'overview',
    title: 'Marble Park workspace',
    tagline: 'How leads, quotes, orders, dispatch and inventory connect',
    icon: LayoutDashboard,
    Illustration: PipelineIllustration,
    steps: [
      { title: 'Lead', body: 'Every conversation starts as a lead — record customer, source, owner, expected value.' },
      { title: 'Intent → quote', body: 'Capture what they want as an intent, then generate a quote. Quotes lock prices and create reservations.' },
      { title: 'Approval', body: 'Discounts beyond the threshold get queued for owner/manager approval.' },
      { title: 'Sales order', body: 'On conversion the quote becomes an order. Reservations stay in place; inventory is not deducted yet.' },
      { title: 'Dispatch', body: 'Dispatch team partial-challans the order based on what is GRN-received and reserved. Only ready rows can ship.' },
      { title: 'Delivered + paid', body: 'On delivery the stock is deducted. Payments are recorded against the order until balance is zero.' },
    ],
    glossary: [
      { term: 'Reservation', meaning: 'A claim on stock for an open quote/order. Released if the quote expires or is cancelled.' },
      { term: 'GRN', meaning: 'Goods Received Note — inward receipt that bumps available stock and auto-reserves to waiting quotes.' },
      { term: 'Challan', meaning: 'Dispatch note for a partial or full shipment. Generates inventory movements when marked dispatched.' },
    ],
    relatedTopicIds: ['leads', 'quotes', 'dispatch', 'inventory'],
  },
  {
    id: 'leads',
    title: 'Leads & follow-ups',
    tagline: 'Capture and nurture every conversation',
    icon: PackageSearch,
    Illustration: PipelineIllustration,
    steps: [
      { title: 'New lead', body: 'Use New Lead. The form checks for duplicate customers by GST > email > mobile > name+city.' },
      { title: 'Stages', body: 'Move leads through new → contacted → qualified → won/lost. Use the stage dropdown on the lead card.' },
      { title: 'Follow-ups', body: 'Add a follow-up task with a due date. Tasks show on your dashboard and on the lead detail.' },
      { title: 'Communication log', body: 'Log every call, visit, WhatsApp message on the lead so the history is searchable.' },
    ],
    faq: [
      { q: 'How do I avoid creating duplicate customers?', a: 'The form blocks duplicates automatically. Owners/admins can override with Force create when they really need a separate record (e.g. same family, separate site).' },
      { q: 'Where do lost leads go?', a: 'They stay on the leads list filtered by stage = lost. Closing a lead does not delete it.' },
    ],
    relatedTopicIds: ['customers', 'communications', 'quotes'],
  },
  {
    id: 'quotes',
    title: 'Quotes & Quote Studio',
    tagline: 'Build, send and convert quotes',
    icon: FileSpreadsheet,
    Illustration: QuoteIllustration,
    steps: [
      { title: 'Open Quote Studio', body: 'Quotes → New. Pick the customer, add items from catalogue, apply discount, choose display mode.' },
      { title: 'Layouts', body: 'Selection layout = catalogue-style cards with images (great for first share). Priced layout = compact table.' },
      { title: 'Send + reserve', body: 'On Save we auto-reserve the picked items so dispatch can see what is committed.' },
      { title: 'Convert to order', body: 'Once the customer confirms, click Convert to sales order. Approval kicks in for big discounts.' },
    ],
    faq: [
      { q: 'Why is my line marked "Rebuild quote"?', a: 'That row points to a free-text product without a Product Master SKU. Rebuild from the catalogue so dispatch can reserve inventory.' },
      { q: 'Where do quote PDFs come from?', a: 'They are generated server-side using the Marble Park PDF renderer. Re-share the same link any time.' },
    ],
    relatedTopicIds: ['approvals', 'orders', 'inventory'],
  },
  {
    id: 'approvals',
    title: 'Approval desk',
    tagline: 'Owner / manager gate for big discounts',
    icon: ClipboardCheck,
    Illustration: ApprovalIllustration,
    steps: [
      { title: 'Auto-queued', body: 'Quotes above the configured discount threshold land here automatically.' },
      { title: 'Review', body: 'Open the quote, check items, discount, customer history. Approve or reject inline.' },
      { title: 'Audit trail', body: 'Every approval/rejection is captured in the audit log with the reviewer and timestamp.' },
    ],
    relatedTopicIds: ['quotes', 'audit'],
  },
  {
    id: 'orders',
    title: 'Sales orders & payments',
    tagline: 'From conversion to fully paid',
    icon: Receipt,
    Illustration: PaymentIllustration,
    steps: [
      { title: 'Order detail', body: 'Open the order to see items, dispatch progress, documents and the payment timeline.' },
      { title: 'Record payment', body: 'Click "Record payment", pick mode (cash/UPI/cheque/transfer/card), enter amount and reference. Status updates automatically.' },
      { title: 'Refund', body: 'Use the Refund option on an existing payment when issuing money back. Refunds also flow from a return.' },
      { title: 'Balance', body: 'Unpaid and partial orders are flagged in the receivables ageing report.' },
    ],
    glossary: [
      { term: 'Receivables ageing', meaning: 'Outstanding order balances bucketed by 0-30 / 31-60 / 61-90 / 90+ days from order date.' },
    ],
    relatedTopicIds: ['payments', 'returns', 'reports'],
  },
  {
    id: 'payments',
    title: 'Payments register',
    tagline: 'Money received and refunded',
    icon: Wallet,
    Illustration: PaymentIllustration,
    steps: [
      { title: 'Per-order view', body: 'Each order shows its full payment history with running balance.' },
      { title: 'Refund a payment', body: 'Refunds are stored as negative entries (direction = refund) so totals stay accurate.' },
      { title: 'Cross-cut reports', body: 'Use the Receivables ageing report to see who owes you what at any time.' },
    ],
    relatedTopicIds: ['orders', 'returns', 'reports'],
  },
  {
    id: 'dispatch',
    title: 'Dispatch board',
    tagline: 'Only ship what is reserved',
    icon: Truck,
    Illustration: DispatchIllustration,
    steps: [
      { title: 'Board layout', body: 'Pending → Packed → In transit → Delivered. Each card shows ready vs pending-inward lines.' },
      { title: 'Partial challan', body: 'Pick a ready line, set quantity, click Partial challan. A pending challan is created.' },
      { title: 'Dispatch', body: 'On Dispatch the inventory is consumed and reservations move to dispatched state.' },
      { title: 'Delivery proof', body: 'Before marking Delivered, capture receiver name + photo/signature. The system blocks delivery without proof.' },
    ],
    faq: [
      { q: 'Why is a line "blocked"?', a: 'Either the SKU has not been received on GRN yet, or the reservation is missing. Use Pending Inward to track it.' },
    ],
    relatedTopicIds: ['inventory', 'returns', 'pending-inward'],
  },
  {
    id: 'pending-inward',
    title: 'Pending inward',
    tagline: 'Items waiting for GRN before they can ship',
    icon: Inbox,
    Illustration: InwardIllustration,
    steps: [
      { title: 'What it lists', body: 'Every confirmed line that has no available stock yet, grouped by SKU.' },
      { title: 'On GRN', body: 'When the SKU is received via GRN, the auto-reserve sweep claims units against the waiting jobs in FIFO order.' },
    ],
    relatedTopicIds: ['inventory', 'dispatch', 'vendors'],
  },
  {
    id: 'inventory',
    title: 'Inventory & GRN',
    tagline: 'Live stock balances',
    icon: Boxes,
    Illustration: InventoryIllustration,
    steps: [
      { title: 'Balances', body: 'On hand · Reserved · Available · Damaged · Hold. Available = what dispatch can promise.' },
      { title: 'Low stock', body: 'Each SKU has a threshold (default 5). Below threshold = flagged on Inventory Manager dashboard.' },
      { title: 'GRN inward', body: 'Use GRN to receive stock against a PO or ad-hoc. The system bumps on-hand and runs auto-reserve.' },
    ],
    relatedTopicIds: ['pending-inward', 'vendors', 'dispatch'],
  },
  {
    id: 'returns',
    title: 'Returns & refunds',
    tagline: 'Bring stock back, refund the customer',
    icon: RefreshCw,
    Illustration: ReturnsIllustration,
    steps: [
      { title: 'Open a return', body: 'On a delivered order, click Return. Pick lines, quantity, reason category, restock flag.' },
      { title: 'Restock or write-off', body: 'Restocked items add back to on-hand. Damaged items log a write-off movement.' },
      { title: 'Refund', body: 'Enter refund amount and mode. A negative payment is posted; the order balance updates automatically.' },
    ],
    relatedTopicIds: ['orders', 'payments', 'inventory'],
  },
  {
    id: 'customers',
    title: 'Customers',
    tagline: 'Master record per buyer',
    icon: Users,
    Illustration: CustomersIllustration,
    steps: [
      { title: 'Add', body: 'Add Customer or create one inline from a new lead. The dedupe guard prevents accidents.' },
      { title: 'Detail page', body: 'Customer detail shows quotes, orders, dispatches, communications, payments and portal links.' },
      { title: 'Portal access', body: 'Issue a 30-day read-only portal link so the customer can self-check status.' },
    ],
    relatedTopicIds: ['communications', 'portal', 'leads'],
  },
  {
    id: 'communications',
    title: 'Communication log',
    tagline: 'Every call, visit, message on record',
    icon: MessageSquare,
    Illustration: CommunicationsIllustration,
    steps: [
      { title: 'Quick log', body: 'On any customer or lead, click "Log communication". Pick type, jot 1-2 lines, save.' },
      { title: 'Inbound vs outbound', body: 'Direction matters when scanning the history — both options stay visible.' },
      { title: 'Search', body: 'The customer detail timeline is searchable by type and date.' },
    ],
    relatedTopicIds: ['customers', 'leads'],
  },
  {
    id: 'portal',
    title: 'Customer portal',
    tagline: 'Read-only magic link the customer can open',
    icon: MapPin,
    Illustration: PortalIllustration,
    steps: [
      { title: 'Issue link', body: 'On the customer detail, click "Issue portal link". The link copies to clipboard.' },
      { title: 'What they see', body: 'Quotes, sales orders, payment status, dispatch tracking — read-only.' },
      { title: 'Revoke', body: 'Revoke any link instantly from the customer detail. Audit logs the action.' },
    ],
    relatedTopicIds: ['customers'],
  },
  {
    id: 'vendors',
    title: 'Vendors & purchase orders',
    tagline: 'Where stock comes from',
    icon: Bath,
    Illustration: VendorsIllustration,
    steps: [
      { title: 'Vendor master', body: 'Maintain the vendor address book — used by GRN and by reports.' },
      { title: 'Purchase order', body: 'Create a PO with expected date, lines, vendor. Status flows draft → open → received → closed.' },
      { title: 'GRN reference', body: 'When inward arrives, reference the PO on the GRN. The Procurement report shows open POs.' },
    ],
    relatedTopicIds: ['inventory', 'pending-inward'],
  },
  {
    id: 'targets',
    title: 'Sales targets',
    tagline: 'Monthly amount per sales rep',
    icon: ListChecks,
    Illustration: TargetsIllustration,
    steps: [
      { title: 'Set target', body: 'On the Users page (manager view), pick a rep + month + amount.' },
      { title: 'Live progress', body: 'The rep dashboard shows actual vs target with a radial gauge.' },
      { title: 'Team rollup', body: 'Sales Manager / Owner see team-wide achievement.' },
    ],
    relatedTopicIds: ['users', 'reports'],
  },
  {
    id: 'reports',
    title: 'Reports & exports',
    tagline: 'Operational and financial snapshots',
    icon: FileSpreadsheet,
    Illustration: ReportsIllustration,
    steps: [
      { title: 'Available reports', body: 'Monthly sales by category, top customers, dead stock (90d), conversion funnel by rep, pending dispatch ageing, receivables ageing.' },
      { title: 'Filters', body: 'Each report has a date filter. Defaults to last 90 days.' },
      { title: 'CSV export', body: 'One click per report. Streams to a downloadable CSV.' },
    ],
    relatedTopicIds: ['payments', 'dispatch', 'inventory'],
  },
  {
    id: 'audit',
    title: 'Audit log',
    tagline: 'Who did what, when (admin + owner only)',
    icon: History,
    Illustration: AuditIllustration,
    steps: [
      { title: 'Filter', body: 'By date range, action family, critical-only, and free text.' },
      { title: 'Cards', body: 'Each event shows actor, action, summary, metadata. Critical actions are red-tagged.' },
      { title: 'Export', body: 'Download as CSV for compliance review.' },
    ],
    relatedTopicIds: ['users', 'settings'],
  },
  {
    id: 'users',
    title: 'User management',
    tagline: 'Roles and access',
    icon: UserCog,
    Illustration: ProfileIllustration,
    steps: [
      { title: 'Roles', body: 'Owner, Admin, Sales Manager, Sales, Inventory Manager, Dispatch Ops, Office Staff.' },
      { title: 'Add user', body: 'Owners + Admins create accounts. Disable rather than delete to preserve history.' },
      { title: 'Reset', body: 'Trigger a password reset link from the user detail page.' },
    ],
    relatedTopicIds: ['audit', 'profile'],
  },
  {
    id: 'profile',
    title: 'My profile',
    tagline: 'Avatar, contact, password',
    icon: UserCircle2,
    Illustration: ProfileIllustration,
    steps: [
      { title: 'Avatar', body: 'Upload an image up to 5MB. Falls back to your initials if you skip it.' },
      { title: 'Change password', body: 'Enter your current password, then a new one (min 8 chars).' },
      { title: 'Sessions', body: 'Changing your password signs out other devices for safety.' },
    ],
    relatedTopicIds: ['users'],
  },
  {
    id: 'settings',
    title: 'System settings',
    tagline: 'Prefixes, approval thresholds, app URL',
    icon: Settings,
    Illustration: SettingsIllustration,
    steps: [
      { title: 'Numbering', body: 'Quote and challan prefixes feed into auto-generated numbers.' },
      { title: 'Approval threshold', body: 'Discount % above this triggers manager approval.' },
      { title: 'Branding', body: 'Company name, support phone/email appear on PDFs and the portal.' },
    ],
    relatedTopicIds: ['audit', 'users'],
  },
  {
    id: 'security',
    title: 'Security & sessions',
    tagline: 'How sign-in and tokens work',
    icon: ShieldCheck,
    Illustration: ProfileIllustration,
    steps: [
      { title: 'Session tokens', body: 'Tokens are hashed at rest. Plaintext never lands in the database after the rollover.' },
      { title: 'Rate limiting', body: 'Login attempts cap at 8 per 15 min per IP+email pair.' },
      { title: 'Change password', body: 'Sign out every other device the moment you suspect a leak.' },
    ],
    relatedTopicIds: ['profile', 'audit'],
  },
];

export function findHelpTopic(id: string): HelpTopic | undefined {
  return HELP_TOPICS.find((t) => t.id === id);
}
