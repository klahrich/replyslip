'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorText, formatTime } from './api';
import { CopyButton } from './CopyButton';
import type { Invite, NewInvite, Offer } from './types';

/** Mirrors the INVITE_* and MAX_SHARE_DAILY_CAP limits in lib/constants. The API checks them too. */
const MAX_USES = 1_000;
const MAX_DAYS = 90;
const MAX_CAP = 10_000;

const STATUS_TEXT: Record<Invite['status'], string> = {
  active: 'Active',
  exhausted: 'Used up',
  expired: 'Expired',
  revoked: 'Revoked',
};

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** The message an owner sends a customer. Editable before copying. */
function customerMessage(made: NewInvite, agentName: string): string {
  const hello = made.invite.label ? `Hi ${made.invite.label},` : 'Hi,';
  const reach =
    made.invite.max_uses === 1 ? 'This link works once' : `This link works for up to ${made.invite.max_uses} agents`;
  return [
    hello,
    '',
    `You can now connect your AI agent to our ${agentName}. No ReplySlip account needed.`,
    'Paste this into your agent:',
    '',
    ...made.agent_prompt.split('\n').map((line) => `  ${line}`),
    '',
    `What it can do and what it returns: ${made.url}`,
    `${reach} and expires on ${longDate(made.invite.expires_at)}.`,
  ].join('\n');
}

/**
 * Invite links for one shared agent: create, the one-time "send this to your customer" panel, and the list.
 * Only a signed-in human creates a link that approves on redeem; the API refuses agent keys here.
 */
