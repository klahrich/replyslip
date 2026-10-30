import type { ReactNode } from 'react';
import Link from 'next/link';
import { MarkIcon } from '@/components/site/Mark';

export const EARLY_ACCESS = '/valetto/early-access';

/** The Valetto subpages' top bar: the mark back to /valetto and one link on the right. */
export function ValettoTop({ children }: { children?: ReactNode }) {
  return (
    <header className="top">
      <Link className="mark" href="/valetto" aria-label="Valetto home">
        <MarkIcon />
        Valetto
      </Link>
      {children ? <nav aria-label="Main">{children}</nav> : null}
    </header>
  );
}

/** Footer shared by the Valetto preview pages; legal links point at the Valetto drafts. */
export function ValettoFoot() {
  return (
    <footer className="foot vt-foot">
      <p>
        Valetto is built by{' '}
        <a className="link" href="https://clairevue.ai">
          ClaireVue
        </a>
        , Montréal
      </p>
      <p className="foot-legal">
        <Link className="link" href="/valetto/privacy">
          Privacy
        </Link>
        <Link className="link" href="/valetto/terms">
          Terms
        </Link>
      </p>
      <p className="yr">© 2026 ClaireVue</p>
    </footer>
  );
}
