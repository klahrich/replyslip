'use client';

import { useEffect, useState } from 'react';
import { api, errorText } from './api';
import { Guests } from './Guests';
import { InviteLinks } from './InviteLinks';
import { SharingToggle } from './SharingToggle';
import { WorkspaceHandle } from './WorkspaceHandle';
import type { Agent, Offer } from './types';

const STEPS = [
  { title: 'Pick what your agent offers', text: 'Each offer is a task with a result schema you write. Your agent adds them with upsert_offer.' },
  {
    title: 'Give access',
    text: 'Invite a ReplySlip workspace by its handle, or create an invite link for a customer who isn’t on ReplySlip.',
  },
  { title: 'They send tasks', text: 'Their agent calls your address over MCP. You can revoke access at any time.' },
];

/** Offers of the selected agent, for the invite-link form. Guests loads its own copy. */
function useOffers(agentId: string | null) {
  const [state, setState] = useState<{ id: string; offers: Offer[] } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    api<{ offers: Offer[] }>(`/api/v1/agents/${agentId}/offers`).then(
      (r) => {
        if (!cancelled) {
          setState({ id: agentId, offers: r.offers });
          setError('');
        }
      },
      (err: unknown) => {
        if (!cancelled) setError(errorText(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [agentId]);
  return { offers: state?.id === agentId ? state.offers : null, error };
}

/** The Sharing tab: how sharing works, the handle, and per-agent sharing, invite links, and guests. */
export function Sharing({
  agents,
  handle,
  onHandleSaved,
  guestLimit,
  onChange,
}: {
  agents: Agent[];
  handle: string | null;
  onHandleSaved: (handle: string) => void;
  guestLimit: number | null;
  onChange: () => void;
}) {
  const live = agents.filter((a) => !a.revoked_at);
  const [picked, setPicked] = useState<string | null>(null);
  const selected = live.find((a) => a.id === picked) ?? live.find((a) => a.shared) ?? live[0] ?? null;
  const { offers, error } = useOffers(selected?.shared ? selected.id : null);
  // Remounts Guests after a revoke that also revoked guests who joined with a link.
  const [guestsKey, setGuestsKey] = useState(0);

  return (
    <>
      <section className="dash-card" aria-labelledby="share-how-h">
        <div className="dash-card-head">
          <div>
            <h2 id="share-how-h">How sharing works</h2>
            <p className="dash-muted">
              Other teams’ agents send tasks to one of your agents. They see only their own tasks.{' '}
              <a className="link" href="/how-it-works#sharing">
                Read more
              </a>
            </p>
          </div>
        </div>
        <ol className="dash-share-steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="dash-share-num" aria-hidden="true">
                {i + 1}
              </span>
              <span>
                <span className="dash-step-label">{s.title}</span>
                <span className="dash-muted dash-step-note">{s.text}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="dash-card" aria-labelledby="share-handle-h">
        <h2 id="share-handle-h">Your handle</h2>
        <p className="dash-muted">Shared agents get the address @handle/agent.</p>
        <WorkspaceHandle handle={handle} shared={live.filter((a) => a.shared).length} onSaved={onHandleSaved} />
      </section>

      <section className="dash-card" aria-labelledby="share-agents-h">
        <div className="dash-card-head">
          <div>
            <h2 id="share-agents-h">Shared agents</h2>
            {!handle ? <p className="dash-muted">Set a handle above first.</p> : null}
          </div>
          {live.length > 1 ? (
            <label className="dash-filter">
              Agent
              <select value={selected?.id ?? ''} onChange={(e) => setPicked(e.target.value)}>
                {live.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.shared ? ' (shared)' : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        {!selected ? (
          <p className="dash-empty">
            No agents yet. Connect one in the{' '}
            <a className="link" href="#connect">
              Workspace tab
            </a>
            , then come back to share it.
          </p>
        ) : (
          <div className="dash-agent">
            <h3 translate="no">{selected.name}</h3>
            <SharingToggle agent={selected} handle={handle} onChange={onChange} />
            {selected.shared ? (
              error ? (
                <p className="dash-err" role="alert">
                  {error}
                </p>
              ) : offers ? (
                <InviteLinks
                  key={selected.id}
                  agentId={selected.id}
                  agentName={selected.name}
                  offers={offers}
                  onRedeemedChange={() => setGuestsKey((k) => k + 1)}
                />
              ) : null
            ) : null}
            <Guests
              key={`${selected.id}-${guestsKey}`}
              agentId={selected.id}
              agentName={selected.name}
              handle={handle}
              shared={!!selected.shared}
              guestLimit={guestLimit}
            />
          </div>
        )}
      </section>
    </>
  );
}
