import type { Metadata } from 'next';
import { BotView } from '../../_views/BotView';

export const metadata: Metadata = { title: 'Jobs' };

export default async function Page({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  return <BotView agentId={agentId} />;
}
