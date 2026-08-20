export type HelpGuide = {
  id: string;
  title: string;
  summary: string;
  roles: string[];
  duration: string;
  href: string;
  video?: string;
  image?: string;
  flow: string[];
  steps: string[];
  checks: string[];
  related: string[];
};

export const HELP_GUIDES: HelpGuide[] = [
  {
    id: 'setup-master-data', title: 'Set up master data and products', duration: '12 min', href: '/dashboard/master-data/products', roles: ['Owner', 'Inventory', 'Office'],
    summary: 'Create controlled brands, categories and generic SKUs; for tiles, separate design content, governed geometry and inwardable variants before any transaction uses them.',
    video: '/help/videos/01-master-data-and-tiles.mp4', image: '/help/images/labels-and-lots.png',
    flow: ['Design registry', 'Size geometry', 'Variant SKU', 'Opening stock / GRN', 'Lot / display asset'],
    steps: ['Create brand, category, finish, UOM, tax and tile-size masters first.', 'In Tile Workspace, create the design once with brand, collection, material/type, surface/finish, colour, pattern, usage, description and images.', 'Create each sellable design × size × finish variant; review pieces per box, UOM, loose-piece policy, pricing and the permanent warehouse SKU.', 'Add supplier, legacy, barcode or showroom codes as aliases instead of renaming the warehouse SKU.', 'Download a fresh Excel template so bulk-import dropdowns match live master data; correct every validation failure before confirming.', 'Record opening stock or a PO/manual GRN against the variant to create exact lots; for tiles enter boxes plus optional loose pieces, batch, shade, caliber and grade.', 'Register a display as a separate asset. Choose a source lot only when physical stock is consumed, then print the display label.'],
    checks: ['Design and size are reusable catalogue masters; Product-backed variant is the only stock identity.', 'Warehouse SKU and design code are immutable after creation.', 'An imported variant starts with zero stock.', 'Display stock changes only through issue-to-display or return-to-lot actions.', 'Stock exists only after a posted opening session or GRN.'],
    related: ['tile-pricing', 'procurement-inward', 'labels-lots'],
  },
  {
    id: 'tile-pricing', title: 'Quote tiles by area, piece or box', duration: '8 min', href: '/dashboard/quotes/new', roles: ['Sales', 'Owner', 'Office'],
    summary: 'Choose the commercial rate basis per quote line while the system continues to reserve and dispatch whole physical boxes.',
    video: '/help/videos/02-tile-pricing-and-quotes.mp4', image: '/help/images/quote-editor-tile-and-sanitaryware.png',
    flow: ['Find display code', 'Choose Area / Pieces / Boxes', 'Enter need', 'System rounds boxes', 'Customer sees billed UOM'],
    steps: ['Search the internal showroom code or SKU in Quote Studio.', 'Select Area, Pieces or Boxes on the tile line.', 'For Area, enter required area and wastage percentage.', 'For Pieces, enter requested pieces; the system rounds to full boxes.', 'For Boxes, enter the physical box count directly.', 'Review the billed quantity, physical boxes, rate/UOM, GST and quote image before saving.'],
    checks: ['Area pricing needs positive coverage per box.', 'Piece pricing needs pieces per box.', 'Orders, reservations and dispatch always use the physical inventory quantity shown.'],
    related: ['crm-quote', 'partial-order', 'setup-master-data'],
  },
  {
    id: 'crm-quote', title: 'Run lead, intent and quote revisions', duration: '14 min', href: '/dashboard/leads', roles: ['Sales', 'Sales Manager', 'Office'],
    summary: 'Capture the customer requirement, build room-wise selections, revise without losing history, and issue priced or selection-only PDFs.',
    video: '/help/videos/03-crm-lead-to-quote.mp4', image: '/help/images/dashboard-with-e2e-records.png',
    flow: ['Lead', 'Intent', 'Product selections', 'Quote revision', 'Customer decision'],
    steps: ['Create or open the customer and lead.', 'Record site, budget, timeline and requirement notes.', 'Create an intent and add Product Master SKUs room by room.', 'Open Quote Studio from the intent or create a direct quote.', 'Edit the room, customer-facing image, internal design code, rate, discount and GST.', 'In Quotation footer, select only the served-brand logos that belong on this customer document.', 'Save a new revision when commercial lines must change after discussion.', 'Download the priced quotation or selection-only PDF and mark it sent.'],
    checks: ['Every line must reference an active Product Master SKU.', 'Below-floor negotiated rates require approval.', 'Commercial lines freeze after an order; use a revision for a new agreement.'],
    related: ['tile-pricing', 'partial-order', 'payments-documents'],
  },
  {
    id: 'partial-order', title: 'Convert a quote in partial sales orders', duration: '11 min', href: '/dashboard/quotes', roles: ['Sales', 'Owner', 'Office'],
    summary: 'Convert only confirmed quantities, keep the remainder open, and avoid creating duplicate quotes for the same customer decision.',
    video: '/help/videos/04-partial-order-and-procurement.mp4', image: '/help/images/pending-inward.png',
    flow: ['Confirmed quote lines', 'Select quantities', 'Sales order', 'Reserve stock', 'Backorder shortage'],
    steps: ['Open the accepted quote and review Fulfilment.', 'Enter the quantity confirmed now for each line.', 'Choose cash or credit and record advance or terms.', 'Create the sales order; remaining quote quantities stay available.', 'Review reserved and backordered quantities.', 'Close the remainder only when the customer cancels it, with a reason.'],
    checks: ['Selections cannot exceed remaining quote quantity.', 'Each conversion is idempotent and creates its own dispatch job.', 'Shortages automatically create purchase demand.'],
    related: ['procurement-inward', 'dispatch-return', 'payments-documents'],
  },
  {
    id: 'procurement-inward', title: 'Procure shortages and receive stock', duration: '13 min', href: '/dashboard/procurement', roles: ['Inventory', 'Office', 'Owner'],
    summary: 'Turn open purchase demand into purchase orders, receive partial GRNs, and create traceable lots without breaking the customer order link.',
    video: '/help/videos/04-partial-order-and-procurement.mp4', image: '/help/images/pending-inward.png',
    flow: ['Overview', 'Demand', 'Purchase orders', 'PO / manual receiving', 'History / allocation'],
    steps: ['Start on Procurement Overview. Its KPI cards and schedule read the live demand, PO and GRN registers; purchase commitment value includes only POs with a captured commercial value and identifies missing costs instead of treating them as real zero spend.', 'Open Demand for customer shortages or Purchase Orders for planned replenishment. Search, filter and sort the server-paged queue; select only active demand and choose a governed supplier.', 'For a planned PO, search the Product/variant code and enter quantity. Tile lines accept boxes plus allowed loose pieces and snapshot the pack conversion.', 'Record expected date, unit cost, discount, GST and notes, then download the supplier PO PDF.', 'In Receiving, choose the PO and enter only quantities physically delivered; every receipt line starts blank and never defaults to the outstanding balance.', 'Capture supplier challan/bill, stock location, damaged pieces, batch and tile shade/caliber/grade. Use Manual GRN only for a real delivery without a prior PO and record the reason.', 'After posting, review History, exact lots, Pending Inward allocation and stock reconciliation. The form clears after success.'],
    checks: ['Never add live stock directly to balances.', 'Received quantity cannot exceed the remaining PO base quantity.', 'Boxes and loose pieces convert to base pieces with an immutable snapshot.', 'Damaged quantity is isolated from available stock.', 'Every inward retains supplier, PO/manual reason, GRN, variant, lot, location, actor and source links.'],
    related: ['labels-lots', 'partial-order', 'inventory-control'],
  },
  {
    id: 'labels-lots', title: 'Print labels, scan and manage lots', duration: '9 min', href: '/dashboard/inventory/labels', roles: ['Inventory', 'Dispatch'],
    summary: 'Generate QR labels for each inward or display sample and use exact-lot identity during picking, movement and return.',
    video: '/help/videos/05-stock-dispatch-and-returns.mp4', image: '/help/images/labels-and-lots.png',
    flow: ['GRN / opening / display', 'Label job', 'Print QR', 'Scan lot', 'Trace movement'],
    steps: ['Open Labels & Scan after posting an inward.', 'Filter by source and choose the label template.', 'Print the required quantity and attach labels to boxes or sample displays.', 'Scan or search the code during stock review and dispatch.', 'Verify SKU, lot, location, inward reference, quantity and status before movement.'],
    checks: ['A QR identifies the system record; it does not replace printed human-readable details.', 'Reprints keep the same lot identity.', 'Display labels identify samples, not saleable quantities.'],
    related: ['procurement-inward', 'dispatch-return', 'inventory-control'],
  },
  {
    id: 'dispatch-return', title: 'Pick, partially dispatch, deliver and return', duration: '15 min', href: '/dashboard/dispatch', roles: ['Dispatch', 'Inventory', 'Office'],
    summary: 'Pick exact lots, create multiple challans against one order, prove delivery with OTP, and return stock to its original traceable lot.',
    video: '/help/videos/05-stock-dispatch-and-returns.mp4', image: '/help/images/dispatch-partial-flow.png',
    flow: ['Order line', 'Exact-lot pick', 'Pack', 'Challan', 'OTP delivery', 'Return / balance'],
    steps: ['Open the order’s dispatch job and review ready, backordered and already dispatched quantities.', 'Select the exact lot and quantity to pick.', 'Confirm pack quantities and create the delivery challan.', 'Repeat later for remaining items; do not create another sales order.', 'Send and verify delivery OTP to close the challan.', 'For a return, select the original dispatch line, reason, disposition and received quantity.'],
    checks: ['Cannot pick more than available or ordered balance.', 'Every challan is partial-safe.', 'A return must reference the original dispatch line and restores the correct lot when saleable.'],
    related: ['partial-order', 'labels-lots', 'inventory-control'],
  },
  {
    id: 'payments-documents', title: 'Track payments and documents', duration: '7 min', href: '/dashboard/payments', roles: ['Owner', 'Sales', 'Office'],
    summary: 'Record cash advances or credit terms, monitor balance due, and retrieve the correct quote, order and receipt documents.',
    flow: ['Sales order', 'Advance / credit', 'Receipt', 'Balance due', 'Document center'],
    steps: ['Choose payment mode during order conversion.', 'For cash, enter the received advance; for credit, confirm terms and due date.', 'Post later receipts against the sales order.', 'Review payment status and remaining balance.', 'Open Document Center for quote PDF, sales order PDF and generated records.'],
    checks: ['Receipt posting is idempotent.', 'Amount cannot exceed the order balance.', 'Credit orders remain visible until settled.'],
    related: ['partial-order', 'reports-audit', 'crm-quote'],
  },
  {
    id: 'file-vault', title: 'Store, present and share files', duration: '6 min', href: '/dashboard/documents', roles: ['Owner', 'Sales', 'Office', 'Inventory', 'Dispatch'],
    summary: 'Keep catalogues, product imagery, videos and working files in one searchable library with controlled public presentation links.',
    flow: ['Upload files', 'Categorise', 'Preview', 'Create expiring link', 'Revoke / archive'],
    steps: ['Open Documents and choose Add files.', 'Drop up to 20 files, select a category and add useful collection or brand notes.', 'Search or filter the library, then select a file to preview it.', 'For customer presentation, choose an expiry and whether to show a download button.', 'Create and copy the public link; recipients do not need a login.', 'Revoke a link after use or archive the file to revoke all active links together.', 'Owners can permanently delete an archived file when its storage must be reclaimed.'],
    checks: ['PDF, image, browser video and audio formats preview inside the system.', 'Office documents download in their native format.', 'Archived files stay recoverable and cannot be opened from old public links.', 'Permanent deletion is restricted to owners/admins and only works after archive.', 'Uploads, edits, shares, revocations, archives and deletions are recorded in System Audit.'],
    related: ['payments-documents', 'crm-quote', 'users-settings'],
  },
  {
    id: 'inventory-control', title: 'Count, reconcile and correct stock', duration: '12 min', href: '/dashboard/inventory/control', roles: ['Inventory', 'Owner'],
    summary: 'Use controlled counts, approvals and reconciliation instead of editing balances, preserving an auditable inventory ledger.',
    image: '/help/images/reconciliation-clean.png',
    flow: ['Freeze scope', 'Count', 'Review variance', 'Approve / post', 'Reconcile'],
    steps: ['Create a stock count session for a location or scope.', 'Enter counted quantities by scanned lot.', 'Submit the count and review variance.', 'Approve and post the adjustment with reason.', 'Open Reconciliation to confirm lot, location, ledger and aggregate balances agree.'],
    checks: ['Only posted sessions affect stock.', 'Adjustments require reason and permissions.', 'Reconciliation should show zero critical differences before go-live.'],
    related: ['labels-lots', 'reports-audit', 'procurement-inward'],
  },
  {
    id: 'reports-audit', title: 'Use reports, approvals and audit', duration: '8 min', href: '/dashboard/reports', roles: ['Owner', 'Sales Manager'],
    summary: 'Use the five report suites, follow every metric to its source, and resolve readiness or operating exceptions without editing facts inside a report.',
    flow: ['Operational event', 'Approval / audit', 'Report', 'Exception action'],
    steps: ['Start with Owner, Sales, Finance, Inventory or Operations according to the decision you need.', 'Choose one of the four primary report tabs; additional specialist views stay behind Show more.', 'Set the business-date range and applicable owner, location or vendor filter.', 'Open Sources & definition to verify date basis, freshness, source tables and coverage.', 'Use a register row to open the authoritative customer, product, order, invoice, lot or audit record.', 'If a view says Needs setup, follow its action to Report Data Readiness instead of entering an estimate.', 'Save a personal view only after filters, metrics and columns match the repeat decision.', 'Use isolated Print or governed CSV export for a point-in-time copy.'],
    checks: ['Reports are decision surfaces, not stock-editing tools.', 'Zero means an eligible governed value of zero; unavailable means the required source is absent.', 'Role permissions determine visible suites, data scope and allowed export.', 'Coverage warnings remain visible when historical facts cannot be reconstructed.', 'Audit records are append-only evidence.'],
    related: ['reporting-readiness', 'payments-documents', 'inventory-control'],
  },
  {
    id: 'reporting-readiness', title: 'Set up missing report data safely', duration: '10 min', href: '/dashboard/reports/setup', roles: ['Owner'],
    summary: 'Identify whether a missing metric already has an operating source, needs a governed Marble Park workflow, or must come from accounting—without creating a generic financial shortcut.',
    flow: ['Needs setup', 'Classify source', 'Use authoritative workflow', 'Verify coverage', 'Report becomes usable'],
    steps: ['Open Data readiness from Reports; only owners and administrators can manage this page.', 'For Targets, select the governed metric and month, enter the approved amount and retain an approval or planning note.', 'Saving the same metric and month creates a new version and supersedes the old one; use Void only with a clear reason.', 'For product and tile exceptions, follow Correct Product Master and update the authoritative category, brand, finish, UOM, HSN, cost, size or pack fields.', 'Do not backfill historical quote or invoice cost using today’s cost. New quote lines snapshot Product Master cost and new invoice lines snapshot the dispatched lot cost automatically.', 'Treat purchase orders and GRNs as commitments and receipts—not supplier bills or payments.', 'Connect a governed accounting source or implement a dedicated AP/GL subledger before enabling supplier aging, P&L, cash flow or balance sheet.', 'Return to the report and review its coverage label; uncovered historical rows remain explicit.'],
    checks: ['Targets are positive, company-level, monthly and versioned.', 'Target revisions and voids appear in System Audit.', 'Product corrections happen only in Product, Tile and Size masters.', 'Supplier AP requires invoices, payments and allocation lineage.', 'Accounting statements require chart of accounts, journals, expenses and opening balances.', 'No report displays an estimate as an accounting fact.'],
    related: ['reports-audit', 'setup-master-data', 'procurement-inward'],
  },
  {
    id: 'account-security', title: 'Sign in and protect your session', duration: '4 min', href: '/dashboard/profile', roles: ['Owner', 'Sales', 'Sales Manager', 'Office', 'Inventory', 'Dispatch'],
    summary: 'Use your own account, understand the 15-minute inactivity safeguard, and recover cleanly when a session ends.',
    flow: ['Named login', 'Meaningful work', 'Expiry warning', 'Stay signed in / Sign out', 'Safe login return'],
    steps: ['Sign in with your assigned email and password; never share the owner account.', 'Marble Park ends every authenticated session after exactly 15 minutes without real keyboard, pointer, touch, input or scroll activity.', 'Background refreshes, charts and polling do not keep a session alive.', 'When the warning appears, choose Stay signed in only if you are still at the device, or Sign out now before leaving.', 'Signing out in one browser tab signs out the other open Marble Park tabs too.', 'After an inactivity sign-out, sign in again and use the safe return link to reopen the protected page.', 'Change a suspected or exposed password immediately from Profile; administrators can issue a temporary reset and all older sessions are revoked.'],
    checks: ['Do not leave unsaved form entries during the expiry warning.', 'Closed or stale tabs cannot continue requests after the server deadline.', 'The browser does not store the login token in local storage.', 'A deactivated account and every expired or revoked session are rejected by the server.'],
    related: ['users-settings', 'reports-audit'],
  },
  {
    id: 'users-settings', title: 'Manage users, roles and settings', duration: '6 min', href: '/dashboard/users', roles: ['Owner'],
    summary: 'Issue named user accounts, apply least-privilege roles, test access, and maintain company/document settings.',
    flow: ['Company identity', 'Document defaults', 'Create user', 'Assign role', 'Permission check', 'Audit'],
    steps: ['In Settings, maintain the company logo, address, GSTIN, phone, email, quotation title, default terms, bank details and footer.', 'Choose Light, Dark or System appearance; System follows the device preference.', 'Create one named account per staff member with a temporary password of at least 12 characters.', 'Assign Sales, Office, Inventory, Dispatch, Manager or Owner role.', 'Apply an override only when the standard role needs a documented exception.', 'Test the user’s navigation and one allowed action.', 'Deactivate departed users instead of reusing accounts; deactivation revokes their active sessions.'],
    checks: ['Never share the owner login.', 'Users cannot grant permissions they do not control.', 'Password resets, password changes, role changes and deactivation are auditable.', 'All sessions use the same 15-minute server-enforced inactivity limit.'],
    related: ['account-security', 'reports-audit', 'crm-quote', 'dispatch-return'],
  },
];

