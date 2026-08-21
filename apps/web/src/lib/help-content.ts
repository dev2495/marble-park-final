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
  examples?: string[];
};

export const HELP_GUIDES: HelpGuide[] = [
  {
    id: 'setup-master-data', title: 'Set up master data and products', duration: '12 min', href: '/dashboard/master-data/products', roles: ['Owner', 'Inventory', 'Office'],
    summary: 'Create controlled brands, categories and generic SKUs; for tiles, separate design content, governed geometry and inwardable variants before any transaction uses them.',
    video: '/help/videos/01-master-data-and-tiles.mp4', image: '/help/images/labels-and-lots.png',
    flow: ['Design registry', 'Size geometry', 'Variant SKU', 'Opening stock / GRN', 'Lot / display asset'],
    examples: ['Training example: create design "Calacatta Ivory" once with permanent code, its Brand Master value and images. Create Size Master "1200 x 600 mm" with calculated area. Then create the inwardable variant that combines that design, governed size and Finish Master value; the system issues its permanent warehouse SKU. Add supplier or old showroom codes as aliases, never by renaming the SKU.'],
    steps: ['Create brand, category, finish, UOM, tax and tile-size masters first.', 'In Tile Workspace, create the design once with only permanent code, design name, a Brand Master dropdown value and images.', 'Use Design Excel sample for bulk creation. Download it fresh so its Brand dropdown reflects live Brand Master, preview every row, then confirm the all-or-nothing import.', 'Create each sellable design × size × finish variant; choose finish from Finish Master and review pieces per box, UOM, loose-piece policy, pricing and the permanent warehouse SKU.', 'Add supplier, legacy, barcode or showroom codes as aliases instead of renaming the warehouse SKU.', 'Record opening stock or a PO/manual GRN against the variant to create exact lots; for tiles enter boxes plus optional loose pieces, batch, shade, caliber and grade.', 'Register a display as a separate asset. Choose a source lot only when physical stock is consumed, then print the display label.'],
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
    id: 'showroom-scan-intent', title: 'Scan showroom items into a customer intent', duration: '6 min', href: '/dashboard/leads/new', roles: ['Sales', 'Sales Manager', 'Owner'],
    summary: 'Use the phone camera while walking the showroom with a customer. Each active MP label resolves the exact physical item first, then offers only active size and finish variants from the same governed tile design.',
    flow: ['Customer + lead details', 'Scan exact showroom item', 'Choose one or several same-design variants', 'Set room / quantity', 'Save intent / create quote'],
    examples: ['Training example: scan the displayed Calacatta Ivory 1200 x 600 label. The exact scanned size remains highlighted; if the same design is active in 600 x 600 or 1200 x 1200, select those too. Add the selected variants, set Room / use to "Master bathroom wall", enter area and wastage for each, then create or save the intent.'],
    steps: ['On mobile, open Leads -> New lead and select the customer, project, source and next action.', 'In Product intent, tap Scan showroom item, then Scan with camera. Allow camera access for the Marble Park HTTPS site when the phone asks.', 'Hold the MP QR inside the frame. A valid active product, lot or display label resolves the linked Product Master item; an inactive or unknown label changes nothing.', 'Keep the exact physically scanned variant selected, or use the side-by-side list to filter by size, finish or code and select several active variants of the same Tile Design. Cross-design suggestions are never mixed in.', 'Tap Add selected to intent. Existing rows are marked and are not duplicated. A display asset stays non-sellable; its linked Product Master variants are the commercial items.', 'Set Room / use and quantity. For area-priced tiles, enter required area and wastage; the system derives physical packs.', 'Search by code remains available when the camera is blocked or a label is damaged.', 'Choose Create lead + intent. On an existing editable intent, scan and select variants, then Save draft or Save & submit so the change persists.', 'Direct Quote Studio and Labels & Scan use the same multi-selector. Always confirm the customer, area, MRP and negotiated rate before saving a quote.'],
    checks: ['Sales users need only an authenticated account and their normal lead/intent or quote permission; label printing permission is not required to scan.', 'The exact scanned item is visually distinct and selected by default.', 'Only active products sharing the scanned Tile Design may be selected; a non-tile label returns only its exact product.', 'Zero-stock variants can be quoted but are explicitly marked and are not treated as available inventory.', 'The camera starts only after a deliberate tap and stops after a successful read.', 'Scanning and selecting do not reserve, issue or increase stock.', 'An existing intent must remain editable; submitted, quoted or cancelled intents are frozen for audit.', 'Do not leave the page until selected intent rows have been saved or submitted.'],
    related: ['crm-quote', 'labels-lots', 'setup-master-data'],
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
    examples: ['Training example: receive 10 boxes of Calacatta Ivory 1200 x 600, 3 pieces per box, plus 1 permitted loose piece. The GRN posts 31 base pieces into one exact lot with supplier batch, shade, caliber, grade, unit cost and location. Labels are created from that posted GRN; the label job does not post the stock again.'],
    steps: ['Start on Procurement Overview. Its KPI cards and schedule read the live demand, PO and GRN registers; purchase commitment value includes only POs with a captured commercial value and identifies missing costs instead of treating them as real zero spend.', 'Open Demand for customer shortages or Purchase Orders for planned replenishment. Search, filter and sort the server-paged queue; select only active demand and choose a governed supplier.', 'For a planned PO, search the Product/variant code and enter quantity. Tile lines accept boxes plus allowed loose pieces and snapshot the pack conversion.', 'Record expected date, unit cost, discount, GST and notes, then download the supplier PO PDF.', 'In Receiving, choose the PO and enter only quantities physically delivered; every receipt line starts blank and never defaults to the outstanding balance.', 'Capture supplier challan/bill, stock location, damaged pieces, batch and tile shade/caliber/grade. Use Manual GRN only for a real delivery without a prior PO and record the reason.', 'After posting, open History and use Create labels on the GRN. It hands the exact accepted lines and lots to the Physical Identity Desk without reposting stock.', 'Review exact lots, Pending Inward allocation and stock reconciliation. The form clears after success.'],
    checks: ['Never add live stock directly to balances.', 'Received quantity cannot exceed the remaining PO base quantity.', 'Boxes and loose pieces convert to base pieces with an immutable snapshot.', 'Damaged quantity is isolated from available stock.', 'Every inward retains supplier, PO/manual reason, GRN, variant, lot, location, actor and source links.'],
    related: ['labels-lots', 'partial-order', 'inventory-control'],
  },
  {
    id: 'labels-lots', title: 'Print labels, scan and manage lots', duration: '9 min', href: '/dashboard/inventory/labels', roles: ['Inventory', 'Dispatch'],
    summary: 'Create auditable labels from recent GRNs, exact lots, products or display assets; print only the chosen labels and verify the real branded QR payload before movement.',
    video: '/help/videos/05-stock-dispatch-and-returns.mp4', image: '/help/images/labels-and-lots.png',
    flow: ['Posted GRN / display', 'Select exact subject', 'Create unique labels', 'Print and confirm', 'Scan and trace'],
    examples: ['Training example: open the recent GRN for Calacatta Ivory, select its exact lot and create 10 carton labels. Prepare a run for only labels 1-10, print on the chosen physical template, and confirm only after paper is produced. A salesperson may later scan any active label, keep the exact size or select several active same-design sizes for Intent or Quote; no stock changes during scan, selection or print.'],
    steps: ['After posting a PO or manual GRN, use Create labels in Procurement History or open Recent GRNs in the Physical Identity Desk.', 'Select accepted receipt lines and verify the product image, permanent code, exact lot, location, accepted quantity and pieces per pack.', 'Confirm the number of physical packs or items that need unique labels. The suggestion is derived from accepted pieces and pack size but remains an explicit operator decision.', 'For a shelf, existing lot, carton or showroom asset, use Other subjects and search the authoritative Product Master, lot or Display Asset register.', 'Open Print & reprint, select the exact unique labels, physical paper/template and reason. A preview creates an audited prepared run but does not mark anything printed.', 'In the isolated print screen, confirm only after the printer produces the labels. Cancel or failed leaves print counts unchanged.', 'In Scan & verify, tap Scan with camera on mobile or use a handheld scanner/manual code. Camera access starts only after the tap and stops after a successful read.', 'Review the exact product, lot, batch, location or display identity. For a tile, the side panel offers only active Product Master variants with the same governed design; filter by size, finish or code and select one or several.', 'Choose Quick quote or Add to intent. The selected Product Master IDs preload together; customer, room, quantity and pricing checks are still required.', 'Void a damaged or superseded physical label with a reason; create a new print run for every reprint.'],
    checks: ['Creating or printing labels never posts stock; only a GRN, opening session or governed movement changes inventory.', 'Every QR encodes MP-LABEL:<unique label code>; the MP centre mark is branding and the human-readable code remains the fallback.', 'Reprints retain the same physical identity and add print audit history.', 'A display label identifies a non-sellable showroom asset and must never be treated as available stock.', 'Vendor-provided displays create no stock movement; displays issued from a received lot post an audited lot issue and can return only to that original lot.'],
    related: ['procurement-inward', 'dispatch-return', 'inventory-control'],
  },
  {
    id: 'display-assets', title: 'Move stock to showroom display', duration: '7 min', href: '/dashboard/inventory/display-assets', roles: ['Inventory', 'Owner'],
    summary: 'Create one non-sellable display identity from an exact received lot, or register a genuine free vendor sample without changing stock.',
    flow: ['GRN or vendor sample', 'Exact product and lot', 'Display code and zone', 'Audited issue / register', 'QR label and lifecycle'],
    examples: ['Training example A: from Procurement History choose Move to display for the exact Calacatta Ivory GRN line. Confirm the product image, GRN, supplier, size, finish, batch, available quantity and location, then issue 1 piece to display code WALL-A-014 in zone Tile Gallery Bay A. Available stock reduces by 1 and the display remains linked to the original lot. Training example B: register a free vendor sample with its own display code and zone; no GRN, lot or stock quantity is created.'],
    steps: ['For anything purchased or intended as saleable stock, post the PO/manual GRN first so the physical receipt has a governed lot.', 'From Procurement History use Move to display on the exact accepted line, or open Display Assets and choose From inventory.', 'Search the Product Master item, then search and select a recognisable receipt card showing GRN, supplier, item, design, size, finish, date, lot, batch, challan, location and available quantity.', 'Enter the quantity, unique display code, showroom location and one clear Zone value. Position is not a separate field.', 'Saving posts one display_issue out of that exact lot, creates the non-sellable display asset and prepares its QR label job.', 'Use Vendor sample only for a free/non-stock physical sample. This registers the asset but creates no GRN and no stock movement.', 'Print the display QR from Labels & Scan and attach it to the matching physical sample.', 'Use Inspect and Maintenance for routine lifecycle updates. Remove with a reason; a stock-issued display can return only its complete issued quantity to the original lot.'],
    checks: ['Purchased goods never bypass GRN.', 'A display is always non-sellable and excluded from available stock.', 'Every stock-issued display retains product, source lot, location, quantity, actor and ledger posting.', 'A vendor sample never increases stock.', 'Every lifecycle change and reprint retains audit history.'],
    related: ['procurement-inward', 'labels-lots', 'inventory-control'],
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
  ['/dashboard/leads/new', 'showroom-scan-intent'], ['/dashboard/intents', 'showroom-scan-intent'], ['/dashboard/leads', 'crm-quote'],
  ['/dashboard/procurement', 'procurement-inward'], ['/dashboard/pending-inward', 'procurement-inward'], ['/dashboard/inventory/inwards', 'procurement-inward'],
  ['/dashboard/inventory/display-assets', 'display-assets'], ['/dashboard/inventory/labels', 'labels-lots'], ['/dashboard/dispatch', 'dispatch-return'], ['/dashboard/returns', 'dispatch-return'],
  ['/dashboard/payments', 'payments-documents'], ['/dashboard/documents', 'file-vault'],
  ['/dashboard/inventory', 'inventory-control'], ['/dashboard/reports/setup', 'reporting-readiness'], ['/dashboard/reports', 'reports-audit'], ['/dashboard/audit', 'reports-audit'], ['/dashboard/approvals', 'reports-audit'],
  ['/dashboard/profile', 'account-security'], ['/dashboard/users', 'users-settings'], ['/dashboard/settings', 'users-settings'],
];

export function guideForRoute(pathname: string) {
  const match = HELP_ROUTE_MAP.find(([route]) => pathname === route || pathname.startsWith(`${route}/`));
  return match?.[1] || 'crm-quote';
}
