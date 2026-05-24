const API = process.env.API_URL || 'http://localhost:4000/graphql';
const WEB = process.env.WEB_URL || '';

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

async function login(email) {
  const data = await gql(
    `mutation($input: LoginInput!) { login(input: $input) { token user { id email role } } }`,
    { input: { email, password: 'password123' } },
  );
  return data.login;
}

async function main() {
  const [admin, office, sales, dispatch] = await Promise.all([
    login('admin@marblepark.com'),
    login('office@marblepark.com'),
    login('sales@marblepark.com'),
    login('dispatch@marblepark.com'),
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
        media: { primary: '/catalogue-images/new-style-products-p011-106-98195b773d7d52.png', gallery: ['/catalogue-images/new-style-products-p011-106-98195b773d7d52.png'] },
      },
    },
    admin.token,
  );
  const product = productData.createProduct;

  const inventoryData = await gql(
    `mutation($input: CreateInventoryInput!) { createInventory(input: $input) { id onHand available reserved product { id sku } } }`,
    { input: { productId: product.id, onHand: 3 } },
    admin.token,
  );
  assert(inventoryData.createInventory.available === 3, 'created inventory should be available');

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
    },
    {
      type: 'tile',
      category: 'Tiles',
      tileCode,
      tileSize: '600 x 1200',
      qty: 4,
      uom: 'box',
      pcsPerBox: 2,
      price: 1800,
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

  let fullDispatchBlocked = false;
  try {
    await gql(
      `mutation($input: CreateChallanInput!) { createChallan(input: $input) { id challanNumber status } }`,
      { input: { jobId: job.id, transporter: 'E2E Transport', vehicleNo: 'E2E-001', driverName: 'E2E Driver', driverPhone: '9000000000' } },
      dispatch.token,
    );
  } catch (error) {
    fullDispatchBlocked = /not linked to stock|not inwards yet/i.test(error.message);
  }
  assert(fullDispatchBlocked, 'full dispatch should block the tile/manual row until stock is linked/inwarded');

  const partialLine = quote.lines.find((line) => line.productId === product.id);
  const challanData = await gql(
    `mutation($input: CreateChallanInput!) { createChallan(input: $input) { id challanNumber status lines } }`,
    {
      input: {
        jobId: job.id,
        transporter: 'E2E Transport',
        vehicleNo: 'E2E-002',
        driverName: 'E2E Driver',
        driverPhone: '9000000000',
        lines: JSON.stringify([partialLine]),
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
    `query($leadId: ID!, $inventoryId: ID!) { lead(id: $leadId) { id stage activities intents quotes } inventoryBalance(id: $inventoryId) { id onHand available reserved } }`,
    { leadId: lead.id, inventoryId: inventoryData.createInventory.id },
    sales.token,
  );
  assert(finalState.lead.stage === 'won', 'sales order conversion should mark lead won');
  assert(finalState.inventoryBalance.onHand === 1, `partial dispatch should consume stock to 1, got ${finalState.inventoryBalance.onHand}`);

  if (WEB) {
    const pdf = await fetch(`${WEB}/api/pdf/quote/${quote.id}`);
    const bytes = Buffer.from(await pdf.arrayBuffer());
    assert(pdf.ok, `quote PDF route should return 200, got ${pdf.status}`);
    assert(pdf.headers.get('content-type')?.includes('application/pdf'), 'quote PDF should return application/pdf');
    assert(bytes.subarray(0, 4).toString() === '%PDF', 'quote PDF should start with a PDF header');
    const orderPdf = await fetch(`${WEB}/api/pdf/order/${order.id}`);
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
