import type { Metadata } from 'next';
import { Mark, SimpleFooter } from '@/components/site/Mark';
import '@/components/site/site-width.css';
import '@/components/site/signin.css';
import { InvitePreview } from './InvitePreview';
import './invite.css';

// The invite token lives in the URL fragment, which browsers never send. Keep it out of referrers and indexes too.
export const metadata: Metadata = {
  title: 'Invite link',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function InvitePage() {
  return (
    <div className="si site-w">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="top">
        <Mark />
      </header>
      <main id="main">
        <InvitePreview />
      </main>
      <SimpleFooter />
    </div>
  );
}
