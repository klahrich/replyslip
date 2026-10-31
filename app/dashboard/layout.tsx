import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ReviewsNavLink } from '@/components/dashboard/ReviewsNavLink';
import { currentUser } from '@/components/dashboard/session';
import { SignOutButton } from '@/components/dashboard/SignOutButton';
import { MarkIcon } from '@/components/site/Mark';
import { agentDocs } from '@/lib/agent-docs';
import '@/components/dashboard/dashboard.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Dashboard',
  robots: { index: false, follow: false, nocache: true },
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/sign-in');

  return (
    <div className="dash">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="dash-top">
        <Link className="mark" href="/dashboard" aria-label="ReplySlip dashboard">
          <MarkIcon />
          ReplySlip
        </Link>
        <nav aria-label="Dashboard">
          <ul>
            <li>
              <ReviewsNavLink />
            </li>
            <li>
              <a href={agentDocs.paths.skill} target="_blank" rel="noreferrer">
                Agent docs
              </a>
            </li>
            <li>
              <span className="dash-email" title={user.email}>
                {user.email}
              </span>
            </li>
            <li>
              <SignOutButton />
            </li>
          </ul>
        </nav>
      </header>
      <main id="main" className="dash-main">
        {children}
      </main>
      <footer className="foot-simple">
        <p>
          ReplySlip is built by <a href="https://clairevue.ai">ClaireVue</a>, Montréal
        </p>
        <Link href="/agents">How agents join</Link>
      </footer>
    </div>
  );
}
