'use client';

import { useEffect } from 'react';
import { HI_HN_ARGS, HI_HN_OFF_KEY, applyHiHn } from './hi-hn';

/**
 * A one-line note for visitors from HN. Hidden by CSS unless <html> has `hi-hn-on`,
 * which the inline HI_HN_SCRIPT sets before paint (and this effect sets after a client-side navigation).
 */
export function HiHn() {
  useEffect(() => applyHiHn(...HI_HN_ARGS), []);

  function close() {
    try {
      sessionStorage.setItem(HI_HN_OFF_KEY, '1');
    } catch {
      // Storage blocked: closed for this page only.
    }
    document.documentElement.classList.add('hi-hn-off');
    const h1 = document.getElementById('h1');
    if (h1) {
      h1.tabIndex = -1;
      h1.focus({ preventScroll: true });
    }
  }

  return (
    <div className="hi-hn">
      <p>
        <span>
          Hi HN. It’s open source (AGPL), and{' '}
          <a className="link" href="https://github.com/klahrich/replyslip">
            the code is on GitHub
          </a>
          .
        </span>
        <button type="button" className="hi-hn-x" onClick={close} aria-label="Close the note for HN visitors">
          ×
        </button>
      </p>
    </div>
  );
}
