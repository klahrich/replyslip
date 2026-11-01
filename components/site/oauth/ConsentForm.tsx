'use client';

import Link from 'next/link';
import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { ConsentProblemView } from './ConsentFrame';
import {
  appLabel,
  canAllow,
  decisionBody,
  initialSelection,
  nameProblem,
  outcomeFromResponse,
  returningText,
  type Selection,
} from './consent-logic';
import { CONSENT_POST_PATH, type ConsentProblem, type ConsentView } from './consent-types';

const noSubscribe = () => () => {};
// setTimeout's ceiling; requests last 20 minutes, so this only guards against a far-off expires_at.
const MAX_DELAY = 2_147_483_647;

/** A date in the viewer's locale, filled in after hydration (the server can't know the time zone). */
function LocalDate({ iso }: { iso: string }) {
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {mounted ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : ''}
    </time>
  );
}

type Phase = { kind: 'idle' } | { kind: 'sending'; decision: 'allow' | 'deny' } | { kind: 'returning' };

/**
 * "Allow access?" for one authorization request. What the app may and may not do, its name and host, and the
 * reconnect choices all come from the server (`ConsentView`, docs/design/mcp-oauth.md §6.1). Allow and Cancel both
 * POST /api/oauth/consent and follow the `redirect_to` it returns, so the app learns the answer either way.
 */
