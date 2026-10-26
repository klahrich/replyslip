'use client';

import { useState } from 'react';
import { JOIN_CODE_MAX_PENDING } from '@/lib/constants';
import { api, errorText, formatTime } from './api';
import { CopyButton, OnceSecret } from './CopyButton';
import type { Agent, JoinCode } from './types';

const HISTORY_LIMIT = 25;

export type DocPaths = { llms: string; skill: string; gettingStarted: string; api: string; mcp: string };

export function JoinCodes({
  codes,
  agents,
  origin,
  paths,
  onChange,
}: {
  codes: JoinCode[];
  agents: Agent[];
  origin: string;
  paths: DocPaths;
  onChange: () => void;
}) {
  const [fresh, setFresh] = useState<JoinCode | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const skillUrl = origin + paths.skill;
  const agentName = (id: string | null) => agents.find((a) => a.id === id)?.name ?? null;

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError('');
    try {
      await fn();
      onChange();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  const create = () =>
    run('create', async () => {
      const { join_code } = await api<{ join_code: JoinCode }>('/api/v1/join-codes', { method: 'POST' });
      setFresh(join_code);
    });

  // Replacing revokes this code and returns a new secret, so show the new one.
  const rotate = (id: string) =>
    run(id + 'r', async () => {
      const { join_code } = await api<{ join_code: JoinCode }>(`/api/v1/join-codes/${id}/rotate`, { method: 'POST' });
      setFresh(join_code);
    });

  // Only hide the code on screen if it is the one being revoked.
  const revoke = (id: string) =>
    run(id + 'x', async () => {
      await api(`/api/v1/join-codes/${id}/revoke`, { method: 'POST' });
      setFresh((shown) => (shown?.id === id ? null : shown));
    });

  // Status is computed by the server when the list is fetched, so expired codes already say 'expired'.
  const isPending = (c: JoinCode) => c.status === 'pending';
  const pending = codes.filter(isPending);
  const past = codes
    .filter((c) => !isPending(c))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const history = past.slice(0, HISTORY_LIMIT);
  const olderHidden = past.length - history.length;

  return (
    <section className="dash-card" aria-labelledby="jc-h">
      <div className="dash-card-head">
        <div>
          <h2 id="jc-h">Connect an agent</h2>
          <p className="dash-muted">
            Each join code registers one agent, then stops working. Codes expire after 24 hours.
          </p>
        </div>
        <button
          type="button"
          className="btn"
          disabled={busy !== null}
          onClick={create}
        >
          {busy === 'create' ? 'Creating…' : 'Create join code'}
        </button>
      </div>

      {error ? (
        <p className="dash-err" role="alert">
          {error}
        </p>
      ) : null}

      {fresh?.secret ? (
        <OnceSecret title="New join code. Copy it now: it won’t be shown again." secret={fresh.secret}>
          <div className="dash-prompt">
            <p className="dash-secret-title">Or paste this to your agent</p>
            <div className="dash-secret-row">
              <code translate="no" className="dash-secret-value">
                Read{' '}
                <a className="link" href={skillUrl} target="_blank" rel="noreferrer">
                  {skillUrl}
                </a>{' '}
                {PROMPT_REST}
                {fresh.secret}
              </code>
              <CopyButton value={setupPrompt(skillUrl, fresh.secret)} label="Copy prompt" />
            </div>
          </div>
          <p className="dash-secret-help">
            The agent registers itself and keeps its own key. Agents that don’t load skills can start at{' '}
            <DocLink href={origin + paths.llms} /> or <DocLink href={origin + paths.gettingStarted} />.
          </p>
          <p className="dash-secret-help">
            For a webhook, the agent can include it when it registers, or you can set delivery on the agent after it
            joins. Pick Bearer token if your endpoint checks the Authorization header, HMAC signature if it checks a
            signed body, or Static headers if it wants its own header.
          </p>
          <p className="dash-muted">Expires {formatTime(fresh.expires_at)}.</p>
        </OnceSecret>
      ) : null}

      <h3 className="dash-subhead" id="jc-pending-h">
        Waiting to be used{' '}
        <span className="dash-count">
          {pending.length} of {JOIN_CODE_MAX_PENDING}
        </span>
      </h3>
      {pending.length ? (
        <div className="dash-table-wrap">
          <table className="dash-table" aria-labelledby="jc-pending-h">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Created</th>
                <th scope="col">Expires</th>
                <th scope="col">
                  <span className="vh">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pending.map((c) => (
                <tr key={c.id}>
                  <td>
                    <code translate="no">{c.prefix}…</code>
                  </td>
                  <td data-label="Created">{formatTime(c.created_at)}</td>
                  <td data-label="Expires">{formatTime(c.expires_at)}</td>
                  <td className="dash-td-actions">
                    <div className="dash-actions">
                      <button
                        type="button"
                        className="dash-textbtn"
                        disabled={busy !== null}
                        onClick={() => rotate(c.id)}
                      >
                        {busy === c.id + 'r' ? 'Replacing…' : 'Replace'}
                      </button>
                      <button
                        type="button"
                        className="dash-textbtn dash-danger"
                        disabled={busy !== null}
                        onClick={() => revoke(c.id)}
                      >
                        {busy === c.id + 'x' ? 'Revoking…' : 'Revoke'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="dash-muted">No unused codes. Pending codes count toward the limit until they are used, revoked or expire.</p>
      )}

      {history.length ? (
        <details className="dash-sub dash-history">
          <summary>
            History <span className="dash-count">{past.length}</span>
          </summary>
          <div className="dash-table-wrap">
            <table className="dash-table">
              <caption className="vh">Used, expired and revoked join codes</caption>
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Status</th>
                  <th scope="col">When</th>
                </tr>
              </thead>
              <tbody>
                {history.map((c) => (
                  <tr key={c.id} className={c.status === 'consumed' ? undefined : 'is-revoked'}>
                    <td>
                      <code translate="no">{c.prefix}…</code>
                    </td>
                    <td>{historyLabel(c, agentName(c.consumed_by_agent_id))}</td>
                    <td data-label={historyWhenLabel(c)}>{formatTime(historyWhen(c))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {olderHidden > 0 ? (
            <p className="dash-muted">
              Showing the latest {HISTORY_LIMIT}. {olderHidden} older {olderHidden === 1 ? 'code is' : 'codes are'} not shown.
            </p>
          ) : null}
        </details>
      ) : null}
    </section>
  );
}

const PROMPT_REST = 'and set yourself up on ReplySlip. Register with this join code: ';

function setupPrompt(skillUrl: string, code: string): string {
  return `Read ${skillUrl} ${PROMPT_REST}${code}`;
}

function DocLink({ href }: { href: string }) {
  return (
    <a className="link" href={href} target="_blank" rel="noreferrer">
      <code translate="no">{href}</code>
    </a>
  );
}

function historyLabel(c: JoinCode, agent: string | null): string {
  if (c.status === 'consumed') return `Used by ${agent ?? 'an agent'}`;
  if (c.status === 'revoked') return 'Revoked';
  return 'Expired';
}

function historyWhenLabel(c: JoinCode): string {
  if (c.status === 'consumed') return 'Used';
  if (c.status === 'revoked') return 'Revoked';
  return 'Expired';
}

function historyWhen(c: JoinCode): string | null {
  if (c.status === 'consumed') return c.consumed_at;
  if (c.status === 'revoked') return c.revoked_at;
  return c.expires_at;
}
