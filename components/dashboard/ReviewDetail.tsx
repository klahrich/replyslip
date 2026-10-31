'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, errorText, formatTime, SIGNED_OUT_EVENT } from './api';
import { jobTitle, REVIEWS_CHANGED_EVENT, senderText, settledText } from './review-text';
import type { Review, ReviewAction } from './types';

/** Mirrors OWNER_NOTE_MAX in lib/constants. The API checks it too. */
const NOTE_MAX = 2000;

const PATH: Record<ReviewAction, string> = {
  approve: 'approve',
  decline: 'decline',
  release: 'release',
  send_back: 'send-back',
};

function doneText(action: ReviewAction, before: Review): string {
  switch (action) {
    case 'approve':
      return 'Approved. Your bot is working on this request now.';
    case 'decline':
      return 'Declined. Your customer sees that this request was declined.';
    case 'send_back':
      return 'Sent back. Your bot will try again with your note.';
    case 'release':
      return before.held_action === 'question'
        ? 'Released. Your customer can see the question and answer it.'
        : before.held_action === 'failure'
          ? 'Released. Your customer sees that this couldn’t be done.'
          : 'Released. Your customer can see the answer now.';
  }
}

function Rows({ rows, label }: { rows: { key: string; label: string; value: string; kind?: string }[]; label: string }) {
  return (
    <dl className="dash-rows" aria-label={label}>
      {rows.map((row) => (
        <div key={row.key}>
          <dt>{row.label}</dt>
          <dd>
            {row.kind === 'json' ? (
              <pre className="dash-json" translate="no">
                <code translate="no">{row.value}</code>
              </pre>
            ) : (
              <span className="dash-pre-text">{row.value}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function stageTitle(r: Review): string {
  if (r.stage === 'request') return 'New request to approve';
  if (r.stage === 'answer') return 'Answer to release';
  return 'Already handled';
}

/** /dashboard/reviews/:taskId: one request or answer, with Approve / Decline or Release / Send back. */
export function ReviewDetail({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [review, setReview] = useState<Review | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<ReviewAction | null>(null);
  const [outcome, setOutcome] = useState<{ kind: 'ok' | 'handled'; text: string } | null>(null);
  const [actionError, setActionError] = useState('');
  const [panel, setPanel] = useState<'decline' | 'send_back' | null>(null);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState('');

  useEffect(() => {
    const onSignedOut = () => router.replace('/sign-in');
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, [router]);

  const fetchOne = useCallback(() => api<{ review: Review }>(`/api/v1/reviews/${encodeURIComponent(taskId)}`), [taskId]);

  const applyLoad = useCallback((r: { review: Review } | unknown) => {
    if (r instanceof ApiError || r instanceof Error) {
      if (r instanceof ApiError && r.status === 404) setMissing(true);
      else setLoadError(errorText(r));
      return;
    }
    setReview((r as { review: Review }).review);
    setMissing(false);
    setLoadError('');
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchOne().then(
      (r) => {
        if (!cancelled) applyLoad(r);
      },
      (err: unknown) => {
        if (!cancelled) applyLoad(err);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fetchOne, applyLoad]);

  async function reload() {
    try {
      applyLoad(await fetchOne());
    } catch (err) {
      applyLoad(err);
    }
  }

  async function act(action: ReviewAction) {
    if (!review) return;
    const text = note.trim();
    if (action === 'send_back' && !text) {
      setNoteError('Tell your bot what to change.');
      return;
    }
    if (text.length > NOTE_MAX) {
      setNoteError(`Keep the note under ${NOTE_MAX.toLocaleString()} characters.`);
      return;
    }
    const withNote = (action === 'decline' || action === 'send_back') && text;
    setBusy(action);
    setActionError('');
    setNoteError('');
    try {
      const r = await api<{ review: Review }>(`/api/v1/reviews/${encodeURIComponent(review.task_id)}/${PATH[action]}`, {
        method: 'POST',
        body: withNote ? { note: text } : {},
      });
      setOutcome({ kind: 'ok', text: doneText(action, review) });
      setReview(r.review);
      setPanel(null);
      setNote('');
      window.dispatchEvent(new Event(REVIEWS_CHANGED_EVENT));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Reload first, so the message appears with the item's current state.
        await reload();
        setOutcome({ kind: 'handled', text: 'This was already handled.' });
        setPanel(null);
        setNote('');
        window.dispatchEvent(new Event(REVIEWS_CHANGED_EVENT));
      } else if (err instanceof ApiError && err.status === 404) {
        setMissing(true);
      } else if (err instanceof ApiError && err.code === 'validation_error') {
        const fields = (err.details as { fields?: { note?: string } } | undefined)?.fields;
        setNoteError(fields?.note ?? err.message);
      } else {
        setActionError(errorText(err));
      }
    } finally {
      setBusy(null);
    }
  }

  const back = (
    <p className="dash-muted">
      <Link className="link" href="/dashboard/reviews">
        ← All reviews
      </Link>
    </p>
  );

  if (missing) {
    return (
      <>
        <section className="dash-hero dash-hero-tight">{back}</section>
        <section className="dash-card" aria-labelledby="rv-missing-h">
          <h1 id="rv-missing-h" className="dash-review-h1">
            We couldn’t find this review
          </h1>
          <p className="dash-muted">The link may be wrong, or the request belongs to another account.</p>
          <p className="dash-review-back">
            <Link className="link" href="/dashboard/reviews">
              Go to your reviews
            </Link>
          </p>
        </section>
      </>
    );
  }

  if (!review) {
    return (
      <>
        <section className="dash-hero dash-hero-tight">{back}</section>
        {loadError ? (
          <p className="dash-err" role="alert">
            {loadError}{' '}
            <button type="button" className="dash-textbtn" onClick={() => void reload()}>
              Try again
            </button>
          </p>
        ) : (
          <p className="dash-muted">Loading…</p>
        )}
      </>
    );
  }

  const r = review;
  const can = (a: ReviewAction) => r.actions.includes(a);
  const disabled = busy !== null;
  const customer = r.sender.kind === 'customer' ? 'your customer' : 'the other team';

  return (
    <>
      <section className="dash-hero dash-hero-tight" aria-labelledby="rv-h">
        {back}
        <p className="dash-muted">{stageTitle(r)}</p>
        <h1 id="rv-h">{jobTitle(r)}</h1>
        <p className="dash-muted">
          From <span translate="no">{senderText(r)}</span> to <span translate="no">{r.agent.name}</span> · sent {formatTime(r.created_at)}
        </p>
      </section>

      {outcome ? (
        <div className="dash-status dash-review-outcome" role="status">
          <p className={outcome.kind === 'ok' ? 'dash-ok' : 'dash-pending'}>
            {outcome.text}{' '}
            <Link className="link" href="/dashboard/reviews">
              Back to reviews
            </Link>
          </p>
        </div>
      ) : null}

      <section className="dash-card" aria-labelledby="rv-sent-h">
        <h2 id="rv-sent-h">What {customer} sent</h2>
        {r.input_display.length ? <Rows rows={r.input_display} label="Form answers" /> : null}
        <h3 className="dash-review-sub">Notes</h3>
        <p className="dash-pre-text">{r.notes || 'None'}</p>
        {r.answers.length ? (
          <>
            <h3 className="dash-review-sub">Questions and answers</h3>
            <ol className="dash-thread">
              {r.answers.map((a) => (
                <li key={a.asked_at}>
                  <p className="dash-muted">Your bot asked · {formatTime(a.asked_at)}</p>
                  <p className="dash-pre-text">{a.question}</p>
                  <p className="dash-muted dash-review-reply">
                    {r.sender.kind === 'customer' ? 'Your customer' : 'They'} answered · {formatTime(a.answered_at)}
                  </p>
                  <p className="dash-pre-text">{a.answer}</p>
                </li>
              ))}
            </ol>
          </>
        ) : null}
      </section>

      {r.stage === 'answer' ? (
        <section className="dash-card" aria-labelledby="rv-answer-h">
          {r.held_action === 'question' ? (
            <>
              <h2 id="rv-answer-h">Your bot wants to ask {customer}</h2>
              <p className="dash-pre-text dash-review-held">{r.question}</p>
            </>
          ) : r.held_action === 'failure' ? (
            <>
              <h2 id="rv-answer-h">Your bot couldn’t do this</h2>
              <p className="dash-pre-text dash-review-held">{r.fail_message || 'Your bot gave no reason.'}</p>
            </>
          ) : (
            <>
              <h2 id="rv-answer-h">Your bot’s answer</h2>
              {r.result_display.length ? (
                <Rows rows={r.result_display} label="Answer" />
              ) : (
                <p className="dash-muted">The answer is empty.</p>
              )}
            </>
          )}
          <p className="dash-muted dash-review-help">
            {customer.charAt(0).toUpperCase() + customer.slice(1)} doesn’t see this until you release it.
          </p>
        </section>
      ) : null}

      {r.owner_note ? (
        <section className="dash-card" aria-labelledby="rv-note-h">
          <h2 id="rv-note-h">Your note to your bot</h2>
          <p className="dash-pre-text">{r.owner_note}</p>
          <p className="dash-muted dash-review-help">Only you and your bot see this.</p>
        </section>
      ) : null}

      <section className="dash-card" aria-labelledby="rv-act-h">
        <h2 id="rv-act-h">{r.actions.length ? 'Your decision' : 'Status'}</h2>
        {r.actions.length === 0 ? (
          <>
            <p>{settledText(r)}</p>
            {r.reviewed_at ? <p className="dash-muted">You reviewed this {formatTime(r.reviewed_at)}.</p> : null}
          </>
        ) : panel ? (
          <form
            className="dash-review-form"
            onSubmit={(e) => {
              e.preventDefault();
              void act(panel);
            }}
          >
            <div className="dash-field">
              <label htmlFor="rv-note">{panel === 'send_back' ? 'What should your bot change?' : 'Note for your bot (optional)'}</label>
              <textarea
                id="rv-note"
                rows={3}
                maxLength={NOTE_MAX}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                aria-invalid={noteError ? true : undefined}
                aria-describedby="rv-note-hint"
                aria-required={panel === 'send_back' ? true : undefined}
              />
              <p className="dash-hint" id="rv-note-hint">
                {panel === 'send_back'
                  ? `Your bot gets this note and tries again. ${customer.charAt(0).toUpperCase() + customer.slice(1)} doesn’t see it.`
                  : `${customer.charAt(0).toUpperCase() + customer.slice(1)} sees only that the request was declined, not your note.`}
              </p>
              {noteError ? <p className="dash-field-err">{noteError}</p> : null}
            </div>
            <div className="dash-review-buttons">
              <button type="submit" className={panel === 'decline' ? 'dash-btn dash-btn-danger' : 'dash-btn dash-btn-ink'} disabled={disabled}>
                {panel === 'decline' ? (busy ? 'Declining…' : 'Decline') : busy ? 'Sending back…' : 'Send back'}
              </button>
              <button
                type="button"
                className="dash-textbtn"
                disabled={disabled}
                onClick={() => {
                  setPanel(null);
                  setNoteError('');
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <p className="dash-muted">
              {r.stage === 'request'
                ? 'Approve to let your bot start on this request. Decline to close it.'
                : r.held_action === 'question'
                  ? `Release to send the question to ${customer}. Send back to ask your bot to change it.`
                  : `Release to show the answer to ${customer}. Send back to ask your bot to change it.`}
            </p>
            <div className="dash-review-buttons">
              {can('approve') ? (
                <button type="button" className="dash-btn dash-btn-ink" disabled={disabled} onClick={() => void act('approve')}>
                  {busy === 'approve' ? 'Approving…' : 'Approve'}
                </button>
              ) : null}
              {can('release') ? (
                <button type="button" className="dash-btn dash-btn-ink" disabled={disabled} onClick={() => void act('release')}>
                  {busy === 'release' ? 'Releasing…' : 'Release'}
                </button>
              ) : null}
              {can('send_back') ? (
                <button type="button" className="dash-btn dash-btn-line" disabled={disabled} onClick={() => setPanel('send_back')}>
                  Send back
                </button>
              ) : null}
              {can('decline') ? (
                r.stage === 'request' ? (
                  <button type="button" className="dash-btn dash-btn-line" disabled={disabled} onClick={() => setPanel('decline')}>
                    Decline
                  </button>
                ) : (
                  <button type="button" className="dash-textbtn dash-danger" disabled={disabled} onClick={() => setPanel('decline')}>
                    Decline the request
                  </button>
                )
              ) : null}
            </div>
          </>
        )}
        {actionError ? (
          <p className="dash-err" role="alert">
            {actionError}
          </p>
        ) : null}
      </section>
    </>
  );
}
