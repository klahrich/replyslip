import type { ReactNode } from 'react';
import Link from 'next/link';
import { MarkIcon } from '@/components/site/Mark';
import { problemCopy } from './consent-logic';
import type { ConsentProblem } from './consent-types';
import './consent.css';

/** The consent page shell: a light card on the Valetto background, with the mark and who is signed in. */
export function ConsentFrame({ email, children }: { email?: string; children: ReactNode }) {
  return (
    <div className="vt oc-page">
      <main id="main" className="oc-card">
        <header className="oc-head">
          <span className="mark oc-mark">
            <MarkIcon />
            Valetto
          </span>
          {email ? (
            <p className="oc-who">
              Signed in as <b>{email}</b>
            </p>
          ) : null}
        </header>
        <div className="oc-body">{children}</div>
      </main>
      <footer className="oc-foot">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
      </footer>
    </div>
  );
}

/** A request the page can't show: not found, expired, already answered, or no workspace yet. */
export function ConsentProblemView({ problem }: { problem: ConsentProblem }) {
  const copy = problemCopy(problem);
  return (
    <div className="oc-problem" role="status">
      <h1>{copy.title}</h1>
      <p className="oc-lead">{copy.body}</p>
      {copy.dashboard ? (
        <p className="oc-actions">
          <Link className="oc-btn oc-btn-go" href="/dashboard">
            Open your dashboard
          </Link>
        </p>
      ) : (
        <p className="oc-note">You can close this tab.</p>
      )}
    </div>
  );
}
