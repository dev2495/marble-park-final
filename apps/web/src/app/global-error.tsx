'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('Global error boundary tripped', error);
  }, [error]);

  return (
    <html>
      <body style={{ fontFamily: 'system-ui, sans-serif', background: '#f7f8fb', color: '#0f172a' }}>
        <main style={{ maxWidth: 520, margin: '120px auto', padding: 32, background: 'white', borderRadius: 16, boxShadow: '0 18px 40px -22px rgba(15,23,42,0.25)' }}>
          <h1 style={{ fontSize: 24, fontWeight: 800 }}>Something went wrong</h1>
          <p style={{ marginTop: 8, color: '#475569', lineHeight: 1.6 }}>
            We hit an unexpected error. Please try again. If it keeps happening, share the reference below with support.
          </p>
          {error?.digest ? (
            <p style={{ marginTop: 12, fontFamily: 'monospace', fontSize: 12, color: '#475569' }}>Reference: {error.digest}</p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 20, padding: '10px 16px', borderRadius: 8, background: '#2563eb', color: 'white',
              fontWeight: 600, border: 'none', cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
