import { handle, json, requireUuid } from '@/lib/http';
import { publicOrigin } from '@/lib/origin';
import { requireWakeUrlOwner, rotateWakeUrl, serializeWakeUrl } from '@/lib/wake-urls';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Revoke an active wake URL and issue its replacement. The old URL 404s at once; the new one is shown only here. */
export function POST(req: Request, context: { params: Promise<{ id: string; wakeUrlId: string }> }) {
  return handle(async () => {
    const { id, wakeUrlId } = await context.params;
    const subject = await requireWakeUrlOwner(req, requireUuid(id, 'agent'), { issue: true });
    const { row, url, revoked } = await rotateWakeUrl(subject, requireUuid(wakeUrlId, 'wake URL'), publicOrigin(req));
    return json(
      { wake_url: { ...serializeWakeUrl(row), url }, revoked: serializeWakeUrl(revoked) },
      200,
      { 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer' },
    );
  });
}
