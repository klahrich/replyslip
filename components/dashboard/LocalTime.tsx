'use client';

import { useSyncExternalStore } from 'react';
import { formatTime } from './api';

const noSubscribe = () => () => {};

/**
 * A date and time in the viewer's own time zone and locale. The server can't know either, so it renders an empty
 * <time> and the browser fills it in right after hydration. Formatting on both sides gave different text
 * (UTC on the server, local time in the browser) and React error #418.
 */
export function LocalTime({ iso, className }: { iso: string | null | undefined; className?: string }) {
  // false during the server render and hydration, true after.
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  if (!iso) return <>—</>;
  return (
    <time className={className} dateTime={iso} suppressHydrationWarning>
      {mounted ? formatTime(iso) : ''}
    </time>
  );
}
