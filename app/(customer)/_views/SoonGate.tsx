import { PlainFrame } from '../_components/Frame';
import { Notice } from '../_components/Notice';
import { JOBS_LIVE } from '../_lib/api';

/**
 * Until the jobs, requests and answers routes (R3–R8) are live, everything past the link page shows this
 * instead of sample data. Remove once LIVE in api.ts is all true.
 */
export function SoonGate({ children }: { children: React.ReactNode }) {
  if (JOBS_LIVE) return children;
  return (
    <PlainFrame>
      <Notice title="Not open yet">
        <p>This business’s page isn’t open for requests yet. Open the link the business sent you again soon to get started.</p>
      </Notice>
    </PlainFrame>
  );
}
