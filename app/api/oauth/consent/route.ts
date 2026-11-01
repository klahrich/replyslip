import { requireUser } from '@/lib/auth';
import { HttpError } from '@/lib/errors';
import { json, parseBody, readJson } from '@/lib/http';
import { assertSameOrigin } from '@/lib/origin';
import { consumeRateLimit } from '@/lib/rate-limit';
import { consentBodySchema, decideConsent } from '@/lib/oauth/consent';
import { handleOAuthSession } from '@/lib/oauth/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/oauth/consent (§5.4, §6.2): Allow or Deny. Answers 200 { redirect_to } for both. */
export function POST(req: Request) {
  return handleOAuthSession(async () => {
    assertSameOrigin(req);
    const raw = await readJson(req);
    const user = await requireUser(req);
    const limit = await consumeRateLimit({ kind: 'oauthConsent', agentId: user.id });
    if (limit.limited) {
      throw new HttpError(429, 'rate_limited', 'Too many tries. Wait a few minutes.', {
        retry_after_seconds: limit.retryAfterSeconds,
      });
    }
    const body = parseBody(consentBodySchema, raw);
    return json(await decideConsent(req, user, body));
  });
}
