'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import { getMe, signOut } from '../_lib/api';
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
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-11 shrink-0 rounded-xl px-3 text-sm text-muted-foreground hover:text-foreground"
      onClick={async () => {
        await signOut();
        router.push('/c?signed_out=1');
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

export function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? `Today, ${d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}`
    : d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
