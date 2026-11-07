'use client';

import { useEffect, useState } from 'react';

type Preview = {
  address: string;
  owner: { name: string; handle: string };
  agent: { name: string; description: string | null };
  offers: { name: string; title?: string; description: string; result_schema: unknown; input_schema?: unknown }[];
  expires_at: string;
  uses_left: number;
  connection: 'bearer' | 'redeem';
  connected: boolean;
};

type State =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; token: string; preview: Preview };

const INVALID = 'This invite link isn’t valid any more. Ask the sender for a new one.';

function instructionsFor(token: string, preview: Preview): string {
  const origin = window.location.origin;
  const offers = preview.offers.map((offer) => offer.name).join(', ');
  const http = `${origin}/api/v1/external`;
  const shared = [
    'Do not sign up for Valetto, do not choose a name, and do not send a workspace handle.',
    'You are not a member of the owner’s workspace. Valetto does not run you and cannot push results to you. Poll for status.',
    `Granted address: ${preview.address}`,
    `Granted offers: ${offers}`,
    'Call get_agent_card with that address. Then create_task with to set to the address and offer set to one granted offer. If the card includes input_schema, send input that matches it. Poll list_tasks with role sent, or get_task. If status is needs_info, call answer_task. If status is in_review, keep polling.',
    'Hosts that only connect with OAuth sign-in cannot use this link. Do not create a Valetto account.',
    `HTTP, same Authorization header, token never in the URL: POST ${http}/card {"to":"${preview.address}"}; POST ${http}/tasks {"to","offer","title","description","input"}; GET ${http}/tasks; GET ${http}/tasks/{id}; POST ${http}/tasks/{id}/answer {"answer"}.`,
  ];
  if (preview.connection === 'bearer') {
    return [
      'Connect to Valetto. This invite token is the only credential. It is not the owner’s key.',
      'The first call opens a private guest. Using the token again is the same guest.',
      'MCP, only on a host that accepts a remote URL and a static Authorization header. Valetto cannot install this for you.',
      `URL: ${origin}/api/mcp`,
      `Header: Authorization: Bearer ${token}`,
      'Transport: Streamable HTTP',
      ...shared,
    ].join('\n');
  }
  return [
    'Connect to Valetto. This link can admit more than one agent. Do not share the invite token as a bearer, or every caller would be the same guest.',
    `POST ${origin}/api/v1/invites/redeem`,
    `{"invite":"${token}"}`,
    'No Authorization header and no name. Save api_key. It is shown once and is not the owner’s key.',
    `Then, if the host accepts a static bearer, connect MCP to ${origin}/api/mcp with Authorization: Bearer <api_key>. Valetto cannot install this for you.`,
    ...shared,
  ].join('\n');
}

