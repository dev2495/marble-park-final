const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const TWO_MINUTES_MS = 2 * 60 * 1000;

function finitePositiveInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Production sessions always use the contracted 15-minute idle window.
 * A millisecond override is intentionally accepted only in NODE_ENV=test so
 * browser and API acceptance tests can prove expiry without waiting 15 minutes.
 */
export function sessionIdleTimeoutMs(): number {
  if (process.env.NODE_ENV === 'test') {
    return finitePositiveInteger(process.env.SESSION_IDLE_TIMEOUT_MS) ?? FIFTEEN_MINUTES_MS;
  }

  const configuredMinutes = finitePositiveInteger(process.env.SESSION_IDLE_TIMEOUT_MINUTES) ?? 15;
  if (process.env.NODE_ENV === 'production' && configuredMinutes !== 15) {
    throw new Error('SESSION_IDLE_TIMEOUT_MINUTES must be exactly 15 in production');
  }
  return configuredMinutes * 60 * 1000;
}

export function sessionWarningMs(idleTimeoutMs = sessionIdleTimeoutMs()): number {
  return Math.min(TWO_MINUTES_MS, Math.max(1_000, Math.floor(idleTimeoutMs / 3)));
}

export function nextIdleExpiry(now = new Date()): Date {
  return new Date(now.getTime() + sessionIdleTimeoutMs());
}

