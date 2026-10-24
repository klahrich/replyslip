'use client';

import { useState } from 'react';
import { api, errorText, formatTime } from './api';
import { OnceSecret } from './CopyButton';
import type { Agent, AgentKey, NewAgentKey } from './types';

function deliveryLabel(a: Agent): string {
  if (a.delivery.mode === 'webhook') {
    let host = '';
    try {
      host = a.delivery.url ? new URL(a.delivery.url).host : '';
    } catch {
      host = '';
    }
    return `Webhook${host ? ` · ${host}` : ''}`;
  }
  if (a.delivery.mode === 'herdr') return `Terminal watcher${a.delivery.pane ? ` · pane ${a.delivery.pane}` : ''}`;
  return 'Checks the relay itself';
}

export function Agents({
  agents,
  keys,
  onChange,
}: {
  agents: Agent[];
  keys: Record<string, AgentKey[]>;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const [newKey, setNewKey] = useState<{ agentId: string; key: NewAgentKey } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function run(id: string, fn: () => Promise<void>) {
    setBusy(id);
    setError(null);
    try {
      await fn();
      onChange();
    } catch (err) {
      setError({ id, text: errorText(err) });
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  const sorted = [...agents].sort((a, b) => Number(!!a.revoked_at) - Number(!!b.revoked_at));

  return (
    <section className="dash-card" aria-labelledby="ag-h">
      <div className="dash-card-head">
        <div>
          <h2 id="ag-h">Agents</h2>
          <p className="dash-muted">
            Each agent signs its calls with its own key. Keys are stored as hashes, so only the prefix is shown here.
          </p>
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="dash-empty">No agents yet. Create a join code above and give it to your first agent.</p>
      ) : (
        <ul className="dash-agents">
          {sorted.map((a) => {
            const agentKeys = keys[a.id] ?? [];
            const revoked = !!a.revoked_at;
            return (
              <li key={a.id} className={revoked ? 'dash-agent is-revoked' : 'dash-agent'}>
                <div className="dash-agent-head">
                  <div>
                    <h3>
                      <span translate="no">{a.name}</span>
                      {revoked ? <span className="dash-pill dash-pill-failed">revoked</span> : null}
                    </h3>
                    {a.description ? <p className="dash-agent-desc">{a.description}</p> : null}
                    <p className="dash-muted">
                      Joined {formatTime(a.created_at)} · {deliveryLabel(a)}
                    </p>
                  </div>
                  {!revoked ? (
                    <div className="dash-actions">
                      <button
                        type="button"
                        className="dash-textbtn"
                        disabled={busy !== null}
                        onClick={() =>
                          run(a.id + 'k', async () => {
                            const { key } = await api<{ key: NewAgentKey }>(`/api/v1/agents/${a.id}/keys`, {
                              method: 'POST',
                            });
                            setNewKey({ agentId: a.id, key });
                          })
                        }
                      >
                        {busy === a.id + 'k' ? 'Creating…' : 'New key'}
                      </button>
                      {confirming === a.id ? (
                        <>
                          <button
                            type="button"
                            className="dash-textbtn dash-danger"
                            disabled={busy !== null}
                            onClick={() =>
                              run(a.id, async () => {
                                await api(`/api/v1/agents/${a.id}/revoke`, { method: 'POST' });
                              })
                            }
                          >
                            {busy === a.id ? 'Revoking…' : `Yes, revoke ${a.name}`}
                          </button>
                          <button type="button" className="dash-textbtn" onClick={() => setConfirming(null)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="dash-textbtn dash-danger"
                          disabled={busy !== null}
                          onClick={() => setConfirming(a.id)}
                        >
                          Revoke agent
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>

                {error?.id.startsWith(a.id) ? (
                  <p className="dash-err" role="alert">
                    {error.text}
                  </p>
                ) : null}

                {newKey?.agentId === a.id ? (
                  <OnceSecret title={`New key for ${a.name}. Copy it now: it won’t be shown again.`} secret={newKey.key.secret}>
                    <p className="dash-secret-help">
                      Give it to {a.name} as <code translate="no">Authorization: Bearer …</code> on its MCP connection.
                    </p>
                  </OnceSecret>
                ) : null}

                {agentKeys.length ? (
                  <div className="dash-table-wrap">
                    <table className="dash-table">
                      <caption className="vh">Keys for {a.name}</caption>
                      <thead>
                        <tr>
                          <th scope="col">Key</th>
                          <th scope="col">Created</th>
                          <th scope="col">Last used</th>
                          <th scope="col">
                            <span className="vh">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {agentKeys.map((k) => (
                          <tr key={k.id} className={k.revoked_at ? 'is-revoked' : undefined}>
                            <td data-label="Key">
                              <code translate="no">{k.prefix}…</code>
                            </td>
                            <td data-label="Created">{formatTime(k.created_at)}</td>
                            <td data-label={k.revoked_at ? 'Revoked' : 'Last used'}>{k.revoked_at ? `Revoked ${formatTime(k.revoked_at)}` : formatTime(k.last_used_at)}</td>
                            <td className="dash-td-actions">
                              <div className="dash-actions">
                                {!k.revoked_at && !revoked ? (
                                  <button
                                    type="button"
                                    className="dash-textbtn dash-danger"
                                    disabled={busy !== null}
                                    onClick={() =>
                                      run(a.id + k.id, async () => {
                                        await api(`/api/v1/agents/${a.id}/keys/${k.id}/revoke`, { method: 'POST' });
                                      })
                                    }
                                  >
                                    {busy === a.id + k.id ? 'Revoking…' : 'Revoke key'}
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="dash-muted">No keys.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
