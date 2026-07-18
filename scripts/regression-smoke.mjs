const API = process.env.API_URL || 'http://localhost:4000/graphql';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password123';
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'admin@marblepark.com';
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || TEST_PASSWORD;
const SALES_EMAIL = process.env.SALES_EMAIL || 'sales@marblepark.com';
const SALES_PASSWORD = process.env.SALES_PASSWORD || TEST_PASSWORD;

async function gql(query, variables, token) {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  return json;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function login(email, password) {
  const result = await gql(
    `mutation Login($input: LoginInput!) { login(input: $input) { token user { id email role } authenticated } }`,
    { input: { email, password } },
  );
  assert(!result.errors, `login failed for ${email}: ${JSON.stringify(result.errors)}`);
  return result.data.login;
}

async function main() {
  const publicQuotes = await gql(`query { quotes { id } }`);
  assert(publicQuotes.errors?.some((e) => /login|auth/i.test(e.message)), 'public quotes query must be rejected');

  const sales = await login(SALES_EMAIL, SALES_PASSWORD);
  const salesQuotes = await gql(`query { quotes { id owner } }`, {}, sales.token);
  assert(!salesQuotes.errors, `sales quotes failed: ${JSON.stringify(salesQuotes.errors)}`);
  assert(salesQuotes.data.quotes.every((q) => q.owner?.id === sales.user.id), 'sales user must only see own quotes');

  const owner = await login(OWNER_EMAIL, OWNER_PASSWORD);
  const dashboard = await gql(`query { ownerDashboard { stats } }`, {}, owner.token);
  assert(!dashboard.errors, `owner dashboard failed: ${JSON.stringify(dashboard.errors)}`);
  assert(dashboard.data.ownerDashboard.stats.totalProducts > 0, 'owner dashboard should return product stats');

  const importsPublic = await gql(`mutation { processExcelImport(filePath: "/tmp/nope.xlsx", confirmationToken: "unconfirmed") { id } }`);
  assert(importsPublic.errors?.some((e) => /login|auth/i.test(e.message)), 'public import mutation must be rejected');

  console.log('regression smoke passed');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
