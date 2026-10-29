'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, errorText } from './api';
import type { Offer, Share } from './types';

/** Mirrors MAX_SHARE_DAILY_CAP in lib/constants. The API checks it too. */
const MAX_CAP = 10_000;

type Loaded = { shares: Share[]; offers: Offer[] };

function who(s: Share): string {
  const at = s.guest_handle ? `@${s.guest_handle}` : null;
  if (s.label) return at ? `${s.label} (${at})` : s.label;
  return at ?? 'A workspace with no handle';
}

/** "Joined with invite link rsi_8hQx…" under a guest that redeemed a link. */
function via(s: Share) {
  return s.invite_prefix ? (
    <p className="dash-muted">
      Joined with invite link <code translate="no">{s.invite_prefix}…</code>
    </p>
  ) : null;
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
  shared,
  guestLimit,
}: {
  agentId: string;
  agentName: string;
  /** This workspace's handle, for the @handle/agent address. */
  handle: string | null;
  /** Whether the agent is shared. When it isn't, this lists leftover guests so they can be revoked, and hides the invite form. */
  shared: boolean;
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
  const [taskEdit, setTaskEdit] = useState<{ id: string; names: string[] } | null>(null);
  const [notice, setNotice] = useState('');
  /** Confirmation shown on the row that just changed, so it's next to the button you pressed. */
  const [saved, setSaved] = useState<{ id: string; text: string } | null>(null);
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
    setSaved(null);
    try {
      await fn();
      setConfirming(null);
    } catch (err) {
      // 404 or 409 on a guest row means it changed elsewhere (revoked, or approved by another tab). Reload it.
      if (id !== 'invite' && err instanceof ApiError && (err.status === 404 || err.status === 409)) {
        setConfirming(null);
        setEditing(null);
        setTaskEdit(null);
        setError({ id: 'list', text: `${errorText(err)} The list is up to date now.` });
        await load();
      } else {
        setError({ id, text: errorText(err) });
      }
    } finally {
      setBusy(null);
    }
  }

  const headingId = `guests-${agentId}`;
  const address = handle ? `@${handle}/${agentName}` : null;

  if (!data) {
    // An unshared agent shows Guests only when it has some, so stay quiet until we know.
    if (!shared && !loadError) return null;
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

  if (!shared && used === 0) return null;

  function rowSaved(id: string) {
    return saved?.id === id ? (
      <p className="dash-ok dash-row-ok" role="status">
        {saved.text}
      </p>
    ) : null;
  }

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
        <button type="button" className="dash-textbtn dash-danger" disabled={busy !== null} onClick={() => {
            setSaved(null);
            setConfirming(s.id);
          }}
        >
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
          <button type="button" className="dash-textbtn" disabled={busy === key} onClick={() => {
              setSaved(null);
              setConfirming(null);
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  function capEditor(s: Share, lead: string) {
    if (editing?.id !== s.id) {
      return (
        <p className="dash-muted">
          {lead}
          {s.daily_cap.toLocaleString('en-US')} tasks a day{' '}
          <button
            type="button"
            className="dash-textbtn"
            disabled={busy !== null}
            aria-label={`Change daily limit for ${who(s)}`}
            onClick={() => {
              setError(null);
              setSaved(null);
              setTaskEdit(null);
              setEditing({ id: s.id, value: String(s.daily_cap) });
            }}
          >
            Change
          </button>
        </p>
      );
    }
    return (
      <form
        className="dash-cap-form"
        onSubmit={(e) => {
          e.preventDefault();
          const cap = Number(editing.value);
          if (!Number.isInteger(cap) || cap < 1 || cap > MAX_CAP) {
            setSaved(null);
            setError({ id: `cp${s.id}`, text: `Enter a whole number from 1 to ${MAX_CAP.toLocaleString('en-US')}.` });
            return;
          }
          void run(`cp${s.id}`, async () => {
            const r = await api<{ share: Share }>(`${base}/shares/${s.id}`, { method: 'PATCH', body: { daily_cap: cap } });
            put(r.share);
            setEditing(null);
            setSaved({ id: s.id, text: `Daily limit saved: ${r.share.daily_cap.toLocaleString('en-US')} tasks a day.` });
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
        <button type="button" className="dash-textbtn" disabled={busy === `cp${s.id}`} onClick={() => {
            setSaved(null);
            setEditing(null);
          }}
        >
          Cancel
        </button>
      </form>
    );
  }

  function tasksEditor(s: Share) {
    if (taskEdit?.id !== s.id) {
      return (
        <p className="dash-muted">
          Tasks: <span translate="no">{taskList(s)}</span>{' '}
          {data && data.offers.length ? (
            <button
              type="button"
              className="dash-textbtn"
              disabled={busy !== null}
              aria-label={`Edit tasks for ${who(s)}`}
              onClick={() => {
                setError(null);
                setSaved(null);
                setEditing(null);
                setTaskEdit({ id: s.id, names: s.offers.map((o) => o.name) });
              }}
            >
              Edit tasks
            </button>
          ) : null}
        </p>
      );
    }
    const names = taskEdit.names;
    return (
      <form
        className="dash-task-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (names.length === 0) {
            setSaved(null);
            setError({ id: `tk${s.id}`, text: 'Pick at least one task.' });
            return;
          }
          void run(`tk${s.id}`, async () => {
            const r = await api<{ share: Share }>(`${base}/shares/${s.id}`, { method: 'PATCH', body: { offers: names } });
            put(r.share);
            setTaskEdit(null);
            setSaved({ id: s.id, text: 'Tasks saved.' });
          });
        }}
      >
        <fieldset className="dash-guest-offers">
          <legend>Tasks {who(s)} can send</legend>
          {data?.offers.map((o) => (
            <label key={o.id}>
              <input
                type="checkbox"
                checked={names.includes(o.name)}
                onChange={(e) =>
                  setTaskEdit({ id: s.id, names: e.target.checked ? [...names, o.name] : names.filter((n) => n !== o.name) })
                }
              />
              <span translate="no">{o.name}</span>
            </label>
          ))}
        </fieldset>
        <div className="dash-actions">
          <button type="submit" className="dash-textbtn" disabled={busy !== null}>
            {busy === `tk${s.id}` ? 'Saving…' : 'Save tasks'}
          </button>
          <button type="button" className="dash-textbtn" disabled={busy === `tk${s.id}`} onClick={() => {
              setSaved(null);
              setTaskEdit(null);
            }}
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <section className="dash-guests" aria-labelledby={headingId}>
      <div className="dash-guests-head">
        <h4 id={headingId}>Guests</h4>
        {address && shared ? (
          <p className="dash-muted">
            Address <code translate="no">{address}</code>
          </p>
        ) : null}
        {guestLimit !== null ? (
          <p className="dash-muted">
            Free plan: {guestLimit} guest workspaces per agent · {used} used
          </p>
        ) : null}
      </div>

      {!shared ? (
        <p className="dash-muted dash-guest-invite-note">
          Sharing is off, so these guests can’t send tasks. Revoke anyone you don’t want back when you share again.
        </p>
      ) : null}

      {shared && data.offers.length ? (
        <>
          <h5 className="dash-guests-sub">Task menu</h5>
          <ul className="dash-offers">
            {data.offers.map((o) => (
              <li key={o.id}>
                <code translate="no">{o.name}</code>
                <span className="dash-muted">{o.description}</span>
              </li>
            ))}
          </ul>
          <p className="dash-muted dash-offers-note">
            Your agent adds and changes tasks with <code translate="no">upsert_offer</code>.
          </p>
        </>
      ) : null}

      {error?.id === 'list' ? (
        <p className="dash-err dash-guest-notice" role="alert">
          {error.text}
        </p>
      ) : null}

      {notice ? (
        <p className="dash-ok dash-guest-notice" role="status">
          {notice}
        </p>
      ) : null}

      {used === 0 ? (
        <p className="dash-empty">No guests yet. Invite a workspace by its handle, or send an invite link.</p>
      ) : null}

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
                  {via(s)}
                  <p className="dash-muted">
                    Tasks: <span translate="no">{taskList(s)}</span>
                  </p>
                  {capEditor(s, 'Up to ')}
                </div>
                <div className="dash-actions">
                  {shared ? (
                    <button
                      type="button"
                      className="dash-btn dash-btn-ink dash-btn-sm"
                      disabled={busy !== null || confirming === s.id}
                      onClick={() =>
                        run(`ap${s.id}`, async () => {
                          const r = await api<{ share: Share }>(`${base}/shares/${s.id}/approve`, { method: 'POST' });
                          put(r.share);
                          setSaved({ id: s.id, text: `Approved. ${who(s)} can send tasks now.` });
                        })
                      }
                    >
                      {busy === `ap${s.id}` ? 'Approving…' : 'Approve'}
                    </button>
                  ) : (
                    <p className="dash-muted">Turn sharing on to approve guests.</p>
                  )}
                  {revokeButtons(s, 'Deny', `Deny ${who(s)}? They won’t get access.`)}
                </div>
                {rowError(s.id)}
                {rowSaved(s.id)}
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
                  {via(s)}
                  {tasksEditor(s)}
                  {capEditor(s, 'Up to ')}
                </div>
                <div className="dash-actions">
                  {revokeButtons(s, 'Revoke', `Revoke ${who(s)}? Open tasks from this guest will fail with “access revoked”.`)}
                </div>
                {rowError(s.id)}
                {rowSaved(s.id)}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {!shared ? null : data.offers.length === 0 ? (
        <p className="dash-muted dash-guest-invite-note">
          Add a task to this agent’s menu before you invite anyone. Your agent can add one with{' '}
          <code translate="no">upsert_offer</code>.
        </p>
      ) : (
        <form
          className="dash-guest-invite"
          onSubmit={(e) => {
            e.preventDefault();
            const guest = inviteHandle.trim().replace(/^@/, '').toLowerCase();
            if (!guest) {
              setError({ id: 'invite', text: 'Enter a handle.' });
              return;
            }
            // Re-inviting a current guest would reset their tasks and daily cap, so stop here.
            const current = data.shares.find((s) => s.guest_handle === guest && s.status !== 'revoked');
            if (current) {
              setError({ id: 'invite', text: current.status === 'approved' ? `@${guest} is already a guest.` : `@${guest} is already invited.` });
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
              setNotice(`Invited ${who(r.share)}. Approve it when you’re ready.`);
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
                ? `This agent has ${guestLimit} guest workspaces, the free plan limit per agent. Revoke one to invite another.`
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
