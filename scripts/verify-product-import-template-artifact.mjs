import fs from 'node:fs/promises';
import path from 'node:path';
import { FileBlob, SpreadsheetFile } from '/Users/devarshthakkar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';

const API = process.env.API_URL || 'http://localhost:4000/graphql';
const EMAIL = process.env.TEST_EMAIL || 'admin@marblepark.com';
const PASSWORD = process.env.TEST_PASSWORD || 'password123';
const outputDir = path.resolve(process.cwd(), 'output/product-import-template-2026-07-17');

async function gql(query, variables = {}, token) {
  const response = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const json = await response.json();
  if (!response.ok || json.errors?.length) throw new Error(json.errors?.map((row) => row.message).join('; ') || `GraphQL failed (${response.status})`);
  return json.data;
}

await fs.mkdir(outputDir, { recursive: true });
const token = (await gql('mutation($input: LoginInput!) { login(input: $input) { token } }', { input: { email: EMAIL, password: PASSWORD } })).login.token;
const template = (await gql('query { productImportTemplate }', {}, token)).productImportTemplate;
const templatePath = path.join(outputDir, template.filename);
await fs.writeFile(templatePath, Buffer.from(template.contentBase64, 'base64'));

const input = await FileBlob.load(templatePath);
const workbook = await SpreadsheetFile.importXlsx(input);
const inspection = await workbook.inspect({ kind: 'workbook,sheet,table,definedName', maxChars: 12000, tableMaxRows: 8, tableMaxCols: 12, tableMaxCellChars: 120 });
await fs.writeFile(path.join(outputDir, 'artifact-inspection.ndjson'), inspection.ndjson || String(inspection));

for (const sheetName of ['Product Master', 'How to use', 'Live Master Lists', 'Reference details']) {
  const preview = await workbook.render({ sheetName, autoCrop: 'all', scale: 1, format: 'png' });
  await fs.writeFile(path.join(outputDir, `${sheetName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`), new Uint8Array(await preview.arrayBuffer()));
}

console.log(JSON.stringify({ ok: true, templatePath, masterCounts: template.masterCounts, generatedAt: template.generatedAt }, null, 2));
