const API = process.env.API_URL || 'http://localhost:4000/graphql';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@marblepark.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password123';

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

async function login(email, password = TEST_PASSWORD) {
  return (await gql(
    `mutation($input: LoginInput!) { login(input: $input) { token user { id email role } } }`,
    { input: { email, password } },
  )).login;
}

async function createUser(token, input) {
  return (await gql(
    `mutation($input: CreateUserInput!) {
      createUser(input: $input) {
        id
        email
        role
        active
        avatarUrl
        bio
        permissionOverrides
        effectivePermissions
      }
    }`,
    { input },
    token,
  )).createUser;
}

async function deleteUser(token, id) {
  await gql(`mutation($id: ID!) { deleteUser(id: $id) { id active } }`, { id }, token).catch(() => null);
}

async function main() {
  const tag = unique('RBAC');
  const password = `RbacPass${tag}!`;
  const admin = await login(TEST_EMAIL);
  const createdUserIds = [];

  try {
    const owner = await createUser(admin.token, {
      name: `RBAC Owner ${tag}`,
      email: `rbac-owner-${tag.toLowerCase()}@example.com`,
      phone: '9000000001',
      password,
      role: 'owner',
      avatarUrl: '/catalogue-images/manual/rbac-owner.png',
      bio: 'RBAC smoke owner.',
      permissionOverrides: {},
    });
    createdUserIds.push(owner.id);
    assert(owner.role === 'owner', 'admin should create owner');
    assert(owner.avatarUrl, 'create user should accept avatarUrl without GraphQL 400');
    assert(owner.bio === 'RBAC smoke owner.', 'create user should accept bio without GraphQL 400');

    const ownerSession = await login(owner.email, password);
    assert(ownerSession.user.role === 'owner', 'temporary owner should be able to log in');

    const skuManager = await createUser(ownerSession.token, {
      name: `RBAC SKU Manager ${tag}`,
      email: `rbac-sku-${tag.toLowerCase()}@example.com`,
      phone: '9000000002',
      password,
      role: 'sales',
      permissionOverrides: { 'products.manage': true, 'master_data.manage': true },
    });
    createdUserIds.push(skuManager.id);
    assert(skuManager.role === 'sales', 'owner should create a sales user');
    assert(skuManager.effectivePermissions.includes('products.manage'), 'per-user products.manage override should be effective');

    const accessManager = await createUser(ownerSession.token, {
      name: `RBAC Access Manager ${tag}`,
      email: `rbac-access-${tag.toLowerCase()}@example.com`,
      phone: '9000000003',
      password,
      role: 'sales',
      permissionOverrides: { 'users.manage': true },
    });
    createdUserIds.push(accessManager.id);
    assert(accessManager.effectivePermissions.includes('users.manage'), 'per-user users.manage override should be effective');

    const skuSession = await login(skuManager.email, password);
    const product = (await gql(
      `mutation($input: CreateProductInput!) { createProduct(input: $input) { id sku name } }`,
      {
        input: {
          sku: unique('RBAC-SKU'),
          name: 'RBAC Override Product',
          category: 'Accessories',
          brand: 'Marble Park',
          unit: 'PC',
          sellPrice: 999,
          floorPrice: 800,
        },
      },
      skuSession.token,
    )).createProduct;
    assert(product.id, 'sales user with products.manage should create SKU');

    const accessSession = await login(accessManager.email, password);
    const createdByOverride = await createUser(accessSession.token, {
      name: `RBAC Created By Override ${tag}`,
      email: `rbac-created-${tag.toLowerCase()}@example.com`,
      phone: '9000000004',
      password,
      role: 'dispatch_ops',
      permissionOverrides: { 'dispatch.manage': true },
    });
    createdUserIds.push(createdByOverride.id);
    assert(createdByOverride.role === 'dispatch_ops', 'user with users.manage override should create another user');

    console.log(JSON.stringify({
      ok: true,
      ownerId: owner.id,
      skuManagerId: skuManager.id,
      accessManagerId: accessManager.id,
      createdByOverrideId: createdByOverride.id,
      productSku: product.sku,
    }, null, 2));
  } finally {
    for (const id of createdUserIds.reverse()) await deleteUser(admin.token, id);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
