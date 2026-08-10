const API_URL = process.env.API_URL || 'http://127.0.0.1:4012/graphql';
const APP_ORIGIN = process.env.APP_ORIGIN || 'http://127.0.0.1:3011';
const EMAIL = process.env.TEST_LOGIN_EMAIL || '';
const PASSWORD = process.env.TEST_LOGIN_PASSWORD || '';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(query, variables = {}, { cookie = '', origin = APP_ORIGIN } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    return { response, body, cookie: (response.headers.get('set-cookie') || '').split(';')[0] };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  assert(EMAIL && PASSWORD, 'TEST_LOGIN_EMAIL and TEST_LOGIN_PASSWORD are required');
  const login = await request(
    'mutation Login($input:LoginInput!){login(input:$input){authenticated user{id role}}}',
    { input: { email: EMAIL, password: PASSWORD } },
  );
  assert(login.body?.data?.login?.authenticated, `Production-mode login failed: ${JSON.stringify(login.body)}`);
  assert(/mp_session=/.test(login.cookie), 'Production-mode login did not issue a cookie');
  const setCookie = login.response.headers.get('set-cookie') || '';
  assert(/HttpOnly/i.test(setCookie) && /Secure/i.test(setCookie) && /SameSite=Lax/i.test(setCookie), 'Production cookie flags are incomplete');
  assert(/Max-Age=900(?:;|$)/.test(setCookie), 'Production cookie is not bounded to 900 seconds');

  const status = await request('{sessionStatus{idleTimeoutSeconds warningSeconds}}', {}, { cookie: login.cookie });
  assert(status.body?.data?.sessionStatus?.idleTimeoutSeconds === 900, 'Production idle timeout is not 900 seconds');
  assert(status.body?.data?.sessionStatus?.warningSeconds === 120, 'Production warning is not 120 seconds');

  const introspection = await request('{__schema{queryType{name}}}');
  assert(introspection.body?.errors?.length, 'Production GraphQL introspection is enabled');

  const crossOrigin = await request('{sessionStatus{idleTimeoutSeconds}}', {}, { cookie: login.cookie, origin: 'https://evil.example' });
  assert(crossOrigin.response.status === 403, `Cross-origin cookie request returned HTTP ${crossOrigin.response.status}, not 403`);

  const logout = await request('mutation{logout(reason:"user")}', {}, { cookie: login.cookie });
  assert(logout.body?.data?.logout === true, 'Production-mode logout failed');

  console.log(JSON.stringify({
    ok: true,
    productionIdleSeconds: 900,
    warningSeconds: 120,
    cookie: 'HttpOnly; Secure; SameSite=Lax; Max-Age=900',
    introspection: 'disabled',
    crossOriginCookieRequest: 'HTTP 403',
    logout: 'server session revoked',
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
