const API = process.env.API_URL || 'http://localhost:4000/graphql';

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

async function main() {
  const login = await gql(`mutation($input: LoginInput!) { login(input: $input) { token user { id role } } }`, { input: { email: 'admin@marblepark.com', password: 'password123' } });
  const token = login.login.token;
  const sku = unique('E2E-HR');

  const productData = await gql(`mutation($input: CreateProductInput!) { createProduct(input: $input) { id sku name sellPrice } }`, {
    input: { sku, name: 'E2E High Resolution Test Basin Mixer', category: 'Faucets & Showers', brand: 'Marble Park Select', finish: 'Chrome', dimensions: 'Test 180 mm', unit: 'PC', sellPrice: 9900, floorPrice: 8200, description: 'Created by E2E smoke.' },
  }, token);
  const product = productData.createProduct;

  const inventoryData = await gql(`mutation($input: CreateInventoryInput!) { createInventory(input: $input) { id onHand available reserved product { id sku } } }`, { input: { productId: product.id, onHand: 5 } }, token);
  const inventoryId = inventoryData.createInventory.id;

  const customerData = await gql(`mutation($input: CreateCustomerInput!) { createCustomer(input: $input) { id name mobile city } }`, {
    input: { name: 'E2E Patel Residence', phone: '9898989898', email: 'e2e-patel@example.com', city: 'Ahmedabad', address: 'E2E Site Road', gstNo: '24ABCDE1234F1Z5', notes: 'E2E customer' },
  }, token);
  const customer = customerData.createCustomer;

  const leadData = await gql(`mutation($input: CreateLeadInput!) { createLead(input: $input) { id stage expectedValue } }`, {
    input: { customerId: customer.id, title: 'E2E full bath package follow-up', source: 'Showroom', stage: 'new', expectedValue: 19800, notes: 'Call and quote flow.' },
  }, token);
  const lead = leadData.createLead;
  await gql(`mutation($id: ID!, $stage: String!) { updateLeadStage(id: $id, stage: $stage) { id stage } }`, { id: lead.id, stage: 'contacted' }, token);
  await gql(`mutation($id: ID!, $stage: String!) { updateLeadStage(id: $id, stage: $stage) { id stage } }`, { id: lead.id, stage: 'proposal' }, token);

  const lines = JSON.stringify([{ productId: product.id, sku: product.sku, name: product.name, qty: 2, unit: 'PC', price: product.sellPrice, sellPrice: product.sellPrice, media: { primary: '/catalogue-images/new-style-products-p011-106-98195b773d7d52.png', source: 'e2e' } }]);
  const quoteData = await gql(`mutation($input: CreateQuoteInput!) { createQuote(input: $input) { id quoteNumber status approvalStatus lines } }`, {
    input: { leadId: lead.id, customerId: customer.id, title: 'E2E quote with image and stock', projectName: 'E2E Bathroom', notes: 'E2E quote', lines },
  }, token);
  const quote = quoteData.createQuote;
  assert(quote.approvalStatus === 'pending', 'quote should wait for owner approval before send/confirm');
  await gql(`mutation($id: ID!, $note: String) { approveQuote(id: $id, note: $note) { id status approvalStatus } }`, { id: quote.id, note: 'E2E owner approval' }, token);
  await gql(`mutation($id: ID!) { sendQuote(id: $id) { id status sentAt } }`, { id: quote.id }, token);
  await gql(`mutation($id: ID!) { confirmQuote(id: $id) { id status confirmedAt } }`, { id: quote.id }, token);

  const afterReserve = await gql(`query($id: ID!) { inventoryBalance(id: $id) { id onHand available reserved } dispatchJobs { id quoteId status } }`, { id: inventoryId }, token);
  assert(afterReserve.inventoryBalance.onHand === 5, 'onHand should remain before dispatch');
  assert(afterReserve.inventoryBalance.reserved >= 2, 'reserved should increase after confirm');
  const job = afterReserve.dispatchJobs.find((row) => row.quoteId === quote.id);
  assert(job, 'dispatch job should exist after quote confirm');

  const challanData = await gql(`mutation($input: CreateChallanInput!) { createChallan(input: $input) { id challanNumber status } }`, { input: { jobId: job.id, transporter: 'E2E Transport', vehicleNo: 'E2E-001', driverName: 'E2E Driver', driverPhone: '9000000000' } }, token);
  const challan = challanData.createChallan;
  await gql(`mutation($id: ID!, $status: String!) { updateChallanStatus(id: $id, status: $status) { id status } }`, { id: challan.id, status: 'dispatched' }, token);
  await gql(`mutation($id: ID!, $status: String!) { updateChallanStatus(id: $id, status: $status) { id status } }`, { id: challan.id, status: 'delivered' }, token);
  await gql(`mutation($id: ID!, $stage: String!) { updateLeadStage(id: $id, stage: $stage) { id stage } }`, { id: lead.id, stage: 'won' }, token);

  const finalState = await gql(`query($id: ID!, $quoteId: ID!) { inventoryBalance(id: $id) { id onHand available reserved } quote(id: $quoteId) { id status } dispatchJobs { id quoteId status } }`, { id: inventoryId, quoteId: quote.id }, token);
  assert(finalState.inventoryBalance.onHand === 3, `onHand should consume to 3, got ${finalState.inventoryBalance.onHand}`);
  assert(finalState.inventoryBalance.reserved === 0, `reserved should be 0, got ${finalState.inventoryBalance.reserved}`);
  assert(finalState.dispatchJobs.find((row) => row.quoteId === quote.id)?.status === 'delivered', 'dispatch job should be delivered');

  console.log(JSON.stringify({ ok: true, sku, productId: product.id, customerId: customer.id, leadId: lead.id, quoteId: quote.id, quoteNumber: quote.quoteNumber, inventory: finalState.inventoryBalance, challanNumber: challan.challanNumber }, null, 2));
}

main().catch((error) => { console.error(error.message); process.exit(1); });
