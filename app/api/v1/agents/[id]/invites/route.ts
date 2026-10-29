import { z } from 'zod';
import { requireHumanOwner, requireUser } from '@/lib/auth';
import { INVITE_LABEL_MAX, INVITE_MAX_TTL_DAYS, INVITE_MAX_USES, INVITE_MIN_TTL_DAYS, MAX_SHARE_DAILY_CAP } from '@/lib/constants';
import { handle, json, parseBody, readJson, requireUuid } from '@/lib/http';
import { createInvite, invitePrompt, inviteUrl, listInvites } from '@/lib/invites';
import { requestOrigin } from '@/lib/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  offers: z.array(z.string()).min(1).max(50),
  daily_cap: z.number().int().min(1).max(MAX_SHARE_DAILY_CAP).optional(),
  max_uses: z.number().int().min(1).max(INVITE_MAX_USES).optional(),
  expires_in_days: z.number().int().min(INVITE_MIN_TTL_DAYS).max(INVITE_MAX_TTL_DAYS).optional(),
  label: z.string().max(INVITE_LABEL_MAX).optional(),
  approve_on_redeem: z.boolean().optional(),
});

export function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser(req);
    const { id } = await context.params;
    const invites = await listInvites(user.workspace.id, requireUuid(id, 'agent'));
    return json({ invites });
  });
}

export function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireHumanOwner(req);
    const { id } = await context.params;
    const body = parseBody(bodySchema, await readJson(req));
    const { invite, token } = await createInvite(
      user.workspace.id,
      requireUuid(id, 'agent'),
      { userId: user.id },
      {
        offerNames: body.offers,
        dailyCap: body.daily_cap,
        maxUses: body.max_uses,
        expiresInDays: body.expires_in_days,
        label: body.label,
        approveOnRedeem: body.approve_on_redeem,
      },
    );
    const origin = requestOrigin(req);
    return json({ invite, token, url: inviteUrl(origin, token), agent_prompt: invitePrompt(origin, token) }, 201);
  });
}
