'use client';

import { ApolloProvider } from '@apollo/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { apolloClient } from '@/lib/apollo-client';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        refetchOnWindowFocus: false,
      },
    },
  }));

  return (
    <ApolloProvider client={apolloClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </ApolloProvider>
  );
}