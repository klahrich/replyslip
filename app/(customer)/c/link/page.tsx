import type { Metadata } from 'next';
import { LinkFromHash } from '../../_views/LinkView';

export const metadata: Metadata = { title: 'Sign in' };

/**
 * Customer link landing. Links are /i#<token> (spec 17.14); /i hands rsl_ tokens here with the fragment intact,
 * so the token never reaches a server log or a Referer.
 */
export default function Page() {
  return <LinkFromHash />;
}
