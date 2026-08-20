# Marble Park procurement, tile and label design QA

Date: 2026-08-20

## Visual target and evidence

- Approved procurement reference: `procurement-reference-desktop.png`
- Final desktop candidate: `procurement-candidate-desktop-final.jpg` (1200 × 985)
- Final mobile candidate: `procurement-candidate-mobile-final.jpg` (390 × 844)
- Reference and candidate were inspected together at the same desktop state before acceptance.
- These screenshots are local release evidence and are intentionally excluded from Git because they contain cloned operating data.

## Procurement workspace

- **Hierarchy and palette — pass.** The primary route opens to a branded command overview rather than a form wall. The dark-to-brand-red hero, high-contrast actions, coloured active tab, restrained KPI tones, and serif display heading match the approved direction while retaining the existing Marble Park design tokens.
- **Source-backed overview — pass.** Actionable demand, POs in motion, valued purchase commitment, receipts, accepted units, supplier exceptions, expected receipts and priority queues come from the procurement summary API. Missing PO costs render as `Needs cost`; no substitute value is invented.
- **Progressive workflow — pass.** Overview, Demand, Purchase orders, Receiving and History are distinct tab states. Demand, PO and GRN registers expose server search, status filter, sort and pagination. PO/GRN search resolved an exact warehouse SKU through indexed line-item fields.
- **Receiving safety — pass after correction.** Selecting an open PO leaves every quantity blank and the post action disabled. Direct tile PO and manual tile GRN actions also remain disabled until every selected line has a positive base quantity.
- **Responsive layout — pass.** At 390 × 844 the hero, actions, stacked tabs and both receiving flows remain usable; measured document width equalled viewport width with no horizontal page overflow. Wide data tables retain their intentional local horizontal scroll container.
- **States and interaction — pass.** Loading, no-match and truthful incomplete-data states are present. Buttons, tab transitions, hover states and focusable controls remain visible and consistent.

## Tile master

- **Design registry — pass.** The page separates design-owned catalogue content and images from size-owned geometry and variant-owned immutable warehouse identity. Design search, status/sort controls, blank create form and server pager were verified.
- **Variant registry — pass.** Warehouse SKU, display code, aliases, governed size, finish, packing and loose-piece policy are visible. Supplier alias search resolved the exact warehouse SKU and excluded unrelated variants.
- **Tile Size Master — pass after correction.** Existing unambiguous size codes are deterministically backfilled to width, height and per-piece/per-box coverage with an audit event. Operator-entered geometry is preserved. No tested row remained `Not captured` for geometry or coverage.
- **Display assets — pass.** Registration clearly distinguishes non-stock vendor samples from exact source-lot issues. Status, condition, location/position, stock quantity, label linkage and the lifecycle audit trail are visible; removed samples remain in history.
- **Responsive layout — pass.** The design/variant/display navigation and create/register states fit a 390-pixel viewport with no page-level horizontal overflow.

## Labels and print

- **Shared subjects — pass.** Product/SKU, inventory lot and display subjects are available, along with shelf/product, carton, exact stock lot/pack and showroom-display purposes.
- **Register and reprint — pass.** Label jobs are searchable and paged; subset selection, physical template/version, copy count, reprint reason and safe void reason are available.
- **Isolated print — pass.** `/print/labels/[runId]` contains only print controls and the exact-size sheet—no dashboard navigation. The tested A4 template rendered a 70 × 37 mm label. `@page` uses physical dimensions and print media hides controls and removes chrome/shadow.
- **Audit semantics — pass.** Preparing or opening a run does not increment print counts. The user must explicitly confirm successful physical output; cancel/failed preserves the prior count and audit record.
- **Responsive layout — pass.** Create, scan and register sections fit a 390-pixel viewport without page-level horizontal overflow.

## Truthful data-readiness states

- The acceptance clone currently reports six tile designs without images. This is real master-data onboarding work, surfaced by the UI rather than a rendering placeholder.
- Five active production-clone POs lack captured commercial value and some supplier commitments are overdue. The overview exposes these as `Needs cost` and priority exceptions; they are operational data gaps, not fabricated KPIs.

Result: **pass for release gating**, subject to the repository build, migration, lifecycle, security and production smoke gates recorded separately.
