'use client';

import { Fragment, useEffect, useState } from 'react';
import { api, ApiError, errorText } from './api';
import { CopyButton } from './CopyButton';
import { LocalTime } from './LocalTime';
import {
  appHost,
  appName,
  CONNECTED_APPS_PATH,
  MCP_URL,
  endedAt,
  pastLabel,
  replaceConnectedApp,
  revokePath,
  revokeQuestion,
  splitConnectedApps,
  type ConnectedApp,
  type ConnectedAppsResponse,
} from './connected-apps';

type Load = { state: 'loading' } | { state: 'off' } | { state: 'ready'; apps: ConnectedApp[] } | { state: 'error'; message: string };

async function fetchConnectedApps(): Promise<Load> {
  try {
    const { connected_apps } = await api<ConnectedAppsResponse>(CONNECTED_APPS_PATH);
    return { state: 'ready', apps: connected_apps };
  } catch (err) {
    // No route yet (connecting apps is switched off): show nothing rather than an error.
    if (err instanceof ApiError && err.status === 404) return { state: 'off' };
    return { state: 'error', message: errorText(err) };
  }
}

function AppCell({ app }: { app: ConnectedApp }) {
  return (
    <div className="dash-app">
      <span className="dash-app-name">
        {appName(app)}
        {app.client.verified ? null : <span className="dash-app-flag">Unverified</span>}
      </span>
      <span className="dash-muted" translate="no">
        {appHost(app)}
      </span>
    </div>
  );
}

/** ChatGPT and Claude connections: one row each, with Revoke. Revoking keeps the agent and its tasks. */
export function ConnectedApps() {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    void fetchConnectedApps().then((next) => {
      if (!cancelled) setLoad(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function revoke(app: ConnectedApp) {
    setError('');
    setNotice('');
    setBusy(app.id);
    try {
      const { connected_app } = await api<{ connected_app: ConnectedApp }>(revokePath(app.id), { method: 'POST' });
      setLoad((cur) => (cur.state === 'ready' ? { state: 'ready', apps: replaceConnectedApp(cur.apps, connected_app) } : cur));
      setConfirming(null);
      setNotice(`Revoked ${appName(app)}. The agent ${app.agent.name} is still in your agents list.`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  if (load.state === 'off' || load.state === 'loading') return null;

  const { current, past } = load.state === 'ready' ? splitConnectedApps(load.apps) : { current: [], past: [] };

  return (
    <section className="dash-card dash-apps" id="connected-apps" aria-labelledby="ca-h">
      <div className="dash-card-head">
        <div>
          <h2 id="ca-h">Connected apps</h2>
          <p className="dash-muted">
            ChatGPT and Claude connect as their own agent. They can send tasks and read their own tasks and answers.
          </p>
        </div>
      </div>

      {load.state === 'error' ? (
        <p className="dash-err" role="alert">
          {load.message}
        </p>
      ) : null}
      {error ? (
        <p className="dash-err" role="alert">
          {error}
        </p>
      ) : null}

      <p className="dash-ok dash-apps-notice" role="status">
        {notice}
      </p>

      {load.state === 'ready' && current.length === 0 ? (
        <div className="dash-empty dash-apps-empty">
          <p>No connected apps. To connect one, paste this into ChatGPT or Claude:</p>
          <div className="dash-secret-row">
            <code translate="no" className="dash-secret-value">
              {MCP_URL}
            </code>
            <CopyButton value={MCP_URL} />
          </div>
        </div>
      ) : null}

      {current.length > 0 ? (
        <div className="dash-table-wrap">
          <table className="dash-table">
            <caption className="vh">Connected apps</caption>
            <thead>
              <tr>
                <th scope="col">App</th>
                <th scope="col">Agent</th>
                <th scope="col">Connected</th>
                <th scope="col">Last used</th>
                <th scope="col">Expires</th>
                <th scope="col">
                  <span className="vh">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {current.map((app) => (
                <Fragment key={app.id}>
                  <tr className={confirming === app.id ? 'is-confirming' : undefined}>
                    <td>
                      <AppCell app={app} />
                    </td>
                    <td data-label="Agent">
                      <code translate="no">{app.agent.name}</code>
                    </td>
                    <td data-label="Connected">
                      <LocalTime iso={app.created_at} />
                    </td>
                    <td data-label="Last used">{app.last_used_at ? <LocalTime iso={app.last_used_at} /> : 'Not yet'}</td>
                    <td data-label="Expires">
                      <LocalTime iso={app.expires_at} />
                    </td>
                    <td className="dash-td-actions">
                      <div className="dash-actions">
                        {confirming === app.id ? null : (
                          <button
                            type="button"
                            className="dash-textbtn dash-danger"
                            disabled={busy !== null}
                            onClick={() => setConfirming(app.id)}
                          >
                            Revoke<span className="vh"> {appName(app)}</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {confirming === app.id ? (
                    <tr className="dash-apps-confirm-row">
                      <td colSpan={6}>
                        <div className="dash-confirm" role="group" aria-label={`Revoke ${appName(app)}`}>
                          <p>{revokeQuestion(app)}</p>
                          <div className="dash-actions">
                            <button
                              type="button"
                              className="dash-textbtn dash-danger"
                              disabled={busy !== null}
                              onClick={() => revoke(app)}
                            >
                              {busy === app.id ? 'Revoking…' : `Yes, revoke ${appName(app)}`}
                            </button>
                            <button
                              type="button"
                              className="dash-textbtn"
                              disabled={busy !== null}
                              onClick={() => setConfirming(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {past.length > 0 ? (
        <details className="dash-apps-past">
          <summary>
            Ended in the last 30 days <span className="dash-muted">({past.length})</span>
          </summary>
          <div className="dash-table-wrap">
            <table className="dash-table">
              <caption className="vh">Ended connections</caption>
              <thead>
                <tr>
                  <th scope="col">App</th>
                  <th scope="col">Agent</th>
                  <th scope="col">Connected</th>
                  <th scope="col">Ended</th>
                </tr>
              </thead>
              <tbody>
                {past.map((app) => (
                  <tr key={app.id} className="is-revoked">
                    <td>
                      <AppCell app={app} />
                    </td>
                    <td data-label="Agent">
                      <code translate="no">{app.agent.name}</code>
                    </td>
                    <td data-label="Connected">
                      <LocalTime iso={app.created_at} />
                    </td>
                    <td data-label="Ended">
                      <LocalTime iso={endedAt(app)} /> <span className="dash-muted">· {pastLabel(app.status)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </section>
  );
}
