import { previewClaim } from '@/lib/auth';
import { agentGuestsEnabled } from '@/lib/constants';
import { HttpError } from '@/lib/errors';
import { bearerToken, handle, json } from '@/lib/http';
import { consumeRateLimit } from '@/lib/rate-limit';
import { clientIp } from '@/lib/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  return handle(async () => {
    if (!agentGuestsEnabled()) throw new HttpError(404, 'claim_not_found', 'This claim link is not valid.');
    // Own bucket: claim lookups no longer share a budget with invite previews.
    const limit = await consumeRateLimit({ kind: 'claimPreview', ip: clientIp(req) });
    if (limit.limited) throw new HttpError(429, 'rate_limited', 'Too many requests. Try again later.');
    const token = bearerToken(req);
    if (!token?.startsWith('rsc_')) throw new HttpError(404, 'claim_not_found', 'This claim link is not valid.');
    return json(await previewClaim(token), 200, { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
  });
}
