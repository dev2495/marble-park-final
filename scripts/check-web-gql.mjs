#!/usr/bin/env node
// Validates every gql`...` document in apps/web/src against the API's GraphQL schema.
// A field or argument the API does not have would be a 400 (GRAPHQL_VALIDATION_FAILED) in the browser.
// The schema is built from the API's resolver classes (no database, no server): TypeScript files are
// transpiled on the fly with decorator metadata, the same way the jest harness (ts-jest transpilation) does.
// Usage: node scripts/check-web-gql.mjs [--print-schema <file>]
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = path.join(root, 'apps/api');
const webSrc = path.join(root, 'apps/web/src');
const require = createRequire(path.join(apiDir, 'package.json'));

function walk(dir, match, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, match, out);
    else if (match(full)) out.push(full);
  }
  return out;
}

// 1. Require hook: transpile apps/api TypeScript with emitDecoratorMetadata (types come from decorators).
const ts = require('typescript');
const tsconfig = ts.readConfigFile(path.join(apiDir, 'tsconfig.json'), ts.sys.readFile).config || {};
const compilerOptions = {
  ...ts.convertCompilerOptionsFromJson(tsconfig.compilerOptions || {}, apiDir).options,
  module: ts.ModuleKind.CommonJS, sourceMap: false, inlineSourceMap: false, declaration: false, incremental: false,
};
const Module = require('node:module');
Module._extensions['.ts'] = (module, filename) => {
  const source = readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions, fileName: filename });
  module._compile(outputText, filename);
};

process.env.NOTIFICATIONS_WORKER_DISABLED = '1';
require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { GraphQLSchemaBuilderModule, GraphQLSchemaFactory } = require('@nestjs/graphql');
const graphql = require('graphql');
// The API's own extra rule (depth and size limit), so a screen asking for too much also fails here.
const { graphqlLimitRule } = require(path.join(apiDir, 'src/modules/common/graphql-limits.ts'));

// 2. Every class marked @Resolver in apps/api/src.
const RESOLVER_KEY = 'graphql:resolver_name'; // set by every @Resolver(), with or without a type
const resolvers = new Set();
const resolverFiles = walk(path.join(apiDir, 'src'), (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts') && /@Resolver\(/.test(readFileSync(f, 'utf8')));
for (const file of resolverFiles) {
  const exported = require(file);
  for (const value of Object.values(exported)) {
    if (typeof value === 'function' && Reflect.hasMetadata(RESOLVER_KEY, value)) resolvers.add(value);
  }
}
if (!resolvers.size) { console.error('check-web-gql: no resolvers found'); process.exit(2); }

const app = await NestFactory.create(GraphQLSchemaBuilderModule, { logger: false });
await app.init();
const schema = await app.get(GraphQLSchemaFactory).create([...resolvers]);
await app.close();
const printIndex = process.argv.indexOf('--print-schema');
if (printIndex > 0 && process.argv[printIndex + 1]) writeFileSync(process.argv[printIndex + 1], graphql.printSchema(schema));

// 3. Every gql`...` in apps/web/src, validated with the standard rules (fragments resolved per file).
const failures = [];
let documents = 0;
const webFiles = walk(webSrc, (f) => /\.(tsx?|jsx?|mjs)$/.test(f));
for (const file of webFiles) {
  const text = readFileSync(file, 'utf8');
  const pattern = /gql`([\s\S]*?)`/g;
  let match;
  while ((match = pattern.exec(text))) {
    documents += 1;
    const line = text.slice(0, match.index).split('\n').length;
    const where = `${path.relative(root, file)}:${line}`;
    // ${NAME} is filled in from a `const NAME = \`...\`` (plain or gql) string in the same file.
    const body = match[1].replace(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g, (whole, name) => {
      const found = new RegExp(`const\\s+${name}\\s*=\\s*(?:gql)?\`([^\`]*)\``).exec(text);
      return found && !found[1].includes('${') ? found[1] : whole;
    });
    if (body.includes('${')) { failures.push(`${where}  uses \${...} inside gql that is not a plain string in this file; the checker cannot read it`); continue; }
    let doc;
    try { doc = graphql.parse(body); } catch (error) { failures.push(`${where}  does not parse: ${error.message}`); continue; }
    for (const error of graphql.validate(schema, doc, [...graphql.specifiedRules, graphqlLimitRule])) failures.push(`${where}  ${error.message}`);
  }
}

console.log(`check-web-gql: ${resolvers.size} resolvers, ${documents} gql documents in ${webFiles.length} web files, ${failures.length} problem(s)`);
for (const failure of failures) console.log(`  ${failure}`);
process.exit(failures.length ? 1 : 0);