function mcpConfig(token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        valetto: {
          url: `${window.location.origin}/api/mcp`,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}

type Kind = { kind: 'loading' } | { kind: 'invalid' } | { kind: 'agent'; token: string } | { kind: 'customer'; token: string };

/**
 * /i#<token>. The token lives in the fragment, which browsers never send, so it stays out of access logs.
 * The prefix picks the page: rsi_ is an agent invite (VALETTO_AGENT_GUESTS), rsl_ a customer link.
 */
export function InvitePreview() {
  const [link, setLink] = useState<Kind>({ kind: 'loading' });
  useEffect(() => {
    let token = '';
    try {
      token = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      // a malformed % escape falls through to the invalid-link message
    }
    queueMicrotask(() =>
      setLink(
        token.startsWith('rsi_')
          ? { kind: 'agent', token }
          : token.startsWith('rsl_')
            ? { kind: 'customer', token }
            : { kind: 'invalid' },
      ),
    );
  }, []);
  if (link.kind === 'loading') return <p className="lead">Loading invite…</p>;
  if (link.kind === 'agent') return <AgentInvitePreview token={link.token} />;
  if (link.kind === 'customer') return <CustomerLinkHandoff />;
  return (
    <>
      <h1>Invite link</h1>
      <p className="lead">{INVALID}</p>
    </>
  );
}

/**
 * rsl_ customer links open the hosted customer page (app/(customer)/c/link). The fragment is carried over
 * as is, so the token still never reaches a server, a log, or a Referer.
 */
function CustomerLinkHandoff() {
  useEffect(() => {
    window.location.replace(`/c/link${window.location.search}${window.location.hash}`);
  }, []);
  return <p className="lead">Opening your link…</p>;
}

/** Shows what an rsi_ agent invite grants. It never redeems. */
function AgentInvitePreview({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [copied, setCopied] = useState<'prompt' | 'config' | null>(null);

  useEffect(() => {
    let cancelled = false;
    const done = (next: State) => {
      if (!cancelled) setState(next);
    };
    fetch('/api/v1/invites/preview', { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then(async (res) => {
        if (res.status === 404) return done({ kind: 'invalid' });
        if (!res.ok) return done({ kind: 'error', message: 'We couldn’t load this invite. Try again in a minute.' });
        done({ kind: 'ok', token, preview: (await res.json()) as Preview });
      })
      .catch(() => done({ kind: 'error', message: 'We couldn’t reach Valetto. Check your connection and try again.' }));
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.kind === 'loading') return <p className="lead">Loading invite…</p>;
  if (state.kind !== 'ok') {
    return (
      <>
        <h1>Invite link</h1>
        <p className="lead">{state.kind === 'invalid' ? INVALID : state.message}</p>
      </>
    );
  }

  const { preview } = state;
  const prompt = instructionsFor(token, preview);
  const config = preview.connection === 'bearer' ? mcpConfig(token) : '';
  const expires = new Date(preview.expires_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  async function copy(value: string, which: 'prompt' | 'config') {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }
  return (
    <>
      <h1>
        {preview.owner.name} is sharing <span translate="no">{preview.agent.name}</span> with your agent
      </h1>
      <p className="lead">
        Give this link to your agent. No Valetto account, no email code, and no workspace to set up. It can send{' '}
        <code translate="no">{preview.address}</code> only the tasks listed here.
      </p>
      {preview.agent.description ? <p className="inv-desc">{preview.agent.description}</p> : null}

      <h2 className="inv-h">What your agent can ask</h2>
      <ul className="inv-offers">
        {preview.offers.map((o) => (
          <li key={o.name}>
            <code translate="no">{o.name}</code>
            {o.title && o.title !== o.name ? <span className="inv-title">{o.title}</span> : null}
            <p>{o.description}</p>
            {o.input_schema ? (
              <details>
                <summary>What you send</summary>
                <pre>{JSON.stringify(o.input_schema, null, 2)}</pre>
              </details>
            ) : null}
            <details>
              <summary>What it returns</summary>
              <pre>{JSON.stringify(o.result_schema, null, 2)}</pre>
            </details>
          </li>
        ))}
      </ul>

      <h2 className="inv-h">Give this to your agent</h2>
      <p>
        Paste the instructions into your agent. It connects with the token. Valetto does not run that agent, and it
        cannot ping a host it does not control. Your agent polls for the result.
      </p>
      {preview.connected ? (
        <p className="inv-note">This link is already connected. Using it again is the same guest, not a new one.</p>
      ) : null}
      <pre className="inv-prompt" translate="no">
        {prompt}
      </pre>
      <button type="button" className="btn" onClick={() => void copy(prompt, 'prompt')}>
        {copied === 'prompt' ? 'Copied' : 'Copy instructions'}
      </button>

      {preview.connection === 'bearer' ? (
        <>
          <h2 className="inv-h">Or paste an MCP config</h2>
          <p>
            Use this only in a host that lets you set a remote MCP URL and an Authorization header, such as Cursor or a
            Claude custom connector. Valetto cannot install it for you. Hosts that only offer OAuth sign-in, including
            some ChatGPT and Claude connectors, cannot use this link. Do not create a Valetto account. Use the HTTP
            calls in the instructions instead.
          </p>
          <pre className="inv-prompt" translate="no">
            {config}
          </pre>
          <button type="button" className="btn" onClick={() => void copy(config, 'config')}>
            {copied === 'config' ? 'Copied' : 'Copy config'}
          </button>
        </>
      ) : (
        <p className="inv-note">
          This link can connect more than one agent. Each agent redeems it once and saves the guest key from the
          response. The invite token itself is not a shared login.
        </p>
      )}
      <p className="row-links">
        Already have a Valetto agent of your own? It can call <code translate="no">redeem_invite</code> to add this
        grant to that workspace. A new agent should use the instructions above.
      </p>
      <p className="row-links">
        {preview.connection === 'bearer'
          ? 'This link is one guest'
          : preview.uses_left === 1
            ? 'One connection left'
            : `${preview.uses_left} connections left`}{' '}
        and expires on {expires}. Anyone with the link can use it until then. If the owner revokes the link, this token
        stops working. Revoking the guest stops the next call even if a separate guest key was issued. After the expiry
        date, the next call fails.
      </p>
    </>
  );
}
