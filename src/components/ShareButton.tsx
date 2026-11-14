'use client';

import { useState } from 'react';

/** Native share sheet where available, clipboard copy everywhere else. */
export function ShareButton({ text, url }: { text: string; url: string }) {
  const [status, setStatus] = useState('');

  async function share() {
    const full = `${text}\n${url}`;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Animellion', text, url });
        return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return; // user closed the sheet
      }
    }
    try {
      await navigator.clipboard.writeText(full);
      setStatus('Copied to clipboard!');
    } catch {
      setStatus('Copy failed. Select the text below to copy it.');
    }
    setTimeout(() => setStatus(''), 4000);
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <button type="button" className="btn blue" onClick={share}>
        Share result
      </button>
      <span className="hint" role="status" aria-live="polite">
        {status}
      </span>
    </div>
  );
}
