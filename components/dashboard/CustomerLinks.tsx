'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorText, formatTime } from './api';
import { CopyButton } from './CopyButton';
import type { CustomerAccess, CustomerInvite, InvitesResponse, NewCustomerInvite, Offer } from './types';

/** Mirrors MAX_SHARE_DAILY_CAP in lib/constants. The API checks it too. */
const MAX_CAP = 10_000;

const STATUS_TEXT: Record<CustomerInvite['status'], string> = {
  active: 'Active',
  exhausted: 'Used up',
  expired: 'Expired',
  revoked: 'Revoked',
};

function emailsFromText(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);
}

/**
 * Customer links for one shared agent: who gets in (open link or approve each), the one public link with
 * reset, personal links, and revoke. A customer signs in with an email code; they never see a key.
 */
export function CustomerLinks({
  agentId,
  offers,
  onLoaded,
  onChange,
}: {
  agentId: string;
  offers: Offer[];
  /** Reports whether agent guests (anonymous agent invite links) are enabled on this deployment. */
  onLoaded: (agentGuestsEnabled: boolean) => void;
  /** Called after a change that affects the guest list (a revoke that also revoked customers). */
  onChange: () => void;
}) {
  const base = `/api/v1/agents/${agentId}/invites`;
  const [invites, setInvites] = useState<CustomerInvite[] | null>(null);
  const [access, setAccess] = useState<CustomerAccess | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const [saved, setSaved] = useState('');
  const [made, setMade] = useState<{ url: string; kind: CustomerInvite['kind']; rotated: boolean } | null>(null);
  const [confirming, setConfirming] = useState<{ id: string; withCustomers: boolean } | null>(null);

  const [mode, setMode] = useState<CustomerAccess['mode']>('approve_each');
  const [notify, setNotify] = useState(true);
  const [emails, setEmails] = useState('');

  const [kind, setKind] = useState<CustomerInvite['kind']>('personal');
  const [label, setLabel] = useState('');
  const [email, setEmail] = useState('');
  const [allOffers, setAllOffers] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [cap, setCap] = useState('20');

  const apply = useCallback(
    (r: InvitesResponse) => {
      setInvites(r.invites);
      setAccess(r.customer_access);
      setMode(r.customer_access.mode);
      setNotify(r.customer_access.notify_pending_email);
      setEmails(r.customer_access.preapproved_emails.join('\n'));
      onLoaded(r.agent_guests_enabled);
    },
    [onLoaded],
  );

  const load = useCallback(async () => {
    try {
      apply(await api<InvitesResponse>(base));
      setLoadError('');
    } catch (err) {
      setLoadError(errorText(err));
    }
  }, [apply, base]);

  useEffect(() => {
    let cancelled = false;
    api<InvitesResponse>(base).then(
      (r) => {
        if (!cancelled) apply(r);
      },
      (err: unknown) => {
        if (!cancelled) setLoadError(errorText(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [apply, base]);

  async function run(id: string, fn: () => Promise<void>) {
    setBusy(id);
    setError(null);
    setSaved('');
    try {
      await fn();
    } catch (err) {
      setError({ id, text: errorText(err) });
    } finally {
      setBusy(null);
    }
  }

  function saveAccess() {
    void run('access', async () => {
      await api(`/api/v1/agents/${agentId}/customer-access`, {
        method: 'PUT',
        body: { mode, notify_pending_email: notify, preapproved_emails: emailsFromText(emails) },
      });
      await load();
      setSaved('Saved.');
    });
  }

  function create() {
    const dailyCap = Number(cap);
    if (!Number.isInteger(dailyCap) || dailyCap < 1 || dailyCap > MAX_CAP) {
      setError({ id: 'create', text: `Tasks per day must be 1 to ${MAX_CAP.toLocaleString()}.` });
      return;
    }
    if (!allOffers && picked.length === 0) {
      setError({ id: 'create', text: 'Pick at least one task, or allow all tasks.' });
      return;
    }
    void run('create', async () => {
      const r = await api<NewCustomerInvite>(base, {
        method: 'POST',
        body: {
          kind,
          daily_cap: dailyCap,
          offers: allOffers ? null : picked,
          ...(label.trim() ? { label: label.trim() } : {}),
          ...(kind === 'personal' && email.trim() ? { email: email.trim() } : {}),
        },
      });
      setMade({ url: r.url, kind: r.invite.kind, rotated: false });
      setLabel('');
      setEmail('');
      await load();
    });
  }

  function rotate(invite: CustomerInvite) {
    void run(`ro${invite.id}`, async () => {
      const r = await api<NewCustomerInvite>(`${base}/${invite.id}/rotate`, { method: 'POST' });
      setMade({ url: r.url, kind: 'public', rotated: true });
      await load();
    });
  }

  function revoke(invite: CustomerInvite, withCustomers: boolean) {
    void run(`rv${invite.id}`, async () => {
      await api(`${base}/${invite.id}/revoke`, { method: 'POST', body: { revoke_customers: withCustomers } });
      setConfirming(null);
      await load();
      if (withCustomers) onChange();
    });
  }

  const rowError = (id: string) =>
    error?.id === id ? (
      <p className="dash-err" role="alert">
        {error.text}
      </p>
    ) : null;
  const publicLive = invites?.some((i) => i.kind === 'public' && i.status === 'active') ?? false;
  const headingId = `customers-h-${agentId}`;

  return (
    <section className="dash-invites" aria-labelledby={headingId}>
      <h4 id={headingId}>Customer links</h4>
      <p className="dash-muted">
        Customers open the link and sign in with an email code. They show up under Guests.
        {access ? ` ${access.customer_count} customers · ${access.pending_count} waiting.` : ''}
      </p>

      {loadError ? (
        <p className="dash-err" role="alert">
          {loadError}{' '}
          <button type="button" className="dash-textbtn" onClick={() => void load()}>
            Try again
          </button>
        </p>
      ) : null}

      {access ? (
        <form
          className="dash-invite-form"
          onSubmit={(e) => {
            e.preventDefault();
            saveAccess();
          }}
        >
          <fieldset className="dash-guest-offers">
            <legend>Who gets in with the public link</legend>
            <label>
              <input type="radio" name={`mode-${agentId}`} checked={mode === 'approve_each'} onChange={() => setMode('approve_each')} />
              I approve each customer
            </label>
            <label>
              <input type="radio" name={`mode-${agentId}`} checked={mode === 'open_link'} onChange={() => setMode('open_link')} />
              Anyone with the link
            </label>
          </fieldset>
          <div className="dash-field">
            <label htmlFor={`pre-${agentId}`}>Always approve these emails (one per line)</label>
            <textarea id={`pre-${agentId}`} rows={3} value={emails} onChange={(e) => setEmails(e.target.value)} />
          </div>
          <label className="dash-invite-check">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            Email me when someone asks for access (at most once an hour)
          </label>
          <div className="dash-actions">
            <button type="submit" className="dash-btn dash-btn-sm" disabled={busy !== null}>
              {busy === 'access' ? 'Saving…' : 'Save'}
            </button>
          </div>
          {rowError('access')}
          {saved ? (
            <p className="dash-ok" role="status">
              {saved}
            </p>
          ) : null}
        </form>
      ) : null}

      {made ? (
        <div className="dash-secret dash-invite-made" role="region" aria-label="Your customer link">
          <p className="dash-secret-title">{made.rotated ? 'New public link' : 'Your customer link'}</p>
          <p className="dash-muted">
            {made.rotated ? 'The old link stopped working. Existing customers keep their access. ' : ''}
            This link is shown once.
          </p>
          <div className="dash-secret-row">
            <code translate="no" className="dash-secret-value">
              {made.url}
            </code>
            <CopyButton value={made.url} label="Copy link" />
          </div>
          <div className="dash-actions">
            <button type="button" className="dash-textbtn" onClick={() => setMade(null)}>
              Done
            </button>
          </div>
        </div>
      ) : null}

      {offers.length === 0 ? (
        <p className="dash-muted dash-guest-invite-note">Add a task to this agent’s menu before you create a link.</p>
      ) : (
        <form
          className="dash-invite-form"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <fieldset className="dash-guest-offers">
            <legend>New link</legend>
            <label>
              <input type="radio" name={`kind-${agentId}`} checked={kind === 'personal'} onChange={() => setKind('personal')} />
              Personal: one customer, works once, always approved
            </label>
            <label>
              <input
                type="radio"
                name={`kind-${agentId}`}
                checked={kind === 'public'}
                disabled={publicLive}
                onChange={() => setKind('public')}
              />
              Public: one link for everyone{publicLive ? ' (you already have one; reset it below)' : ''}
            </label>
          </fieldset>
          <div className="dash-invite-grid">
            <div className="dash-field">
              <label htmlFor={`clabel-${agentId}`}>Label (optional)</label>
              <input id={`clabel-${agentId}`} type="text" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            {kind === 'personal' ? (
              <div className="dash-field">
                <label htmlFor={`cemail-${agentId}`}>Only this email can use it (optional)</label>
                <input id={`cemail-${agentId}`} type="email" maxLength={320} value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            ) : null}
            <div className="dash-field">
              <label htmlFor={`ccap-${agentId}`}>Tasks per day, per customer</label>
              <input id={`ccap-${agentId}`} type="number" min={1} max={MAX_CAP} value={cap} onChange={(e) => setCap(e.target.value)} />
            </div>
          </div>
          <label className="dash-invite-check">
            <input type="checkbox" checked={allOffers} onChange={(e) => setAllOffers(e.target.checked)} />
            All tasks, including ones added later
          </label>
          {!allOffers ? (
            <fieldset className="dash-guest-offers">
              <legend>Tasks they can send</legend>
              {offers.map((o) => (
                <label key={o.id}>
                  <input
                    type="checkbox"
                    checked={picked.includes(o.name)}
                    onChange={(e) => setPicked(e.target.checked ? [...picked, o.name] : picked.filter((n) => n !== o.name))}
                  />
                  <span translate="no">{o.name}</span>
                </label>
              ))}
            </fieldset>
          ) : null}
          <div className="dash-actions">
            <button type="submit" className="dash-btn dash-btn-ink" disabled={busy !== null || (kind === 'public' && publicLive)}>
              {busy === 'create' ? 'Creating…' : 'Create link'}
            </button>
          </div>
          {rowError('create')}
        </form>
      )}

      {invites && invites.length > 0 ? (
        <ul className="dash-guest-list">
          {invites.map((inv) => {
            const live = inv.status === 'active';
            return (
              <li key={inv.id} className="dash-guest">
                <div className="dash-guest-main">
                  <p className="dash-guest-name">
                    {inv.kind === 'public' ? 'Public link' : (inv.label ?? inv.email ?? 'Personal link')}{' '}
                    <code translate="no" className="dash-muted">
                      {inv.prefix}…
                    </code>
                  </p>
                  <p className="dash-muted">
                    {STATUS_TEXT[inv.status]} · used {inv.uses}
                    {inv.max_uses !== null ? ` of ${inv.max_uses}` : ''}
                    {inv.revoked_at ? ` · ${inv.rotated_at ? 'reset' : 'revoked'} ${formatTime(inv.revoked_at)}` : ''}
                    {!inv.revoked_at && inv.expires_at ? ` · expires ${formatTime(inv.expires_at)}` : ''}
                    {' · '}
                    <span translate="no">{inv.all_offers ? 'all tasks' : (inv.offers ?? []).map((o) => o.name).join(', ')}</span>
                  </p>
                </div>
                <div className="dash-actions">
                  {confirming?.id === inv.id ? (
                    <div className="dash-confirm" role="group" aria-label={`Revoke link ${inv.prefix}`}>
                      <p>Revoke this link? Nobody new can use it.</p>
                      {inv.uses > 0 ? (
                        <label className="dash-invite-check">
                          <input
                            type="checkbox"
                            checked={confirming.withCustomers}
                            onChange={(e) => setConfirming({ id: inv.id, withCustomers: e.target.checked })}
                          />
                          Also remove the customers who joined with it. They can’t come back.
                        </label>
                      ) : null}
                      <div className="dash-actions">
                        <button
                          type="button"
                          className="dash-textbtn dash-danger"
                          disabled={busy !== null}
                          onClick={() => revoke(inv, confirming.withCustomers)}
                        >
                          {busy === `rv${inv.id}` ? 'Revoking…' : 'Yes, revoke'}
                        </button>
                        <button type="button" className="dash-textbtn" disabled={busy !== null} onClick={() => setConfirming(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {live && inv.kind === 'public' ? (
                        <button type="button" className="dash-textbtn" disabled={busy !== null} onClick={() => rotate(inv)}>
                          {busy === `ro${inv.id}` ? 'Resetting…' : 'Reset link'}
                        </button>
                      ) : null}
                      {live || inv.uses > 0 ? (
                        <button
                          type="button"
                          className="dash-textbtn dash-danger"
                          disabled={busy !== null}
                          onClick={() => setConfirming({ id: inv.id, withCustomers: !live })}
                        >
                          {live ? 'Revoke' : 'Remove customers…'}
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
                {rowError(`rv${inv.id}`)}
                {rowError(`ro${inv.id}`)}
              </li>
            );
          })}
        </ul>
      ) : invites ? (
        <p className="dash-empty">No customer links yet.</p>
      ) : null}
    </section>
  );
}
