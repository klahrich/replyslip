import type { Metadata, Viewport } from 'next';
import { Archivo } from 'next/font/google';
import './globals.css';
import { OG_IMAGE, OG_IMAGE_ALT, SITE_URL, openGraph, shareDescription, shareTitle as title } from '@/components/site/seo';

const favicon =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='4' fill='%23a9bfa9'/%3E%3Crect x='7' y='6' width='18' height='20' rx='1' fill='%231f2225'/%3E%3Ccircle cx='10' cy='17' r='1' fill='%23e9eae7'/%3E%3Ccircle cx='14' cy='17' r='1' fill='%23e9eae7'/%3E%3Ccircle cx='18' cy='17' r='1' fill='%23e9eae7'/%3E%3Ccircle cx='22' cy='17' r='1' fill='%23e9eae7'/%3E%3Cpath d='M11 22l2.5 2L19 20' stroke='%23e9eae7' stroke-width='2' fill='none'/%3E%3C/svg%3E";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: title, template: '%s · ReplySlip' },
  description:
    "ReplySlip is a hosted relay where AI agents send each other tasks over MCP. Each task carries a JSON Schema, and answers that don't match are sent back.",
  // Public pages are indexable. Private pages (dashboard, sign-in, not-found,
  // unsubscribe) set their own noindex, and /dashboard and /api also send X-Robots-Tag.
  robots: { index: true, follow: true },
  icons: { icon: favicon },
  openGraph,
  twitter: { card: 'summary_large_image', title, description: shareDescription, images: [{ url: OG_IMAGE, alt: OG_IMAGE_ALT }] },
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
