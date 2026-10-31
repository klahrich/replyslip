import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ReviewDetail } from '@/components/dashboard/ReviewDetail';
import { currentUser } from '@/components/dashboard/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Review' };

export default async function ReviewPage({ params }: { params: Promise<{ taskId: string }> }) {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const { taskId } = await params;
  // key: a fresh state per item when moving between review pages.
  return <ReviewDetail key={taskId} taskId={taskId} />;
}
