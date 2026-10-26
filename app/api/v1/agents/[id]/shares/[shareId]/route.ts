import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { MAX_SHARE_DAILY_CAP } from '@/lib/constants';
import { handle, json, parseBody, readJson, requireUuid } from '@/lib/http';
import { updateShare } from '@/lib/sharing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  offers: z.array(z.string()).min(1).max(50).optional(),
  daily_cap: z.number().int().min(1).max(MAX_SHARE_DAILY_CAP).optional(),
});

export function PATCH(req: Request, context: { params: Promise<{ id: string; shareId: string }> }) {
  return handle(async () => {
    const user = await requireUser(req);
    const { id, shareId } = await context.params;
    const body = parseBody(bodySchema, await readJson(req));
    const share = await updateShare(user.workspace.id, requireUuid(id, 'agent'), requireUuid(shareId, 'share'), {
      offerNames: body.offers,
      dailyCap: body.daily_cap,
    });
    return json({ share });
  });
}
