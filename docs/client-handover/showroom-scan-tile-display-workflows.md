# Client handover: tile, inward, display and showroom scan

This handover covers the connected physical-identity workflows used by sales, inventory, office and owner roles. All names, codes and quantities below are illustrative training examples, not production records.

## One operating model

```text
Tile Design -> Size Master -> Variant / permanent warehouse SKU
                                      |
                                      v
                         PO or Manual GRN -> Exact lot
                                                   |
                         +-------------------------+------------------+
                         |                         |                  |
                         v                         v                  v
                  Saleable stock            Carton/lot label   Display issue
                                                                       |
                                                                       v
Customer -> Lead -> Scan showroom QR -> Intent row -> Quote -> Order / fulfilment
```

The design is reusable catalogue content. The size is controlled geometry. The Product-backed variant is the only inwardable, stockable and quoteable identity. A lot is the physical receipt. A display is a separate non-sellable asset. A label identifies one governed subject; scanning or printing never changes stock.

## Roles and ownership

- **Sales:** create leads/intents, scan showroom labels, verify selections, set room and requirement, prepare quotes.
- **Inventory / office:** maintain tile masters and variants, create POs/manual GRNs, receive exact lots, prepare labels, issue or return display stock.
- **Owner / administrator:** approve master-data policy, assign named roles, resolve exceptions and inspect audit/reconciliation.
- **Dispatch:** use active labels to verify physical identity; dispatch and returns continue through their dedicated governed workflows.

## Sales: scan directly into a new lead and intent

1. On the phone, open **Leads -> New lead**.
2. Select the customer and enter project/requirement, source and next action.
3. In **Product intent**, tap **Scan showroom item**, then **Scan with camera**.
4. Allow camera access for the Marble Park HTTPS site when prompted.
5. Hold the MP QR inside the frame. The camera stops after a successful read.
6. Verify the product image, permanent code, design, size, finish and displayed rate.
7. Set **Room / use** and quantity. For area-priced tiles, enter the required area and wastage; review the derived pack count.
8. Repeat for the customer's next selection.
9. Choose **Create lead + intent**.

### Worked sales example

The customer selects the training tile **Calacatta Ivory 1200 x 600** for the master bathroom. Scan its active display label, confirm the returned item, set Room / use to **Master bathroom wall**, enter the required area and wastage, then scan the selected basin. Creating the lead saves both Product Master items in the intent.

### Existing intent

Open an intent that is still editable, use **Scan showroom item**, verify the added row, then choose **Save draft** or **Save & submit**. The scan is not persistent until the intent is saved. Submitted, quoted or cancelled intents remain frozen for audit.

### Scan safeguards

- Any authenticated user may resolve an active label; normal lead/intent permissions still control sales actions.
- An inactive, void, removed, unknown or unlinked label adds nothing.
- A display QR adds its linked sellable Product Master variant, not the non-sellable display asset itself.
- Scanning does not reserve, issue, receive or increase stock.
- If the camera is blocked, use the handheld scanner or printed human-readable label code.

## Tiles: design, size and variant registry

Open **Master Data -> Tile Workspace**.

### 1. Design Registry

Create the design once with its human design code, name, brand, collection, material/type, surface/finish, colour, pattern, usage, description and images. The design record owns catalogue facts and imagery; it does not own stock.

### 2. Tile Size Master

Create or choose the governed geometry, such as **1200 x 600 mm**. Confirm dimensions, area/coverage and active status. Do not type a free-text size into each receipt.

### 3. Variant Registry

Combine design + size + finish into the Product-backed variant. Confirm pieces per box, inventory UOM, sales/pricing UOM, loose-piece policy, purchase/selling values and aliases. The generated warehouse/internal SKU is permanent. Supplier, old showroom, barcode and legacy codes belong in aliases.

### Worked tile example

Create training design **Calacatta Ivory** once with polished marble-look details and images. Select governed size **1200 x 600 mm**, then create the polished variant with **3 pieces per box**. Use the permanent warehouse SKU for inward, stock, label, intent, quote, order and dispatch.

