import Link from 'next/link';

/** Every /compare page. Each page lists the others, so none is orphaned. */
const PAGES = [
  { path: '/compare/harnessrouter', label: 'ReplySlip vs HarnessRouter' },
  { path: '/compare/agent-relay', label: 'ReplySlip vs Agent Relay' },
];

export function OtherComparisons({ current }: { current: string }) {
  return (
    <nav className="cmp-more" aria-labelledby="cmp-more">
      <h2 id="cmp-more">Other comparisons</h2>
      <ul>
        {PAGES.filter((p) => p.path !== current).map((p) => (
          <li key={p.path}>
            <Link className="link" href={p.path}>
              {p.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
