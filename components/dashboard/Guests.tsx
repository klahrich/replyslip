'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from './api';
import type { Offer, Share } from './types';

/** Mirrors MAX_SHARE_DAILY_CAP in lib/constants. The API checks it too. */
const MAX_CAP = 10_000;

type Loaded = { shares: Share[]; offers: Offer[] };

function who(s: Share): string {
  return s.guest_handle ? `@${s.guest_handle}` : 'A workspace with no handle';
}

function taskList(s: Share): string {
  return s.offers.length ? s.offers.map((o) => o.name).join(', ') : 'none';
}

/**
 * Guests of one shared agent. An owner's agent can invite over MCP, but only the signed-in owner approves, here.
 * Deny and Revoke both call the revoke route; there is no deny route.
 */
export function Guests({
  agentId,
  agentName,
  handle,
  guestLimit,
}: {
  agentId: string;
  agentName: string;
  /** This workspace's handle, for the @handle/agent address. */
  handle: string | null;
  /** Pending plus approved guests allowed per shared agent on this plan. Null when the plan has no cap. */
  guestLimit: number | null;
}) {
  const base = `/api/v1/agents/${agentId}`;
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [inviteHandle, setInviteHandle] = useState('');
  const [picked, setPicked] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const [{ shares }, { offers }] = await Promise.all([
        api<{ shares: Share[] }>(`${base}/shares`),
        api<{ offers: Offer[] }>(`${base}/offers`),
      ]);
      setData({ shares, offers });
    } catch (err) {
      setLoadError(errorText(err));
    }
  }, [base]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api<{ shares: Share[] }>(`${base}/shares`), api<{ offers: Offer[] }>(`${base}/offers`)]).then(
      ([{ shares }, { offers }]) => {
        if (!cancelled) setData({ shares, offers });
      },
      (err: unknown) => {
        if (!cancelled) setLoadError(errorText(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [base]);

  function put(share: Share) {
    setData((d) =>
      d
        ? {
            ...d,
            shares: d.shares.some((s) => s.id === share.id)
              ? d.shares.map((s) => (s.id === share.id ? share : s))
              : [...d.shares, share],
          }
        : d,
    );
  }

  async function run(id: string, fn: () => Promise<void>) {
    setBusy(id);
    setError(null);
    setNotice('');
    try {
      await fn();
      setConfirming(null);
    } catch (err) {
      setError({ id, text: errorText(err) });
    } finally {
      setBusy(null);
    }
  }

  const headingId = `guests-${agentId}`;
  const address = handle ? `@${handle}/${agentName}` : null;

  if (!data) {
    return (
      <section className="dash-guests" aria-labelledby={headingId}>
        <h4 id={headingId}>Guests</h4>
        {loadError ? (
          <p className="dash-err" role="alert">
            {loadError}{' '}
            <button type="button" className="dash-textbtn" onClick={() => void load()}>
              Try again
            </button>
          </p>
        ) : (
          <p className="dash-muted" aria-live="polite">
            Loading guests…
          </p>
        )}
      </section>
    );
  }

  const pending = data.shares.filter((s) => s.status === 'pending');
  const active = data.shares.filter((s) => s.status === 'approved');
  const used = pending.length + active.length;
  const full = guestLimit !== null && used >= guestLimit;
  const chosen = picked ?? data.offers.map((o) => o.name);

  function rowError(id: string) {
    return error?.id.endsWith(id) ? (
      <p className="dash-err" role="alert">
        {error.text}
      </p>
    ) : null;
  }

  function revokeButtons(s: Share, verb: 'Deny' | 'Revoke', question: string) {
    const key = `rv${s.id}`;
    if (confirming !== s.id) {
      return (
        <button type="button" className="dash-textbtn dash-danger" disabled={busy !== null} onClick={() => setConfirming(s.id)}>
          {verb}
        </button>
      );
    }
    return (
      <div className="dash-confirm" role="group" aria-label={`${verb} ${who(s)}`}>
        <p>{question}</p>
        <div className="dash-actions">
          <button
            type="button"
            className="dash-textbtn dash-danger"
            disabled={busy !== null}
            onClick={() =>
              run(key, async () => {
                const r = await api<{ share: Share; failed_tasks: number }>(`${base}/shares/${s.id}/revoke`, { method: 'POST' });
                put(r.share);
                if (verb === 'Revoke') {
                  setNotice(
                    r.failed_tasks
                      ? `Revoked ${who(s)}. ${r.failed_tasks} open ${r.failed_tasks === 1 ? 'task' : 'tasks'} failed.`
                      : `Revoked ${who(s)}.`,
                  );
                } else {
                  setNotice(`Denied ${who(s)}.`);
                }
              })
            }
          >
            {busy === key ? (verb === 'Deny' ? 'Denying…' : 'Revoking…') : `Yes, ${verb.toLowerCase()}`}
          </button>
          <button type="button" className="dash-textbtn" disabled={busy === key} onClick={() => setConfirming(null)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className="dash-guests" aria-labelledby={headingId}>
      <div className="dash-guests-head">
        <h4 id={headingId}>Guests</h4>
        {address ? (
          <p className="dash-muted">
            Address <code translate="no">{address}</code>
          </p>
        ) : null}
        {guestLimit !== null ? (
          <p className="dash-muted">
            Free plan: {used} of {guestLimit} guest workspaces
          </p>
        ) : null}
      </div>

      {notice ? (
        <p className="dash-ok dash-guest-notice" role="status">
          {notice}
        </p>
      ) : null}

      {used === 0 ? <p className="dash-empty">No guests yet. Invite a workspace by its handle, then approve it here.</p> : null}

      {pending.length ? (
        <>
          <h5 className="dash-guests-sub">Invited, waiting for your approval</h5>
          <ul className="dash-guest-list">
            {pending.map((s) => (
              <li key={s.id} className="dash-guest">
                <div className="dash-guest-main">
                  <p className="dash-guest-name" translate="no">
                    {who(s)}
                  </p>
                  <p className="dash-muted">
                    Tasks: <span translate="no">{taskList(s)}</span> · up to {s.daily_cap.toLocaleString('en-US')} a day
                  </p>
                </div>
                <div className="dash-actions">
                  <button
                    type="button"
                    className="dash-btn dash-btn-ink dash-btn-sm"
                    disabled={busy !== null || confirming === s.id}
                    onClick={() =>
                      run(`ap${s.id}`, async () => {
                        const r = await api<{ share: Share }>(`${base}/shares/${s.id}/approve`, { method: 'POST' });
                        put(r.share);
                        setNotice(`Approved ${who(s)}. They can send tasks now.`);
                      })
                    }
                  >
                    {busy === `ap${s.id}` ? 'Approving…' : 'Approve'}
                  </button>
                  {revokeButtons(s, 'Deny', `Deny ${who(s)}? They won’t get access.`)}
                </div>
                {rowError(s.id)}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {active.length ? (
        <>
          <h5 className="dash-guests-sub">Active guests</h5>
          <ul className="dash-guest-list">
            {active.map((s) => (
              <li key={s.id} className="dash-guest">
                <div className="dash-guest-main">
                  <p className="dash-guest-name" translate="no">
                    {who(s)}
                  </p>
                  <p className="dash-muted">
                    Tasks: <span translate="no">{taskList(s)}</span>
                  </p>
                  {editing?.id === s.id ? (
                    <form
                      className="dash-cap-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const cap = Number(editing.value);
                        if (!Number.isInteger(cap) || cap < 1 || cap > MAX_CAP) {
                          setError({ id: `cp${s.id}`, text: `Enter a whole number from 1 to ${MAX_CAP.toLocaleString('en-US')}.` });
                          return;
                        }
                        void run(`cp${s.id}`, async () => {
                          const r = await api<{ share: Share }>(`${base}/shares/${s.id}`, { method: 'PATCH', body: { daily_cap: cap } });
                          put(r.share);
                          setEditing(null);
                        });
                      }}
                    >
                      <label htmlFor={`cap-${s.id}`}>Tasks a day</label>
                      <input
                        id={`cap-${s.id}`}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={MAX_CAP}
                        step={1}
                        value={editing.value}
                        onChange={(e) => setEditing({ id: s.id, value: e.target.value })}
                      />
                      <button type="submit" className="dash-textbtn" disabled={busy !== null}>
                        {busy === `cp${s.id}` ? 'Saving…' : 'Save'}
                      </button>
                      <button type="button" className="dash-textbtn" disabled={busy === `cp${s.id}`} onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <p className="dash-muted">
                      Up to {s.daily_cap.toLocaleString('en-US')} tasks a day{' '}
                      <button
                        type="button"
                        className="dash-textbtn"
                        disabled={busy !== null}
                        onClick={() => {
                          setError(null);
                          setEditing({ id: s.id, value: String(s.daily_cap) });
                        }}
                      >
                        Change
                      </button>
                    </p>
                  )}
                </div>
                <div className="dash-actions">
                  {revokeButtons(s, 'Revoke', `Revoke ${who(s)}? Open tasks from this guest will fail with “access revoked”.`)}
                </div>
                {rowError(s.id)}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {data.offers.length === 0 ? (
        <p className="dash-muted dash-guest-invite-note">
          Add a task to this agent’s menu before you invite anyone. Your agent can add one with{' '}
          <code translate="no">upsert_offer</code>.
        </p>
      ) : (
        <form
          className="dash-guest-invite"
          onSubmit={(e) => {
            e.preventDefault();
            const guest = inviteHandle.trim().replace(/^@/, '');
            if (!guest) {
              setError({ id: 'invite', text: 'Enter a handle.' });
              return;
            }
            if (chosen.length === 0) {
              setError({ id: 'invite', text: 'Pick at least one task.' });
              return;
            }
            void run('invite', async () => {
              const r = await api<{ share: Share }>(`${base}/shares`, {
                method: 'POST',
                body: { guest_handle: guest, offers: chosen },
              });
              put(r.share);
              setInviteHandle('');
              setNotice(
                r.share.status === 'approved' ? `Updated ${who(r.share)}.` : `Invited ${who(r.share)}. Approve it when you’re ready.`,
              );
            });
          }}
        >
          <div className="dash-field">
            <label htmlFor={`invite-${agentId}`}>Invite a workspace by handle</label>
            <div className="dash-guest-invite-row">
              <input
                id={`invite-${agentId}`}
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="otherco"
                value={inviteHandle}
                aria-invalid={error?.id === 'invite' || undefined}
                onChange={(e) => setInviteHandle(e.target.value)}
              />
              <button type="submit" className="dash-btn dash-btn-ink" disabled={busy !== null || full}>
                {busy === 'invite' ? 'Inviting…' : 'Invite'}
              </button>
            </div>
            <p className="dash-hint">
              {full
                ? `This agent has ${guestLimit} guest workspaces, the free plan limit. Revoke one to invite another.`
                : 'The workspace needs a ReplySlip account with a handle set.'}
            </p>
          </div>
          {data.offers.length > 1 ? (
            <fieldset className="dash-guest-offers">
              <legend>Tasks they can send</legend>
              {data.offers.map((o) => (
                <label key={o.id}>
                  <input
                    type="checkbox"
                    checked={chosen.includes(o.name)}
                    onChange={(e) =>
                      setPicked(e.target.checked ? [...chosen, o.name] : chosen.filter((n) => n !== o.name))
                    }
                  />
                  <span translate="no">{o.name}</span>
                </label>
              ))}
            </fieldset>
          ) : (
            <p className="dash-muted">
              They can send <span translate="no">{data.offers[0]?.name}</span>.
            </p>
          )}
          {rowError('invite')}
        </form>
      )}
    </section>
  );
}
