# Live user and admin quick-start

## Sign in and session safety

1. Open the production HTTPS address supplied by the administrator.
2. Sign in with your individual email and password. Do not share accounts.
3. Passwords must contain at least 12 characters. An administrator should issue a temporary password through the Users page and the user should change it from Profile.
4. Every session ends after exactly **15 minutes of true user inactivity**. A warning appears shortly before expiry. Mouse, keyboard, touch, form, or deliberate scrolling activity keeps an active session alive; background refreshes, reports polling, animations, and an untouched tab do not.
5. Activity and logout are synchronized across tabs. When one tab expires or signs out, the other tabs return safely to Sign in. Unsaved entries should be saved before leaving a workstation.

The normal sign-out button immediately revokes the server session. Changing your password revokes other browser/device sessions. An administrator password reset or account disable revokes all of that user's sessions.

If the page says **Invalid credentials**, replace any Safari AutoFill value and try the password you were actually issued. If the password is not known, stop retrying and ask an authorised administrator for a one-hour, one-time reset link. The reset page removes the token from the address bar and signs out all old sessions after the password changes.

## Roles

- **Owner / administrator:** full operational access, user and permission management, report setup, exports, audit, and configuration.
- **Sales manager:** sales leadership, approvals, receivables actions, sales/finance reporting, and documents.
- **Sales:** assigned sales workflow, documents, and sales reporting. Lead ownership restrictions still apply.
- **Inventory manager:** product/master data, imports, stock locations/counts, inventory, procurement/GRN, and inventory/procurement reporting.
- **Dispatch operations:** dispatch, returns, and fulfilment reporting.
- **Office staff:** procurement/GRN, fulfilment, and document workflows.

Owner/administrator can add or remove explicit permission overrides from **Users**. Overrides are exceptional; prefer the standard role unless the business owner approves a documented exception.

## Everyday source-of-truth workflow

- Create and maintain generic product facts in **Products**. For tiles, use **Tile Workspace**: Design owns catalogue facts and images, Size Master owns geometry/area, and Variant Registry creates the immutable Product-backed warehouse SKU used by every stock and commercial transaction.
- In **Procurement**, use Overview → Demand → Purchase Orders → Receiving → History. Overview counts come from the live demand, PO and GRN registers; purchase commitment value includes only POs with captured commercial value and explicitly shows when costs still need entry. PO and manual GRN forms clear after a successful post. Tile receipts accept boxes plus permitted loose pieces and store the pack conversion, batch, shade, caliber and grade on the created lot.
- Treat a showroom display as a separate asset. Issue from an exact lot only when saleable stock is physically consumed; inspections, maintenance, removal and return-to-lot require a reason and retain an event/audit trail.
- Record commercial progression through **Leads → Quotes → Orders → Dispatch / Invoice / Collection**. Do not infer invoice revenue from an order or quote.
- In **Quote Studio**, List rate is read-only from Product Master. Enter the tax-inclusive **MRP** amount, then the **NRP/base discount** as percent or rupees (percent is default), then the optional **special discount** as percent or rupees; special discount is applied to NRP. Apply an optional whole-quote discount only after all lines are present. The system proportionally allocates it so the Quote Register, PDF and Sales Order conversion reconcile to the same final value.
- Quote Studio shortcuts are **/** for product search, **Cmd/Ctrl+S** for draft, **Cmd/Ctrl+Enter** to validate, **Esc** to close a scan panel, and normal **Tab** order through the pricing fields. A validated quote requires a positive MRP and blocks discounts that exceed their applicable base.
- Receive stock through purchase/GRN or approved opening stock, and move it through the lot ledger. Never type a balance correction outside the stock count/adjustment workflow.
- The inventory control tower values stock from active lot quantity × that lot's governed unit cost. A **LOT COST MISSING** exception means quantity is usable but valuation is incomplete. An owner, administrator, or inventory manager may expand the lot and record a verified missing cost with the source document/reason; the change is audited and cannot overwrite an already-governed positive cost.
- Cancel or void with a reason. Do not delete commercial records to fix history.
- Use **Labels** for product, lot, display, shelf/carton, and supported physical subjects. Reprints and voids preserve their audit trail.
- Sales users can scan an active MP label directly while creating a lead or editing an intent. Verify the linked Product Master row, room/use and quantity, then save or submit the intent; scanning itself never moves or reserves stock. See the [tile, inward, display and showroom-scan handover](showroom-scan-tile-display-workflows.md) for worked examples.
- Use **Reports** through the five suites: Owner, Sales, Finance, Inventory, and Operations. Open a source row to confirm the underlying transaction.

## Reports and missing data

Every metric shows its definition, date basis, freshness, source coverage, and readiness. **Needs setup** is deliberate: follow its action link to Reports Setup or to the authoritative master/transaction. Only owner/administrator can maintain company targets. Accounting statements and supplier payables cannot be typed into a generic report form.

## Help and support

Use **Help** in the application for task-specific steps and reporting-readiness guidance. The complete printable guide is available from Help. For a recurring error, record the time, page, user role, record number, and request ID shown in the error; do not share passwords, session cookies, database dumps, or private document links in chat.
