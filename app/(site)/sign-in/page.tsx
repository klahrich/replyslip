import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentUser } from '@/components/dashboard/session';
import { Mark, SimpleFooter } from '@/components/site/Mark';
import { SignInForm } from '@/components/site/SignInForm';
import { pageMeta } from '@/components/site/seo';
import '@/components/site/site-width.css';
import '@/components/site/signin.css';

export const metadata: Metadata = {
  title: { absolute: 'Sign in · Valetto' },
  robots: { index: false, follow: false },
  ...pageMeta('/sign-in'),
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string | string[] }>;
}) {
  let signedIn = false;
  try {
    signedIn = (await currentUser()) !== null;
  } catch {
    // No database reachable: still show the form; the API will report the error.
  }
  if (signedIn) redirect('/dashboard');

  const sp = await searchParams;
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
        <SignInForm sent={sent} />
      </main>
      <SimpleFooter />
    </div>
  );
}
