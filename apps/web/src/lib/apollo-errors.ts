export const APOLLO_ERROR_EVENT = 'marble:apollo-error';

export type ApolloDiagnostic = {
  title: string;
  message: string;
  hint: string;
  code?: string;
  requestId?: string;
  operation?: string;
  path?: string;
};

function graphErrors(error: any) {
  if (Array.isArray(error?.graphQLErrors) && error.graphQLErrors.length) return error.graphQLErrors;
  if (Array.isArray(error?.networkError?.result?.errors) && error.networkError.result.errors.length) return error.networkError.result.errors;
  return [];
}

export function describeApolloError(error: any, operation?: string): ApolloDiagnostic {
  const errors = graphErrors(error);
  if (errors.length) {
    const primary = errors[0];
    const codes = errors.map((item: any) => String(item.extensions?.code || '').toUpperCase()).filter(Boolean);
    const code = codes[0] || 'GRAPHQL_ERROR';
    const message = errors.map((item: any) => item.message).filter(Boolean).join(' | ');
    const requestId = errors.find((item: any) => item.extensions?.requestId)?.extensions?.requestId;
    const path = primary.path?.join?.('.') || undefined;
    if (codes.includes('UNAUTHENTICATED')) return { title: 'Session expired', message, hint: 'Sign in again, then retry your last action.', code, requestId, operation, path };
    if (codes.includes('FORBIDDEN')) return { title: 'Permission required', message, hint: 'Ask an owner to grant the required role or permission.', code, requestId, operation, path };
    if (codes.some((item: string) => ['BAD_USER_INPUT', 'BAD_REQUEST'].includes(item)) || /required|invalid|unknown|duplicate|cannot|must|exceed|changed|revalidate/i.test(message)) {
      return { title: 'Check the entered information', message, hint: 'Correct the stated fields and submit again. No confirmed data was changed.', code, requestId, operation, path };
    }
    return { title: 'The request could not be completed', message, hint: 'Retry once. If it repeats, give the reference below to the system owner.', code, requestId, operation, path };
  }

  if (error?.networkError) {
    const requestId = error.networkError?.response?.headers?.get?.('x-request-id') || undefined;
    return {
      title: 'Cannot reach the server',
      message: error.networkError.message || 'The network request failed.',
      hint: 'Check connectivity and retry. Your unconfirmed form data remains on this page.',
      code: String(error.networkError.statusCode || 'NETWORK_ERROR'),
      requestId,
      operation,
    };
  }

  return {
    title: 'The request could not be completed',
    message: error?.message || 'An unknown error occurred.',
    hint: 'Review the information and retry.',
    code: 'CLIENT_ERROR',
    operation,
  };
}

export function emitApolloDiagnostic(detail: ApolloDiagnostic) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ApolloDiagnostic>(APOLLO_ERROR_EVENT, { detail }));
}
