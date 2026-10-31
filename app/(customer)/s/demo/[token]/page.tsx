import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { SiteDemoView } from '../../../_views/SiteDemoView';

// Private demo: the (customer) layout already sets noindex, nofollow and no-referrer.
export const metadata: Metadata = { title: 'Private demo' };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const accept = (await headers()).get('accept-language')?.trim().toLowerCase() ?? '';
  return <SiteDemoView token={token} initialLang={accept.startsWith('fr') ? 'fr' : 'en'} />;
}
