'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, errorText } from './api';
import { LocalTime } from './LocalTime';
import { OnceSecret } from './CopyButton';
import type { WakeUrl } from './types';

async function fetchWakeUrls(agentId: string): Promise<WakeUrl[]> {
  const { wake_urls } = await api<{ wake_urls: WakeUrl[] }>(`/api/v1/agents/${agentId}/wake-urls`);
  return wake_urls;
}

/**
 * One agent's wake link: create, copy once, rotate, revoke. Only a hash of the link is stored, so the full link is
 * shown only in the issue or rotate response. After that the row says Active and offers a new link instead.
 */
export function WakeUrlPanel({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [active, setActive] = useState<WakeUrl | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [fresh, setFresh] = useState<{ id: string; url: string } | null>(null);
  const [confirming, setConfirming] = useState<'rotate' | 'revoke' | null>(null);
  const [busy, setBusy] = useState<'create' | 'rotate' | 'revoke' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const apply = useCallback((list: WakeUrl[]) => {
    setActive(list.find((w) => w.status === 'active') ?? null);
    setLoaded(true);
  }, []);

  const load = useCallback(() => fetchWakeUrls(agentId).then(apply), [agentId, apply]);

  useEffect(() => {
    let cancelled = false;
    fetchWakeUrls(agentId).then(
      (list) => {
        if (!cancelled) apply(list);
      },
      (err: unknown) => {
        if (cancelled) return;
        setError(errorText(err));
        setLoaded(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [agentId, apply]);

  async function run(kind: 'create' | 'rotate' | 'revoke', fn: () => Promise<void>) {
    setBusy(kind);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (err) {
      // Someone else changed the link in another tab: show what is there now.
      if (err instanceof ApiError && (err.code === 'wake_url_exists' || err.code === 'wake_url_not_active')) {
        await load().catch(() => {});
      }
      setError(errorText(err));
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  const create = () =>
    run('create', async () => {
      const { wake_url } = await api<{ wake_url: WakeUrl }>(`/api/v1/agents/${agentId}/wake-urls`, { method: 'POST' });
      setActive(wake_url);
      if (wake_url.url) setFresh({ id: wake_url.id, url: wake_url.url });
    });

  const rotate = (current: WakeUrl) =>
    run('rotate', async () => {
      const { wake_url } = await api<{ wake_url: WakeUrl }>(`/api/v1/agents/${agentId}/wake-urls/${current.id}/rotate`, {
        method: 'POST',
      });
      setActive(wake_url);
      if (wake_url.url) setFresh({ id: wake_url.id, url: wake_url.url });
      setNotice('New link ready. The old one no longer works.');
    });

  const revoke = (current: WakeUrl) =>
    run('revoke', async () => {
      await api(`/api/v1/agents/${agentId}/wake-urls/${current.id}/revoke`, { method: 'POST' });
      setActive(null);
      setFresh(null);
      setNotice('Wake link revoked. Apps using it no longer hear about new messages.');
    });

  const shown = fresh && active && fresh.id === active.id ? fresh.url : null;

  return (
    <div className="dash-wake" role="group" aria-labelledby={`wake-h-${agentId}`}>
      <div className="dash-wake-head">
        <h4 id={`wake-h-${agentId}`}>Wake link</h4>
        {active ? <span className="dash-pill dash-pill-done">Active</span> : null}
      </div>
      <p className="dash-muted dash-wake-help">
        Apps like Muse check this link to know when <span translate="no">{agentName}</span> has a new message. Keep it
        private. Anyone with it can see when messages arrive, but not what they say.
      </p>

      {!loaded ? null : active ? (
        <>
          {shown ? (
            <OnceSecret title="Copy your wake link now. It won’t be shown again." secret={shown}>
              <p className="dash-secret-help">
                Paste it into Muse or any app that checks for new messages. If you lose it, get a new link below.
              </p>
            </OnceSecret>
          ) : null}
          <p className="dash-muted dash-wake-meta">
            <code translate="no">{active.prefix}…</code> · Created <LocalTime iso={active.created_at} /> · Last checked{' '}
            {active.last_used_at ? <LocalTime iso={active.last_used_at} /> : 'not yet'}
          </p>
          {confirming === 'rotate' ? (
            <div className="dash-confirm" role="group" aria-label={`Get a new wake link for ${agentName}`}>
              <p>Get a new link? The current one stops working right away, so paste the new one into Muse.</p>
              <div className="dash-actions">
                <button type="button" className="dash-textbtn" disabled={busy !== null} onClick={() => rotate(active)}>
                  {busy === 'rotate' ? 'Getting new link…' : 'Yes, get a new link'}
                </button>
                <button type="button" className="dash-textbtn" disabled={busy !== null} onClick={() => setConfirming(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : confirming === 'revoke' ? (
            <div className="dash-confirm" role="group" aria-label={`Revoke the wake link for ${agentName}`}>
              <p>Revoke this link? Apps using it stop hearing about new messages. You can create a new one later.</p>
              <div className="dash-actions">
                <button
                  type="button"
                  className="dash-textbtn dash-danger"
                  disabled={busy !== null}
                  onClick={() => revoke(active)}
                >
                  {busy === 'revoke' ? 'Revoking…' : 'Yes, revoke link'}
                </button>
                <button type="button" className="dash-textbtn" disabled={busy !== null} onClick={() => setConfirming(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="dash-actions dash-wake-actions">
              <button type="button" className="dash-textbtn" disabled={busy !== null} onClick={() => setConfirming('rotate')}>
                Get a new link
              </button>
              <button
                type="button"
                className="dash-textbtn dash-danger"
                disabled={busy !== null}
                onClick={() => setConfirming('revoke')}
              >
                Revoke link
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="dash-wake-actions">
          <button type="button" className="dash-btn dash-btn-line dash-btn-sm" disabled={busy !== null} onClick={create}>
            {busy === 'create' ? 'Creating…' : 'Create wake link'}
          </button>
        </div>
      )}

      <p className="dash-wake-notice" role="status" aria-live="polite">
        {notice}
      </p>
      {error ? (
        <p className="dash-err" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
