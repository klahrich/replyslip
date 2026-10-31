'use client';

import { useEffect, useRef } from 'react';

/**
 * Polls `tick` while the tab is visible (spec 15.9). `delay(elapsedMs)` returns the next wait in ms,
 * or null to stop. Polls right away when the tab becomes visible again.
 */
export function usePoll(tick: () => Promise<unknown> | void, delay: (elapsedMs: number) => number | null, enabled: boolean) {
  const tickRef = useRef(tick);
  const delayRef = useRef(delay);
  useEffect(() => {
    tickRef.current = tick;
    delayRef.current = delay;
  });
  useEffect(() => {
    if (!enabled) return;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const schedule = () => {
      const d = delayRef.current(Date.now() - started);
      if (d === null || stopped) return;
      timer = setTimeout(run, d);
    };
    const run = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        await tickRef.current();
      } finally {
        schedule();
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(timer);
        void run();
      } else clearTimeout(timer);
    };
    schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);
}
