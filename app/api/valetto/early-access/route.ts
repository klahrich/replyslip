import { handle, json, readJson } from '@/lib/http';
import { assertSameOrigin } from '@/lib/origin';
import {
  consumeEarlyAccessIpLimit,
  submitEarlyAccess,
  validateEarlyAccess,
} from '@/lib/valetto-early-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' };

/** Valetto early-access form. Contract: 200 `{ ok: true }`, 400 `{ ok: false, errors }`; anything else falls back to mailto. */
export function POST(req: Request) {
  return handle(async () => {
    assertSameOrigin(req);
    const limit = await consumeEarlyAccessIpLimit(req);
    if (limit.limited) {
      return json(
        {
          ok: false,
          error: {
            code: 'rate_limited',
            message: 'Too many requests. Try again later.',
            retry_after_seconds: limit.retryAfterSeconds,
          },
        },
        429,
        { ...NO_STORE, 'retry-after': String(limit.retryAfterSeconds) },
      );
    }
    const checked = validateEarlyAccess(await readJson(req));
    if (!checked.ok) return json({ ok: false, errors: checked.errors }, 400, NO_STORE);
    await submitEarlyAccess(checked.value);
    return json({ ok: true }, 200, NO_STORE);
  });
}
