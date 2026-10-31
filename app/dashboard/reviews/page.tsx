import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Reviews } from '@/components/dashboard/Reviews';
import { currentUser } from '@/components/dashboard/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Reviews' };

export default async function ReviewsPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  return <Reviews />;
}
