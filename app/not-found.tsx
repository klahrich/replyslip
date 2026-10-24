import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main style={{ margin: '22vh var(--mr) 0 var(--al)', maxWidth: 560 }}>
      <h1 style={{ fontSize: '2.25rem', marginBottom: 16 }}>Nothing at this address</h1>
      <p>
        The relay answered with a 404. <Link href="/">Go to the ReplySlip home page</Link>.
      </p>
    </main>
  );
}
