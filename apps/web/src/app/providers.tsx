'use client';

import { ApolloProvider } from '@apollo/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { apolloClient } from '@/lib/apollo-client';
import { ApolloErrorNotifier } from '@/components/apollo-error-notifier';

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
        {/* Respect the "reduce motion" setting for every framer-motion animation. */}
        <MotionConfig reducedMotion="user">
          <ApolloErrorNotifier />
          {children}
        </MotionConfig>
      </QueryClientProvider>
    </ApolloProvider>
  );
}
