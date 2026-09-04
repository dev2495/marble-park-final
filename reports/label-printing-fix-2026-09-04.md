# Sticker printing update — 4 September 2026

## What changed

- Finish is printed immediately below the product code (tile design name for tiles).
- Brand is the governed Brand Master code only. No brand name, GRN/lot details, MRP/GST captions or tax language were added.
- The current version-4 template defaults to a real **4-inch wide × 2-inch high landscape page** (101.6 × 50.8 mm). A real 2 × 4-inch portrait page remains selectable.
- Orientation is saved with the print run, not inferred from the printer dialog. Previous template versions and print history are preserved.
- Multiple labels from different batches can share one tray and one print run. Copies are actual pages, not a request for the printer driver to repeat one page.
- Copies must be whole numbers from 1 to 50; a run is limited to 500 unique labels and 1,000 physical pages.
- A single PDF download contains every sticker, with exactly one sticker per exact-size page. Downloading does not confirm printing or increment print counts.
- Changing orientation/copies creates a new audited run; an unconfirmed previous setup is cancelled without incrementing counts. Settled runs remain protected after reload.
- Bulk filters are applied before server pagination. Successful batches remain in the tray if a later batch fails, avoiding duplicate retries.
- Long text is fitted rather than silently clipped. Values that cannot remain legible are blocked with a corrective message. Missing finish is explicitly “NOT SET”, never fabricated.

## Operator workflow

1. Open **Inventory → Labels & Scan → Print & reprint**.
2. Search/filter, add batches or individual labels to the tray. Selection survives searching and pagination.
3. Select **Landscape 4 × 2 in** for a roll that is four inches across and feeds two inches per sticker.
4. Set **Copies of every selected sticker**. The displayed page count is the physical sticker count.
5. Prepare the run; use **Download sticker PDF** for a fixed-page-size print file, or the browser print button.
6. Printer settings: custom paper **101.6 mm wide × 50.8 mm high**, **100% / Actual size**, all pages, one page per sheet, no headers/margins, printer copies **1** (extra copies are already in the file).
7. Check the first physical sticker and scan its QR. Confirm printed only after all stickers complete. Cancel/failed if nothing printed or output is incomplete.

If the label crosses a physical gap, stop printing and correct the driver paper dimensions and gap calibration. Choosing “landscape” alone cannot correct an incorrectly configured roll. Do not reuse an old downloaded PDF expecting its layout to change; create/download a version-4 run.

## Verified evidence

| Check | Result |
| --- | --- |
| API production build | Passed |
| Web production build, type and lint checks | Passed; includes authenticated label-PDF route |
| Isolated database end-to-end test | Passed: multi-job selection, copies, orientation persistence/guards, finish, filters, QR resolution, confirmation/cancellation audit |
| Stock invariant during label operations | On hand 4, available 4, reserved 0, unchanged |
| Branded QR regression | 3 payloads, 12 successful decode checks |
| PDF layout verification | 6 pages in each orientation; every page exactly 288 × 144 or 144 × 288 points |
| PDF rendered QR verification | 4 successful scans from rendered normal/long-product pages |
| PDF content | Finish present on every page; unwanted brand names, GRN/lot and tax text absent; duplicate copies preserved |
| Browser acceptance on isolated real API/database | 3 labels across 2 jobs produced 6 landscape pages; fractional copies blocked; PDF downloaded; reconfiguration produced 9 portrait pages; cancelled old run remained disabled after reload |
| Independent final code review | No remaining concrete release blockers |

The PDF layout/decode test requires Poppler (`pdfinfo`, `pdftotext`, `pdftoppm`) on the verification host. This is not a production runtime dependency. Artifacts from the successful run are under `tmp/pdfs/label-v4-verification/` and are not committed.

## Boundaries

No commercial pricing, inventory quantity or procurement business logic changed. Acceptance writes were confined to a disposable local database. Production deployment requires the fresh backup/restore and service-health checks described in the release handover.

Physical printer acceptance remains unverified remotely. The in-app test browser cannot open its native print dialog; PDF generation/download and page geometry were verified separately. The actual printer model/driver settings were requested from the user. Software tests cannot guarantee correct paper feed or gap sensing on an uninspected device.

During verification, 823 MB of rebuildable local Webpack cache was removed to resolve disk exhaustion. No local application data, credentials or unrelated user files were removed.
