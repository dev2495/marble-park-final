/**
 * Resolve the database the integration tests run against.
 *  - TEST_DATABASE_URL is required (refuses to run without it).
 *  - With TEST_DB_PER_WORKER=1 each jest worker uses `<name>_w<N>` so workers never share rows.
 *    Create those with: scripts/test-db.sh <name>_w1 <name>_w2 ...
 */
export function resolveTestDatabaseUrl(): string {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) throw new Error('TEST_DATABASE_URL is not set. See scripts/test-db.sh and docs in the tooling notes.');
  if (/marble_park(\?|$|")/.test(raw) || /prod/i.test(raw)) throw new Error('TEST_DATABASE_URL looks like a real database. Refusing to run.');
  if (process.env.TEST_DB_PER_WORKER !== '1') return raw;
  const worker = process.env.JEST_WORKER_ID || '1';
  const [base, query = ''] = raw.split('?');
  return `${base}_w${worker}${query ? `?${query}` : ''}`;
}
