import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentUser } from '@/components/dashboard/session';
import { ConsentForm } from '@/components/site/oauth/ConsentForm';
import { ConsentFrame, ConsentProblemView } from '@/components/site/oauth/ConsentFrame';
import { loadConsent } from '@/components/site/oauth/consent-server';
import { CONSENT_REQUEST_TOKEN, consentPath } from '@/components/site/oauth/next-path';
import '@/components/site/valetto/valetto.css';

// Never indexed, and the request token in the URL must not leak through Referer (docs/design/mcp-oauth.md §5.4).
export const metadata: Metadata = {
  title: { absolute: 'Connect an app · Valetto' },
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/** /oauth/consent?req=<token>: where ChatGPT or Claude sends someone to allow access to their workspace. */
export default async function ConsentPage({ searchParams }: { searchParams: Promise<{ req?: string | string[] }> }) {
  const sp = await searchParams;
  const req = typeof sp.req === 'string' ? sp.req : '';
  // A malformed link can't be a real request; say so without a sign-in round trip.
  if (!CONSENT_REQUEST_TOKEN.test(req)) {
    return (
      <ConsentFrame>
        <ConsentProblemView problem="request_not_found" />
      </ConsentFrame>
    );
  }

  const user = await currentUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(consentPath(req)));

  const load = await loadConsent(req, user);
  return (
    <ConsentFrame email={load.kind === 'view' ? load.view.user.email : user.email}>
      {load.kind === 'view' ? <ConsentForm view={load.view} /> : <ConsentProblemView problem={load.problem} />}
    </ConsentFrame>
  );
}
