'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, errorText, SIGNED_OUT_EVENT } from './api';
import { LocalTime } from './LocalTime';
import { jobTitle, senderText } from './review-text';
import type { Review, ReviewsResponse } from './types';
import { previewText } from './review-text';

/** The API caps a page at 100. Owners with more see the oldest 100 first, which are the ones to act on. */
const LIMIT = 100;

function ReviewRow({ r }: { r: Review }) {
  const preview = previewText(r);
  return (
    <li>
      <Link className="dash-review" href={`/dashboard/reviews/${r.task_id}`}>
        <span className="dash-review-main">
          <span className="dash-review-title">{jobTitle(r)}</span>
          {preview ? <span className="dash-review-preview">{preview}</span> : null}
          <span className="dash-muted">
            <span translate="no">{senderText(r)}</span> · to <span translate="no">{r.agent.name}</span>
          </span>
        </span>
        <LocalTime className="dash-review-time" iso={r.updated_at} />
        <span className="dash-review-open" aria-hidden="true">
          Open →
        </span>
      </Link>
    </li>
  );
}

function Section({ id, title, help, items }: { id: string; title: string; help: string; items: Review[] }) {
  return (
    <section className="dash-card" aria-labelledby={id}>
      <h2 id={id} className="dash-review-h">
        {title} <span className="dash-count">{items.length}</span>
      </h2>
      <p className="dash-muted">{help}</p>
      {items.length ? (
        <ul className="dash-reviews">
          {items.map((r) => (
            <ReviewRow key={r.task_id} r={r} />
          ))}
        </ul>
      ) : (
        <p className="dash-muted dash-review-none">None right now.</p>
      )}
    </section>
  );
}

/** /dashboard/reviews: requests waiting for approval and answers waiting for release, oldest first. */
export function Reviews() {
  const router = useRouter();
  const [data, setData] = useState<ReviewsResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onSignedOut = () => router.replace('/sign-in');
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, [router]);

  const fetchList = useCallback(() => api<ReviewsResponse>(`/api/v1/reviews?limit=${LIMIT}`), []);

  useEffect(() => {
    let cancelled = false;
    fetchList().then(
      (r) => {
        if (!cancelled) {
          setData(r);
          setError('');
        }
      },
      (err: unknown) => {
        if (!cancelled) setError(errorText(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fetchList]);

  async function reload() {
    setLoading(true);
    try {
      setData(await fetchList());
      setError('');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }

  const requests = data?.reviews.filter((r) => r.status === 'in_review') ?? [];
  const answers = data?.reviews.filter((r) => r.status === 'awaiting_release') ?? [];

  return (
    <>
      <section className="dash-hero dash-hero-tight" aria-labelledby="reviews-h">
        <p className="dash-muted">
          <Link className="link" href="/dashboard">
            ← Dashboard
          </Link>
        </p>
        <div className="dash-review-head">
          <h1 id="reviews-h">Reviews</h1>
          <button type="button" className="dash-textbtn" onClick={() => void reload()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <p className="dash-muted">
          For bots set to Review first. You approve each new request before your bot starts, and each answer before your customer sees it.
        </p>
      </section>
      {error ? (
        <p className="dash-err" role="alert">
          {error}{' '}
          <button type="button" className="dash-textbtn" onClick={() => void reload()}>
            Try again
          </button>
        </p>
      ) : null}
      {data === null ? (
        error ? null : <p className="dash-muted">Loading…</p>
      ) : data.reviews.length === 0 ? (
        <section className="dash-card" aria-label="Reviews">
          <p className="dash-empty">Nothing waiting for review.</p>
        </section>
      ) : (
        <>
          <Section
            id="rv-requests-h"
            title="New requests to approve"
            help="Your bot doesn’t see these until you approve them."
            items={requests}
          />
          <Section
            id="rv-answers-h"
            title="Answers to release"
            help="Your bot has answered. Your customer doesn’t see the answer until you release it."
            items={answers}
          />
          {data.count > data.reviews.length ? (
            <p className="dash-muted">
              Showing the oldest {data.reviews.length} of {data.count}. Handle these to see the rest.
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
