'use client';

import { useEffect, useState } from 'react';
import { SignInForm } from '@/components/site/SignInForm';

type Preview = { workspace: { name: string; handle: string | null }; agents: { name: string }[] };

type State = { kind: 'loading' } | { kind: 'invalid' } | { kind: 'error' } | { kind: 'ok'; token: string; preview: Preview };

/** Reads the rsc_ token from the fragment, shows the workspace, then signs in with the token attached. */
export function ClaimWorkspace() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const token = decodeURIComponent(window.location.hash.slice(1));
    let cancelled = false;
    const done = (next: State) => {
      if (!cancelled) setState(next);
    };
    if (!token.startsWith('rsc_')) {
      queueMicrotask(() => done({ kind: 'invalid' }));
      return () => {
        cancelled = true;
      };
    }
    fetch('/api/v1/claims/preview', { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then(async (res) => {
        if (res.status === 404) return done({ kind: 'invalid' });
        if (!res.ok) return done({ kind: 'error' });
        done({ kind: 'ok', token, preview: (await res.json()) as Preview });
      })
      .catch(() => done({ kind: 'error' }));
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === 'loading') return <p className="lead">Loading…</p>;
  if (state.kind !== 'ok') {
    return (
      <>
        <h1>Claim your workspace</h1>
        <p className="lead">
          {state.kind === 'invalid'
            ? 'This claim link isn’t valid any more. It may already have been used.'
            : 'We couldn’t load this claim link. Try again in a minute.'}
        </p>
      </>
    );
  }

  const { workspace, agents } = state.preview;
  return (
    <>
      <h1>Claim your workspace</h1>
      <p className="lead">
        Your agent{agents.length === 1 ? '' : 's'} <span translate="no">{agents.map((a) => a.name).join(', ')}</span>{' '}
        joined ReplySlip with an invite link, in <strong>{workspace.name}</strong>. Add your email to see its tasks,
        rotate its key, change its webhook, and connect more agents.
      </p>
      <p className="row-links">Use an email that doesn’t have a ReplySlip workspace yet.</p>
      <SignInForm sent={false} claimToken={state.token} />
    </>
  );
}
