'use client';

import { useState } from 'react';
import { api, errorText } from './api';
import type { Agent } from './types';

/** Turns sharing on or off for one agent (PUT /api/v1/agents/:id/sharing { shared }). */
export function SharingToggle({ agent, handle, onChange }: { agent: Agent; handle: string | null; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const shared = !!agent.shared;

  async function set(next: boolean) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/v1/agents/${agent.id}/sharing`, { method: 'PUT', body: { shared: next } });
      setConfirming(false);
      onChange();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dash-sharing">
      {shared ? (
        <p>
          <span className="dash-pill dash-pill-done">shared</span>{' '}
          {handle ? (
            <span className="dash-muted">
              Other teams you approve reach it at <code translate="no">@{handle}/{agent.name}</code>
            </span>
          ) : null}
        </p>
      ) : handle ? (
        <p className="dash-muted">
          Not shared. Share it to give other teams the address <code translate="no">@{handle}/{agent.name}</code>.
        </p>
      ) : (
        <p className="dash-muted">Set a workspace handle above before you share this agent.</p>
      )}
      <div className="dash-actions dash-sharing-actions">
        {shared ? (
          confirming ? (
            <div className="dash-confirm" role="group" aria-label={`Stop sharing ${agent.name}`}>
              <p>Stop sharing {agent.name}? Open tasks from guests will fail with “access revoked”. Guests stay listed so you can revoke them.</p>
              <div className="dash-actions">
                <button type="button" className="dash-textbtn dash-danger" disabled={busy} onClick={() => void set(false)}>
                  {busy ? 'Stopping…' : 'Yes, stop sharing'}
                </button>
                <button type="button" className="dash-textbtn" disabled={busy} onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="dash-textbtn dash-danger" disabled={busy} onClick={() => setConfirming(true)}>
              Stop sharing
            </button>
          )
        ) : (
          <button type="button" className="dash-btn dash-btn-ink dash-btn-sm" disabled={busy || !handle} onClick={() => void set(true)}>
            {busy ? 'Sharing…' : 'Share this agent'}
          </button>
        )}
      </div>
      {error ? (
        <p className="dash-err" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
