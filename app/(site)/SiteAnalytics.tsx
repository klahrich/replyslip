'use client';

import { Analytics, type BeforeSendEvent } from '@vercel/analytics/next';

/**
 * Vercel Web Analytics for the public pages only (cookie-free page views).
 * Mounted from app/(site)/layout.tsx, so the dashboard never loads it.
 * Sign-in is skipped, and query strings and hashes are stripped so no codes or emails are sent.
 */
function beforeSend(event: BeforeSendEvent): BeforeSendEvent | null {
  const url = new URL(event.url);
  if (url.pathname.startsWith('/sign-in')) return null;
  url.search = '';
  url.hash = '';
  return { ...event, url: url.toString() };
}

export function SiteAnalytics() {
  return <Analytics beforeSend={beforeSend} />;
}
