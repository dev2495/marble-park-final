# Tile Master and shared label platform

## Product decision

`TileSize` remains a small controlled reference list used only by products in the Tiles category. It is not a base product and never owns stock, price, orders or labels.

The existing `Product` record is the sellable and stockable variant. Its immutable `sku` is the warehouse identity. A tile Product combines the design identity used by the business with its size, finish/material, UOM and pack conversion. Human showroom, supplier and historical codes are searchable `ProductAlias` records and may change without rewriting document or stock history.

We deliberately did **not** add a separate `TileDesign` family table in this release. Current workflows and imports treat each design/size configuration as one quoteable SKU, and there is no verified requirement that one visual design must own several sellable size/finish variants. Adding an empty family layer would increase migration ambiguity for 3,000–5,000 records without improving stock control. If the source catalogue later proves that the same named visual design is sold in multiple sizes or finishes, add `TileDesign 1 → N Product` as a presentation family; Product must remain the stock/price/order identity.

## Guardrails

- Warehouse SKU is immutable after creation; archive a referenced SKU and create a successor rather than recycling it.
- Tile Size is selected from Tile Size Master. Generic products are not forced to carry tile size or box/coverage fields.
- Display, supplier, barcode and old codes are aliases. Active cross-product collisions are rejected and alias changes are audited.
- A showroom display is non-sellable and points to one Product. Its display code is registered as a searchable Product alias.
- Catalogue import creates zero stock, validates masters and code collisions, and applies all-or-nothing after a signed preview.
- Physical stock begins only through opening stock or GRN and is traced by lot and location.

## Label identity

Labels are shared infrastructure for Product, inventory lot and display subjects. Shelf and carton are label purposes, not tile-specific records. Every physical label has an immutable label code; void and reprint retain history. A prepared print run does not increment print counts. Counts change only after the operator explicitly confirms successful physical output on the isolated exact-size print page.

QR values use `MP-LABEL:<label-code>`. The scanner also accepts legacy JSON, lookup URLs and bare codes so existing labels remain usable.
