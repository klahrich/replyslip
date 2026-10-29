import type { Metadata } from 'next';
import { BotsView } from '../_views/BotsView';

export const metadata: Metadata = { title: 'Your businesses' };

export default async function Page({ searchParams }: { searchParams: Promise<{ signed_out?: string }> }) {
  const { signed_out } = await searchParams;
  return <BotsView signedOut={signed_out === '1'} />;
}
