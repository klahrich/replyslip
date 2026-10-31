import type { Metadata } from 'next';
import { BotsView } from '../_views/BotsView';
import { SoonGate } from '../_views/SoonGate';

export const metadata: Metadata = { title: 'Your businesses' };

export default async function Page({ searchParams }: { searchParams: Promise<{ signed_out?: string }> }) {
  const { signed_out } = await searchParams;
  return (
    <SoonGate>
      <BotsView signedOut={signed_out === '1'} />
    </SoonGate>
  );
}
