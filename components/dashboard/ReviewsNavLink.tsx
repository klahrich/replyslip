'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from './api';
import { REVIEWS_CHANGED_EVENT } from './review-text';
import type { ReviewsResponse } from './types';

/** "Reviews" in the dashboard nav, with how many items wait for the owner. Recounts on navigation and after an action. */
export function ReviewsNavLink() {
  const pathname = usePathname();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api<ReviewsResponse>('/api/v1/reviews?limit=1').then(
        (r) => {
          if (!cancelled) setCount(r.count);
        },
        () => {
          // The badge is a hint; the Reviews page shows any error.
          if (!cancelled) setCount(null);
        },
      );
    void load();
    window.addEventListener(REVIEWS_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(REVIEWS_CHANGED_EVENT, load);
    };
  }, [pathname]);

  const current = pathname === '/dashboard/reviews' || pathname.startsWith('/dashboard/reviews/');
  return (
    <Link href="/dashboard/reviews" aria-current={current ? 'page' : undefined} className="dash-nav-reviews">
      Reviews
      {count ? (
        <span className="dash-badge">
          {count}
          <span className="vh"> waiting</span>
        </span>
      ) : null}
    </Link>
  );
}
