# Plan: quote PDF names, customer phone identity, quote naming, global search, "not asked" stock report

Date: 23 Nov 2026 · Branch: `notification-workspace` · Status: **for approval, nothing built yet**

## What stays exactly as it is

These are not touched by any phase below:

- Pricing, MRP, NRP, discounts, GST and owner price approval.
- How a quote is confirmed, revised, converted to an order or cancelled.
- Stock posting, reservations, dispatch, invoices and payments.
- Who can see what by default (roles and permissions).
- Every existing quote number. A PDF a customer already has keeps its number.

The two rule changes you asked for are called out where they happen:

- Phone becomes the customer identity.
- A same name in the same city no longer blocks a new customer.

---

## Phase 1: Quote PDF filename and the "Confirmed" label (small, low risk)

### 1a. PDF filename matches the system number

**Today:** every quote PDF downloads as `MarblePark_Quote_<internal id>.pdf`, for example `MarblePark_Quote_01M83QVGT….pdf`. The name comes from `apps/web/src/app/api/pdf/quote/[id]/route.tsx:13`. Shared links always download as `MarblePark_Quotation.pdf`.

The order, invoice, dispatch, PO, receipt and statement PDFs have the same problem.

**Change:**

- Each renderer script already loads the document and its number. It will also report that number to the route.
- The route names the file after the number, with `/` turned into `-` because filenames can't contain `/`:
  - `Captain-0069a` → `Captain-0069a.pdf`
  - `QT/2026/0063b` → `QT-2026-0063b.pdf`
  - `SO/2026/0012` → `SO-2026-0012.pdf`
- If the number can't be read, it falls back to today's name, so a PDF never fails because of naming.
- Applies to all PDF routes, including the shared quote link.
- Pricing checks and blocking are unchanged.

### 1b. "Confirmed" at the top of a quote on mobile

**Today:** the green "Confirmed" pill does **not** mean the customer confirmed. It means the quote's prices are locked and its PDF is unlocked; this is the workspace's own mode.

On a phone, the header card takes the whole first screen before any item is visible. It shows the number, the pill, customer, architect, type, PDF, Share and Convert to order. Share and Convert to order also appear again in the sticky bottom bar.

**Change:**

- Rename the pill to say what it means. **Decision 1.**
- On phones only:
  - keep the number, pill and customer on one compact row;
  - move PDF into the bottom bar next to Share and Convert to order;
  - stop repeating Share and Convert to order in the header.
- Desktop layout is unchanged.

---

## Phase 2: Customer phone identity, similar names, quote naming

### What we found

- Nothing stops two customers having the same phone. There is one `mobile` column with no unique rule (`schema.prisma:79`).
- The phone is saved three different ways:
  - quick add and walk-ins save 10 digits;
  - the Customers page saves whatever was typed, such as `+91 98250 12345`.
- Lookups use "contains". A number saved with spaces is therefore missed and a duplicate gets created.
- There are three separate phone-cleaning functions, in customers, walk-ins and follow-ups.
- **Quick add** already reuses a customer when the number matches. It only says so after the fact, and only for clean 10-digit numbers.
- **Customers page** blocks a new customer whose name and city match someone, even with a different phone. Two different Ramesh Patels in Vapi can't both be added.
- **Walk-in → quote** silently creates a customer without the duplicate check.
- **Follow-up completion** can change a mobile to one another customer already has.
- **New lead** picker shows only the first 50 customers, as name · city, with no phone.

### 2a. Phone is the identity

- Use one shared phone cleaner everywhere: keep the last 10 digits, so `+91`, spaces, dashes and a leading 0 are all handled.
- Every create and edit path saves the clean 10 digits: Customers page, quick add, walk-in, follow-up and API.
- Lookups compare the clean number exactly. "Contains" is no longer used for phone matching.
- **Existing data:** a one-time cleanup script cleans the saved numbers.
  - It runs as a dry run first and lists anything it can't clean, such as 8-digit landlines or blanks.
  - It also lists customers who already share a number.
  - Nothing is merged or deleted automatically.
  - It runs on production only after a database backup.
- A database-level unique rule is added only once that list is empty. Until then, the app enforces it.

### 2b. "Customer already present" while typing

- Quick add (quote workspace), Customers page, walk-in check-in and the follow-up edit all behave the same way.
- As soon as 10 digits are typed, the app looks the number up straight away and shows:

  > **Already a customer:** Amita Khairo · Vapi · ••5678 · 2 open quotes
  > [Use this customer]

