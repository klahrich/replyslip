'use client';

import { useEffect, useState } from 'react';
import { PlainFrame } from '../_components/Frame';
import { Notice } from '../_components/Notice';
import { UNAUTHORIZED_EVENT } from '../_lib/api';

/**
 * When any /api/v1/c call answers 401 (no session, or it expired), the whole page becomes one sign-in notice.
 * Customers sign in through the link the business sent them; there's no separate customer sign-in page yet.
 */
export function SessionGate({ children }: { children: React.ReactNode }) {
  const [signedOut, setSignedOut] = useState(false);
  useEffect(() => {
    const on = () => setSignedOut(true);
    window.addEventListener(UNAUTHORIZED_EVENT, on);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, on);
  }, []);
  if (!signedOut) return children;
  return (
    <PlainFrame>
      <Notice title="Sign in to continue">
        <p>Open the link the business sent you to sign in again. Your requests are still here.</p>
      </Notice>
    </PlainFrame>
  );
}
