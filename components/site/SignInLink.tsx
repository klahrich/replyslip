'use client';

import Link from 'next/link';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { REF_KEY, REF_TTL_MS as TTL_MS } from './ref-keep';

const SAFE_REF = /^[a-z0-9_-]{1,40}$/;
/** Only the /sharing CTA should send this, so it is never kept across pages. */
const SHARING = 'sharing';

/** Same precedence as sourceFromUrl: `ref`, then `utm_source`. Lowercased; null unless it is safe. */
function refFromUrl(): string | null {
  const q = new URLSearchParams(window.location.search);
  const ref = (q.get('ref') || q.get('utm_source') || '').trim().toLowerCase();
  return SAFE_REF.test(ref) ? ref : null;
}

function keptRef(): string | null {
  try {
    const raw = sessionStorage.getItem(REF_KEY);
    if (!raw) return null;
    const { ref, at } = JSON.parse(raw) as { ref?: unknown; at?: unknown };
    if (typeof ref === 'string' && typeof at === 'number' && Date.now() - at < TTL_MS && SAFE_REF.test(ref) && ref !== SHARING) {
      return ref;
    }
    sessionStorage.removeItem(REF_KEY);
  } catch {
    // Storage blocked or bad JSON: no kept ref.
  }
  return null;
}

/**
 * `ref` on this page, or one kept from an earlier page in this tab within the last 30 minutes.
 * `sharing` counts only on /sharing itself, so wants_sharing comes from intent on that page.
 */
function currentRef(): string | null {
  const fromUrl = refFromUrl();
  if (fromUrl === SHARING && window.location.pathname !== '/sharing') return keptRef();
  return fromUrl ?? keptRef();
}

const noSubscribe = () => () => {};

/**
 * A link to /sign-in that carries the visitor's `?ref=`, so a sign-up started from the top bar keeps its source.
 * The server render has no ref, so static pages stay static; the ref is added after hydration.
 * A href that already sets ref (the /sharing CTA) is left as is. `sharing` is never kept and passes through only on /sharing.
 */
export function SignInLink({ href = '/sign-in', className, children }: { href?: string; className?: string; children: ReactNode }) {
  const ref = useSyncExternalStore(noSubscribe, currentRef, () => null);

  useEffect(() => {
    const fromUrl = refFromUrl();
    if (!fromUrl || fromUrl === SHARING) return;
    try {
      sessionStorage.setItem(REF_KEY, JSON.stringify({ ref: fromUrl, at: Date.now() }));
    } catch {
      // Storage blocked: the ref still works on this page.
    }
  }, []);

  const hasRef = new URLSearchParams(href.split('?')[1] ?? '').has('ref');
  const to = ref && !hasRef ? `${href}${href.includes('?') ? '&' : '?'}ref=${ref}` : href;
  return (
    <Link className={className} href={to}>
      {children}
    </Link>
  );
}
