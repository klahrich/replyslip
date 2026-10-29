'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { getBot } from '../_lib/api';
import { ApiError, type BotResponse } from '../_lib/types';
import { BrandFrame } from '../_components/Frame';
import { JobForm } from '../_components/JobForm';
import { Account, Loading, NotFound } from './common';
import { jobTitle } from './BotView';

export function JobView({ agentId, offer }: { agentId: string; offer: string }) {
  const router = useRouter();
  const [data, setData] = useState<BotResponse | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    getBot(agentId).then(
      (d) => {
        if (d.share.status !== 'approved') router.replace(`/c/${agentId}`);
        setData(d);
      },
      (e) => e instanceof ApiError && setMissing(true),
    );
  }, [agentId, router]);

  if (missing) return <NotFound />;
  if (!data) return <Loading />;
  const job = data.jobs.find((j) => j.name === offer);
  if (!job) return <NotFound message="This job isn't available anymore." />;

  return (
    <BrandFrame branding={data.bot.branding} agentId={agentId} account={<Account />}>
      <Link href={`/c/${agentId}`} className="-ml-2 inline-flex h-11 w-fit items-center gap-1.5 rounded-lg px-2 text-[15px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All jobs
      </Link>
      <h1 className="mt-2 text-[26px] leading-tight font-semibold tracking-tight">{jobTitle(job)}</h1>
      <p className="mt-1.5 text-[15px] text-muted-foreground">{job.description}</p>
      {job.result_fields.length > 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">You&apos;ll get:</span> {job.result_fields.map((f) => f.label).join(', ')}
        </p>
      )}
      <div className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
        <JobForm agentId={agentId} job={job} onSent={(r) => router.push(`/c/${agentId}/r/${r.id}`)} />
      </div>
    </BrandFrame>
  );
}
