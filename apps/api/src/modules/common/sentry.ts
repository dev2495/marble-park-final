// Sentry shim. If SENTRY_DSN is set but @sentry/node isn't installed yet, we
// fall back to console-level logging so the API still starts cleanly. The
// upgrade path is: add `@sentry/node` to dependencies and replace the
// dynamic require below with a top-level import. The call surface stays the
// same so the rest of the codebase doesn't change.

let initialised = false;

export function initSentry() {
  if (initialised) return;
  initialised = true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
      release: process.env.SENTRY_RELEASE,
    });
  } catch {
    // Sentry not installed — silent no-op.
  }
}

export function captureException(err: any, context?: Record<string, any>) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require('@sentry/node');
    Sentry.withScope((scope: any) => {
      if (context) {
        for (const [k, v] of Object.entries(context)) scope.setExtra(k, v);
      }
      Sentry.captureException(err);
    });
  } catch {
    // Fallback — print to stderr in JSON.
    try {
      process.stderr.write(
        JSON.stringify({ level: 'error', msg: 'unhandled', error: String(err?.message || err), context }) + '\n',
      );
    } catch {
      // give up
    }
  }
}
