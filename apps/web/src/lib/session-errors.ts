type SessionErrorCandidate = {
  message?: string;
  graphQLErrors?: Array<{ message?: string; extensions?: { code?: unknown } }>;
  networkError?: { statusCode?: number };
};

const AUTHENTICATION_MESSAGE = /session expired|invalid session|not authenticated|authentication required|login required|account is disabled or missing/i;

export function isSessionAuthenticationError(error: unknown) {
  const candidate = error as SessionErrorCandidate | null;
  if (!candidate) return false;
  if (candidate.networkError?.statusCode === 401) return true;
  return (candidate.graphQLErrors || []).some((entry) => {
    const code = String(entry.extensions?.code || '').toUpperCase();
    return code === 'UNAUTHENTICATED' || AUTHENTICATION_MESSAGE.test(entry.message || '');
  }) || AUTHENTICATION_MESSAGE.test(candidate.message || '');
}
