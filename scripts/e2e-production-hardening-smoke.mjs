const API = process.env.API_URL || 'http://localhost:4000/graphql';

async function gql(query, variables = {}, token) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map((error) => error.message).join('; '));
  return json.data;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function unique(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

async function main() {
  const login = await gql(
    `mutation($input: LoginInput!) { login(input: $input) { token user { id email role } } }`,
    { input: { email: 'admin@marblepark.com', password: 'password123' } },
  );
  const token = login.login.token;
  const sku = unique('PROD-HARDEN');

  const product = (await gql(
    `mutation($input: CreateProductInput!) {
      createProduct(input: $input) { id sku name sellPrice category brand finish unit }
    }`,
    {
      input: {
        sku,
        name: 'Production Hardening Test Basin Mixer',
        category: 'Faucets & Showers',
        brand: 'Marble Park Select',
        finish: 'Chrome',
        dimensions: 'Smoke 180 mm',
        unit: 'PC',
        sellPrice: 8400,
        floorPrice: 7100,
        description: 'Created by production-hardening smoke.',
      },
    },
    token,
  )).createProduct;

  const vendor = (await gql(
    `mutation($input: VendorInput!) { saveVendor(input: $input) { data } }`,
    {
      input: {
        name: `Production Smoke Vendor ${sku}`,
        phone: '9000000011',
        email: `${sku.toLowerCase()}@vendor.example`,
        city: 'Ahmedabad',
        state: 'Gujarat',
        category: 'Sanitaryware',
        status: 'active',
      },
    },
    token,
  )).saveVendor.data;

  const vendorList = (await gql(`query { vendors(status: "active", take: 200) }`, {}, token)).vendors;
  assert(vendorList.some((row) => row.id === vendor.id), 'GRN vendor dropdown source must include saved Vendor Master record');

  const plant = (await gql(
    `mutation($input: StockLocationInput!) { createStockLocation(input: $input) }`,
    {
      input: {
        code: sku.replace('PROD-HARDEN-', 'PLANT-').slice(0, 24),
        name: `Production Smoke Plant ${sku}`,
        type: 'plant',
        status: 'active',
        sortOrder: 1,
        defaultStockScope: true,
        address: 'Production hardening smoke plant',
      },
    },
    token,
  )).createStockLocation;
  assert(plant.id && plant.defaultStockScope, 'settings plant mutation should create a default stock scope');

  const grn = (await gql(
    `mutation($input: ManualGoodsReceiptInput!) { createManualGoodsReceipt(input: $input) }`,
    {
      input: {
        vendorId: vendor.id,
        vendorName: vendor.name,
        supplierChallan: `CH-${sku}`,
        locationId: plant.id,
        reason: 'Production-hardening vendor dropdown smoke',
        lines: JSON.stringify([{ productId: product.id, receivedQuantity: 4, damagedQuantity: 0, unitCost: 5200, location: plant.name, locationId: plant.id }]),
      },
    },
    token,
  )).createManualGoodsReceipt;
  assert(grn.vendorId === vendor.id && grn.vendorName === vendor.name, 'manual GRN must persist Vendor Master id and name');

  const locationsAfterGrn = (await gql(`query { stockLocations }`, {}, token)).stockLocations;
  const smokeLocation = locationsAfterGrn.find((row) => row.id === plant.id);
  assert(smokeLocation?.defaultStockScope, 'created plant should remain the default stock location');
  const afterGrnLocationStock = (await gql(
    `query($locationId: String, $productId: String) { stockLocationBalances(locationId: $locationId, productId: $productId) }`,
    { locationId: plant.id, productId: product.id },
    token,
  )).stockLocationBalances;
  assert(afterGrnLocationStock.some((row) => row.locationId === plant.id && row.onHand === 4), 'manual GRN should post stock into the selected plant');
  const grnLedger = (await gql(
    `query($productId: String) { stockLedgerEntries(productId: $productId, take: 20) }`,
    { productId: product.id },
    token,
  )).stockLedgerEntries;
  assert(grnLedger.some((row) => row.type === 'grn_receipt' && row.direction === 'in' && row.locationId === plant.id), 'manual GRN should post a plant-scoped stock ledger receipt');

  const count = (await gql(
    `mutation($input: StockCountInput!) { createStockCountSession(input: $input) }`,
    {
      input: {
        scope: 'selected_skus',
        locationId: plant.id,
        notes: 'Production hardening count smoke',
        submit: true,
        lines: JSON.stringify([{ productId: product.id, countedQuantity: 5, reason: 'physical recount smoke' }]),
      },
    },
    token,
  )).createStockCountSession;
  const approvedCount = (await gql(
    `mutation($id: ID!) { approveStockCountSession(id: $id) }`,
    { id: count.id },
    token,
  )).approveStockCountSession;
  assert(approvedCount.status === 'approved', 'stock count should approve and post variance');

  const customer = (await gql(
    `mutation($input: CreateCustomerInput!) { createCustomer(input: $input) { id name } }`,
    {
      input: {
        name: `Production Hardening Customer ${sku}`,
        phone: '9898981212',
        email: `${sku.toLowerCase()}@example.com`,
        city: 'Ahmedabad',
        address: 'Production hardening site',
        forceCreate: true,
      },
    },
    token,
  )).createCustomer;
  const lead = (await gql(
    `mutation($input: CreateLeadInput!) { createLead(input: $input) { id stage } }`,
    { input: { customerId: customer.id, title: 'Production hardening quote order', source: 'Showroom', stage: 'new', notes: 'Smoke flow.' } },
    token,
  )).createLead;
  const lines = JSON.stringify([{ productId: product.id, sku: product.sku, name: product.name, category: product.category, brand: product.brand, finish: product.finish, qty: 1, unit: 'PC', price: product.sellPrice }]);
  const quote = (await gql(
    `mutation($input: CreateQuoteInput!) { createQuote(input: $input) { id quoteNumber lines } }`,
    { input: { leadId: lead.id, customerId: customer.id, title: 'Production hardening quote', projectName: 'Production Smoke', lines } },
    token,
  )).createQuote;
  const order = (await gql(
    `mutation($input: CreateSalesOrderInput!) { createSalesOrderFromQuote(input: $input) }`,
    { input: { quoteId: quote.id, paymentMode: 'cash', advanceAmount: product.sellPrice, notes: 'Full advance smoke.' } },
    token,
  )).createSalesOrderFromQuote;
  assert(order.documents?.salesOrderPdfUrl === `/api/pdf/order/${order.id}`, 'sales order document URL should be generated');

  const job = (await gql(`query { dispatchJobs { id quoteId status } }`, {}, token)).dispatchJobs.find((row) => row.quoteId === quote.id);
  assert(job, 'sales order conversion should create dispatch job');
  const challan = (await gql(
    `mutation($input: CreateChallanInput!) { createChallan(input: $input) { id challanNumber status } }`,
    { input: { jobId: job.id, transporter: 'Production Smoke Transport', vehicleNo: 'SMOKE-95', driverName: 'Smoke Driver', driverPhone: '9000000095' } },
    token,
  )).createChallan;
  await gql(`mutation($id: ID!, $status: String!) { updateChallanStatus(id: $id, status: $status) { id status } }`, { id: challan.id, status: 'dispatched' }, token);
  await gql(`mutation($id: ID!, $status: String!) { updateChallanStatus(id: $id, status: $status) { id status } }`, { id: challan.id, status: 'delivered' }, token);

  const returnOrder = (await gql(
    `mutation($input: ReturnOrderInput!) { createReturnOrder(input: $input) }`,
    {
      input: {
        salesOrderId: order.id,
        challanId: challan.id,
        customerId: customer.id,
        locationId: plant.id,
        receive: true,
        reason: 'Production hardening return smoke',
        refundMode: 'store_credit',
        refundAmount: 0,
        lines: JSON.stringify([{ productId: product.id, sku: product.sku, name: product.name, quantity: 1, disposition: 'resell' }]),
      },
    },
    token,
  )).createReturnOrder;
  assert(returnOrder.returnNumber?.startsWith('RT/'), 'return order should receive a controlled return number');

  const finalData = await gql(
    `query($productId: String, $locationId: String) {
      inventoryBalances(productId: $productId) { id productId onHand available reserved damaged product { sku } }
      documentJobs(take: 60)
      paymentReceipts(take: 60)
      stockCountSessions(take: 20)
      returnOrders(take: 20)
      stockLedgerEntries(productId: $productId, take: 80)
      stockLocationBalances(locationId: $locationId, productId: $productId)
      productionReadinessSummary
    }`,
    { productId: product.id, locationId: plant.id },
    token,
  );

  const balance = finalData.inventoryBalances.find((row) => row.productId === product.id);
  assert(balance?.onHand >= 5, 'final inventory should reflect GRN, approved count, dispatch, and return');
  assert(finalData.documentJobs.some((jobRow) => jobRow.entityId === quote.id), 'quote document job should exist');
  assert(finalData.documentJobs.some((jobRow) => jobRow.entityId === order.id), 'sales order document job should exist');
  assert(finalData.paymentReceipts.some((receipt) => receipt.salesOrderId === order.id && receipt.status === 'posted'), 'payment receipt should exist for full advance');
  assert(finalData.stockCountSessions.some((session) => session.id === approvedCount.id && session.status === 'approved'), 'approved stock count should be queryable');
  assert(finalData.returnOrders.some((row) => row.id === returnOrder.id), 'return order should be queryable');
  assert(finalData.stockLedgerEntries.some((row) => row.referenceType === 'ReturnOrder' && row.referenceId === returnOrder.id), 'return should post stock ledger entry');
  assert(finalData.stockLedgerEntries.some((row) => row.type === 'dispatch' && row.direction === 'out' && row.locationId === plant.id), 'dispatch should consume from the default plant stock scope');
  assert(finalData.stockLocationBalances.some((row) => row.locationId === plant.id && row.onHand >= 5), 'final plant stock should reflect GRN, count, dispatch and return');
  assert(finalData.productionReadinessSummary.score >= 95, 'production readiness score should stay above 95');
  assert(finalData.productionReadinessSummary.dispatch.shipments >= 1, 'dispatch shipment records should be counted');
  assert(finalData.productionReadinessSummary.returns.returns >= 1, 'return records should be counted');

  console.log(JSON.stringify({
    ok: true,
    sku,
    vendorId: vendor.id,
    plant: { id: plant.id, code: plant.code, name: plant.name },
    grnNumber: grn.grnNumber,
    countNumber: approvedCount.countNumber,
    quoteNumber: quote.quoteNumber,
    orderNumber: order.orderNumber,
    challanNumber: challan.challanNumber,
    returnNumber: returnOrder.returnNumber,
    readinessScore: finalData.productionReadinessSummary.score,
    finalInventory: balance,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
