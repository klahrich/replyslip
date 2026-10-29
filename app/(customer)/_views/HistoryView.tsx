'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Inbox } from 'lucide-react';
import { getBot, listRequests } from '../_lib/api';
import { ApiError, type Branding, type RequestListRow } from '../_lib/types';
import { Button } from '../_ui/button';
import { BrandFrame } from '../_components/Frame';
import { usePoll } from '../_components/usePoll';
import { cn } from '../_lib/utils';
import { Account, Loading, NotFound } from './common';
import { RequestRow } from './BotView';

type Filter = 'all' | 'open' | 'needs_info' | 'done' | 'failed';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'needs_info', label: 'Needs you' },
  { id: 'open', label: 'Working' },
  { id: 'done', label: 'Done' },
  { id: 'failed', label: 'Not completed' },
];

export function HistoryView({ agentId }: { agentId: string }) {
  const [branding, setBranding] = useState<Branding | null>(null);
  const [rows, setRows] = useState<RequestListRow[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await listRequests(agentId, { limit: 20, status: filter === 'all' ? undefined : filter });
      setRows(r.requests);
      setCursor(r.next_cursor);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setMissing(true);
    }
  }, [agentId, filter]);

  useEffect(() => {
    getBot(agentId).then((b) => setBranding(b.bot.branding), () => setMissing(true));
  }, [agentId]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  usePoll(load, () => 30000, true); // spec 15.9: the list every 30 s while visible

  if (missing) return <NotFound />;
  if (!branding || !rows) return <Loading />;
  const name = branding.display_name;

  return (
    <BrandFrame branding={branding} agentId={agentId} account={<Account />}>
      <Link href={`/c/${agentId}`} className="-ml-2 inline-flex h-11 w-fit items-center gap-1.5 rounded-lg px-2 text-[15px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All jobs
      </Link>
      <h1 className="mt-2 text-[26px] leading-tight font-semibold tracking-tight">Your requests</h1>

      <div className="-mx-4 mt-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0" role="tablist" aria-label="Filter requests">
        <div className="flex w-max gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                'h-10 rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-colors',
                filter === f.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground hover:bg-accent',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="mt-6 grid place-items-center rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
          <Inbox className="size-8 text-muted-foreground" />
          <p className="mt-3 font-medium">No requests here yet</p>
          <Link href={`/c/${agentId}`} className="mt-1 inline-flex min-h-11 items-center text-[15px] text-primary-text underline underline-offset-4">
            Send a request
          </Link>
        </div>
      ) : (
        <ul className="mt-5 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          {rows.map((r) => (
            <li key={r.id}>
              <RequestRow agentId={agentId} name={name} row={r} />
            </li>
          ))}
        </ul>
      )}
      {cursor && (
        <Button
          variant="outline"
          className="mt-4 h-12 rounded-xl bg-card text-base"
          onClick={async () => {
            const more = await listRequests(agentId, { limit: 20, cursor, status: filter === 'all' ? undefined : filter });
            setRows([...(rows ?? []), ...more.requests]);
            setCursor(more.next_cursor);
          }}
        >
          Show more
        </Button>
      )}
    </BrandFrame>
  );
}