export const HELP_ROUTE_MAP: Array<[string, string]> = [
  ['/dashboard/master-data', 'setup-master-data'], ['/dashboard/products', 'setup-master-data'],
  ['/dashboard/quotes/new', 'tile-pricing'], ['/dashboard/quotes', 'partial-order'],
  ['/dashboard/leads', 'crm-quote'], ['/dashboard/intents', 'crm-quote'],
  ['/dashboard/procurement', 'procurement-inward'], ['/dashboard/pending-inward', 'procurement-inward'], ['/dashboard/inventory/inwards', 'procurement-inward'],
  ['/dashboard/inventory/labels', 'labels-lots'], ['/dashboard/dispatch', 'dispatch-return'], ['/dashboard/returns', 'dispatch-return'],
  ['/dashboard/payments', 'payments-documents'], ['/dashboard/documents', 'file-vault'],
  ['/dashboard/inventory', 'inventory-control'], ['/dashboard/reports/setup', 'reporting-readiness'], ['/dashboard/reports', 'reports-audit'], ['/dashboard/audit', 'reports-audit'], ['/dashboard/approvals', 'reports-audit'],
  ['/dashboard/profile', 'account-security'], ['/dashboard/users', 'users-settings'], ['/dashboard/settings', 'users-settings'],
];

export function guideForRoute(pathname: string) {
  const match = HELP_ROUTE_MAP.find(([route]) => pathname === route || pathname.startsWith(`${route}/`));
  return match?.[1] || 'crm-quote';
}
