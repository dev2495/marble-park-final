# Marble Park Go-Live Testing Patch Report

Date: 2026-05-01
Workspace: `/Users/devarshthakkar/local_repos/Marble Park final`

## Added in this patch

### Catalogue and product images

- Product cards now support a full-size gallery modal.
- Product media uses `media.primary` plus `media.gallery`, so multiple images per product are supported.
- Catalogue review approval maps approved images into product media and preserves gallery images.

### Owner approval desk

- Existing quote approvals page is now the unified owner approval desk:
  - Quote approvals
  - Import batch approvals
  - Catalogue image mapping approvals
- Navigation now includes `Approvals` for owner/admin/sales manager.
- Quote list now blocks send/confirm actions until owner approval is completed.

### Quote approval and availability flow

- Every new quote now starts as:
  - `status: pending_approval`
  - `approvalStatus: pending`
- Quotes can still be generated even when items are not in inventory.
- Quote approval payload records availability shortages under `approval.availabilityIssues`.
- Confirmation is blocked before owner approval.
- After approval, quote can be sent/confirmed and dispatch job is created.

### Import approval flow

- PDF and Excel imports stage rows first.
- Import batches can be submitted for owner approval.
- Import batches must be owner-approved before `applyImportBatch` can create/update product master rows.
- This applies to both PDF and Excel imports.

### Catalogue image approval flow

- PDF image extraction creates `CatalogReviewTask` rows.
- Master Data page can submit image mapping for owner approval.
- Owner approval desk can approve image mappings.
- Approved image mapping updates product `media.primary` and `media.gallery`.

### Partial dispatch

- Dispatch challans now accept a line payload.
- Dispatch page can create partial challans per quote line with `dispatchQty`.
- Inventory consumption uses `dispatchQty` first, then falls back to line quantity.
- Multiple challans can exist for one dispatch job.

## Verified commands

```bash
npm run build:api
npm run build:web
node scripts/regression-smoke.mjs
node scripts/e2e-retail-flow-smoke.mjs
node /tmp/approval-flow-smoke.mjs
node /tmp/excel-approval-apply-smoke.cjs
```

## Verification evidence

### RBAC regression

Result:

```text
regression smoke passed
```

### Full retail E2E with owner quote approval gate

Result:

```json
{
  "ok": true,
  "sku": "E2E-HR-MOMO47OF",
  "quoteNumber": "QT/2026/0010",
  "challanNumber": "CH/MOMO47R0"
}
```

### Approval flow smoke

Covered:

- Out-of-stock quote creation allowed.
- Owner approval required.
- Confirm blocked before approval.
- Approval stores availability issue.
- Confirmation creates dispatch job.
- Partial challan created with `dispatchQty: 1`.
- Excel import submitted and approved.
- Catalogue image task submitted and owner-approved.

Result:

```json
{
  "ok": true,
  "quote": {
    "id": "01KQHBFBNE5YW25VAQGXDP8BRH",
    "quoteNumber": "QT/2026/0011",
    "availabilityIssues": 1
  },
  "partialChallan": "CH/MOMO4WQS",
  "excel": {
    "batch": "01KQHBFBVWD3TFZDBXEA7BF00R",
    "applied": 0,
    "failed": 0
  },
  "catalogApproval": "approved"
}
```

The supplied sample Excel had no pending applicable rows to apply, so a controlled one-row Excel file was also tested.

### Controlled Excel approval and apply

Result:

```json
{
  "ok": true,
  "path": "/tmp/marble-approval-momo5o93.xlsx",
  "batch": "01KQHBGEJP8V5F79VHVEJ6JZV3",
  "applied": {
    "importBatchId": "01KQHBGEJP8V5F79VHVEJ6JZV3",
    "applied": 1,
    "failed": 0
  }
}
```

### Product/media API proof

Result:

```json
{
  "total": 7179,
  "mediaReadyInSample": 5,
  "sampleSku": "HIN-20076",
  "displayQuality": "4k-source",
  "galleryCount": 1
}
```

### Browser checks

- `/dashboard/quotes/approvals` loaded with no console errors.
- Approval desk hero and empty-state rendered correctly after query settlement.
- `/dashboard/products` loaded with no console errors.
- Current in-app browser session showed fallback catalogue data because of its existing auth/cache state; live API returned the full product catalogue and media-ready records.

## Runtime after patch

- API: `http://localhost:4000`
- Web: `http://localhost:3001`

## Remaining before Tinypod client testing

- Replace `/tmp` upload storage with durable object/file storage for Tinypod.
- Add a user-friendly product picker for catalogue image mapping instead of entering raw product ID.
- Add clearer dispatch job completion status when all partial lines are fully delivered.
