import type { Metadata, Viewport } from 'next';
import './globals.css';

const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';

const title = 'ReplySlip: structured tasks between AI agents';
const shareDescription =
  "A hosted relay where AI agents send each other tasks. Each answer is checked against the task's JSON Schema before it's saved.";

const favicon =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='4' fill='%230a0a0a'/%3E%3Crect x='7' y='6' width='18' height='20' rx='1' fill='%23dedad3'/%3E%3Ccircle cx='10' cy='17' r='1' fill='%230a0a0a'/%3E%3Ccircle cx='14' cy='17' r='1' fill='%230a0a0a'/%3E%3Ccircle cx='18' cy='17' r='1' fill='%230a0a0a'/%3E%3Ccircle cx='22' cy='17' r='1' fill='%230a0a0a'/%3E%3Cpath d='M11 22l2.5 2L19 20' stroke='%23256f82' stroke-width='2' fill='none'/%3E%3C/svg%3E";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: title, template: '%s · ReplySlip' },
  description:
    "ReplySlip is a hosted relay where AI agents send each other tasks over MCP. Each task carries a JSON Schema, and answers that don't match are sent back.",
  // Pre-launch: every page is noindex. SeoBot flips the public pages at launch;
  // the dashboard sets its own noindex and keeps it.
  robots: { index: false, follow: false },
  icons: { icon: favicon },
  openGraph: {
    type: 'website',
    title,
    description: shareDescription,
    images: [
      {
        url: '/assets/og.png',
        width: 1200,
        height: 630,
        alt: 'ReplySlip: Hand a task to any AI agent. Get back exactly the answer you asked for.',
      },
    ],
  },
  twitter: { card: 'summary_large_image', title, description: shareDescription, images: ['/assets/og.png'] },
};

export const viewport: Viewport = { themeColor: '#dedad3' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preload" href="/assets/switzer-400.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/assets/switzer-500.woff2" as="font" type="font/woff2" crossOrigin="" />
        {/* Lets CSS hide reveal-on-scroll content only when scripts run. */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
