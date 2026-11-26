// Shared helpers for the smoke and release-gate scripts: one GraphQL client, one login, small assertions.
// Replaces the per-script copies of gql() / login() / assert().
//
//   import { createApiClient, assert } from './lib/api-client.mjs';
//   const API = process.env.API_URL || 'http://localhost:4000/graphql';
//   const { gql, login } = createApiClient(API);
//   const { token } = await login(email, password);
//   const data = await gql('query { me { id } }', {}, token);

export const DEFAULT_API_URL = 'http://localhost:4000/graphql';

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message || 'Values differ'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** Runs fn and requires it to fail. Returns the error message. Optionally the message must match `pattern`. */
export async function assertRejects(fn, pattern, message) {
  let failure = null;
  try { await fn(); } catch (error) { failure = String(error?.message || error); }
  if (failure === null) throw new Error(message || 'Expected the call to be refused, but it succeeded');
  if (pattern && !pattern.test(failure)) throw new Error(`${message || 'Refused for the wrong reason'}: ${failure}`);
  return failure;
}

export function createApiClient(apiUrl = process.env.API_URL || DEFAULT_API_URL) {
  /**
   * POST a GraphQL document. Throws with every server message joined by "; ".
   * With expectError = true it never throws on GraphQL errors and returns the joined message ('' when none).
   */
  async function gql(query, variables = {}, token = '', expectError = false) {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ query, variables }),
    });
    const json = await response.json();
    const error = json.errors?.map((row) => row.message).join('; ') || '';
    if (expectError) return error;
    if (!response.ok || error) throw new Error(error || `GraphQL request failed (${response.status})`);
    return json.data;
  }

  /** Sign in and return { token, user }. */
  async function login(email, password) {
    const data = await gql(
      `mutation($input: LoginInput!) { login(input: $input) { authenticated token user { id email role name } } }`,
      { input: { email, password } },
    );
    if (!data.login?.token) throw new Error(`Login failed for ${email}`);
    return data.login;
  }

  return { gql, login, apiUrl };
}
