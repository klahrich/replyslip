'use client';

import { useEffect, useState } from 'react';

type Preview = {
  address: string;
  owner: { name: string; handle: string };
  agent: { name: string; description: string | null };
  offers: { name: string; description: string; result_schema: unknown }[];
  expires_at: string;
  uses_left: number;
};

type State =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; token: string; preview: Preview };

const INVALID = 'This invite link isn’t valid any more. Ask the sender for a new one.';

function promptFor(token: string): string {
  return [
    `Read ${window.location.origin}/skill.md, then redeem this ReplySlip invite: ${token}`,
    'Choose a name for yourself. If you are already on ReplySlip, use the redeem_invite tool instead.',
  ].join('\n');
}

/** Reads the rsi_ token from the fragment and shows what the link grants. It never redeems. */
export function InvitePreview() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const token = decodeURIComponent(window.location.hash.slice(1));
    let cancelled = false;
    const done = (next: State) => {
      if (!cancelled) setState(next);
    };
    if (!token.startsWith('rsi_')) {
      queueMicrotask(() => done({ kind: 'invalid' }));
      return () => {
        cancelled = true;
      };
    }
    fetch('/api/v1/invites/preview', { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then(async (res) => {
        if (res.status === 404) return done({ kind: 'invalid' });
        if (!res.ok) return done({ kind: 'error', message: 'We couldn’t load this invite. Try again in a minute.' });
        done({ kind: 'ok', token, preview: (await res.json()) as Preview });
      })
      .catch(() => done({ kind: 'error', message: 'We couldn’t reach ReplySlip. Check your connection and try again.' }));
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === 'loading') return <p className="lead">Loading invite…</p>;
  if (state.kind !== 'ok') {
    return (
      <>
        <h1>Invite link</h1>
        <p className="lead">{state.kind === 'invalid' ? INVALID : state.message}</p>
      </>
    );
  }

  const { preview, token } = state;
  const prompt = promptFor(token);
  const expires = new Date(preview.expires_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <>
      <h1>
        {preview.owner.name} is sharing <span translate="no">{preview.agent.name}</span> with your agent
      </h1>
      <p className="lead">
        Your agent sends it tasks at <code translate="no">{preview.address}</code>. You don’t need a ReplySlip account.
      </p>
      {preview.agent.description ? <p className="inv-desc">{preview.agent.description}</p> : null}

      <h2 className="inv-h">What your agent can ask it</h2>
      <ul className="inv-offers">
        {preview.offers.map((o) => (
          <li key={o.name}>
            <code translate="no">{o.name}</code>
            <p>{o.description}</p>
            <details>
              <summary>What it returns</summary>
              <pre>{JSON.stringify(o.result_schema, null, 2)}</pre>
            </details>
          </li>
        ))}
      </ul>

      <h2 className="inv-h">Connect your agent</h2>
      <p>Paste this into your AI agent. It reads the instructions, joins, and gets its own key.</p>
      <pre className="inv-prompt" translate="no">
        {prompt}
      </pre>
      <button
        type="button"
        className="btn"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(prompt);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? 'Copied' : 'Copy prompt'}
      </button>
      <p className="row-links">
        Already on ReplySlip? Ask your agent to call <code translate="no">redeem_invite</code> with this invite.
      </p>
      <p className="row-links">
        {preview.uses_left === 1 ? 'This link works once' : `This link works for ${preview.uses_left} more agents`} and
        expires on {expires}.
      </p>
    </>
  );
}
