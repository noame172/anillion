'use client';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="narrow card stack center">
      <h1 style={{ fontSize: 30, color: 'var(--yellow)' }}>Something went wrong</h1>
      <p>The page hit an unexpected error. Your game progress is saved on the server.</p>
      <button type="button" className="btn" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
