'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Clock, Hourglass, Lock, ShieldOff } from 'lucide-react';
import { getBot, listRequests } from '../_lib/api';
import type { BotResponse, Job, RequestListRow } from '../_lib/types';
import { cn } from '../_lib/utils';
import { BrandFrame } from '../_components/Frame';
import { Notice } from '../_components/Notice';
import { StatusBadge } from '../_components/StatusBadge';
import { usePoll } from '../_components/usePoll';
import { Account, ConnectError, Loading, NotFound, loadFailure, retryable, useEmail, when, type LoadFailure } from './common';

export function BotView({ agentId }: { agentId: string }) {
  const [data, setData] = useState<BotResponse | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [recent, setRecent] = useState<RequestListRow[] | null>(null);
  const email = useEmail();

  const load = useCallback(async () => {
    try {
      const d = await getBot(agentId);
      setData(d);
      setFailure(null);
      if (d.share.status !== 'pending') setRecent((await listRequests(agentId, { limit: 3 })).requests);
    } catch (e) {
      setFailure(loadFailure(e));
    }
  }, [agentId]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  // Waiting for approval: check every 30 s and swap in the jobs without a reload (spec 15.9).
  usePoll(load, () => 30000, data?.share.status === 'pending');

  if (failure === 'missing') return <NotFound />;
  // A failed poll keeps the page it already has; only a first load that fails shows the retry screen.
  if (retryable(failure) && !data)
    return (
      <ConnectError
        failure={failure}
        onRetry={() => {
          setFailure(null);
          void load();
        }}
      />
    );
  if (!data) return <Loading />;
  const { branding } = data.bot;
  const name = branding.display_name;

  if (data.share.status === 'pending') {
    return (
      <BrandFrame branding={branding} agentId={agentId} account={<Account />}>
        <Notice icon={<Hourglass />} title={`Waiting for approval from ${name}`}>
          <p>You can send requests as soon as they approve you. You can close this page.</p>
          {email && (
            <p>
              Signed in as <span className="font-medium break-all text-foreground">{email}</span>
            </p>
          )}
        </Notice>
        <p className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <span className="size-1.5 animate-pulse rounded-full bg-primary" aria-hidden /> This page updates on its own.
        </p>
        {data.jobs.length > 0 && (
          <section className="mt-8">
            <h2 className="text-[17px] font-semibold tracking-tight">What you can ask once you&apos;re approved</h2>
            <JobList agentId={agentId} jobs={data.jobs} muted />
          </section>
        )}
      </BrandFrame>
    );
  }

  if (data.share.status === 'revoked') {
    return (
      <BrandFrame branding={branding} agentId={agentId} account={<Account />}>
        <Notice icon={<ShieldOff />} title={`You can't send new requests to ${name}`}>
          <p>Your access was turned off. If you think this is a mistake, contact {name} directly.</p>
        </Notice>
        {recent && recent.length > 0 && <Recent agentId={agentId} name={name} rows={recent} title="Your past requests" />}
      </BrandFrame>
    );
  }

  const share = data.share;
  const capped = share.used_today >= share.daily_cap;

  return (
    <BrandFrame branding={branding} agentId={agentId} account={<Account />}>
      <h1 className="text-[26px] leading-tight font-semibold tracking-tight">What can we help with?</h1>
      <p className="mt-1.5 text-[15px] text-muted-foreground">Pick a job. You&apos;ll see the answer on this page.</p>

      {capped && (
        <Notice icon={<Clock />} title="You've reached today's limit" level="h2" className="mt-6">
          <p>
            You can send up to {share.daily_cap} {share.daily_cap === 1 ? 'request' : 'requests'} a day to {name}. {resetText(share.resets_at)}
          </p>
        </Notice>
      )}

      {capped ? (
        <ul className="mt-6 grid gap-3">
          {data.jobs.map((job) => (
            <li key={job.name}>
              <div className="rounded-2xl border border-border bg-card p-5 opacity-60" aria-disabled>
                <JobCardBody title={job.title} description={job.description} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <JobList agentId={agentId} jobs={data.jobs} />
      )}

      {recent && recent.length > 0 && <Recent agentId={agentId} name={name} rows={recent} title="Recent requests" />}
    </BrandFrame>
  );
}

function resetText(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === new Date().toDateString() || d.toDateString() === tomorrow.toDateString()) return 'You can send more tomorrow.';
  return `You can send more on ${d.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })}.`;
}

function JobList({ agentId, jobs, muted = false }: { agentId: string; jobs: Job[]; muted?: boolean }) {
  return (
    <ul className={muted ? 'mt-4 grid gap-3' : 'mt-6 grid gap-3'}>
      {jobs.map((job) => (
        <li key={job.name}>
          <Link
            href={`/c/${agentId}/new/${job.name}`}
            className={cn(
              'group flex items-center gap-4 rounded-2xl border border-border bg-card p-5 transition-[border-color,box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none',
              muted ? 'text-muted-foreground' : 'shadow-sm hover:border-primary/40 hover:shadow-md',
            )}
          >
            <JobCardBody title={job.title} description={job.description} />
            <span
              className={cn(
                'grid size-10 shrink-0 place-items-center rounded-full',
                muted ? 'bg-muted text-muted-foreground' : 'bg-accent text-primary-text transition-colors group-hover:bg-primary group-hover:text-primary-foreground',
              )}
            >
              {muted ? <Lock className="size-4" aria-label="Available once approved" /> : <ChevronRight className="size-5" />}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function JobCardBody({ title, description }: { title: string; description: string }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block text-[17px] font-semibold tracking-tight">{title}</span>
      <span className="mt-1 block text-[15px] leading-snug text-muted-foreground">{description}</span>
    </span>
  );
}

export function RequestRow({ agentId, name, row }: { agentId: string; name: string; row: RequestListRow }) {
  const job = row.offer_title ?? row.title;
  return (
    <Link href={`/c/${agentId}/r/${row.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3.5 transition-colors hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{row.summary}</span>
        <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
          {job && job !== row.summary ? `${job} · ` : ''}
          {when(row.created_at)}
        </span>
      </span>
      <StatusBadge status={row.status} name={name} />
    </Link>
  );
}

function Recent({ agentId, name, rows, title }: { agentId: string; name: string; rows: RequestListRow[]; title: string }) {
  return (
    <section className="mt-10">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
        <Link href={`/c/${agentId}/requests`} className="inline-flex min-h-11 items-center px-1 text-[15px] font-medium text-primary-text underline-offset-4 hover:underline">
          See all
        </Link>
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        {rows.map((r) => (
          <li key={r.id}>
            <RequestRow agentId={agentId} name={name} row={r} />
          </li>
        ))}
      </ul>
    </section>
  );
}
