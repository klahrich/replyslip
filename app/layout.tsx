import type { Metadata, Viewport } from 'next';
import { Archivo } from 'next/font/google';
import './globals.css';
import { SITE_URL } from '@/components/site/seo';
import { VALETTO_DESCRIPTION as description, VALETTO_TITLE as title } from '@/components/site/valetto/seo';

const favicon =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='4' fill='%23a9bfa9'/%3E%3Crect x='7' y='6' width='18' height='20' rx='1' fill='%231f2225'/%3E%3Ccircle cx='12' cy='14' r='1.8' fill='%23e9eae7'/%3E%3Ccircle cx='20' cy='14' r='1.8' fill='%23e9eae7'/%3E%3Cpath d='M12 20.5l2.5 2L20 18.5' stroke='%23e9eae7' stroke-width='2' fill='none'/%3E%3C/svg%3E";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // Valetto is the product name. ReplySlip marketing pages keep their own share text through pageMeta(), and
  // metadataBase stays on replyslip.com because their relative canonicals resolve against it.
  title: { default: title, template: '%s · Valetto' },
  description,
  // Public pages are indexable. Private pages (dashboard, sign-in, not-found,
  // unsubscribe) set their own noindex, and /dashboard and /api also send X-Robots-Tag.
  robots: { index: true, follow: true },
  icons: { icon: favicon, apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }] },
  // No image: the only og image is ReplySlip's (Valetto pages leave it out too).
  openGraph: { type: 'website', siteName: 'Valetto', title, description },
  twitter: { card: 'summary', title, description },
};

const archivo = Archivo({ subsets: ['latin'], display: 'swap', variable: '--font-archivo' });

/** Site palette: 'a' | 'b' | 'c', defined in app/globals.css. Keep themeColor and the favicon in step. */
const PALETTE = 'b';

export const viewport: Viewport = { themeColor: '#1f2225' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={archivo.variable} data-palette={PALETTE} suppressHydrationWarning>
      <head>
        {/* Marks that scripts run; CSS only uses it for progressive enhancements, never to hide content. */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