- "Add" is blocked for that number. One tap uses the existing customer.
- Owner and admin keep the existing `customers.force_create` override, for a family sharing a number. The override asks for a reason, which is written to the audit log.
- GST and email duplicates keep blocking as today.

### 2c. Similar names and surnames

- A **name match alone no longer blocks**. It shows a soft warning: "2 other customers named Ramesh Patel (Vapi ••3210, Surat ••8890). Check the number."
- Everywhere a customer is listed or picked, it shows **name · mobile · city**. This covers quote picker, new lead, orders, payments and search results.
- The new-lead customer list becomes searchable, replacing the fixed list of the first 50.

### 2d. Heads-up when the customer already has a quote

- When a customer is picked on a **new** quote, the app checks for their open quotes.
- Open means not cancelled, closed, lost, expired or replaced.
- It shows a non-blocking notice:

  > Amita Khairo already has **Amita-0058** (draft, ₹32,400, 3 days ago). [Open it] or carry on with a new quote.

- Nothing is blocked. Sales can still make a second quote.

### 2e. Quote names that never confuse

**Today:**

- New quotes are named `<customer first name>-<serial>`, for example `Captain-0069`. Revisions add `a`, `b`, …
- Names can't actually repeat: the database requires a unique name and the serial comes from one counter.

There are still two problems:

1. **The serial restarts at 0001 every January.**
   - In 2027 the next Ramesh quote will try `Ramesh-0001`, which already exists from 2026. The save clashes and retries with the next serial.
   - Five clashes in a row would fail the save.
   - The guard that re-syncs the counter only understands the old `QT/2026/…` format.
   - **Decision 2.**
2. **Same first name, different person.** `Ramesh-0070` and `Ramesh-0071` can be two different Rameshes.
   - Fix: wherever a quote is shown, show **number · customer full name · ••last 4 of mobile**. This covers the quote register, search, order screens and notifications.

The counter guard will also understand both formats, so it can always re-sync. Existing quote numbers do not change.

---

## Phase 3: New report, "In stock, not asked for"

### What "dead stock" means

**Dead stock** is stock sitting in the warehouse that isn't selling. It blocks money and space.

The system already has a **Dead stock** report under Reports. It lists items that have **not gone out of the warehouse for 90+ days**, measured by dispatch and stock out, not sales talk. It also shows recent quotes and scans as side columns, with a Promote / Watch / Display piece suggestion.

### What the new report adds

You asked a different question: **stock we hold that no customer has asked about in N days.** "Asked" counts any of:

- the item was put on a quote (including drafts, since the customer asked);
- it was on an intent;
- it was ordered;
- a walk-in customer scanned it in the showroom.

Website views are left out: they aren't tied to a customer and have no dated history.

| Column | Notes |
|---|---|
| Item, brand, category, size | |
| On hand, available | Boxes or pieces, from lot stock |
| Value at cost | Shown only to people already allowed to see cost |
| Value at MRP | |
| Last asked | Date and how, e.g. "quote Amita-0058". "Never" if not asked since data starts. |
| Days not asked | |
| Last received, days in stock | So stock that just arrived isn't wrongly flagged |
| Last went out | |
| Display piece? | |
| Suggestion | Promote / Put on display / Offer to architects / Watch |

- **Filters:** "Not asked in" 30 / 60 / 90 / 180 days, or a custom number. Also brand, category and location.
- **KPIs:** item count, total value tied up, share of all stock value.
- **Export:** Excel and CSV through the existing report export.
- **Access:** the same people who can open the Dead stock report today.
- **Note on history:** the system's report history starts 1 Nov 2026. If N reaches back before that, the report says so, so "never asked" isn't misread.

No stock, pricing or order data is changed. The report only reads.

---

## Phase 4: Global search, everything findable

### What we found

- The header search only searches products, leads (by title) and quotes (by number or title).
- **Only products are shown.** Lead and quote results are fetched but never displayed, so searching a quote number says "No matches".
- Clicking a product goes to `/dashboard/products?sku=…`, which that page ignores, so you land on the full catalogue.
- **Permission gap:** global search ignores the rule that sales staff see only their own quotes and leads. It also returns whole quote rows (lines, approvals, notes) to anyone logged in.
- There's no debounce, so it searches on every keystroke. There's no keyboard support, no loading state and no proper mobile view.
- It doesn't search:
  - customers (name, phone, GST), architects, vendors and users;
  - sales orders, challans, vehicle numbers and invoices;
  - payment receipts and UTR/cheque references;
  - POs, GRNs and supplier bills;
  - display samples, lots, transfers, returns and credit notes;
  - documents and walk-ins;
  - tile design, collection and size.
