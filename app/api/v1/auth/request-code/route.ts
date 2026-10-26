import { z } from 'zod';
import { normalizeWantsSharing, REQUEST_CODE_MESSAGE, requestLoginCode } from '@/lib/auth';
import { handle, json, parseBody, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  email: z.string(),
  source: z.union([z.string(), z.null()]).optional(),
  // Only boolean true counts. Any other value is ignored rather than rejected.
  wants_sharing: z.unknown().optional(),
});

const RATE_LIMIT_MESSAGE = 'Too many sign-in codes were requested. Try again later.';

export function POST(req: Request) {
  return handle(async () => {
    const body = parseBody(bodySchema, await readJson(req));
    const result = await requestLoginCode(body.email, req, body.source, {
      wantsSharing: normalizeWantsSharing(body.wants_sharing),
    });
    if (result.limited) {
      return json(
        {
          error: {
            code: 'rate_limited',
            message: RATE_LIMIT_MESSAGE,
            retry_after_seconds: result.retryAfterSeconds,
          },
        },
        429,
        { 'retry-after': String(result.retryAfterSeconds) },
      );
    }
    return json({ ok: true, message: REQUEST_CODE_MESSAGE });
  });
}
