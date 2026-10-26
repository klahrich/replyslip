import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { MAX_SHARE_DAILY_CAP } from '@/lib/constants';
import { handle, json, parseBody, readJson, requireUuid } from '@/lib/http';
import { inviteGuest, listShares } from '@/lib/sharing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  guest_handle: z.string(),
  offers: z.array(z.string()).min(1).max(50),
  daily_cap: z.number().int().min(1).max(MAX_SHARE_DAILY_CAP).optional(),
});

export function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser(req);
    const { id } = await context.params;
    const shares = await listShares(user.workspace.id, requireUuid(id, 'agent'));
    return json({ shares });
  });
}

export function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser(req);
    const { id } = await context.params;
    const body = parseBody(bodySchema, await readJson(req));
    const share = await inviteGuest(user.workspace.id, requireUuid(id, 'agent'), {
      guestHandle: body.guest_handle,
      offerNames: body.offers,
      dailyCap: body.daily_cap,
    });
    return json({ share }, 201);
  });
}
