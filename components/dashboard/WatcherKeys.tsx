'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { api, errorText, formatTime } from './api';
import { OnceSecret } from './CopyButton';
import type { NewWatcherKey, WatcherKey } from './types';

async function fetchWatcherKeys(): Promise<WatcherKey[]> {
  const data = await api<{ watcher_keys: WatcherKey[] }>('/api/v1/watcher-keys');
  return data.watcher_keys;
}

/**
 * Keys for `replyslip watch`, the local process that delivers wakes to herdr and Orca panes.
 * A key belongs to the workspace, not to one agent.
 */
export function WatcherKeys() {
  const uid = useId();
  const [keys, setKeys] = useState<WatcherKey[] | null>(null);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [created, setCreated] = useState<NewWatcherKey | null>(null);

  const load = useCallback(async () => {
    try {
      setKeys(await fetchWatcherKeys());
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchWatcherKeys().then(
      (list) => {
        if (!cancelled) setKeys(list);
      },
      (err: unknown) => {
        if (!cancelled) setError(errorText(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  async function create(ev: React.FormEvent) {
    ev.preventDefault();
    const n = name.trim();
    if (!n) {
      setNameError('Name the machine this watcher runs on, for example “laptop”.');
      document.getElementById(`${uid}-name`)?.focus();
      return;
    }
    setNameError('');
    setError('');
    setBusy('create');
    try {
      const { watcher_key } = await api<{ watcher_key: NewWatcherKey }>('/api/v1/watcher-keys', {
        method: 'POST',
        body: { name: n },
      });
      setCreated(watcher_key);
      setName('');
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function revoke(id: string) {
    setError('');
    setBusy(id);
    try {
      await api(`/api/v1/watcher-keys/${id}/revoke`, { method: 'POST' });
      if (created?.id === id) setCreated(null);
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  return (
    <section className="dash-card" id="watchers" aria-labelledby="wk-h">
      <div className="dash-card-head">
        <div>
          <h2 id="wk-h">Watchers</h2>
          <p className="dash-muted">
            Local agents need a watcher key. One key per machine covers all its local agents, and it’s shown once.
          </p>
        </div>
      </div>

      <form className="dash-inline-form" onSubmit={create} noValidate autoComplete="off">
        <div className="dash-field">
          <label htmlFor={`${uid}-name`}>Machine name</label>
          <input
            id={`${uid}-name`}
            value={name}
            maxLength={100}
            placeholder="laptop"
            autoComplete="off"
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? `${uid}-name-err` : undefined}
            onChange={(e) => setName(e.target.value)}
          />
          {nameError ? (
            <p className="dash-field-err" id={`${uid}-name-err`}>
              {nameError}
            </p>
          ) : null}
        </div>
        <button type="submit" className="btn" disabled={busy !== null}>
          {busy === 'create' ? 'Creating…' : 'Create watcher key'}
        </button>
      </form>

      {error ? (
        <p className="dash-err" role="alert">
          {error}
        </p>
      ) : null}

      {created ? (
        <OnceSecret title={`Watcher key for ${created.name}. Copy it now: it won’t be shown again.`} secret={created.secret}>
          <p className="dash-secret-help">
            Paste it to your agent; it starts the watcher in another herdr or Orca pane. That machine needs herdr 0.8.0+ or Orca 1.4.199+ with
            its CLI on (Settings → Experimental → CLI).
          </p>
        </OnceSecret>
      ) : null}

      {keys === null ? null : keys.length === 0 ? (
        <p className="dash-empty">No watcher keys yet.</p>
      ) : (
        <div className="dash-table-wrap">
          <table className="dash-table">
            <caption className="vh">Watcher keys</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Key</th>
                <th scope="col">Created</th>
                <th scope="col">Last used</th>
                <th scope="col">
                  <span className="vh">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className={k.revoked_at ? 'is-revoked' : undefined}>
                  <td data-label="Name">{k.name}</td>
                  <td data-label="Key">
                    <code translate="no">{k.prefix}…</code>
                  </td>
                  <td data-label="Created">{formatTime(k.created_at)}</td>
                  <td data-label={k.revoked_at ? 'Revoked' : 'Last used'}>
                    {k.revoked_at ? `Revoked ${formatTime(k.revoked_at)}` : formatTime(k.last_used_at)}
                  </td>
                  <td className="dash-td-actions">
                    <div className="dash-actions">
                      {k.revoked_at ? null : confirming === k.id ? (
                        <>
                          <button type="button" className="dash-textbtn dash-danger" disabled={busy !== null} onClick={() => revoke(k.id)}>
                            {busy === k.id ? 'Revoking…' : `Yes, revoke ${k.name}`}
                          </button>
                          <button type="button" className="dash-textbtn" onClick={() => setConfirming(null)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button type="button" className="dash-textbtn dash-danger" disabled={busy !== null} onClick={() => setConfirming(k.id)}>
                          Revoke<span className="vh"> {k.name}</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
