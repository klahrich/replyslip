import type { Metadata } from 'next';
import { LinkView } from '../../_views/LinkView';

export const metadata: Metadata = { title: 'Sign in' };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <LinkView token={token} />;
}
