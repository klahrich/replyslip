'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api, errorText } from './api';
import { REVIEWS_CHANGED_EVENT } from './review-text';
import type { ReviewMode as Mode, ReviewSettings } from './types';

const MODES: { value: Mode; label: string; help: string }[] = [
  { value: 'auto', label: 'Auto', help: 'Your bot answers customers directly.' },
  { value: 'review_first', label: 'Review first', help: 'You approve each request and each answer before your customer sees it.' },
];

/** Per-bot Auto / Review first (GET/PUT /api/v1/agents/:id/review-mode). Saves on change and goes back if the save fails. */
export function ReviewMode({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [settings, setSettings] = useState<ReviewSettings | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const latest = useRef(0);
  const base = `/api/v1/agents/${agentId}/review-mode`;

  useEffect(() => {
    let cancelled = false;
    api<{ review: ReviewSettings }>(base).then(
      (r) => {
        if (!cancelled) {
          setSettings(r.review);
          setLoadError('');
        }
      },
      (err: unknown) => {
        if (!cancelled) setLoadError(errorText(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [base]);

  async function save(patch: Partial<Pick<ReviewSettings, 'review_mode' | 'notify_review_email'>>) {
    if (!settings) return;
    const prev = settings;
    const req = ++latest.current;
    setSettings({ ...settings, ...patch });
    setBusy(true);
    setError('');
    setSaved('');
    try {
      const r = await api<{ review: ReviewSettings }>(base, { method: 'PUT', body: patch });
      if (req === latest.current) {
        setSettings(r.review);
        setSaved('Saved.');
        window.dispatchEvent(new Event(REVIEWS_CHANGED_EVENT));
      }
    } catch (err) {
      if (req === latest.current) {
        setSettings(prev);
        setError(`Couldn’t save that. ${errorText(err)}`);
      }
    } finally {
      if (req === latest.current) setBusy(false);
    }
  }

  const headingId = `review-mode-h-${agentId}`;
  return (
    <section className="dash-invites" aria-labelledby={headingId}>
      <h4 id={headingId}>Answers to customers</h4>
      {loadError ? (
        <p className="dash-err" role="alert">
          {loadError}
        </p>
      ) : !settings ? (
        <p className="dash-muted">Loading…</p>
      ) : (
        <>
          <fieldset className="dash-modes dash-review-modes" disabled={busy}>
            <legend className="vh">How {agentName} answers customers</legend>
            {MODES.map((m) => (
              <label key={m.value} className={settings.review_mode === m.value ? 'dash-mode is-on' : 'dash-mode'}>
                <input
                  type="radio"
                  name={`review-mode-${agentId}`}
                  value={m.value}
                  checked={settings.review_mode === m.value}
                  onChange={() => void save({ review_mode: m.value })}
                />
                <span>
                  <span className="dash-mode-label">{m.label}</span>
                  <span className="dash-muted">{m.help}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {settings.review_mode === 'review_first' ? (
            <label className="dash-invite-check dash-review-notify">
              <input
                type="checkbox"
                checked={settings.notify_review_email}
                disabled={busy}
                onChange={(e) => void save({ notify_review_email: e.target.checked })}
              />
              Email me when something is waiting (at most once an hour)
            </label>
          ) : null}
          {settings.held_count > 0 ? (
            <p className="dash-muted dash-review-notify">
              {settings.held_count} waiting for you ·{' '}
              <Link className="link" href="/dashboard/reviews">
                Open reviews
              </Link>
            </p>
          ) : null}
          <p className={error ? 'dash-err' : 'dash-ok dash-review-saved'} role="status" aria-live="polite">
            {error || saved}
          </p>
        </>
      )}
    </section>
  );
}