- Number formats break it. `QT-2026-0063` doesn't find `QT/2026/0063`, `63` doesn't reliably find `0063`, and `+91 98250 12345` doesn't find `9825012345`.
- Word order breaks it: `ram patel` doesn't find "Patel Ram", and `kajaria 60x60 matt` finds nothing.
- Some fields need database speed-up indexes or search will slow down as data grows.

### Change

**Backend: one search service, grouped results.**

- Each group is shown only to people allowed to open that page. Sales see only their own quotes and leads, exactly as on the quote and lead pages.
- Groups:
  - Customers
  - Quotes
  - Sales orders
  - Leads and intents
  - Products and tiles (designs, sizes, collections)
  - Dispatch
  - Invoices and payments
  - Purchase: PO, GRN and vendors
  - Architects
  - Stock: lots, display samples, transfers and returns
  - Documents
  - Users (admin only)
- Matching rules:
  - **Words in any order:** each word must match some field.
  - **Document numbers ignore `/`, `-` and spaces**, and `63` also matches `0063`.
  - **Phones are matched on the clean 10 digits.**
  - **Exact hits come first.** An exact SKU, document number or phone ranks above partial matches.
- Results return only what the list needs: number, name, status, amount and link. Full records are not sent.
- Up to 5 per group, plus "See all in Quotes →", which opens that page already filtered.
- New database indexes for every searched field, so search stays fast as data grows. Each is checked with EXPLAIN on a copy of real data.
- The product search used inside quotes, orders, intents and procurement keeps working. Those screens get a products-only query, so they stop paying for unused results. The quote workspace's tile vs CP filter stays.

**Frontend:**

- The dropdown shows every group.
- Waits 250 ms after typing before searching.
- Shows "Searching…" while loading.
- Keyboard: ↑ ↓ Enter Esc, and Ctrl/⌘ K opens search from anywhere.
- On phones, a full-screen search sheet.
- Every result opens the exact record. Pages that can't open a record from a link today will be taught to: customers, vendors, architects, users, walk-ins, documents, follow-ups, returns, transfers and inwards.
- Fixes the broken product link and the broken follow-up link.

---

## How we make sure nothing breaks

1. **Automated tests:**
   - the phone cleaner;
   - the duplicate-phone block and the override;
   - name-only warning, not a block;
   - quote numbering across New Year (31 Dec → 1 Jan), with both old and new name formats;
   - PDF filename for every document type;
   - search permission scoping: a sales user can't find another salesperson's quote;
   - search number and phone formats;
   - the new report's maths on seeded data.
2. **Existing checks:** the full type check and every existing test must still pass.
3. **Browser walkthrough on local, at phone and desktop sizes:**
   - quick add with an existing number;
   - new quote for a customer with an open quote;
   - confirm, then download the PDF and check its filename;
   - revise and convert to order, to prove those flows are unchanged;
   - global search for each entity type, as admin, as sales and as dispatch;
   - open the new report and export it.
4. **Production data:**
   - back up the database first;
   - run the phone cleanup as a dry run and share the list with you;
   - apply only after you OK it.
5. **Ship order:** Phase 1 → 2 → 3 → 4, each its own commit, deployed and checked before the next.

## Not in this plan (possible later work)

- Merging duplicate customers that already exist. This plan lists them; merging would move their quotes, orders and payments.
- Typo-tolerant search ("kajria" → "Kajaria").

## Decisions (answered 23 Nov 2026)

1. **"Confirmed" pill** → renamed **"Ready to send"**. Only the label changes; the mode and its rules don't.
2. **Quote serial** → **add the year**.
   - Quotes created from 1 Jan 2027 are named `<first name>-<YY>-<serial>`, for example `Ramesh-27-0001`.
   - The serial restarts each year, but the year in the name means it can never repeat.
   - Revisions still add `a`, `b`, … (`Ramesh-27-0001a`).
   - 2026 quotes keep their current names.
3. **PDF filename** → **number only**: `Captain-0069a.pdf`, `QT-2026-0063b.pdf`, `Ramesh-27-0001.pdf`.
4. **New report default** → **not asked in 30 days**. 60, 90, 180 and custom stay selectable.
