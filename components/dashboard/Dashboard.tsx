'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Agents } from './Agents';
import { api, errorText, formatTime, SIGNED_OUT_EVENT } from './api';
import { EmailPrefs } from './EmailPrefs';
import { JoinCodes, type DocPaths } from './JoinCodes';
import { Tasks } from './Tasks';
import { WatcherKeys } from './WatcherKeys';
import { WorkspaceName } from './WorkspaceName';
import type { Agent, AgentKey, JoinCode } from './types';

type Workspace = { id: string; name: string; created_at: string };

type Loaded = { agents: Agent[]; keys: Record<string, AgentKey[]>; codes: JoinCode[] };

async function fetchAll(): Promise<Loaded> {
  const [{ agents }, { join_codes }] = await Promise.all([
    api<{ agents: Agent[] }>('/api/v1/agents'),
    api<{ join_codes: JoinCode[] }>('/api/v1/join-codes'),
  ]);
  const keyLists = await Promise.all(
    agents.map((a) => api<{ keys: AgentKey[] }>(`/api/v1/agents/${a.id}/keys`).then((r) => [a.id, r.keys] as const)),
  );
  return { agents, keys: Object.fromEntries(keyLists), codes: join_codes };
}

export function Dashboard({
  workspace,
  email,
  marketingOptIn,
  origin,
  paths,
}: {
  workspace: Workspace;
  email: string;
  /** user.marketing_opt_in, the same value GET /api/v1/auth/me returns. */
  marketingOptIn: boolean;
  origin: string;
  paths: DocPaths;
}) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [keys, setKeys] = useState<Record<string, AgentKey[]>>({});
  const [codes, setCodes] = useState<JoinCode[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  const router = useRouter();

  useEffect(() => {
    const onSignedOut = () => router.replace('/sign-in');
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, [router]);

  const apply = useCallback((data: Loaded | Error) => {
    if (data instanceof Error) {
      setError(errorText(data));
    } else {
      setAgents(data.agents);
      setKeys(data.keys);
      setCodes(data.codes);
      setError('');
    }
    setLoaded(true);
  }, []);

  const load = useCallback(() => fetchAll().then(apply, (err: Error) => apply(err)), [apply]);

  useEffect(() => {
    let cancelled = false;
    fetchAll().then(
      (data) => {
        if (!cancelled) apply(data);
      },
      (err: Error) => {
        if (!cancelled) apply(err);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [apply]);

  const refresh = () => {
    void load();
    setTick((t) => t + 1);
  };

  const live = agents.filter((a) => !a.revoked_at).length;

  return (
    <>
      <section className="dash-hero" aria-labelledby="ws-h">
        <p className="dash-muted">Workspace</p>
        <WorkspaceName initialName={workspace.name} />
        <p className="dash-muted">
          Signed in as {email} · created {formatTime(workspace.created_at)}
          {loaded ? ` · ${live} active ${live === 1 ? 'agent' : 'agents'}` : ''}
        </p>
      </section>
      {error ? (
        <p className="dash-err" role="alert">
          {error}{' '}
          <button type="button" className="dash-textbtn" onClick={refresh}>
            Try again
          </button>
        </p>
      ) : null}
      <JoinCodes codes={codes} agents={agents} origin={origin} paths={paths} onChange={refresh} />
      {loaded ? <Agents agents={agents} keys={keys} onChange={refresh} /> : null}
      <WatcherKeys />
      <Tasks refreshKey={tick} />
      <EmailPrefs initialOptIn={marketingOptIn} />
    </>
  );
}
