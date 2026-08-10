const API_URL = process.env.API_URL || '';
const APP_ORIGIN = process.env.APP_ORIGIN || '';
const EMAIL = process.env.TEST_LOGIN_EMAIL || '';
const PASSWORD = process.env.TEST_LOGIN_PASSWORD || '';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(query, variables = {}, cookie = '') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: APP_ORIGIN,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    return {
      response,
      body,
      cookie: (response.headers.get('set-cookie') || '').split(';')[0],
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  assert(API_URL && APP_ORIGIN && EMAIL && PASSWORD, 'API_URL, APP_ORIGIN, TEST_LOGIN_EMAIL and TEST_LOGIN_PASSWORD are required');

  const login = await request(
    'mutation Login($input:LoginInput!){login(input:$input){authenticated user{id role}}}',
    { input: { email: EMAIL, password: PASSWORD } },
  );
  assert(login.response.ok && login.body?.data?.login?.authenticated, `Login failed: ${JSON.stringify(login.body)}`);
  assert(login.cookie.startsWith('mp_session='), 'Login did not return a session cookie');

  const cookie = login.cookie;
  const boot = await request(
    'query ProductionReadOnlySmoke { me { id role effectivePermissions } sessionStatus { idleTimeoutSeconds warningSeconds } reportCatalog reportingFilterOptions reportingReadiness customers(take:2,skip:0){id name} inventoryLots(take:2) }',
    {},
    cookie,
  );
  assert(!boot.body?.errors?.length, `Read-only boot query failed: ${JSON.stringify(boot.body)}`);
  const data = boot.body?.data;
  assert(data?.me?.id && data?.me?.role, 'Authenticated identity was not returned');
  assert(data?.sessionStatus?.idleTimeoutSeconds === 900, 'Live session policy is not 900 seconds');
  assert(Array.isArray(data?.reportCatalog) && data.reportCatalog.length > 0, 'Governed report definitions are unavailable');
  assert(Array.isArray(data?.reportingReadiness) && data.reportingReadiness.length > 0, 'Reporting readiness guidance is unavailable');
  assert(Array.isArray(data?.customers) && data.customers.length <= 2, 'Customer pagination boundary failed');
  assert(Array.isArray(data?.inventoryLots) && data.inventoryLots.length <= 2, 'Inventory lot pagination boundary failed');

  const ownerReport = await request(
    'query OwnerReport($reportId:String!){reportingReport(reportId:$reportId,page:1,pageSize:5)}',
    { reportId: 'owner.pulse' },
    cookie,
  );
  assert(!ownerReport.body?.errors?.length, `Owner report query failed: ${JSON.stringify(ownerReport.body)}`);
  assert(ownerReport.body?.data?.reportingReport?.meta, 'Owner report did not return provenance metadata');
  assert((ownerReport.body?.data?.reportingReport?.rows?.items || []).length <= 5, 'Owner report pagination boundary failed');

  const logout = await request('mutation { logout(reason:"user") }', {}, cookie);
  assert(logout.body?.data?.logout === true, 'Logout failed');

  console.log(JSON.stringify({
    ok: true,
    authenticatedRole: data.me.role,
    idleTimeoutSeconds: data.sessionStatus.idleTimeoutSeconds,
    warningSeconds: data.sessionStatus.warningSeconds,
    governedDefinitionsAvailable: data.reportCatalog.length,
    readinessAreasAvailable: data.reportingReadiness.length,
    customerPageSize: data.customers.length,
    inventoryLotPageSize: data.inventoryLots.length,
    ownerReport: 'source-backed response with provenance metadata',
    logout: 'server session revoked',
    mutations: 'login/logout session lifecycle only',
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
