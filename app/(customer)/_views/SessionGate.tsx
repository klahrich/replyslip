'use client';

import { Fragment, useEffect, useState } from 'react';
import { PlainFrame } from '../_components/Frame';
import { EmailSignIn, SignInCard } from '../_components/EmailSignIn';
import { UNAUTHORIZED_EVENT } from '../_lib/api';

/**
 * When any /api/v1/c call answers 401 (no session, or it expired), the whole page becomes an email-code
 * sign-in. Personal links work once, so this is how a returning customer gets back in. Once signed in, the
 * page underneath is mounted fresh so it loads again with the new session.
 */
export function SessionGate({ children }: { children: React.ReactNode }) {
  const [signedOut, setSignedOut] = useState(false);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const on = () => setSignedOut(true);
    window.addEventListener(UNAUTHORIZED_EVENT, on);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, on);
  }, []);
  if (!signedOut) return <Fragment key={generation}>{children}</Fragment>;
  return (
    <PlainFrame>
      <SignInCard>
        <EmailSignIn
          title="Sign in to continue"
          intro="Enter the email you used with this business. We'll send you a 6-digit code."
          onSignedIn={() => {
            setGeneration((g) => g + 1);
            setSignedOut(false);
          }}
        />
      </SignInCard>
    </PlainFrame>
  );
}
