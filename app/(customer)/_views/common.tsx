'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LogOut, WifiOff } from 'lucide-react';
import { getMe, signOut } from '../_lib/api';
import { agentIdFromPath } from '../_lib/brandMemory';
import { ApiError } from '../_lib/types';
import { Button } from '../_ui/button';
import { Skeleton } from '../_ui/skeleton';
import { PlainFrame } from '../_components/Frame';
import { Notice } from '../_components/Notice';

export function useEmail(): string | null {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    getMe().then((m) => setEmail(m.user.email), () => setEmail(null));
  }, []);
  return email;
}

export function Account() {
  const router = useRouter();
  // The signed-out page shows this business's name and logo again.
  const agentId = agentIdFromPath(usePathname());
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-11 shrink-0 rounded-xl px-3 text-sm text-muted-foreground hover:text-foreground"
      onClick={async () => {
        await signOut();
        router.push(agentId ? `/c?signed_out=1&from=${encodeURIComponent(agentId)}` : '/c?signed_out=1');
      }}
    >
      <LogOut aria-hidden />
      <span>Sign out</span>
    </Button>
  );
}

export function Loading() {
  return (
    <PlainFrame>
      <div className="grid gap-4" aria-busy="true" aria-label="Loading">
        <div className="flex items-center gap-3">
          <Skeleton className="size-11 rounded-xl" />
          <Skeleton className="h-5 w-40" />
        </div>
        <Skeleton className="h-36 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    </PlainFrame>
  );
}

export function NotFound({ message }: { message?: string }) {
  return (
    <PlainFrame>
      <Notice title="We couldn't find that page">
        <p>{message ?? 'Check the link, or ask the business that sent it.'}</p>
      </Notice>
    </PlainFrame>
  );
}

/**
 * How a page load failed. 404 → NotFound; 401 → nothing here (SessionGate already swapped the page for the
 * sign-in form); 403/410 (not yours, gone) also read as not found. A failed fetch, 5xx, 429 or anything
 * unexpected → ConnectError with a retry.
 */
export type LoadFailure = 'missing' | 'signed_out' | 'connect';

export function loadFailure(e: unknown): LoadFailure {
  if (!(e instanceof ApiError)) return 'connect';
  if (e.status === 401) return 'signed_out';
  if (e.status === 404 || e.status === 403 || e.status === 410) return 'missing';
  return 'connect';
}

export function ConnectError({ onRetry }: { onRetry: () => void }) {
  return (
    <PlainFrame>
      <Notice
        icon={<WifiOff />}
        title="Couldn't connect"
        action={
          <Button type="button" onClick={onRetry} className="h-12 w-full rounded-xl text-base font-semibold">
            Try again
          </Button>
        }
      >
        <p>Check your connection and try again.</p>
      </Notice>
    </PlainFrame>
  );
}

export function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? `Today, ${d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}`
    : d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
