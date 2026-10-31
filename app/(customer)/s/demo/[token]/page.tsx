import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { siteAssistantEnabled } from '@/lib/site-assistant/config';
import { SiteDemoView } from '../../../_views/SiteDemoView';

// Private demo: the (customer) layout already sets noindex, nofollow and no-referrer.
export const metadata: Metadata = { title: 'Private demo' };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  // Same gate as the /api/v1/s routes: the page 404s while the demo is off.
  if (!siteAssistantEnabled()) notFound();
  const { token } = await params;
  const accept = (await headers()).get('accept-language')?.trim().toLowerCase() ?? '';
  return <SiteDemoView token={token} initialLang={accept.startsWith('fr') ? 'fr' : 'en'} />;
}
