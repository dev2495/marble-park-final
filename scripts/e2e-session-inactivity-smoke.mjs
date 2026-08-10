const API_URL = process.env.API_URL || 'http://127.0.0.1:4011/graphql';
const APP_ORIGIN = process.env.APP_ORIGIN || 'http://127.0.0.1:3011';
const EMAIL = process.env.TEST_LOGIN_EMAIL || '';
const PASSWORD = process.env.TEST_LOGIN_PASSWORD || '';
const EXPECTED_TIMEOUT_SECONDS = Number(process.env.EXPECTED_TIMEOUT_SECONDS || 6);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(query, variables = {}, { cookie = '', origin = APP_ORIGIN, bearer = '' } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const response = await fetch(API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json().catch(() => ({}));
  return { response, body, setCookie: response.headers.get('set-cookie') || '' };
}

async function login() {
  const result = await request(
    'mutation Login($input:LoginInput!){login(input:$input){authenticated token user{id email}}}',
    { input: { email: EMAIL, password: PASSWORD } },
  );
  assert(result.body?.data?.login?.authenticated, `Login failed: ${JSON.stringify(result.body)}`);
  assert(/mp_session=/i.test(result.setCookie), 'Login did not set mp_session');
  assert(/HttpOnly/i.test(result.setCookie), 'Session cookie is not HttpOnly');
  assert(/SameSite=Lax/i.test(result.setCookie), 'Session cookie is not SameSite=Lax');
  assert(new RegExp(`Max-Age=${EXPECTED_TIMEOUT_SECONDS}(?:;|$)`).test(result.setCookie), `Cookie Max-Age is not ${EXPECTED_TIMEOUT_SECONDS}s: ${result.setCookie}`);
  return {
    cookie: result.setCookie.split(';')[0],
    token: result.body.data.login.token,
  };
}

async function status(cookie) {
  return request('{sessionStatus{expiresAt serverTime idleTimeoutSeconds warningSeconds}}', {}, { cookie });
}

async function main() {
  assert(EMAIL && PASSWORD, 'TEST_LOGIN_EMAIL and TEST_LOGIN_PASSWORD are required');

  const first = await login();
  let result = await status(first.cookie);
  assert(result.body?.data?.sessionStatus?.idleTimeoutSeconds === EXPECTED_TIMEOUT_SECONDS, 'Server did not advertise the configured idle timeout');

  const csrfAttempt = await request('{sessionStatus{expiresAt}}', {}, { cookie: first.cookie, origin: '' });
  assert(csrfAttempt.response.status === 403, `Cookie request without Origin was not rejected (HTTP ${csrfAttempt.response.status})`);

  await pause(Math.max(1_000, Math.floor(EXPECTED_TIMEOUT_SECONDS * 400)));
  result = await request('{me{id email}}', {}, { cookie: first.cookie });
  assert(result.body?.data?.me?.id, 'Protected background-style query failed before idle deadline');
  await pause(Math.max(1_500, Math.floor(EXPECTED_TIMEOUT_SECONDS * 700)));
  result = await status(first.cookie);
  assert(result.body?.errors?.some((entry) => /session expired/i.test(entry.message)), 'Background authenticated query incorrectly extended the session');

  const second = await login();
  await pause(Math.max(1_000, Math.floor(EXPECTED_TIMEOUT_SECONDS * 500)));
  result = await request('mutation{keepSessionAlive{expiresAt idleTimeoutSeconds}}', {}, { cookie: second.cookie });
  assert(result.body?.data?.keepSessionAlive?.idleTimeoutSeconds === EXPECTED_TIMEOUT_SECONDS, 'Explicit keep-alive failed');
  const refreshedCookie = (result.setCookie || '').split(';')[0] || second.cookie;
  await pause(Math.max(1_000, Math.floor(EXPECTED_TIMEOUT_SECONDS * 650)));
  result = await status(refreshedCookie);
  assert(result.body?.data?.sessionStatus?.expiresAt, 'Meaningful explicit keep-alive did not extend the session');

  result = await request('mutation{logout(reason:"user")}', {}, { cookie: refreshedCookie });
  assert(result.body?.data?.logout === true, 'Logout failed');
  result = await status(refreshedCookie);
  assert(result.body?.errors?.some((entry) => /session expired/i.test(entry.message)), 'Logged-out session was still accepted');

  console.log(JSON.stringify({
    ok: true,
    idleTimeoutSeconds: EXPECTED_TIMEOUT_SECONDS,
    cookie: 'HttpOnly; SameSite=Lax; bounded Max-Age',
    csrf: 'cookie request without Origin rejected',
    backgroundPolling: 'did not extend idle deadline',
    meaningfulKeepAlive: 'extended idle deadline',
    logout: 'server session revoked',
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});

