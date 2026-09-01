import bcrypt from 'bcrypt';
import ExcelJS from 'exceljs';
import { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';

if (process.env.ALLOW_MUTATING_ACCEPTANCE !== 'true') {
  throw new Error('Refusing to mutate data. Run only against an isolated acceptance database with ALLOW_MUTATING_ACCEPTANCE=true.');
}

const API = process.env.API_URL || 'http://127.0.0.1:4100/graphql';
const prisma = new PrismaClient();
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function gql(query, variables = {}, token, expectError = false) {
  const response = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const json = await response.json();
  const error = json.errors?.map((row) => row.message).join('; ') || '';
  if (expectError) return error;
  if (!response.ok || error) throw new Error(error || `GraphQL request failed (${response.status})`);
  return json.data;
}

async function main() {
  const suffix = Date.now().toString(36).toUpperCase();
  const email = `release-gate-${suffix.toLowerCase()}@example.invalid`;
  const password = `Gate-${suffix}-Strong!42`;
  await prisma.user.create({ data: {
    id: ulid(), name: 'Release Gate Owner', email, passwordHash: await bcrypt.hash(password, 12),
    role: 'owner', phone: '', active: true, permissionOverrides: {}, passwordChangedAt: new Date(),
  } });
  const token = (await gql('mutation($input: LoginInput!) { login(input: $input) { token } }', { input: { email, password } })).login.token;
  assert(token, 'Acceptance owner must authenticate');

  const sizes = (await gql('query { tileSizes(status:"active") }', {}, token)).tileSizes;
  assert(sizes.length > 1, 'At least two active governed Tile Sizes are required for same-design selection acceptance');
  const governedMasters = await gql('query { masterProductBrands(status:"active") masterProductFinishes(status:"active") }', {}, token);
  assert(governedMasters.masterProductBrands.length && governedMasters.masterProductFinishes.length, 'Active Brand and Finish masters are required');
  const governedBrand = governedMasters.masterProductBrands[0].name;
  const governedFinish = governedMasters.masterProductFinishes[0].name;
  const size = sizes.find((row) => Number(row.pcsPerBox || 0) >= 2) || sizes[0];
  const piecesPerPack = Math.max(2, Number(size.pcsPerBox || 2));
  const design = (await gql('mutation($input: TileDesignInput!) { saveTileDesign(input:$input) }', { input: {
    designCode: `GATE-${suffix}`, name: `Acceptance marble ${suffix}`, brand: governedBrand, status: 'active',
  } }, token)).saveTileDesign;
  const variant = (await gql('mutation($input: TileVariantInput!) { saveTileVariant(input:$input) { id sku internalCode tileDesignId tileSizeId piecesPerPack purchaseUom allowLoose } }', { input: {
    tileDesignId: design.id, tileSizeId: size.id, sku: `WH-${suffix}`, internalCode: `SHOW-${suffix}`, finish: governedFinish,
    piecesPerPack, purchaseUom: 'BOX', salesUom: 'BOX', allowLoose: true,
    defaultMrpInclusive: 200, defaultNrpInclusive: 190, floorPriceInclusive: 180,
    priceRateBasis: 'AREA', priceUom: 'SQFT', mrpSource: 'MANUAL', pricingEffectiveFrom: new Date().toISOString(),
  } }, token)).saveTileVariant;
  assert(variant.sku === `WH-${suffix}` && variant.tileDesignId === design.id && variant.tileSizeId === size.id, 'Variant must retain immutable warehouse SKU, design and governed size');
  const duplicateError = await gql('mutation($input: TileVariantInput!) { saveTileVariant(input:$input) { id } }', { input: { tileDesignId: design.id, tileSizeId: size.id, finish: governedFinish } }, token, true);
  assert(/already exists/i.test(duplicateError), 'Duplicate design × size × finish variants must be blocked');
  const updatedVariant = (await gql('mutation($input: TileVariantInput!) { saveTileVariant(input:$input) { id sku } }', { input: { id: variant.id, tileDesignId: design.id, tileSizeId: size.id, sku: `CHANGED-${suffix}`, finish: governedFinish, piecesPerPack } }, token)).saveTileVariant;
  assert(updatedVariant.sku === variant.sku, 'Warehouse SKU must remain immutable on update');
  const siblingSize = sizes.find((row) => row.id !== size.id);
  const siblingVariant = (await gql('mutation($input: TileVariantInput!) { saveTileVariant(input:$input) { id sku internalCode tileDesignId tileSizeId } }', { input: {
    tileDesignId: design.id, tileSizeId: siblingSize.id, sku: `WH-${suffix}-ALT`, internalCode: `SHOW-${suffix}-ALT`, finish: governedFinish,
    piecesPerPack: Math.max(1, Number(siblingSize.pcsPerBox || 1)), purchaseUom: 'BOX', salesUom: 'BOX',
    defaultMrpInclusive: 210, defaultNrpInclusive: 195, floorPriceInclusive: 185,
    priceRateBasis: 'AREA', priceUom: 'SQFT', mrpSource: 'MANUAL', pricingEffectiveFrom: new Date().toISOString(),
  } }, token)).saveTileVariant;
  assert(siblingVariant.tileDesignId === design.id && siblingVariant.tileSizeId === siblingSize.id, 'A second active size must remain governed by the same Tile Design');
  await gql('mutation($input: ProductAliasInput!) { saveProductAlias(input:$input) }', { input: { productId: variant.id, type: 'supplier_sku', value: `SUP-${suffix}` } }, token);
  const aliasResults = (await gql('query($query:String!){globalSearch(query:$query){products}}', { query: `SUP-${suffix}` }, token)).globalSearch.products;
  assert(aliasResults.some((row) => row.id === variant.id), 'Supplier alias must resolve in shared search');

  const readiness = (await gql('query{productImportReadiness}', {}, token)).productImportReadiness;
  const tileCategory = readiness.options.categories.find((value) => value.toLowerCase() === 'tiles');
  assert(readiness.ready && tileCategory && readiness.options.brands.length && readiness.options.finishes.length && readiness.options.taxCodes.length && sizes.length > 1, 'Tile import needs active category, brand, finish, tax and at least two governed sizes');
  const liveDesignTemplate = (await gql('query{tileDesignImportTemplate}', {}, token)).tileDesignImportTemplate;
  const downloadedWorkbook = new ExcelJS.Workbook();
  await downloadedWorkbook.xlsx.load(Buffer.from(liveDesignTemplate.contentBase64, 'base64'));
  const downloadedDesignSheet = downloadedWorkbook.getWorksheet('Tile Designs');
  const downloadedBrandSheet = downloadedWorkbook.getWorksheet('Live Brand Master');
  assert(downloadedDesignSheet?.getCell('C2').dataValidation?.formulae?.[0] === 'TileDesignBrands' && downloadedBrandSheet?.actualRowCount === governedMasters.masterProductBrands.length + 1, 'Fresh design workbook must contain a live Brand Master dropdown and every current active brand');
  const designWorkbook = new ExcelJS.Workbook();
  const designSheet = designWorkbook.addWorksheet('Tile Designs');
  designSheet.addRow(['Permanent Design Code *', 'Design Name *', 'Brand *', 'Image URL (Optional)']);
  designSheet.addRow([`DX-${suffix}`, `Excel design ${suffix}`, governedBrand, '']);
  const designFilename = `tile-design-registry-${suffix}.xlsx`;
  const designContentBase64 = Buffer.from(await designWorkbook.xlsx.writeBuffer()).toString('base64');
  const designPreview = (await gql('mutation($filename:String!,$contentBase64:String!){previewTileDesignImport(filename:$filename,contentBase64:$contentBase64){result}}', { filename: designFilename, contentBase64: designContentBase64 }, token)).previewTileDesignImport.result;
  assert(designPreview.ready === 1 && designPreview.failed === 0 && designPreview.confirmationToken, 'Design-only Excel preview must validate live Brand Master without writing');
  const designApplied = (await gql('mutation($filename:String!,$contentBase64:String!,$confirmationToken:String!){applyTileDesignImport(filename:$filename,contentBase64:$contentBase64,confirmationToken:$confirmationToken){result}}', { filename: designFilename, contentBase64: designContentBase64, confirmationToken: designPreview.confirmationToken }, token)).applyTileDesignImport.result;
  assert(designApplied.applied === 1 && await prisma.tileDesign.findUnique({ where: { designCode: `DX-${suffix}` } }), 'Design-only Excel apply must create the governed design exactly once');
  const importDesignCode = `IMP-${suffix}`;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Product Master');
  sheet.addRow(['SKU','Internal Code','Product Name','Category','Brand','Finish','Material','Tile Size / Dimensions','Base UOM','Purchase UOM','Sales UOM','Pieces Per Pack','Coverage Per Pack','Default MRP Incl GST','Default NRP Incl GST','Floor Price Incl GST','Price Basis','Price UOM','MRP Source','Pricing Effective From','Tax Code','HSN Code','Allow Loose','Range / Series','Image URL','Product Image','Description','Tile Design Code','Tile Design Name']);
  for (const [index, importSize] of sizes.slice(0, 2).entries()) {
    sheet.addRow([`IMP-${suffix}-${index + 1}`,`IMPC-${suffix}-${index + 1}`,`Imported variant ${index + 1}`,tileCategory,readiness.options.brands[0],readiness.options.finishes[0],'',importSize.name,'PC','BOX','BOX',Math.max(1, Number(importSize.pcsPerBox || 1)),0,100,90,80,'AREA','SQFT','MANUAL',new Date().toISOString(),readiness.options.taxCodes[0],'','Yes','Acceptance','','','Clone-only governed tile import',importDesignCode,`Imported design ${suffix}`]);
  }
  const workbookBytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const filename = `tile-design-import-${suffix}.xlsx`;
  const uploadId = (await gql('mutation($filename:String!){beginImportUpload(filename:$filename){result}}', { filename }, token)).beginImportUpload.result.uploadId;
  await gql('mutation($uploadId:String!,$filename:String!,$contentBase64:String!){appendImportUpload(uploadId:$uploadId,filename:$filename,contentBase64:$contentBase64){id}}', { uploadId, filename, contentBase64: workbookBytes.toString('base64') }, token);
  const preview = (await gql('mutation($uploadId:String!,$filename:String!,$kind:String!){previewUploadedImport(uploadId:$uploadId,filename:$filename,kind:$kind){result}}', { uploadId, filename, kind: 'excel' }, token)).previewUploadedImport.result;
  assert(preview.ready === 2 && preview.failed === 0 && preview.previewRows.every((row) => row.designCode === importDesignCode), 'Tile import preview must govern the shared design before writing');
  const applied = (await gql('mutation($uploadId:String!,$filename:String!,$kind:String!,$confirmationToken:String!){applyUploadedImport(uploadId:$uploadId,filename:$filename,kind:$kind,confirmationToken:$confirmationToken){result}}', { uploadId, filename, kind: 'excel', confirmationToken: preview.confirmationToken }, token)).applyUploadedImport.result;
  const importedDesign = await prisma.tileDesign.findUnique({ where: { designCode: importDesignCode }, include: { variants: true } });
  assert(applied.created === 2 && importedDesign?.variants.length === 2 && importedDesign.variants.every((row) => row.tileDesignId === importedDesign.id), 'Tile import must create one design, link both variants, and keep their stock at zero');

  const location = (await gql('query { stockLocations(status:"active") }', {}, token)).stockLocations[0];
  assert(location?.id, 'An active stock location is required');
  const po = (await gql('mutation($input:CreatePurchaseOrderInput!){createPurchaseOrder(input:$input)}', { input: {
    vendorName: `Gate supplier ${suffix}`, notes: 'Clone-only procurement acceptance',
    discountPercent: 10, taxRate: 0,
    lines: JSON.stringify([{ productId: variant.id, boxes: 3, loosePieces: 0, piecesPerPack, enteredUnitCost: 480, rateUom: 'BOX', rateUomFactor: piecesPerPack }]),
  } }, token)).createPurchaseOrder;
  assert(Number(po.lines[0].orderedQuantity) === piecesPerPack * 3 && po.lines[0].metadata?.orderedInput?.boxes === 3, 'PO must convert tile boxes to base pieces and retain the input snapshot');
  const poPage = (await gql('query($search:String){purchaseOrderPage(search:$search,status:"all",sort:"newest",skip:0,take:1)}', { search: po.poNumber }, token)).purchaseOrderPage;
  assert(poPage.total === 1 && poPage.items[0].id === po.id, 'Purchase-order register must be searchable and server-paged');

  const poLine = po.lines[0];
  const receive = (boxes, key) => gql('mutation($input:ReceivePurchaseOrderInput!){receivePurchaseOrder(input:$input)}', { input: {
    purchaseOrderId: po.id, supplierChallan: `PO-${key}-${suffix}`, locationId: location.id, idempotencyKey: `PO-${key}-${suffix}`,
    lines: JSON.stringify([{ purchaseOrderLineId: poLine.id, boxes, loosePieces: 0, piecesPerPack, supplierBatch: `PO-${key}`, shade: 'S1', caliber: 'C1', grade: 'A' }]),
  } }, token);
  await receive(1, 'PART');
  let poRead = (await gql('query($id:ID!){purchaseOrder(id:$id)}', { id: po.id }, token)).purchaseOrder;
  assert(poRead.status === 'partial_received', 'First partial box receipt must keep PO open');
  await receive(2, 'FINAL');
  poRead = (await gql('query($id:ID!){purchaseOrder(id:$id)}', { id: po.id }, token)).purchaseOrder;
  assert(poRead.status === 'received', 'Final receipt must close the PO');

  const manual = (await gql('mutation($input:ManualGoodsReceiptInput!){createManualGoodsReceipt(input:$input)}', { input: {
    vendorName: `Gate supplier ${suffix}`, supplierChallan: `MAN-${suffix}`, reason: 'Clone-only manual inward acceptance',
    locationId: location.id, idempotencyKey: `MAN-${suffix}`,
    lines: JSON.stringify([{ productId: variant.id, boxes: 2, loosePieces: 1, piecesPerPack, enteredUnitCost: 500, rateUom: 'BOX', rateUomFactor: piecesPerPack, supplierBatch: `MAN-${suffix}`, shade: 'S2', caliber: 'C2', grade: 'A' }]),
  } }, token)).createManualGoodsReceipt;
  const grnPage = (await gql('query($search:String){goodsReceiptPage(search:$search,source:"manual",sort:"newest",skip:0,take:1)}', { search: `MAN-${suffix}` }, token)).goodsReceiptPage;
  assert(grnPage.total === 1 && grnPage.items[0].id === manual.id, 'Manual GRN history must be searchable and server-paged');
  const lot = await prisma.inventoryLot.findFirst({ where: { productId: variant.id, sourceId: manual.id }, include: { balances: true } });
  const manualQuantity = piecesPerPack * 2 + 1;
  assert(lot && Number(lot.balances[0].available) === manualQuantity, 'Manual tile inward must create an exact lot using boxes plus loose pieces');
  const recognisableLots = (await gql('query($productId:String,$search:String){inventoryLots(productId:$productId,status:"active",search:$search,take:10)}', { productId: variant.id, search: manual.grnNumber }, token)).inventoryLots;
  assert(recognisableLots.some((row) => row.id === lot.id && row.goodsReceiptLines?.[0]?.goodsReceiptNote?.vendorName === `Gate supplier ${suffix}`), 'Display lot picker must resolve GRN search with supplier and receipt provenance');

  const display = (await gql('mutation($input:DisplaySampleInput!){createDisplaySample(input:$input)}', { input: {
    productId: variant.id, internalCode: `WALL-${suffix}`, locationId: location.id, displayZone: 'Gate A1',
    sourceLotId: lot.id, issuedQuantity: 1, condition: 'good',
  } }, token)).createDisplaySample;
  let lotBalance = await prisma.inventoryLotBalance.findFirst({ where: { lotId: lot.id, locationId: location.id } });
  assert(Number(lotBalance.available) === manualQuantity - 1 && Number(lotBalance.onHand) === manualQuantity - 1, 'Display issue must post once against the selected lot');
  const displayPage = (await gql('query($search:String){displaySamplesPage(search:$search,status:"all",sort:"updated",skip:0,take:1)}', { search: `WALL-${suffix}` }, token)).displaySamplesPage;
  assert(displayPage.total === 1 && displayPage.items[0].sourceLotId === lot.id && displayPage.items[0].events[0].action === 'issue_to_display', 'Display register must expose stock provenance and lifecycle event');

  const labelJob = (await gql('mutation($input:InternalLabelJobInput!){createInternalLabelJob(input:$input)}', { input: { displaySampleId: display.id, quantity: 1, template: 'display_sample', newJob: true } }, token)).createInternalLabelJob;
  const printRun = (await gql('mutation($input:InternalLabelPrintRunInput!){prepareInternalLabelPrintRun(input:$input)}', { input: { labelJobId: labelJob.id, templateCode: 'thermal_4x2', labelIds: [labelJob.instances[0].id], copies: 1, reason: 'Clone display print acceptance' } }, token)).prepareInternalLabelPrintRun;
  const printData = (await gql('query($id:ID!){internalLabelPrintRun(id:$id)}', { id: printRun.id }, token)).internalLabelPrintRun;
  assert(printData.status === 'prepared' && printData.labels.length === 1 && printData.labels[0].qrValue.startsWith('MP-LABEL:'), 'Selected label print run must use isolated scanner-ready payload');
  const stockBeforeSelection = await prisma.inventoryBalance.findUnique({ where: { productId: variant.id } });
  const scanned = (await gql('mutation($code:String!){scanInternalLabel(labelCode:$code)}', { code: printData.labels[0].qrValue }, token)).scanInternalLabel;
  assert(scanned.result === 'success', 'Scanner must accept the actual rendered QR payload');
  assert(scanned.relatedSummary?.type === 'tile_design' && scanned.relatedProducts?.length === 2, 'A tile scan must return every active variant from only the same governed design');
  assert(scanned.relatedProducts.some((product) => product.id === variant.id && product.isScannedProduct) && scanned.relatedProducts.some((product) => product.id === siblingVariant.id), 'Scan response must distinguish the physical item and its selectable sibling size');
  const orderedProducts = (await gql('query($ids:[ID!]!){productsByIds(ids:$ids){id}}', { ids: [siblingVariant.id, variant.id] }, token)).productsByIds;
  assert(orderedProducts.map((product) => product.id).join(',') === `${siblingVariant.id},${variant.id}`, 'Bulk preload must preserve the user-selected Product Master order');
  const selectedScan = (await gql('mutation($code:String!,$input:InternalLabelScanInput){scanInternalLabel(labelCode:$code,input:$input)}', { code: printData.labels[0].qrValue, input: { action: 'acceptance_similar_select', entityType: 'QuoteDraft', metadata: { surface: 'acceptance', selectedProductIds: [variant.id, siblingVariant.id] } } }, token)).scanInternalLabel;
  assert(selectedScan.event.metadata.selectionCount === 2 && selectedScan.event.metadata.scannedProductId === variant.id, 'Multi-selection must be accepted and audit the exact anchor plus selected variants');
  const crossDesignError = await gql('mutation($code:String!,$input:InternalLabelScanInput){scanInternalLabel(labelCode:$code,input:$input)}', { code: printData.labels[0].qrValue, input: { action: 'acceptance_invalid_select', metadata: { selectedProductIds: [variant.id, importedDesign.variants[0].id] } } }, token, true);
  assert(/same tile design/i.test(crossDesignError), 'Cross-design scan selection must be rejected by the server');
  const stockAfterSelection = await prisma.inventoryBalance.findUnique({ where: { productId: variant.id } });
  assert(Number(stockAfterSelection.onHand) === Number(stockBeforeSelection.onHand) && Number(stockAfterSelection.available) === Number(stockBeforeSelection.available), 'Scan lookup and multi-selection must not reserve, issue or change inventory');
  await gql('mutation($id:ID!,$reason:String!){cancelInternalLabelPrintRun(id:$id,reason:$reason)}', { id: printRun.id, reason: 'Acceptance browser dialog cancelled' }, token);
  const cancelledInstance = await prisma.internalLabelInstance.findUnique({ where: { id: labelJob.instances[0].id } });
  assert(cancelledInstance.printCount === 0, 'Cancelled browser print must not mark the label printed');

  await gql('mutation($id:ID!,$input:DisplaySampleTransitionInput!){transitionDisplaySample(id:$id,input:$input)}', { id: display.id, input: { action: 'inspect', reason: 'Clone inspection acceptance', condition: 'good' } }, token);
  await gql('mutation($id:ID!,$input:DisplaySampleTransitionInput!){transitionDisplaySample(id:$id,input:$input)}', { id: display.id, input: { action: 'return_to_stock', reason: 'Clone return acceptance', condition: 'good', returnQuantity: 1 } }, token);
  lotBalance = await prisma.inventoryLotBalance.findFirst({ where: { lotId: lot.id, locationId: location.id } });
  const [returnedDisplay, displayEvents] = await Promise.all([
    prisma.displaySample.findUnique({ where: { id: display.id } }),
    prisma.displaySampleEvent.findMany({ where: { displaySampleId: display.id } }),
  ]);
  assert(Number(lotBalance.available) === manualQuantity && returnedDisplay.status === 'removed' && Number(returnedDisplay.issuedQuantity) === 0 && displayEvents.some((event) => event.action === 'return_to_stock'), 'Display return must restore the exact lot once and close the asset');
  const inactiveScan = (await gql('mutation($code:String!){scanInternalLabel(labelCode:$code)}', { code: printData.labels[0].qrValue }, token)).scanInternalLabel;
  assert(inactiveScan.result === 'inactive', 'A removed display must never scan as an active physical asset even when its historic label record is retained');

  const [aggregate, lots, reconciliation, designPage, variantPage] = await Promise.all([
    prisma.inventoryBalance.findUnique({ where: { productId: variant.id } }),
    prisma.inventoryLotBalance.aggregate({ where: { lot: { productId: variant.id } }, _sum: { onHand: true, available: true, reserved: true, damaged: true, hold: true } }),
    gql('query($productId:String){stockReconciliation(productId:$productId)}', { productId: variant.id }, token),
    gql('query($search:String){tileDesignsPage(search:$search,status:"active",sort:"code_asc",skip:0,take:1)}', { search: `GATE-${suffix}` }, token),
    gql('query($search:String){tileVariantsPage(search:$search,status:"active",sort:"sku_asc",skip:0,take:1)}', { search: `WH-${suffix}` }, token),
  ]);
  assert(Number(aggregate.onHand) === Number(lots._sum.onHand) && Number(aggregate.available) === Number(lots._sum.available), 'Aggregate inventory must equal the sum of lot balances');
  assert(reconciliation.stockReconciliation.summary.critical === 0, 'Stock reconciliation must report zero critical mismatches');
  assert(designPage.tileDesignsPage.total === 1 && variantPage.tileVariantsPage.total === 2, 'Tile design and both same-design variant rows must be searchable and server-paged');

  console.log(JSON.stringify({
    ok: true, designCode: design.designCode, warehouseSku: variant.sku, sizeCode: size.code, importedDesignVariants: importedDesign.variants.length,
    poNumber: po.poNumber, poStatus: poRead.status, poBasePieces: piecesPerPack * 3,
    manualGrn: manual.grnNumber, manualBasePieces: manualQuantity, displayCode: display.internalCode,
    displayIssueAndReturn: true, scannerPayload: true, similarDesignSelection: { returned: scanned.relatedProducts.length, selected: selectedScan.event.metadata.selectionCount, crossDesignBlocked: true }, removedDisplayScan: inactiveScan.result, cancelledPrintCount: cancelledInstance.printCount,
    stock: { onHand: aggregate.onHand, available: aggregate.available, lotOnHand: lots._sum.onHand, lotAvailable: lots._sum.available },
    criticalReconciliation: reconciliation.stockReconciliation.summary.critical,
  }, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
