'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { listBots } from '../_lib/api';
import { brandStyle } from '../_lib/brand';
import type { BotsResponse } from '../_lib/types';
import { LogoTile, PlainFrame } from '../_components/Frame';
import { Notice } from '../_components/Notice';
import { Loading } from './common';

const shareLabel = { approved: '', pending: 'Waiting for approval', revoked: 'Access turned off' } as const;

export function BotsView({ signedOut }: { signedOut: boolean }) {
  const [data, setData] = useState<BotsResponse | null>(null);
  useEffect(() => {
    if (!signedOut) listBots().then(setData, () => setData({ bots: [] }));
  }, [signedOut]);

  if (signedOut) {
    return (
      <PlainFrame>
        <Notice title="You're signed out">
          <p>To come back, open the link the business sent you.</p>
        </Notice>
      </PlainFrame>
    );
  }
  if (!data) return <Loading />;
  return (
    <PlainFrame>
      <h1 className="text-[26px] leading-tight font-semibold tracking-tight">Your businesses</h1>
      <ul className="mt-6 grid gap-3">
        {data.bots.map((b) => (
          <li key={b.agent_id} style={brandStyle(b.branding)}>
            <Link href={`/c/${b.agent_id}`} className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
              <LogoTile branding={b.branding} size={48} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[17px] font-semibold">{b.branding.display_name}</span>
                <span className="block text-sm text-muted-foreground">
                  {shareLabel[b.share_status] || (b.open_requests ? `${b.open_requests} open ${b.open_requests === 1 ? 'request' : 'requests'}` : 'No open requests')}
                </span>
              </span>
              <ChevronRight className="size-5 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </PlainFrame>
  );
}
