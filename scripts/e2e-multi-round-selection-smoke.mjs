const API = process.env.API_URL || 'http://localhost:4000/graphql';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@marblepark.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password123';
const ROLE_PASSWORD = process.env.ROLE_PASSWORD || 'password123';
const OFFICE_EMAIL = process.env.OFFICE_EMAIL || 'office@marblepark.com';
const SALES_EMAIL = process.env.SALES_EMAIL || 'sales@marblepark.com';

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

async function login(email, password = ROLE_PASSWORD) {
  return (await gql(
    `mutation($input: LoginInput!) { login(input: $input) { token user { id email role } } }`,
    { input: { email, password } },
  )).login;
}

async function main() {
  const [admin, sales, office] = await Promise.all([
    login(TEST_EMAIL, TEST_PASSWORD),
    login(SALES_EMAIL),
    login(OFFICE_EMAIL),
  ]);
  assert(sales.user.role === 'sales', 'sales login should use the sales role');
  assert(office.user.role === 'office_staff', 'office login should use the office_staff role');

  const sku = unique('ROUND-SKU');
  const product = (await gql(
    `mutation($input: CreateProductInput!) { createProduct(input: $input) { id sku name category brand finish unit sellPrice } }`,
    {
      input: {
        sku,
        name: 'Multi Round Smoke Wall Mixer',
        category: 'Faucets & Showers',
        brand: 'Marble Park Select',
        finish: 'Chrome',
        dimensions: 'Smoke 210 mm',
        unit: 'PC',
        sellPrice: 6400,
        floorPrice: 5200,
        description: 'Created by multi-round selection smoke.',
      },
    },
    admin.token,
  )).createProduct;

  const customer = (await gql(
    `mutation($input: CreateCustomerInput!) { createCustomer(input: $input) { id name } }`,
    {
      input: {
        name: `Multi Round Customer ${sku}`,
        phone: '9876500000',
        email: `${sku.toLowerCase()}@example.com`,
        city: 'Ahmedabad',
        address: 'Multi-round smoke site',
        forceCreate: true,
      },
    },
    admin.token,
  )).createCustomer;

  const lead = (await gql(
    `mutation($input: CreateLeadInput!) { createLead(input: $input) { id title stage owner } }`,
    {
      input: {
        customerId: customer.id,
        ownerId: sales.user.id,
        title: 'Multi-round villa selection',
        source: 'Showroom',
        stage: 'new',
        notes: 'Smoke lead for multi-round quote revisions.',
      },
    },
    admin.token,
  )).createLead;
  assert(lead.owner.id === sales.user.id, 'lead should be owned by sales user');

  const baseRows = [{
    productId: product.id,
    sku: product.sku,
    name: product.name,
    category: product.category,
    brand: product.brand,
    finish: product.finish,
    qty: 1,
    unit: 'PC',
    price: product.sellPrice,
    area: 'Master Bath',
  }];

  const draft = (await gql(
    `mutation($input: CreateIntentInputDto!) { createIntent(input: $input) }`,
    { input: { leadId: lead.id, rows: baseRows, notes: 'Draft selection round.', intentType: 'initial', submit: false } },
    sales.token,
  )).createIntent;
  assert(draft.status === 'draft', 'sales should be able to create a draft intent');

  await gql(
    `mutation($id: ID!, $input: UpdateIntentInputDto!) { updateIntent(id: $id, input: $input) }`,
    { id: draft.id, input: { rows: baseRows.map((row) => ({ ...row, qty: 2 })), notes: 'Edited before submit.' } },
    sales.token,
  );
  const submitted = (await gql(`mutation($id: ID!) { submitIntent(id: $id) }`, { id: draft.id }, sales.token)).submitIntent;
  assert(submitted.status === 'pending_quote', 'sales submit should move intent to pending_quote');

  const pendingEdit = (await gql(
    `mutation($id: ID!, $input: UpdateIntentInputDto!) { updateIntent(id: $id, input: $input) }`,
    { id: draft.id, input: { rows: baseRows.map((row) => ({ ...row, qty: 3 })), notes: 'Customer changed qty after submit.' } },
    sales.token,
  )).updateIntent;
  assert(pendingEdit.rows[0].qty === 3, 'sales should edit submitted intent before office pickup');

  const locked = (await gql(`mutation($id: ID!) { pickUpIntent(id: $id) }`, { id: draft.id }, office.token)).pickUpIntent;
  assert(locked.status === 'in_quote' && locked.lockedBy === office.user.id, 'office pickup should lock the intent');

  let lockedEditBlocked = false;
  try {
    await gql(
      `mutation($id: ID!, $input: UpdateIntentInputDto!) { updateIntent(id: $id, input: $input) }`,
      { id: draft.id, input: { notes: 'Sales should not edit during office lock.' } },
      sales.token,
    );
  } catch (error) {
    lockedEditBlocked = /currently building|Office staff/i.test(error.message);
  }
  assert(lockedEditBlocked, 'sales edit should be blocked once office has the lock');

  const released = (await gql(`mutation($id: ID!) { releaseIntent(id: $id) }`, { id: draft.id }, office.token)).releaseIntent;
  assert(released.status === 'pending_quote' && !released.lockedBy, 'office release should return intent to sales-editable queue');

  await gql(
    `mutation($id: ID!, $input: UpdateIntentInputDto!) { updateIntent(id: $id, input: $input) }`,
    { id: draft.id, input: { rows: baseRows.map((row) => ({ ...row, qty: 2 })), notes: 'Final v1 selection.' } },
    sales.token,
  );
  await gql(`mutation($id: ID!) { pickUpIntent(id: $id) }`, { id: draft.id }, office.token);
  const firstQuoteResult = (await gql(
    `mutation($intentId: String!, $note: String) { generateQuoteFromIntent(intentId: $intentId, note: $note) }`,
    { intentId: draft.id, note: 'Build quote v1 from smoke intent.' },
    office.token,
  )).generateQuoteFromIntent;
  const quoteV1 = firstQuoteResult.quote;
  assert(quoteV1.versionNumber === 1 && quoteV1.intentId === draft.id, 'first quote should be v1 linked to the intent');

  const revisionDraft = (await gql(
    `mutation($quoteId: String!) { startQuoteRevision(quoteId: $quoteId) }`,
    { quoteId: quoteV1.id },
    sales.token,
  )).startQuoteRevision;
  assert(revisionDraft.status === 'draft', 'quote revision should start as a draft intent');
  assert(revisionDraft.intentType === 'revision', 'revision intent should be marked revision');
  assert(revisionDraft.referencesQuoteId === quoteV1.id, 'revision intent should reference quote v1');

  await gql(
    `mutation($id: ID!, $input: UpdateIntentInputDto!) { updateIntent(id: $id, input: $input) }`,
    { id: revisionDraft.id, input: { rows: baseRows.map((row) => ({ ...row, qty: 1, area: 'Powder Bath' })), notes: 'Revision: customer reduced qty and changed area.' } },
    sales.token,
  );
  await gql(`mutation($id: ID!) { submitIntent(id: $id) }`, { id: revisionDraft.id }, sales.token);
  await gql(`mutation($id: ID!) { pickUpIntent(id: $id) }`, { id: revisionDraft.id }, office.token);
  const secondQuoteResult = (await gql(
    `mutation($intentId: String!, $note: String) { generateQuoteFromIntent(intentId: $intentId, note: $note) }`,
    { intentId: revisionDraft.id, note: 'Build quote v2 from revision intent.' },
    office.token,
  )).generateQuoteFromIntent;
  const quoteV2 = secondQuoteResult.quote;
  assert(quoteV2.versionNumber === 2, 'revision should create quote v2');
  assert(quoteV2.supersedesQuoteId === quoteV1.id, 'quote v2 should supersede quote v1');

  const quoteV1After = (await gql(
    `query($id: ID!) { quote(id: $id) { id status supersededByQuoteId versionNumber } }`,
    { id: quoteV1.id },
    sales.token,
  )).quote;
  assert(quoteV1After.status === 'superseded', 'quote v1 should be frozen as superseded');
  assert(quoteV1After.supersededByQuoteId === quoteV2.id, 'quote v1 should point to quote v2');

  const followup = (await gql(
    `mutation($input: CreateIntentInputDto!) { createIntent(input: $input) }`,
    { input: { leadId: lead.id, rows: [], notes: 'Returning customer follow-up draft.', intentType: 'followup', followUpReason: 'Customer selected extra items', submit: false } },
    sales.token,
  )).createIntent;
  assert(followup.status === 'draft' && followup.intentType === 'followup', 'same-project follow-up intent should be possible after quote completion');

  const newProject = (await gql(
    `mutation($input: CreateLeadInput!) { createLead(input: $input) { id customer stage } }`,
    { input: { customerId: customer.id, ownerId: sales.user.id, title: 'Multi-round second project', source: 'Repeat customer', stage: 'new', notes: 'Separate project for same customer.' } },
    admin.token,
  )).createLead;
  assert(newProject.customer.id === customer.id, 'same customer should support a separate new project lead');

  const timeline = (await gql(`query($id: ID!) { leadTimeline(id: $id) }`, { id: lead.id }, sales.token)).leadTimeline;
  assert(timeline.entries.some((entry) => entry.kind === 'intent' && entry.payload.id === followup.id), 'timeline should show follow-up intent');
  const chain = timeline.chains.find((row) => row.headQuoteId === quoteV2.id);
  assert(chain?.versions?.length === 2, 'timeline should group quote v1 and v2 in one chain');
  assert(timeline.inFlight.activeIntents.some((intent) => intent.id === followup.id), 'timeline should surface active follow-up intent');

  console.log(JSON.stringify({
    ok: true,
    leadId: lead.id,
    quoteV1: { id: quoteV1.id, number: quoteV1.quoteNumber },
    quoteV2: { id: quoteV2.id, number: quoteV2.quoteNumber, version: quoteV2.versionNumber },
    followupIntentId: followup.id,
    newProjectId: newProject.id,
    chainVersions: chain.versions.map((quote) => ({ id: quote.id, version: quote.versionNumber, status: quote.status })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
