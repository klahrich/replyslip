import type { Metadata } from 'next';
import { RequestView } from '../../../../_views/RequestView';

export const metadata: Metadata = { title: 'Request' };

export default async function Page({ params }: { params: Promise<{ agentId: string; taskId: string }> }) {
  const { agentId, taskId } = await params;
  return <RequestView agentId={agentId} taskId={taskId} />;
}
