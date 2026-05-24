const API = process.env.API_URL || 'http://localhost:4000/graphql';
const WEB = process.env.WEB_URL || 'http://localhost:3001';

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
function assert(condition, message) { if (!condition) throw new Error(message); }
function unique(prefix) { return `${prefix}-${Date.now().toString(36).toUpperCase()}`; }
async function login(email) {
  const data = await gql(`mutation($input: LoginInput!) { login(input: $input) { token user { id email role name } } }`, { input: { email, password: 'password123' } });
  return data.login;
}
async function product(token, sku, name, price) {
  return (await gql(`mutation($input: CreateProductInput!) { createProduct(input: $input) { id sku name sellPrice category brand finish unit media } }`, {
    input: { sku, name, category: 'Faucets & Showers', brand: 'Marble Park Select', finish: 'Chrome', dimensions: 'Smoke', unit: 'PC', sellPrice: price, floorPrice: price * 0.8, description: 'Area notification smoke SKU', media: { primary: '/catalogue-images/new-style-products-p011-106-98195b773d7d52.png' } },
  }, token)).createProduct;
}
async function main() {
  const [admin, office, sales, dispatch] = await Promise.all([
    login('admin@marblepark.com'), login('office@marblepark.com'), login('sales@marblepark.com'), login('dispatch@marblepark.com'),
  ]);
  const skuA = unique('AREA-STOCK');
  const skuB = unique('AREA-BACK');
  const stocked = await product(admin.token, skuA, 'Area Smoke Stocked Diverter', 7200);
  const backorder = await product(admin.token, skuB, 'Area Smoke Backorder Shower', 11600);
  await gql(`mutation($input: CreateInventoryInput!) { createInventory(input: $input) { id onHand available } }`, { input: { productId: stocked.id, onHand: 2 } }, admin.token);

  const customer = (await gql(`mutation($input: CreateCustomerInput!) { createCustomer(input: $input) { id name } }`, { input: { name: `Area Quote Notification Customer ${skuA}`, phone: '9777777777', email: `${skuA.toLowerCase()}@example.com`, city: 'Ahmedabad', address: 'Area smoke site', forceCreate: true } }, admin.token)).createCustomer;
  const initialRows = [{ area: 'Master Bath', type: 'product', productId: stocked.id, sku: stocked.sku, name: stocked.name, category: stocked.category, brand: stocked.brand, qty: 1, unit: 'PC', price: stocked.sellPrice }];
  const lead = (await gql(`mutation($input: CreateLeadInput!) { createLead(input: $input) { id stage owner customer } }`, { input: { customerId: customer.id, ownerId: sales.user.id, title: 'Area-wise multi quote smoke lead', source: 'Showroom', notes: 'Smoke with multiple quotes', intentNotes: 'Initial priced master bath selection', intentRows: JSON.stringify(initialRows) } }, admin.token)).createLead;

  const officeBefore = await gql(`query { notifications(unreadOnly: true, take: 20) }`, {}, office.token);
  assert(officeBefore.notifications.some((n) => n.type === 'intent_submitted' && String(n.message).includes('selection row')), 'office should be notified when intent is submitted');

  const pending1 = (await gql(`query($leadId: String, $status: String) { leadIntents(leadId: $leadId, status: $status) }`, { leadId: lead.id, status: 'pending_quote' }, office.token)).leadIntents[0];
  const quote1 = (await gql(`mutation($intentId: String!, $displayMode: String, $note: String) { generateQuoteFromIntent(intentId: $intentId, displayMode: $displayMode, note: $note) }`, { intentId: pending1.id, displayMode: 'priced', note: 'Priced quote for master bath' }, office.token)).generateQuoteFromIntent.quote;
  assert(quote1.displayMode === 'priced', 'first generated quote should show prices');

  const followRows = [{ area: 'Powder Room', type: 'product', productId: stocked.id, sku: stocked.sku, name: stocked.name, category: stocked.category, brand: stocked.brand, qty: 1, unit: 'PC', price: stocked.sellPrice }];
  const intent2 = (await gql(`mutation($input: CreateLeadIntentInput!) { createLeadIntent(input: $input) }`, { input: { leadId: lead.id, rows: JSON.stringify(followRows), notes: 'Customer wants selection-only PDF first', followUpReason: 'customer asked for no-price sharing copy' } }, sales.token)).createLeadIntent;
  const quote2 = (await gql(`mutation($intentId: String!, $displayMode: String, $note: String) { generateQuoteFromIntent(intentId: $intentId, displayMode: $displayMode, note: $note) }`, { intentId: intent2.id, displayMode: 'selection', note: 'Selection-only PDF for family approval' }, office.token)).generateQuoteFromIntent.quote;
  assert(quote2.displayMode === 'selection', 'second quote should be selection summary with hidden prices');

  const orderRows = [
    { area: 'Master Bath', type: 'product', productId: stocked.id, sku: stocked.sku, name: stocked.name, category: stocked.category, brand: stocked.brand, qty: 1, unit: 'PC', price: stocked.sellPrice },
    { area: 'Guest Bath', type: 'product', productId: backorder.id, sku: backorder.sku, name: backorder.name, category: backorder.category, brand: backorder.brand, qty: 1, unit: 'PC', price: backorder.sellPrice },
  ];
  const intent3 = (await gql(`mutation($input: CreateLeadIntentInput!) { createLeadIntent(input: $input) }`, { input: { leadId: lead.id, rows: JSON.stringify(orderRows), notes: 'Final order has one in-store and one pending inward item', followUpReason: 'final selection confirmed' } }, sales.token)).createLeadIntent;
  const quote3 = (await gql(`mutation($intentId: String!, $displayMode: String, $note: String) { generateQuoteFromIntent(intentId: $intentId, displayMode: $displayMode, note: $note) }`, { intentId: intent3.id, displayMode: 'priced', note: 'Final priced order quote' }, office.token)).generateQuoteFromIntent.quote;
  assert(quote3.lines.some((line) => line.area === 'Guest Bath' && line.productId === backorder.id), 'final quote should preserve area-wise backorder line');

  const pdfSelection = await fetch(`${WEB}/api/pdf/quote/${quote2.id}`);
  const pdfPriced = await fetch(`${WEB}/api/pdf/quote/${quote3.id}`);
  assert(pdfSelection.ok && pdfPriced.ok, 'selection and priced quote PDFs should render');
  assert(Buffer.from(await pdfSelection.arrayBuffer()).subarray(0, 4).toString() === '%PDF', 'selection PDF should be a PDF');
  assert(Buffer.from(await pdfPriced.arrayBuffer()).subarray(0, 4).toString() === '%PDF', 'priced PDF should be a PDF');

  const order = (await gql(`mutation($input: CreateSalesOrderInput!) { createSalesOrderFromQuote(input: $input) }`, { input: { quoteId: quote3.id, paymentMode: 'credit', notes: 'Credit final order smoke' } }, office.token)).createSalesOrderFromQuote;
  assert(order.paymentMode === 'credit' && order.paymentStatus === 'credit', 'credit order should retain credit tags');

  const jobs = (await gql(`query { dispatchJobs { id quoteId status quote } }`, {}, dispatch.token)).dispatchJobs;
  const job = jobs.find((row) => row.quoteId === quote3.id);
  assert(job, 'final sales order should open dispatch job');
  let blocked = false;
  try {
    await gql(`mutation($input: CreateChallanInput!) { createChallan(input: $input) { id } }`, { input: { jobId: job.id, transporter: 'Smoke', vehicleNo: 'SMOKE', driverName: 'Driver', driverPhone: '9000000000' } }, dispatch.token);
  } catch (error) {
    blocked = /not inwards yet/i.test(error.message);
  }
  assert(blocked, 'full dispatch must block the not-inwarded backorder line');
  const stockedLine = quote3.lines.find((line) => line.productId === stocked.id);
  const challan = (await gql(`mutation($input: CreateChallanInput!) { createChallan(input: $input) { id challanNumber status lines } }`, { input: { jobId: job.id, transporter: 'Smoke', vehicleNo: 'SMOKE-1', driverName: 'Driver', driverPhone: '9000000000', lines: JSON.stringify([stockedLine]) } }, dispatch.token)).createChallan;
  await gql(`mutation($id: ID!, $status: String!) { updateChallanStatus(id: $id, status: $status) { id status } }`, { id: challan.id, status: 'dispatched' }, dispatch.token);

  await gql(`mutation($input: CreateInventoryInput!) { createInventory(input: $input) { id onHand available product { sku } } }`, { input: { productId: backorder.id, onHand: 1 } }, admin.token);
  const [salesNotices, dispatchNotices, ownerNotices, leadState] = await Promise.all([
    gql(`query { notifications(take: 40) }`, {}, sales.token),
    gql(`query { notifications(take: 40) }`, {}, dispatch.token),
    gql(`query { notifications(take: 40) }`, {}, admin.token),
    gql(`query($id: ID!) { lead(id: $id) { id stage quotes intents activities followUps } }`, { id: lead.id }, sales.token),
  ]);
  assert(salesNotices.notifications.some((n) => n.type === 'quote_generated' && String(n.message).includes(quote2.quoteNumber)), 'sales should be notified when office generates quote PDF');
  assert(salesNotices.notifications.some((n) => n.type === 'stock_ready' && String(n.message).includes(backorder.sku)), 'sales should be notified when backorder inward arrives');
  assert(dispatchNotices.notifications.some((n) => n.type === 'stock_ready' && String(n.message).includes(backorder.sku)), 'dispatch should be notified when backorder inward arrives');
  assert(ownerNotices.notifications.some((n) => n.type === 'quote_ready'), 'owner/admin stream should show quote-ready visibility without approval blocking');
  assert(leadState.lead.quotes.length >= 3, 'same lead should maintain 3 generated quote records');
  assert(leadState.lead.activities.some((a) => a.type === 'stock_ready'), 'lead activity should track stock ready event');

  console.log(JSON.stringify({ ok: true, leadId: lead.id, quotes: [quote1.quoteNumber, quote2.quoteNumber, quote3.quoteNumber], quote2Mode: quote2.displayMode, order: order.orderNumber, partialChallan: challan.challanNumber, stockReadyNotified: true }, null, 2));
}

main().catch((error) => { console.error(error.message); process.exit(1); });