## Inward: PO GRN and manual GRN

Open **Procurement** and use its dedicated tabs.

### Planned receipt

1. Create or open the PO and choose the exact Product/variant.
2. Record supplier, expected date, quantity, unit cost, discount, GST and pack facts.
3. In **Receiving**, choose the PO and type only what physically arrived. Receipt fields start blank.
4. Record supplier document, location, batch and tile shade/caliber/grade; separate damaged quantity.
5. Post the GRN. The system creates an exact lot and lot/location ledger entry.

### Receipt without a PO

Use **Manual GRN** only for a real delivery that genuinely has no PO. Select the same governed variant and capture supplier, source document, reason, quantity, cost, location and batch facts. It produces the same traceable lot lifecycle.

### Worked inward example

Receive **10 boxes**, **3 pieces per box**, plus **1 permitted loose piece** of the training variant. The GRN posts **31 base pieces** into one exact lot with its immutable pack snapshot. It does not create a second product or design.

After posting, use **History -> Create labels**. That handoff selects the accepted GRN lines and lots; it never reposts inventory.

## Labels and scan

Open **Inventory -> Labels & Scan**.

- **Recent GRNs:** create labels from recognisable posted receipts and exact accepted lines.
- **Other subjects:** create product/shelf, exact-lot/carton or registered-display labels.
- **Print & reprint:** select only the required unique labels and physical template. Opening preview does not mark them printed. Confirm only after paper is produced.
- **Scan & verify:** use camera, handheld scanner or printed code. Review the full Product Master, exact lot/location/batch or display identity.
- **Actions:** open Catalogue, move an eligible exact lot to display, add the linked product to intent, or preload Quick Quote.
- **Void/reprint:** retain the original audit trail and record the reason.

The stylised MP centre is branding. The QR remains a standards-valid encoded identifier, and the printed label code remains the recovery path.

## Display assets

Open **Inventory -> Display Assets**.

### From received stock

Choose **From inventory**, then the exact product, lot and location. Enter quantity, unique display code, showroom zone and position. Saving posts one audited issue from that lot and creates the non-sellable display asset and label job.

Training example: issue **1 piece** to display code **WALL-A-014**, zone **Tile Gallery**, position **Bay A**. Saleable available stock reduces by 1. A governed removal may return the complete issued quantity only to the original lot.

### Free vendor sample

Choose **Vendor sample** only when the physical display was provided free and is not company stock. Register its product link, display code, zone and position. This creates no PO, GRN, lot or stock quantity.

## Daily completion checks

- Every tile inward and commercial row references a Product-backed variant.
- Every purchased physical item enters through PO/manual GRN or approved opening stock.
- Every GRN has supplier/source document, exact lot, location and actor.
- Every display has a unique code, product, zone and position; stock-issued displays retain source lot and quantity.
- Every scanned sales row is verified and saved before leaving the page.
- Every reprint/void/removal has a reason and audit history.
- Inventory Reconciliation shows no critical aggregate-versus-lot mismatch.

## Troubleshooting

- **Camera blocked:** allow Camera for the Marble Park HTTPS site in Safari/Chrome settings. Close any other tab using the camera. Use the printed code meanwhile.
- **Scan finds nothing:** confirm the whole printed code was captured, the label is active, and its product/lot/display has not been voided or removed.
- **Scan added the wrong commercial item:** stop and inspect the label subject in Labels & Scan; do not edit Product Master merely to fit the physical label.
- **Tile cannot be inwarded:** create/activate the correct design, size and Product-backed variant first. Never create stock against Design Registry alone.
- **Display cannot be created:** confirm the selected lot belongs to that variant and has available quantity at the selected location; complete display code, zone and position.
- **GRN quantity is wrong:** do not edit balances. Use the governed procurement, return, stock count or approved adjustment workflow appropriate to the physical event.

## Support evidence

For support, record the time, page, user role, GRN/lot/display/label/lead/intent number and request ID shown by the app. Never send passwords, session cookies or database credentials.
