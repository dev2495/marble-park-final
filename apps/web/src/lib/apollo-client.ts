import { ApolloClient, InMemoryCache, createHttpLink, from } from '@apollo/client';
import { onError } from '@apollo/client/link/error';
import { RetryLink } from '@apollo/client/link/retry';

const httpLink = createHttpLink({
  uri: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/graphql',
  credentials: 'include',
});

// Surface GraphQL/network errors centrally and bounce the user to /login on 401-style
// "Unauthorized" / "session expired" responses rather than rendering a broken page.
const errorLink = onError(({ graphQLErrors, networkError, operation }) => {
  if (graphQLErrors) {
    const operationName = operation?.operationName || 'GraphQLOperation';
    for (const err of graphQLErrors) {
      const code = (err.extensions?.code || '').toString().toUpperCase();
      const message = err.message || 'GraphQL error';
      // eslint-disable-next-line no-console
      console.error(`[GraphQL error] ${operationName}: ${message} (code=${code})`);
      const isAuthError =
        code === 'UNAUTHENTICATED' ||
        /session expired|invalid session|not authenticated|authentication required/i.test(message);
      if (isAuthError && typeof window !== 'undefined') {
        if (!window.location.pathname.startsWith('/login')) {
          window.location.assign(`/login?redirect=${encodeURIComponent(window.location.pathname)}`);
        }
      }
    }
  }
  if (networkError) {
    // eslint-disable-next-line no-console
    console.error(`[Network error] ${operation?.operationName || ''}:`, networkError.message);
  }
});

// Retry transient network failures (not GraphQL errors) with bounded backoff.
const retryLink = new RetryLink({
  delay: { initial: 300, max: 3000, jitter: true },
  attempts: {
    max: 3,
    retryIf: (error, _operation) => {
      if (!error) return false;
      // Retry true network failures, not GraphQL/validation errors.
      const message = String(error?.message || '').toLowerCase();
      if (message.includes('failed to fetch')) return true;
      if (message.includes('networkerror')) return true;
      if (error?.statusCode && [502, 503, 504].includes(error.statusCode)) return true;
      return false;
    },
  },
});

export const apolloClient = new ApolloClient({
  link: from([errorLink, retryLink, httpLink]),
  cache: new InMemoryCache(),
  defaultOptions: {
    watchQuery: {
      fetchPolicy: 'cache-first',
      nextFetchPolicy: 'cache-first',
      errorPolicy: 'all',
      notifyOnNetworkStatusChange: false,
    },
    query: {
      fetchPolicy: 'cache-first',
      errorPolicy: 'all',
    },
    mutate: {
      errorPolicy: 'all',
    },
  },
});
