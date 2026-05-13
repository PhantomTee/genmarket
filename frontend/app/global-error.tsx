'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error('Global app error:', error);

  return (
    <html>
      <body>
        <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'system-ui' }}>
          <div style={{ maxWidth: 520, textAlign: 'center' }}>
            <h1>GenMarket hit an unexpected error</h1>
            <p style={{ color: '#666' }}>{error.message}</p>
            <button onClick={reset} style={{ padding: '10px 16px', borderRadius: 10 }}>
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