export function InviteLinks({
  agentId,
  agentName,
  offers,
  onRedeemedChange,
}: {
  agentId: string;
  agentName: string;
  offers: Offer[];
  /** Called after a revoke that also revoked guests, so the guest list can reload. */
  onRedeemedChange: () => void;
}) {
  const base = `/api/v1/agents/${agentId}/invites`;
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const [made, setMade] = useState<NewInvite | null>(null);
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState<{ id: string; withGuests: boolean } | null>(null);

  const [picked, setPicked] = useState<string[] | null>(null);
  const [label, setLabel] = useState('');
  const [many, setMany] = useState(false);
  const [uses, setUses] = useState('10');
  const [days, setDays] = useState('30');
  const [cap, setCap] = useState('50');
  const [approve, setApprove] = useState(true);
  const chosen = picked ?? (offers.length === 1 ? [offers[0]!.name] : []);

  const load = useCallback(async () => {
    try {
      const r = await api<{ invites: Invite[] }>(base);
      setInvites(r.invites);
      setLoadError('');
    } catch (err) {
      setLoadError(errorText(err));
    }
  }, [base]);

  useEffect(() => {
    let cancelled = false;
    api<{ invites: Invite[] }>(base).then(
      (r) => {
        if (!cancelled) setInvites(r.invites);
      },
      (err: unknown) => {
        if (!cancelled) setLoadError(errorText(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [base]);

  async function run(id: string, fn: () => Promise<void>) {
    setBusy(id);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError({ id, text: errorText(err) });
    } finally {
      setBusy(null);
    }
  }

  function create() {
    if (chosen.length === 0) {
      setError({ id: 'create', text: 'Pick at least one task.' });
      return;
    }
    const maxUses = many ? Number(uses) : 1;
    const expires = Number(days);
    const dailyCap = Number(cap);
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > MAX_USES) {
      setError({ id: 'create', text: `Uses must be a whole number from 1 to ${MAX_USES.toLocaleString()}.` });
      return;
    }
    if (!Number.isInteger(expires) || expires < 1 || expires > MAX_DAYS) {
      setError({ id: 'create', text: `Expiry must be 1 to ${MAX_DAYS} days.` });
      return;
    }
    if (!Number.isInteger(dailyCap) || dailyCap < 1 || dailyCap > MAX_CAP) {
      setError({ id: 'create', text: `Daily cap must be 1 to ${MAX_CAP.toLocaleString()}.` });
      return;
    }
    void run('create', async () => {
      const r = await api<NewInvite>(base, {
        method: 'POST',
        body: {
          offers: chosen,
          max_uses: maxUses,
          expires_in_days: expires,
          daily_cap: dailyCap,
          approve_on_redeem: approve,
          ...(label.trim() ? { label: label.trim() } : {}),
        },
      });
      setMade(r);
      setMessage(customerMessage(r, agentName));
      setLabel('');
      await load();
    });
  }

  function revoke(invite: Invite, withGuests: boolean) {
    void run(`rv${invite.id}`, async () => {
      await api(`${base}/${invite.id}/revoke`, { method: 'POST', body: { revoke_shares: withGuests } });
      setConfirming(null);
      await load();
      if (withGuests) onRedeemedChange();
    });
  }

  const headingId = `invites-h-${agentId}`;
  const rowError = (id: string) =>
    error?.id === id ? (
      <p className="dash-err" role="alert">
        {error.text}
      </p>
    ) : null;

  return (
    <section className="dash-invites" aria-labelledby={headingId}>
      <h4 id={headingId}>Invite links</h4>
      <p className="dash-muted">
        For customers who aren’t on ReplySlip. Their agent redeems the link and gets its own key. It shows up under
        Guests.
      </p>

      {made ? (
        <div className="dash-secret dash-invite-made" role="region" aria-label="Send this to your customer">
          <p className="dash-secret-title">Send this to your customer</p>
          <p className="dash-muted">This link is shown once. If you lose it, create a new one.</p>
          <label className="dash-invite-msg-label" htmlFor={`msg-${agentId}`}>
            Message
          </label>
          <textarea
            id={`msg-${agentId}`}
            className="dash-invite-msg"
            rows={12}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <div className="dash-secret-row">
            <CopyButton value={message} label="Copy message" />
          </div>
          <p className="dash-invite-part">Just the prompt for their agent</p>
          <div className="dash-secret-row">
            <code translate="no" className="dash-secret-value dash-pre-text">
              {made.agent_prompt}
            </code>
            <CopyButton value={made.agent_prompt} label="Copy prompt" />
          </div>
          <p className="dash-invite-part">Just the link</p>
          <div className="dash-secret-row">
            <code translate="no" className="dash-secret-value">
              {made.url}
            </code>
            <CopyButton value={made.url} label="Copy link" />
          </div>
          <p className="dash-muted dash-invite-warn">
            Anyone with this link can join until it’s used up or expires. Send it only to the customer it’s for. You can
            revoke it below.
          </p>
          <ol className="dash-invite-next dash-muted">
            <li>Their agent redeems the link and gets its own ReplySlip key.</li>
            <li>
              It shows up under Guests,{' '}
              {made.invite.approve_on_redeem ? 'already approved.' : 'waiting for your approval.'}
            </li>
            <li>Its tasks count against its own quota, not yours.</li>
          </ol>
          <div className="dash-actions">
            <button type="button" className="dash-textbtn" onClick={() => setMade(null)}>
              Done
            </button>
          </div>
        </div>
      ) : null}

      {offers.length === 0 ? (
        <p className="dash-muted dash-guest-invite-note">
          Add a task to this agent’s menu before you create a link. Your agent can add one with{' '}
          <code translate="no">upsert_offer</code>.
        </p>
      ) : (
        <form
          className="dash-invite-form"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          {offers.length > 1 ? (
            <fieldset className="dash-guest-offers">
              <legend>Tasks they can send</legend>
              {offers.map((o) => (
                <label key={o.id}>
                  <input
                    type="checkbox"
                    checked={chosen.includes(o.name)}
                    onChange={(e) => setPicked(e.target.checked ? [...chosen, o.name] : chosen.filter((n) => n !== o.name))}
                  />
                  <span translate="no">{o.name}</span>
                </label>
              ))}
            </fieldset>
          ) : (
            <p className="dash-muted">
              They can send <span translate="no">{offers[0]?.name}</span>.
            </p>
          )}
          <div className="dash-invite-grid">
            <div className="dash-field">
              <label htmlFor={`label-${agentId}`}>Who it’s for (optional)</label>
              <input
                id={`label-${agentId}`}
                type="text"
                maxLength={80}
                placeholder="Initech"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="dash-field">
              <label htmlFor={`days-${agentId}`}>Expires after (days)</label>
              <input id={`days-${agentId}`} type="number" min={1} max={MAX_DAYS} value={days} onChange={(e) => setDays(e.target.value)} />
            </div>
            <div className="dash-field">
              <label htmlFor={`cap-${agentId}`}>Tasks per day, per guest</label>
              <input id={`cap-${agentId}`} type="number" min={1} max={MAX_CAP} value={cap} onChange={(e) => setCap(e.target.value)} />
            </div>
          </div>
          <fieldset className="dash-guest-offers">
            <legend>How many agents can use it</legend>
            <label>
              <input type="radio" name={`uses-${agentId}`} checked={!many} onChange={() => setMany(false)} />
              One customer
            </label>
            <label>
              <input type="radio" name={`uses-${agentId}`} checked={many} onChange={() => setMany(true)} />
              Up to{' '}
              <input
                type="number"
                className="dash-invite-uses"
                aria-label="Maximum uses"
                min={1}
                max={MAX_USES}
                value={uses}
                onFocus={() => setMany(true)}
                onChange={(e) => setUses(e.target.value)}
              />{' '}
              agents
            </label>
          </fieldset>
          <label className="dash-invite-check">
            <input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} />
            Approve guests when they redeem the link
          </label>
          <div className="dash-actions">
            <button type="submit" className="dash-btn dash-btn-ink" disabled={busy !== null}>
              {busy === 'create' ? 'Creating…' : 'Create invite link'}
            </button>
          </div>
          {rowError('create')}
        </form>
      )}

      {loadError ? (
        <p className="dash-err" role="alert">
          {loadError}{' '}
          <button type="button" className="dash-textbtn" onClick={() => void load()}>
            Try again
          </button>
        </p>
      ) : null}

      {invites && invites.length > 0 ? (
        <ul className="dash-guest-list">
          {invites.map((inv) => {
            const live = inv.status === 'active';
            return (
              <li key={inv.id} className="dash-guest">
                <div className="dash-guest-main">
                  <p className="dash-guest-name">
                    {inv.label ?? <span className="dash-muted">No label</span>}{' '}
                    <code translate="no" className="dash-muted">
                      {inv.prefix}…
                    </code>
                  </p>
                  <p className="dash-muted">
                    {STATUS_TEXT[inv.status]} · used {inv.uses} of {inv.max_uses} ·{' '}
                    {inv.status === 'revoked' ? `revoked ${formatTime(inv.revoked_at)}` : `expires ${formatTime(inv.expires_at)}`}
                    {' · '}
                    <span translate="no">{inv.offers.map((o) => o.name).join(', ') || 'no tasks'}</span>
                    {inv.approve_on_redeem ? '' : ' · needs your approval'}
                  </p>
                </div>
                <div className="dash-actions">
                  {confirming?.id === inv.id ? (
                    <div className="dash-confirm" role="group" aria-label={`Revoke link ${inv.prefix}`}>
                      <p>Revoke this link? Nobody new can join with it.</p>
                      {inv.uses > 0 ? (
                        <label className="dash-invite-check">
                          <input
                            type="checkbox"
                            checked={confirming.withGuests}
                            onChange={(e) => setConfirming({ id: inv.id, withGuests: e.target.checked })}
                          />
                          Also revoke the {inv.uses === 1 ? 'guest who' : `${inv.uses} guests who`} joined with it. Their
                          open tasks fail with “access revoked”.
                        </label>
                      ) : null}
                      <div className="dash-actions">
                        <button
                          type="button"
                          className="dash-textbtn dash-danger"
                          disabled={busy !== null}
                          onClick={() => revoke(inv, confirming.withGuests)}
                        >
                          {busy === `rv${inv.id}` ? 'Revoking…' : 'Yes, revoke'}
                        </button>
                        <button type="button" className="dash-textbtn" disabled={busy !== null} onClick={() => setConfirming(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : live || inv.uses > 0 ? (
                    <button
                      type="button"
                      className="dash-textbtn dash-danger"
                      disabled={busy !== null}
                      onClick={() => setConfirming({ id: inv.id, withGuests: !live })}
                    >
                      {live ? 'Revoke' : 'Revoke guests…'}
                    </button>
                  ) : null}
                </div>
                {rowError(`rv${inv.id}`)}
              </li>
            );
          })}
        </ul>
      ) : invites ? (
        <p className="dash-empty">No invite links yet.</p>
      ) : null}
    </section>
  );
}
