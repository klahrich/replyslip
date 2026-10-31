import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './customer.css';
import { SessionGate } from './_views/SessionGate';

/*
 * Valetto customer pages (spec 15). Tailwind + shadcn/ui live only under this route group:
 * customer.css is imported here and nowhere else, has no preflight, and every reset rule is
 * scoped to `.vt-root`, so the ReplySlip site and dashboard never load it.
 */
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-vt' });

export const metadata: Metadata = {
  title: { default: 'Valetto', template: '%s · Valetto' },
  description: 'Send a request to a business and see the answer here.',
  // Spec 14: every customer page is private. Also sent as X-Robots-Tag from next.config.ts.
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: 'no-referrer', // belt and braces: link tokens live in the /i# fragment, which is never sent
  openGraph: { title: 'Valetto', description: 'Send a request to a business and see the answer here.', siteName: 'Valetto', images: [] },
  twitter: { card: 'summary', title: 'Valetto', images: [] },
};

export const viewport: Viewport = { themeColor: '#f6f6f4', colorScheme: 'light' };

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  return <div className={`vt-root ${inter.variable}`}><SessionGate>{children}</SessionGate></div>;
}
