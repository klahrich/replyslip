'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Eye, Hourglass } from 'lucide-react';
import { getBot } from '../_lib/api';
import type { BotResponse } from '../_lib/types';
import { BrandFrame } from '../_components/Frame';
import { JobForm } from '../_components/JobForm';
import { usePoll } from '../_components/usePoll';
import { Account, ConnectError, Loading, NotFound, loadFailure, retryable, type LoadFailure } from './common';

export function JobView({ agentId, offer }: { agentId: string; offer: string }) {
  const router = useRouter();
  const [data, setData] = useState<BotResponse | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await getBot(agentId);
      if (d.access === 'revoked') router.replace(`/c/${agentId}`);
      setData(d);
    } catch (e) {
      setFailure(loadFailure(e));
    }
  }, [agentId, router]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);
  // Section 17.1: a pending customer sees the form disabled; it turns on by itself once approved.
  usePoll(load, () => 30000, data?.access === 'pending');

  if (failure === 'missing') return <NotFound />;
  // A failed poll keeps the form on screen; only a first load that fails shows the retry screen.
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
  const job = data.jobs.find((j) => j.name === offer);
  if (!job) return <NotFound message="This job isn't available anymore." />;
  const name = data.bot.branding.display_name;
  const pending = data.access === 'pending';

  return (
    <BrandFrame branding={data.bot.branding} agentId={agentId} account={<Account />}>
      <Link href={`/c/${agentId}`} className="-ml-2 inline-flex h-11 w-fit items-center gap-1.5 rounded-lg px-2 text-[15px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All jobs
      </Link>
      <h1 className="mt-2 text-[26px] leading-tight font-semibold tracking-tight">{job.title}</h1>
      <p className="mt-1.5 text-[15px] text-muted-foreground">{job.description}</p>
      {job.result_fields.length > 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">You&apos;ll get:</span> {job.result_fields.map((f) => f.label).join(', ')}
        </p>
      )}

      {pending ? (
        <Banner icon={<Hourglass />} title={`Waiting for approval from ${name}`}>
          You can fill this in once they approve you. This page updates on its own.
        </Banner>
      ) : (
        data.review_mode === 'review_first' && (
          // Section 17.7: say so before the customer submits.
          <Banner icon={<Eye />} title={`${name} reviews each request before it's sent`}>
            You&apos;ll see the status on the next page.
          </Banner>
        )
      )}

      <div className="mt-4 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
        <JobForm agentId={agentId} job={job} businessName={name} disabled={pending} onSent={(r) => router.push(`/c/${agentId}/r/${r.id}`)} onPending={load} />
      </div>
    </BrandFrame>
  );
}

function Banner({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6 flex items-start gap-3 rounded-2xl border border-border bg-accent px-4 py-3.5" role="note">
      <span className="mt-0.5 shrink-0 text-primary-text [&_svg]:size-5">{icon}</span>
      <div>
        <p className="text-[15px] leading-snug font-semibold">{title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}
