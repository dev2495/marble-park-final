import { ApolloClient, InMemoryCache, createHttpLink } from '@apollo/client';
import { setContext } from '@apollo/client/link/context';

const httpLink = createHttpLink({
  uri: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/graphql',
});

const authLink = setContext((_, { headers }) => {
  let token = null;
  if (typeof window !== 'undefined') {
    token = localStorage.getItem('auth_token');
  }
  return {
    headers: {
      ...headers,
      authorization: token ? `Bearer ${token}` : '',
    }
  }
});

export const apolloClient = new ApolloClient({
  link: authLink.concat(httpLink),
  cache: new InMemoryCache(),
  defaultOptions: {
    watchQuery: {
      fetchPolicy: 'cache-and-network',
    },
  },
});