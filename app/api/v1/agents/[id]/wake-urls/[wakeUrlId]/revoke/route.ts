import { handle, json, requireUuid } from '@/lib/http';
import { requireWakeUrlOwner, revokeWakeUrl, serializeWakeUrl } from '@/lib/wake-urls';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Revoke a wake URL. It 404s at once. Idempotent. */
export function POST(req: Request, context: { params: Promise<{ id: string; wakeUrlId: string }> }) {
  return handle(async () => {
    const { id, wakeUrlId } = await context.params;
    const subject = await requireWakeUrlOwner(req, requireUuid(id, 'agent'), { issue: false });
    return json({ wake_url: serializeWakeUrl(await revokeWakeUrl(subject, requireUuid(wakeUrlId, 'wake URL'))) });
  });
}
