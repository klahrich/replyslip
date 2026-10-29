import type { Metadata } from 'next';
import { Mark, SimpleFooter } from '@/components/site/Mark';
import '@/components/site/site-width.css';
import '@/components/site/signin.css';
import '../i/invite.css';
import { ClaimWorkspace } from './ClaimWorkspace';

// The claim token lives in the URL fragment, which browsers never send.
export const metadata: Metadata = {
  title: 'Claim your workspace',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ClaimPage() {
  return (
    <div className="si site-w">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="top">
        <Mark />
      </header>
      <main id="main">
        <ClaimWorkspace />
      </main>
      <SimpleFooter />
    </div>
  );
}
