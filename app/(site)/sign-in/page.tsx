import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentUser } from '@/components/dashboard/session';
import { Mark, SimpleFooter } from '@/components/site/Mark';
import { SignInForm } from '@/components/site/SignInForm';
import { DEFAULT_NEXT_PATH, safeNextPath } from '@/components/site/oauth/next-path';
import { pageMeta } from '@/components/site/seo';
import '@/components/site/site-width.css';
import '@/components/site/signin.css';

export const metadata: Metadata = {
  title: { absolute: 'Sign in · Valetto' },
  robots: { index: false, follow: false },
  ...pageMeta('/sign-in'),
  // The consent request token can ride in ?next=; the header already says no-referrer, this keeps it in the page too.
  referrer: 'no-referrer',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string | string[]; next?: string | string[] }>;
}) {
  const sp = await searchParams;
  // ?next= only ever leads back to the consent page; anything else is dropped (docs/design/mcp-oauth.md §6.3).
  const next = safeNextPath(sp.next);

  let signedIn = false;
  try {
    signedIn = (await currentUser()) !== null;
  } catch {
    // No database reachable: still show the form; the API will report the error.
  }
  if (signedIn) redirect(next);

  const sent = sp.sent === '1';

  return (
    <div className="si site-w">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="top">
        <Mark />
      </header>
      <main id="main">
        <SignInForm sent={sent} next={next === DEFAULT_NEXT_PATH ? undefined : next} />
      </main>
      <SimpleFooter />
    </div>
  );
}
