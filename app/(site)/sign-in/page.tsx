import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentUser } from '@/components/dashboard/session';
import { Mark, SimpleFooter } from '@/components/site/Mark';
import { SignInForm } from '@/components/site/SignInForm';
import '@/components/site/signin.css';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string | string[]; sent?: string | string[] }>;
}) {
  let signedIn = false;
  try {
    signedIn = (await currentUser()) !== null;
  } catch {
    // No database reachable: still show the form; the API will report the error.
  }
  if (signedIn) redirect('/dashboard');

  const sp = await searchParams;
  const email = typeof sp.email === 'string' ? sp.email.slice(0, 320) : '';
  const sent = sp.sent === '1' && email !== '';

  return (
    <div className="si">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="top">
        <Mark />
      </header>
      <main id="main">
        <SignInForm initialEmail={email} initialStep={sent ? 'code' : 'email'} />
      </main>
      <SimpleFooter />
    </div>
  );
}
