const API = process.env.API_URL || 'http://localhost:4000/graphql';
const WEB = process.env.WEB_URL || '';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@marblepark.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password123';
const ROLE_PASSWORD = process.env.ROLE_PASSWORD || 'password123';
const OFFICE_EMAIL = process.env.OFFICE_EMAIL || 'office@marblepark.com';
const SALES_EMAIL = process.env.SALES_EMAIL || 'sales@marblepark.com';
const DISPATCH_EMAIL = process.env.DISPATCH_EMAIL || 'dispatch@marblepark.com';

async function gql(query, variables = {}, token) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; '));
  return json.data;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function unique(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

async function login(email, password = ROLE_PASSWORD) {
  const data = await gql(
    `mutation($input: LoginInput!) { login(input: $input) { token user { id email role } } }`,
    { input: { email, password } },
  );
  return data.login;
}

async function main() {
  const [admin, office, sales, dispatch] = await Promise.all([
    login(TEST_EMAIL, TEST_PASSWORD),
    login(OFFICE_EMAIL),
    login(SALES_EMAIL),
    login(DISPATCH_EMAIL),
  ]);
  assert(office.user.role === 'office_staff', 'office user must have office_staff role');

  const sku = unique('INTENT-STOCK');
  const tileCode = unique('TILE');
  const productData = await gql(
    `mutation($input: CreateProductInput!) { createProduct(input: $input) { id sku name sellPrice category brand finish unit media } }`,
    {
      input: {
        sku,
        name: 'E2E Intent Stock Basin Mixer',
        category: 'Faucets & Showers',
        brand: 'Marble Park Select',
        finish: 'Chrome',
        dimensions: 'Test 180 mm',
        unit: 'PC',
        sellPrice: 12500,
        floorPrice: 9900,
        description: 'Created by intent/order smoke.',
      },
    },
    admin.token,
  );
  const product = productData.createProduct;
  const tileProduct = (await gql(
    `mutation($input: CreateProductInput!) { createProduct(input: $input) { id sku internalCode name sellPrice category brand finish unit } }`,
    { input: { sku: unique('INTENT-TILE'), internalCode: tileCode, name: 'E2E Intent Display Tile', category: 'Tiles', brand: 'Marble Park Select', finish: 'Matt', dimensions: '600 x 1200 mm', unit: 'BOX', baseUom: 'PC', purchaseUom: 'BOX', salesUom: 'BOX', piecesPerPack: 2, sellPrice: 1800, floorPrice: 1500 } },
    admin.token,
  )).createProduct;

  const location = (await gql(`query { stockLocations(status: "active") }`, {}, admin.token)).stockLocations.find((row) => row.code !== 'IN-TRANSIT');
  assert(location, 'an active stock location is required');
  await gql(
    `mutation($input: ManualGoodsReceiptInput!) { createManualGoodsReceipt(input: $input) }`,
    { input: { vendorName: 'E2E CRM Vendor', locationId: location.id, reason: 'CRM role handoff smoke', lines: JSON.stringify([{ productId: product.id, receivedQuantity: 3, damagedQuantity: 0, unitCost: 9000 }]) } },
    admin.token,
  );
  const inventoryData = await gql(`query($productId: String) { inventoryBalances(productId: $productId) { id onHand available reserved product { id sku } } }`, { productId: product.id }, admin.token);
  inventoryData.createInventory = inventoryData.inventoryBalances[0];
  assert(inventoryData.createInventory.available === 3, 'GRN stock should be available');

  const customerData = await gql(
    `mutation($input: CreateCustomerInput!) { createCustomer(input: $input) { id name mobile city } }`,
    {
      input: {
        name: 'E2E Intent Customer',
        phone: '9888888888',
        email: `${sku.toLowerCase()}@example.com`,
        city: 'Ahmedabad',
        address: 'E2E Intent Site',
        notes: 'Intent/order smoke customer',
        forceCreate: true,
      },
    },
    admin.token,
  );
  const customer = customerData.createCustomer;

  const intentRows = [
    {
      type: 'catalogue',
      productId: product.id,
      sku: product.sku,
      name: product.name,
      category: product.category,
      brand: product.brand,
      finish: product.finish,
      qty: 2,
      unit: 'PC',
      price: product.sellPrice,
      mrp: Number(product.sellPrice || 0) * 1.2,
      mrpRateBasis: 'PIECE',
    },
    {
      type: 'tile',
      productId: tileProduct.id,
      sku: tileProduct.sku,
      name: tileProduct.name,
      category: tileProduct.category,
      brand: tileProduct.brand,
      finish: tileProduct.finish,
      tileCode,
      tileSize: '600 x 1200',
      qty: 4,
      uom: 'box',
      pcsPerBox: 2,
      price: 1800,
      mrp: 2200,
      mrpRateBasis: 'PACK',
    },
  ];

  const leadData = await gql(
    `mutation($input: CreateLeadInput!) { createLead(input: $input) { id stage expectedValue owner customer } }`,
    {
      input: {
        customerId: customer.id,
        ownerId: sales.user.id,
        title: 'E2E lead with catalogue and tile intent',
        source: 'Showroom',
        stage: 'new',
        notes: 'New lead should capture intent immediately.',
        intentNotes: 'Customer wants mixer from stock and tile by code.',
        intentRows: JSON.stringify(intentRows),
      },
    },
    admin.token,
  );
  const lead = leadData.createLead;
  assert(lead.stage === 'new', 'lead should start new before office quote generation');
  assert(lead.owner?.id === sales.user.id, 'lead should remain assigned to sales user');

  const pendingIntents = await gql(
    `query($leadId: String, $status: String) { leadIntents(leadId: $leadId, status: $status) }`,
    { leadId: lead.id, status: 'pending_quote' },
    office.token,
  );
  assert(pendingIntents.leadIntents.length === 1, 'office intent desk should see the pending lead intent');
  assert(pendingIntents.leadIntents[0].intentType === 'mixed_or_tiles', 'tile row should classify the intent as mixed_or_tiles');

  const generatedData = await gql(
    `mutation($intentId: String!, $note: String) { generateQuoteFromIntent(intentId: $intentId, note: $note) }`,
    { intentId: pendingIntents.leadIntents[0].id, note: 'Office generated quote from captured intent.' },
    office.token,
  );
  const generated = generatedData.generateQuoteFromIntent;
  const quote = generated.quote;
  assert(quote.id && quote.approvalStatus === 'approved', 'generated quote should be ready without owner approval');
  assert(generated.pdfUrl === `/api/pdf/quote/${quote.id}`, 'lead follow-up PDF URL should point at the quote PDF route');
  assert(quote.lines.some((line) => line.type === 'tile' && line.tileCode === tileCode), 'quote should preserve tile code intent');

  const salesLeadAfterQuote = await gql(
    `query($id: ID!) { lead(id: $id) { id stage followUps quotes intents activities } }`,
    { id: lead.id },
    sales.token,
  );
  assert(salesLeadAfterQuote.lead.stage === 'quoted', 'office quote should move sales lead to quoted follow-up stage');
  assert(salesLeadAfterQuote.lead.followUps?.some((task) => String(task.notes || '').includes(`/api/pdf/quote/${quote.id}`)), 'sales follow-up should include shareable quote PDF URL');

  const orderData = await gql(
    `mutation($input: CreateSalesOrderInput!) { createSalesOrderFromQuote(input: $input) }`,
    { input: { quoteId: quote.id, paymentMode: 'cash', advanceAmount: 5000, notes: 'Cash advance received.' } },
    office.token,
  );
  const order = orderData.createSalesOrderFromQuote;
  assert(order.orderNumber?.startsWith('SO/'), 'sales order number should be generated');
  assert(order.paymentMode === 'cash' && order.paymentStatus === 'advance', 'cash order should track advance payment');
  assert(order.documents?.salesOrderPdfUrl === `/api/pdf/order/${order.id}`, 'sales order should keep a stable order PDF URL');

  const orderBook = await gql(
    `query($paymentMode: String, $range: String) { salesOrders(paymentMode: $paymentMode, range: $range) salesOrderStats(range: $range) }`,
    { paymentMode: 'cash', range: 'today' },
    admin.token,
  );
  assert(orderBook.salesOrders.some((row) => row.id === order.id), 'owner cash order report should include the new order');
  assert(orderBook.salesOrderStats.cashOrders >= 1, 'owner cash stats should include cash orders');

  const jobs = await gql(`query { dispatchJobs { id quoteId status } }`, {}, dispatch.token);
  const job = jobs.dispatchJobs.find((row) => row.quoteId === quote.id);
  assert(job, 'sales order conversion should create a dispatch job');

  const pick = (await gql(
    `mutation($input: CreatePickListInput!) { createPickList(input: $input) }`,
    { input: { salesOrderId: order.id, locationId: location.id, notes: 'CRM partial dispatch for currently available stock' } },
    dispatch.token,
  )).createPickList;
  assert(pick.lines.length === 1 && pick.lines[0].productId === product.id, 'partial pick should exclude the tile SKU until its inward is received');
  await gql(`mutation($id: ID!, $action: String!) { transitionPickList(id: $id, action: $action) }`, { id: pick.id, action: 'start' }, dispatch.token);
  await gql(`mutation($id: ID!, $action: String!, $input: PickListTransitionInput) { transitionPickList(id: $id, action: $action, input: $input) }`, { id: pick.id, action: 'pick', input: { lines: JSON.stringify(pick.lines.map((line) => ({ pickLineId: line.id, pickedQuantity: line.requestedQuantity }))) } }, dispatch.token);
  await gql(`mutation($id: ID!, $action: String!, $input: PickListTransitionInput) { transitionPickList(id: $id, action: $action, input: $input) }`, { id: pick.id, action: 'pack', input: { lines: JSON.stringify(pick.lines.map((line) => ({ pickLineId: line.id, packedQuantity: line.requestedQuantity }))) } }, dispatch.token);
  await gql(`mutation($id: ID!, $action: String!) { transitionPickList(id: $id, action: $action) }`, { id: pick.id, action: 'complete' }, dispatch.token);
  const challanData = await gql(
    `mutation($input: CreateChallanInput!) { createChallan(input: $input) { id challanNumber status lines } }`,
    {
      input: {
        jobId: job.id,
        pickListId: pick.id,
        transporter: 'E2E Transport',
        vehicleNo: 'E2E-002',
        driverName: 'E2E Driver',
        driverPhone: '9000000000',
      },
    },
    dispatch.token,
  );
  assert(challanData.createChallan.status === 'pending', 'partial dispatch challan should be created for dispatchable stock row only');
  await gql(
    `mutation($id: ID!, $status: String!) { updateChallanStatus(id: $id, status: $status) { id status } }`,
    { id: challanData.createChallan.id, status: 'dispatched' },
    dispatch.token,
  );

  const finalState = await gql(
    `query($leadId: ID!, $inventoryId: ID!, $productId: String) {
      lead(id: $leadId) { id stage activities intents quotes }
      inventoryBalance(id: $inventoryId) { id onHand available reserved }
      stockReconciliation(productId: $productId, take: 10)
    }`,
    { leadId: lead.id, inventoryId: inventoryData.createInventory.id, productId: product.id },
    admin.token,
  );
  assert(finalState.lead.stage === 'won', 'sales order conversion should mark lead won');
  assert(finalState.inventoryBalance.onHand === 1, `partial dispatch should consume stock to 1, got ${finalState.inventoryBalance.onHand}`);
  const reconciliationRow = finalState.stockReconciliation.rows.find((row) => row.productId === product.id);
  assert(reconciliationRow?.status === 'ok', `stock reconciliation should stay clean after partial dispatch, got ${JSON.stringify(reconciliationRow?.issues || [])}`);

  if (WEB) {
    const pdf = await fetch(`${WEB}/api/pdf/quote/${quote.id}`, { headers: { authorization: `Bearer ${admin.token}` } });
    const bytes = Buffer.from(await pdf.arrayBuffer());
    assert(pdf.ok, `quote PDF route should return 200, got ${pdf.status}`);
    assert(pdf.headers.get('content-type')?.includes('application/pdf'), 'quote PDF should return application/pdf');
    assert(bytes.subarray(0, 4).toString() === '%PDF', 'quote PDF should start with a PDF header');
    const orderPdf = await fetch(`${WEB}/api/pdf/order/${order.id}`, { headers: { authorization: `Bearer ${admin.token}` } });
    const orderBytes = Buffer.from(await orderPdf.arrayBuffer());
    assert(orderPdf.ok, `sales order PDF route should return 200, got ${orderPdf.status}`);
    assert(orderPdf.headers.get('content-type')?.includes('application/pdf'), 'sales order PDF should return application/pdf');
    assert(orderBytes.subarray(0, 4).toString() === '%PDF', 'sales order PDF should start with a PDF header');
  }

  console.log(JSON.stringify({
    ok: true,
    leadId: lead.id,
    quoteId: quote.id,
    quoteNumber: quote.quoteNumber,
    salesOrder: order.orderNumber,
    dispatchJob: job.id,
    partialChallan: challanData.createChallan.challanNumber,
    pdfChecked: Boolean(WEB),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
