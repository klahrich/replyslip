'use client';

/**
 * The business's site as a still image behind the demo chat. Inert: no links, forms, scripts or
 * analytics from the business's site ever load. Images come only from /s/demo/<token>/shot/*,
 * so the noindex header covers them. If a shot fails (mock data has none), a plainly fake
 * placeholder site shows instead.
 */
import { useEffect, useRef, useState } from 'react';
import { shotUrl } from '../../_lib/site-demo-api';
import { cn } from '../../_lib/utils';

export function DemoBackdrop({ token, className }: { token: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // An image that failed before hydration never fires onError for React; check once after mount.
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0) setFailed(true);
  }, []);
  return (
    <div aria-hidden inert className={cn('pointer-events-none overflow-hidden bg-muted select-none', className)} data-testid="backdrop">
      {failed ? (
        <PlaceholderSite />
      ) : (
        <picture>
          <source media="(min-width: 1280px)" srcSet={shotUrl(token, 'desktop')} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={img}
            src={shotUrl(token, 'mobile')}
            alt=""
            decoding="async"
            referrerPolicy="no-referrer"
            draggable={false}
            onError={() => setFailed(true)}
            className="size-full object-cover object-top"
          />
        </picture>
      )}
      <div className="absolute inset-0 bg-black/10" />
    </div>
  );
}

/** Mock and fallback backdrop. Grey boxes and a label, so nobody mistakes it for a real site. */
function PlaceholderSite() {
  return (
    <div data-testid="placeholder-site" className="flex size-full flex-col bg-[repeating-linear-gradient(135deg,#ecece8_0_14px,#f3f3f0_14px_28px)]">
      <div className="flex h-12 items-center gap-3 bg-white/80 px-5">
        <span className="h-5 w-24 rounded bg-neutral-300" />
        <span className="ml-auto h-3 w-12 rounded bg-neutral-200" />
        <span className="h-3 w-12 rounded bg-neutral-200" />
        <span className="hidden h-3 w-12 rounded bg-neutral-200 sm:block" />
      </div>
      <div className="flex flex-1 flex-col items-start justify-center gap-3 px-6 md:px-16">
        <span className="rounded bg-white/90 px-2 py-1 font-mono text-[11px] tracking-wide text-neutral-500 uppercase">Placeholder website · mock data</span>
        <span className="h-6 w-2/3 max-w-md rounded bg-neutral-300" />
        <span className="h-3 w-1/2 max-w-sm rounded bg-neutral-200" />
        <span className="hidden h-40 w-full max-w-lg rounded-lg bg-neutral-200/80 md:block" />
      </div>
    </div>
  );
}
