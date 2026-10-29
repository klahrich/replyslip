'use client';

import { useEffect, useRef, useState } from 'react';

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    t.setAttribute('readonly', '');
    t.style.position = 'fixed';
    t.style.opacity = '0';
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  }
}

/** A literal prompt or message with a Copy button. Same behavior as the setup prompt on / and /agents. */
export function CopyBlock({ text, label = 'Prompt copied', pre = false }: { text: string; label?: string; pre?: boolean }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    if (!(await copyText(text))) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="hw-cp">
      <p className={pre ? 'hw-cp-t hw-cp-pre' : 'hw-cp-t'} translate="no">
        {text}
      </p>
      <button type="button" className="hw-cp-b" data-copied={copied || undefined} onClick={copy}>
        <span aria-hidden={copied}>Copy</span>
        <span className="hw-cp-done" aria-hidden={!copied}>
          Copied
        </span>
      </button>
      <span className="vh" role="status">
        {copied ? label : ''}
      </span>
    </div>
  );
}
