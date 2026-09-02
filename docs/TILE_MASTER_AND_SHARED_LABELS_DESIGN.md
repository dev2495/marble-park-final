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

## Governed physical label standard

All new physical-label runs use `thermal_4x2` version 2: **2 x 4 inches in portrait (50.8 x 101.6 mm)**, one sticker per PDF/print page. The renderer reserves a 1.9 mm printer-safe outer margin, gives the QR a 40.8 mm square, and keeps the human label code outside the symbol as a manual fallback. The visible identity is intentionally code-only: governed Brand Master code, Product Master/display product code, optional exact lot/display code, and the direct governed rate with its UOM. It does not print brand name, product name, warehouse SKU, size, finish, source trace, or MRP/GST/tax wording. Tiles display the governed direct rate per SQFT.

Version 1 landscape, former A4, and smaller thermal templates are archived for new runs, not deleted. Historical print runs continue resolving their original template code and version for audit/review. Operators must print on 2 x 4 inch paper with portrait orientation, one page per sheet, 100%/Actual size, no margins and browser headers disabled. A scaled, clipped or unscannable output is a failed run and must not be confirmed.
