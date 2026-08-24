import assert from 'node:assert/strict';
import { isSessionAuthenticationError } from '../apps/web/src/lib/session-errors';

assert.equal(isSessionAuthenticationError(new Error('Failed to fetch')), false);
assert.equal(isSessionAuthenticationError({ networkError: { statusCode: 503 } }), false);
assert.equal(isSessionAuthenticationError({ networkError: { statusCode: 401 } }), true);
assert.equal(isSessionAuthenticationError({
  graphQLErrors: [{ extensions: { code: 'UNAUTHENTICATED' }, message: 'Denied' }],
}), true);
assert.equal(isSessionAuthenticationError(new Error('Session expired')), true);
assert.equal(isSessionAuthenticationError(new Error('PDF renderer unavailable')), false);

console.log('Session client resilience smoke passed.');
