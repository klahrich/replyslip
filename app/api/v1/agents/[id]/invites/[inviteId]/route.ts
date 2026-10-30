import { z } from 'zod';
import { requireHumanOwner } from '@/lib/auth';
import { CUSTOMER_LINK_MAX_USES, INVITE_LABEL_MAX, MAX_SHARE_DAILY_CAP } from '@/lib/constants';
import { updateCustomerInvite } from '@/lib/customer-invites';
import { handle, json, parseBody, readJson, requireUuid } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  label: z.string().max(INVITE_LABEL_MAX).nullable().optional(),
  offers: z.array(z.string()).min(1).max(50).nullable().optional(),
  daily_cap: z.number().int().min(1).max(MAX_SHARE_DAILY_CAP).optional(),
  max_uses: z.number().int().min(1).max(CUSTOMER_LINK_MAX_USES).nullable().optional(),
  expires_at: z.string().max(64).nullable().optional(),
});

/** Edit a customer invite. Applies to future acceptances; existing customers are edited through their share. */
export function PATCH(req: Request, context: { params: Promise<{ id: string; inviteId: string }> }) {
  return handle(async () => {
    const user = await requireHumanOwner(req);
    const { id, inviteId } = await context.params;
    const body = parseBody(bodySchema, await readJson(req));
    const invite = await updateCustomerInvite(user.workspace.id, requireUuid(id, 'agent'), requireUuid(inviteId, 'invite'), {
      label: body.label,
      offers: body.offers,
      dailyCap: body.daily_cap,
      maxUses: body.max_uses,
      expiresAt: body.expires_at,
    });
    return json({ invite });
  });
}
