const API = process.env.API_URL || 'http://localhost:4000/graphql';

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

async function login(email) {
  const result = await gql(
    `mutation Login($input: LoginInput!) { login(input: $input) { token user { id email role } authenticated } }`,
    { input: { email, password: 'password123' } },
  );
  assert(!result.errors, `login failed for ${email}: ${JSON.stringify(result.errors)}`);
  return result.data.login;
}

async function main() {
  const publicQuotes = await gql(`query { quotes { id } }`);
  assert(publicQuotes.errors?.some((e) => /login|auth/i.test(e.message)), 'public quotes query must be rejected');

  const sales = await login('sales@marblepark.com');
  const salesQuotes = await gql(`query { quotes { id owner } }`, {}, sales.token);
  assert(!salesQuotes.errors, `sales quotes failed: ${JSON.stringify(salesQuotes.errors)}`);
  assert(salesQuotes.data.quotes.every((q) => q.owner?.id === sales.user.id), 'sales user must only see own quotes');

  const owner = await login('owner@marblepark.com');
  const dashboard = await gql(`query { ownerDashboard { stats } }`, {}, owner.token);
  assert(!dashboard.errors, `owner dashboard failed: ${JSON.stringify(dashboard.errors)}`);
  assert(dashboard.data.ownerDashboard.stats.totalProducts > 0, 'owner dashboard should return product stats');

  const importsPublic = await gql(`mutation { processExcelImport(filePath: "/tmp/nope.xlsx") { id } }`);
  assert(importsPublic.errors?.some((e) => /login|auth/i.test(e.message)), 'public import mutation must be rejected');

  console.log('regression smoke passed');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