export function ConsentForm({ view }: { view: ConsentView }) {
  const app = appLabel(view);
  const ids = useId();
  const [selection, setSelection] = useState<Selection>(() => initialSelection(view));
  const [name, setName] = useState(view.agent.suggested_name);
  const [touched, setTouched] = useState(false);
  const [workspaceId, setWorkspaceId] = useState(view.workspaces[0]?.id ?? '');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [error, setError] = useState('');
  const [problem, setProblem] = useState<ConsentProblem | null>(null);

  // The request ends at expires_at; show that instead of letting a late Allow fail.
  useEffect(() => {
    const left = new Date(view.expires_at).getTime() - Date.now();
    if (Number.isNaN(left)) return;
    const timer = setTimeout(() => setProblem('request_expired'), Math.min(Math.max(left, 0), MAX_DELAY));
    return () => clearTimeout(timer);
  }, [view.expires_at]);

  if (problem) return <ConsentProblemView problem={problem} />;

  const atLimit = view.plan.at_agent_limit;
  const options = view.agent.reconnect_options;
  const workspace = view.workspaces.find((w) => w.id === workspaceId) ?? view.workspaces[0];
  const badName = selection.mode === 'new' ? nameProblem(name, view.agent.name_pattern) : null;
  const allowOk = canAllow(view, selection, name) && !!workspace;
  const busy = phase.kind !== 'idle';

  async function decide(decision: 'allow' | 'deny') {
    if (busy) return;
    if (decision === 'allow' && !allowOk) {
      setTouched(true);
      return;
    }
    setError('');
    setPhase({ kind: 'sending', decision });
    let status = 0;
    let data: unknown = null;
    try {
      const res = await fetch(CONSENT_POST_PATH, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(decisionBody(view, decision, selection, name, workspace?.id ?? '')),
      });
      status = res.status;
      data = await res.json().catch(() => null);
    } catch {
      setPhase({ kind: 'idle' });
      setError('Couldn’t reach Valetto. Check your connection and try again.');
      return;
    }
    const outcome = outcomeFromResponse(status, data);
    if (outcome.kind === 'redirect') {
      setPhase({ kind: 'returning' });
      window.location.assign(outcome.url);
      return;
    }
    setPhase({ kind: 'idle' });
    if (outcome.kind === 'problem') {
      setProblem(outcome.problem);
      return;
    }
    if (outcome.suggestedName) {
      setSelection({ mode: 'new' });
      setName(outcome.suggestedName);
    }
    setError(outcome.message);
  }

  if (phase.kind === 'returning') {
    return (
      <div className="oc-returning" role="status">
        <span className="oc-spinner" aria-hidden="true" />
        <p>{returningText(view)}</p>
      </div>
    );
  }

  const appWord = view.client.verified ? view.client.client_name : 'This app';

  return (
    <form
      className="oc-form"
      onSubmit={(ev) => {
        ev.preventDefault();
        void decide('allow');
      }}
    >
      <h1>Allow access?</h1>

      <div className="oc-app">
        <span className="oc-tile" aria-hidden="true">
          {app.initial}
        </span>
        <div className="oc-app-text">
          <p className="oc-app-name">
            {app.name}
            {app.verified ? null : <span className="oc-flag">Unverified</span>}
          </p>
          <p className="oc-app-host">{app.host}</p>
        </div>
      </div>

      <p className="oc-lead">
        {app.name} wants to use your Valetto workspace
        {workspace && view.workspaces.length === 1 ? (
          <>
            , <b>{workspace.name}</b>
          </>
        ) : null}
        .
      </p>

      {app.verified ? null : (
        <p className="oc-warn">Valetto can’t confirm who made this app. Only allow it if you added it yourself.</p>
      )}
      {view.redirect.loopback ? (
        <p className="oc-warn">
          This app will receive access on your own computer (localhost). Only continue if you just started this from a
          program you trust.
        </p>
      ) : app.returnsTo ? (
        <p className="oc-note">You’ll go back to {app.returnsTo}.</p>
      ) : null}

      {view.workspaces.length > 1 ? (
        <div className="oc-field">
          <label htmlFor={`${ids}-ws`}>Workspace</label>
          <select id={`${ids}-ws`} value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} disabled={busy}>
            {view.workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="oc-lists">
        {view.scope.allows.length ? (
          <section>
            <h2>It can</h2>
            <ul className="oc-list is-yes">
              {view.scope.allows.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {view.scope.denies.length ? (
          <section>
            <h2>It can’t</h2>
            <ul className="oc-list is-no">
              {view.scope.denies.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        ) : null}
        <p className="oc-note">
          {appWord} acts on what it reads in tasks, so only connect an app you trust. You can revoke it any time in your
          dashboard.
        </p>
      </div>

      <fieldset className="oc-agent" disabled={busy}>
        <legend>Connect as</legend>

        <div className={`oc-choice${atLimit ? ' is-off' : selection.mode === 'new' ? ' is-on' : ''}`}>
          <label className="oc-radio">
            <input
              type="radio"
              name="agent"
              checked={!atLimit && selection.mode === 'new'}
              disabled={atLimit}
              onChange={() => setSelection({ mode: 'new' })}
            />
            <span>A new agent</span>
          </label>
          {atLimit ? (
            <p className="oc-hint">
              Your workspace has {view.plan.agent_limit ?? 'the most'} agents, the most your plan allows.
              {options.length ? ' Reconnect an agent below, or ' : ' To connect, '}
              <Link href="/dashboard" target="_blank" rel="noopener">
                remove one in your dashboard
              </Link>
              , then reload this page.
            </p>
          ) : selection.mode === 'new' ? (
            <div className="oc-name">
              <label htmlFor={`${ids}-name`}>Agent name</label>
              <input
                id={`${ids}-name`}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setTouched(true);
                }}
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="none"
                maxLength={64}
                aria-invalid={touched && badName ? true : undefined}
                aria-describedby={`${ids}-name-hint`}
              />
              <p id={`${ids}-name-hint`} className={touched && badName ? 'oc-hint oc-bad' : 'oc-hint'}>
                {touched && badName
                  ? badName
                  : `Teammates see this name.${view.plan.agent_limit ? ` It counts toward your plan’s ${view.plan.agent_limit} agents.` : ''}`}
              </p>
            </div>
          ) : null}
        </div>

        {options.map((o) => {
          const on = selection.mode === 'reconnect' && selection.agentId === o.id;
          return (
            <div key={o.id} className={`oc-choice${on ? ' is-on' : ''}`}>
              <label className="oc-radio">
                <input
                  type="radio"
                  name="agent"
                  checked={on}
                  onChange={() => setSelection({ mode: 'reconnect', agentId: o.id })}
                />
                <span>
                  Reconnect as <b>{o.name}</b>
                </span>
              </label>
              <p className="oc-hint">
                {o.last_connected_at ? (
                  <>
                    Last connected <LocalDate iso={o.last_connected_at} />.{' '}
                  </>
                ) : null}
                {on ? `Your previous ${appWord === 'This app' ? 'connection from this app' : `${appWord} connection`} to this agent will be disconnected.` : null}
              </p>
            </div>
          );
        })}
      </fieldset>

      <p className="oc-error" role="alert">
        {error}
      </p>

      <div className="oc-actions">
        <button type="button" className="oc-btn" onClick={() => void decide('deny')} disabled={busy}>
          {phase.kind === 'sending' && phase.decision === 'deny' ? 'Cancelling…' : 'Cancel'}
        </button>
        <button type="submit" className="oc-btn oc-btn-go" disabled={busy || (!allowOk && (atLimit || touched))}>
          {phase.kind === 'sending' && phase.decision === 'allow' ? 'Allowing…' : 'Allow'}
        </button>
      </div>
    </form>
  );
}
