import type { Metadata } from 'next';
import Link from 'next/link';
import { Mark, SimpleFooter } from '@/components/site/Mark';
import '@/components/site/site-width.css';
import '@/components/site/not-found.css';

export const metadata: Metadata = {
  title: { absolute: 'Page not found · Valetto' },
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="nf site-w">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="top">
        <Mark />
        <Link className="top-link" href="/sign-in">
          Sign in
        </Link>
      </header>
      <main id="main">
        <h1>Nothing at this address</h1>
        <p>
          There is no page here. <Link href="/">Go to the Valetto home page</Link>.
        </p>
      </main>
      <SimpleFooter />
    </div>
  );
}
