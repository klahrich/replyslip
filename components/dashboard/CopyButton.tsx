'use client';

import { useState } from 'react';

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <button
      type="button"
      className="dash-btn dash-btn-ink"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setState('copied');
        } catch {
          setState('failed');
        }
        setTimeout(() => setState('idle'), 2000);
      }}
    >
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Select and copy' : label}
      <span className="vh" role="status" aria-live="polite">
        {state === 'copied' ? 'Copied to clipboard' : ''}
      </span>
    </button>
  );
}

/** A secret that is shown exactly once, with a copy button. */
export function OnceSecret({ title, secret, children }: { title: string; secret: string; children?: React.ReactNode }) {
  return (
    <div className="dash-secret" role="region" aria-label={title}>
      <p className="dash-secret-title">{title}</p>
      <div className="dash-secret-row">
        <code translate="no" className="dash-secret-value">
          {secret}
        </code>
        <CopyButton value={secret} />
      </div>
      {children}
    </div>
  );
}
