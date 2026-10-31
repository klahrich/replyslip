import type { Metadata } from 'next';
import { HistoryView } from '../../../_views/HistoryView';

export const metadata: Metadata = { title: 'Your requests' };

export default async function Page({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  return <HistoryView agentId={agentId} />;
}
