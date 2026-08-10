import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const WEB_URL = process.env.WEB_URL || 'http://localhost:3000';
const API_URL = process.env.API_URL || 'http://localhost:4100/graphql';
const TEST_EMAIL = process.env.TEST_EMAIL;
const TEST_PASSWORD = process.env.TEST_PASSWORD;
const CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!TEST_EMAIL || !TEST_PASSWORD) throw new Error('TEST_EMAIL and TEST_PASSWORD are required');

const outputDir = path.resolve(process.env.BROWSER_ARTIFACT_DIR || 'artifacts/reporting-readiness');
await mkdir(outputDir, { recursive: true });

async function gql(query, variables = {}, token) {
  const response = await fetch(API_URL, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ query, variables }) });
  const json = await response.json();
  if (json.errors?.length) throw new Error(json.errors.map((item) => item.message).join('; '));
  return json.data;
}

async function loginApi(email, password) {
  return (await gql(`mutation($input:LoginInput!){login(input:$input){token user{id role}}}`, { input: { email, password } })).login;
}

async function loginUi(page, email, password) {
  await page.goto(`${WEB_URL}/login`, { waitUntil: 'networkidle' });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /start workspace/i }).click();
  await page.waitForURL(/\/dashboard(?:\?|$)/, { timeout: 20_000 });
}

const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
const owner = await loginApi(TEST_EMAIL, TEST_PASSWORD);
const tag = Date.now().toString(36);
const salesEmail = `reporting-readiness-${tag}@example.test`;
const salesPassword = `Readiness${tag}!Aa9`;
let salesUserId = '';

try {
  const created = await gql(`mutation($input:CreateUserInput!){createUser(input:$input){id email role effectivePermissions}}`, { input: { name: `Reporting readiness ${tag}`, email: salesEmail, phone: '9000000088', password: salesPassword, role: 'sales', permissionOverrides: {} } }, owner.token);
  salesUserId = created.createUser.id;
  assert.equal(created.createUser.effectivePermissions.includes('settings.manage'), false, 'Sales user must not receive reporting setup permission');

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => { if (message.type() === 'error' && !/favicon/i.test(message.text())) consoleErrors.push(message.text()); });
  await loginUi(page, TEST_EMAIL, TEST_PASSWORD);
  await page.goto(`${WEB_URL}/dashboard/reports`, { waitUntil: 'networkidle' });
  for (const name of ['Owner', 'Sales', 'Finance', 'Inventory', 'Operations']) await page.getByRole('button', { name: new RegExp(name, 'i') }).first().waitFor();
  assert.equal((await page.getByText(/81 reports/i).count()), 0, 'Normal owner journey must not expose the internal report count');
  await page.screenshot({ path: path.join(outputDir, '01-report-suites-desktop.png'), fullPage: true });

  await page.getByRole('button', { name: /finance/i }).first().click();
  await page.getByRole('tab', { name: /accounting statements/i }).click();
  await page.getByRole('heading', { name: /needs governed setup/i }).waitFor();
  await page.getByRole('link', { name: /review integration path/i }).waitFor();
  await page.getByRole('link', { name: /review integration path/i }).click();
  await page.waitForURL(/\/dashboard\/reports\/setup#accounting/);
  await page.getByRole('heading', { name: /make missing report data actionable/i }).waitFor();
  for (const source of ['Targets and budgets', 'Historical quoted margin', 'Realised gross margin', 'Master-data readiness', 'Supplier payables', 'Accounting statements']) await page.getByText(source, { exact: true }).waitFor();
  await page.getByRole('button', { name: /save governed target/i }).waitFor();
  await page.screenshot({ path: path.join(outputDir, '02-data-readiness-desktop.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: /make missing report data actionable/i }).waitFor();
  assert((await page.locator('body').evaluate((element) => element.scrollWidth <= element.clientWidth + 1)), 'Reporting readiness must not overflow the mobile viewport');
  await page.screenshot({ path: path.join(outputDir, '03-data-readiness-mobile.png'), fullPage: true });

  await page.goto(`${WEB_URL}/dashboard/help#reporting-readiness`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: /set up missing report data safely/i }).first().waitFor();
  await page.screenshot({ path: path.join(outputDir, '04-readiness-help-mobile.png'), fullPage: true });
  await context.close();

  const salesContext = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
  const salesPage = await salesContext.newPage();
  await loginUi(salesPage, salesEmail, salesPassword);
  await salesPage.goto(`${WEB_URL}/dashboard/reports/setup`, { waitUntil: 'networkidle' });
  await salesPage.getByText(/reporting setup is restricted to owners and administrators/i).waitFor();
  await salesContext.close();

  assert.equal(consoleErrors.filter((message) => !/This action is restricted|ReportingSetup/i.test(message)).length, 0, `Unexpected browser console errors: ${consoleErrors.join(' | ')}`);
  console.log(JSON.stringify({ ok: true, routes: ['/dashboard/reports', '/dashboard/reports/setup', '/dashboard/help#reporting-readiness'], viewports: ['1440x1000', '390x844'], roleGate: 'owner allowed; sales rejected', screenshots: ['01-report-suites-desktop.png', '02-data-readiness-desktop.png', '03-data-readiness-mobile.png', '04-readiness-help-mobile.png'] }, null, 2));
} finally {
  if (salesUserId) await gql(`mutation($id:ID!){deleteUser(id:$id){id active}}`, { id: salesUserId }, owner.token).catch(() => null);
  await browser.close();
}
