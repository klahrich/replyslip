import Link from 'next/link';
import './foot-simple.css';

export function MarkIcon({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="4" style={{ fill: 'var(--mark-bg)' }} />
      <rect x="7" y="6" width="18" height="20" rx="1" style={{ fill: 'var(--mark-slip)' }} />
      <circle cx="12" cy="14" r="1.8" style={{ fill: 'var(--mark-ink)' }} />
      <circle cx="20" cy="14" r="1.8" style={{ fill: 'var(--mark-ink)' }} />
      <path d="M12 20.5l2.5 2L20 18.5" style={{ stroke: 'var(--mark-ink)' }} strokeWidth="2" fill="none" />
    </svg>
  );
}

export function Mark({ href = '/', label = 'Valetto home' }: { href?: string; label?: string }) {
  return (
    <Link className="mark" href={href} aria-label={label}>
      <MarkIcon />
      Valetto
    </Link>
  );
}

export function SimpleFooter({ back = true }: { back?: boolean }) {
  return (
    <footer className="foot-simple">
      <p>
        Valetto is built by <a href="https://clairevue.ai">ClaireVue</a>, Montréal
      </p>
      <span className="foot-simple-links">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        {back ? <Link href="/">Back to Valetto</Link> : null}
      </span>
    </footer>
  );
}
