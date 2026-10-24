import Link from 'next/link';

export function MarkIcon({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="4" style={{ fill: 'var(--accent)' }} />
      <rect x="7" y="6" width="18" height="20" rx="1" style={{ fill: 'var(--accent-ink)' }} />
      <circle cx="10" cy="17" r="1" style={{ fill: 'var(--accent)' }} />
      <circle cx="14" cy="17" r="1" style={{ fill: 'var(--accent)' }} />
      <circle cx="18" cy="17" r="1" style={{ fill: 'var(--accent)' }} />
      <circle cx="22" cy="17" r="1" style={{ fill: 'var(--accent)' }} />
      <path d="M11 22l2.5 2L19 20" style={{ stroke: 'var(--accent)' }} strokeWidth="2" fill="none" />
    </svg>
  );
}

export function Mark({ href = '/', label = 'ReplySlip home' }: { href?: string; label?: string }) {
  return (
    <Link className="mark" href={href} aria-label={label}>
      <MarkIcon />
      ReplySlip
    </Link>
  );
}

export function SimpleFooter({ back = true }: { back?: boolean }) {
  return (
    <footer className="foot-simple">
      <p>
        ReplySlip is built by <a href="https://clairevue.ai">ClaireVue</a>, Montréal
      </p>
      {back ? <Link href="/">Back to ReplySlip</Link> : null}
    </footer>
  );
}
