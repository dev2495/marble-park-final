const API = process.env.API_URL || 'http://localhost:4000/graphql';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@marblepark.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password123';
const ROLE_PASSWORD = process.env.ROLE_PASSWORD || 'password123';

async function gql(query, variables = {}, token) {
  const response = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const json = await response.json();
  if (!response.ok || json.errors?.length) throw new Error(json.errors?.map((error) => error.message).join('; ') || `GraphQL ${response.status}`);
  return json.data;
}

async function main() {
  const token = (await gql(
    `mutation($input: LoginInput!) { login(input: $input) { token } }`,
    { input: { email: TEST_EMAIL, password: TEST_PASSWORD } },
  )).login.token;
  const tag = process.env.ROLE_TAG || Date.now().toString(36).toLowerCase();
  const roles = [
    ['sales', 'sales'],
    ['office', 'office_staff'],
    ['dispatch', 'dispatch_ops'],
    ['inventory', 'inventory_manager'],
  ];
  const users = {};
  for (const [key, role] of roles) {
    const email = `e2e-${key}-${tag}@example.test`;
    users[key] = (await gql(
      `mutation($input: CreateUserInput!) { createUser(input: $input) { id email role active } }`,
      { input: { name: `E2E ${key} ${tag}`, email, password: ROLE_PASSWORD, role, phone: `900000${String(Object.keys(users).length + 1).padStart(4, '0')}` } },
      token,
    )).createUser;
  }
  console.log(JSON.stringify({ ok: true, users }, null, 2));
}

main().catch((error) => { console.error(error.message); process.exit(1); });
