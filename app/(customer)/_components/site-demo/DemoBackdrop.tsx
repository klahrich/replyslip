'use client';

/**
 * The business's site as a still image behind the demo chat. Inert: no links, forms, scripts or
 * analytics from the business's site ever load. Images come only from /s/demo/<token>/shot/*,
 * so the noindex header covers them. If a shot is missing (or the link expired, which the shot
 * routes answer with 404), the backdrop is a plain background and the chat works as usual.
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
    <div
      aria-hidden
      inert
      className={cn('pointer-events-none overflow-hidden bg-muted select-none', className)}
      data-testid="backdrop"
      data-shot={failed ? 'none' : 'loaded'}
    >
      {!failed && (
        <picture>
          <source media="(min-width: 1280px)" srcSet={shotUrl(token, 'desktop')} />
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
      {!failed && <div className="absolute inset-0 bg-black/10" />}
    </div>
  );
}
