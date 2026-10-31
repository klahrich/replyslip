import type { Metadata } from 'next';
import { JobView } from '../../../../_views/JobView';

export const metadata: Metadata = { title: 'New request' };

export default async function Page({ params }: { params: Promise<{ agentId: string; offer: string }> }) {
  const { agentId, offer } = await params;
  return <JobView agentId={agentId} offer={offer} />;
}
