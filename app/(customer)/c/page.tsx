import type { Metadata } from 'next';
import { BotsView } from '../_views/BotsView';

export const metadata: Metadata = { title: 'Your businesses' };

export default async function Page({ searchParams }: { searchParams: Promise<{ signed_out?: string; from?: string }> }) {
  const { signed_out, from } = await searchParams;
  return <BotsView signedOut={signed_out === '1'} from={typeof from === 'string' ? from : null} />;
}
