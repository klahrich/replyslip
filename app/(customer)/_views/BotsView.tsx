'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { listBots } from '../_lib/api';
import { brandStyle } from '../_lib/brand';
import type { BotsResponse } from '../_lib/types';
import { EmailSignIn, SignInCard } from '../_components/EmailSignIn';
import { LogoTile, PlainFrame } from '../_components/Frame';
import { ConnectError, Loading, loadFailure } from './common';

const shareLabel = { approved: '', pending: 'Waiting for approval', revoked: 'Access turned off' } as const;

export function BotsView({ signedOut }: { signedOut: boolean }) {
  const router = useRouter();
  const [data, setData] = useState<BotsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      setData(await listBots());
    } catch (e) {
      // 401 is SessionGate's (it shows the sign-in form); a failed fetch or 5xx gets a retry.
      if (loadFailure(e) === 'connect') setFailed(true);
    }
  }, []);
  useEffect(() => {
    if (signedOut) return;
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [signedOut, load]);

  if (signedOut) {
    return (
      <PlainFrame>
        <SignInCard>
          <EmailSignIn
            title="You're signed out"
            intro="To come back, enter the email you used with this business. We'll send you a 6-digit code."
            onSignedIn={() => router.replace('/c')}
          />
        </SignInCard>
      </PlainFrame>
    );
  }
  if (failed)
    return (
      <ConnectError
        onRetry={() => {
          setFailed(false);
          void load();
        }}
      />
    );
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
