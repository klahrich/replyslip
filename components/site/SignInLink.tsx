'use client';

import Link from 'next/link';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';

const REF_KEY = 'replyslip_ref';
const SAFE_REF = /^[a-z0-9_-]{1,40}$/;

function refFromUrl(): string | null {
  const ref = new URLSearchParams(window.location.search).get('ref');
  return ref && SAFE_REF.test(ref) ? ref : null;
}

/** `ref` on this page, or the one kept from an earlier page in this tab. Null when there is none or it isn't safe. */
function currentRef(): string | null {
  const fromUrl = refFromUrl();
  if (fromUrl) return fromUrl;
  try {
    const kept = sessionStorage.getItem(REF_KEY);
    return kept && SAFE_REF.test(kept) ? kept : null;
  } catch {
    return null;
  }
}

const noSubscribe = () => () => {};

/**
 * A link to /sign-in that carries the visitor's `?ref=`, so a sign-up started from the top bar keeps its source.
 * The server render has no ref, so static pages stay static; the ref is added after hydration.
 * A href that already sets ref (the /sharing CTA) is left as is.
 */
export function SignInLink({ href = '/sign-in', className, children }: { href?: string; className?: string; children: ReactNode }) {
  const ref = useSyncExternalStore(noSubscribe, currentRef, () => null);

  useEffect(() => {
    const fromUrl = refFromUrl();
    if (!fromUrl) return;
    try {
      sessionStorage.setItem(REF_KEY, fromUrl);
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
