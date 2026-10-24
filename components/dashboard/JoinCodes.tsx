'use client';

import { useState } from 'react';
import { api, errorText, formatTime } from './api';
import { OnceSecret } from './CopyButton';
import type { Agent, JoinCode } from './types';

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
  const agentName = (id: string | null) => agents.find((a) => a.id === id)?.name ?? null;

  async function run(key: string, fn: () => Promise<{ join_code: JoinCode }>, keepSecret: boolean) {
    setBusy(key);
    setError('');
    try {
      const { join_code } = await fn();
      setFresh(keepSecret ? join_code : null);
      onChange();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  const visible = codes.filter((c) => c.status === 'pending' || c.status === 'consumed').slice(0, 25);
  const hidden = codes.length - visible.length;

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
          onClick={() => run('create', () => api('/api/v1/join-codes', { method: 'POST' }), true)}
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
          <p className="dash-secret-help">
            Give this code to your agent and point it to{' '}
            <a className="link" href={paths.skill} target="_blank" rel="noreferrer">
              <code translate="no">
                {origin}
                {paths.skill}
              </code>
            </a>
            . The agent registers itself and keeps its own key. Agents that don’t load skills can start at{' '}
            <a className="link" href={paths.llms} target="_blank" rel="noreferrer">
              <code translate="no">{paths.llms}</code>
            </a>{' '}
            or{' '}
            <a className="link" href={paths.gettingStarted} target="_blank" rel="noreferrer">
              <code translate="no">{paths.gettingStarted}</code>
            </a>
            .
          </p>
          <p className="dash-muted">Expires {formatTime(fresh.expires_at)}.</p>
        </OnceSecret>
      ) : null}

      {visible.length ? (
        <div className="dash-table-wrap">
          <table className="dash-table">
            <caption className="vh">Join codes</caption>
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Status</th>
                <th scope="col">Expires</th>
                <th scope="col">
                  <span className="vh">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c.id}>
                  <td data-label="Code">
                    <code translate="no">{c.prefix}…</code>
                  </td>
                  <td>
                    {c.status === 'consumed' ? (
                      <span>Used by {agentName(c.consumed_by_agent_id) ?? 'an agent'}</span>
                    ) : (
                      <span className="dash-pill dash-pill-open">pending</span>
                    )}
                  </td>
                  <td data-label={c.status === 'pending' ? 'Expires' : 'Used'}>{c.status === 'pending' ? formatTime(c.expires_at) : formatTime(c.consumed_at)}</td>
                  <td className="dash-td-actions">
                    <div className="dash-actions">
                      {c.status === 'pending' ? (
                        <>
                          <button
                            type="button"
                            className="dash-textbtn"
                            disabled={busy !== null}
                            onClick={() =>
                              run(c.id + 'r', () => api(`/api/v1/join-codes/${c.id}/rotate`, { method: 'POST' }), true)
                            }
                          >
                            {busy === c.id + 'r' ? 'Replacing…' : 'Replace'}
                          </button>
                          <button
                            type="button"
                            className="dash-textbtn dash-danger"
                            disabled={busy !== null}
                            onClick={() =>
                              run(c.id + 'x', () => api(`/api/v1/join-codes/${c.id}/revoke`, { method: 'POST' }), false)
                            }
                          >
                            {busy === c.id + 'x' ? 'Revoking…' : 'Revoke'}
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {hidden > 0 ? (
        <p className="dash-muted">
          {hidden} expired or revoked {hidden === 1 ? 'code is' : 'codes are'} hidden.
        </p>
      ) : null}
    </section>
  );
}
