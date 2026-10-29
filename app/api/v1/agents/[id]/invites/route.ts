import { z } from 'zod';
import { requireHumanOwner, requireUser } from '@/lib/auth';
import {
  agentGuestsEnabled,
  CUSTOMER_LINK_MAX_USES,
  INVITE_LABEL_MAX,
  INVITE_MAX_TTL_DAYS,
  INVITE_MAX_USES,
  INVITE_MIN_TTL_DAYS,
  MAX_SHARE_DAILY_CAP,
} from '@/lib/constants';
import { createCustomerInvite, customerLinkUrl, getCustomerAccess, listCustomerInvites } from '@/lib/customer-invites';
import { handle, json, parseBody, readJson, requireUuid } from '@/lib/http';
import { assertAgentGuestsEnabled, createInvite, invitePrompt, inviteUrl, listInvites } from '@/lib/invites';
import { requestOrigin } from '@/lib/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const customerSchema = z.object({
  kind: z.enum(['personal', 'public']),
  label: z.string().max(INVITE_LABEL_MAX).nullable().optional(),
  email: z.string().max(320).nullable().optional(),
  /** Omitted or null: every offer on the bot, including offers added later. */
  offers: z.array(z.string()).min(1).max(50).nullable().optional(),
  daily_cap: z.number().int().min(1).max(MAX_SHARE_DAILY_CAP).optional(),
  max_uses: z.number().int().min(1).max(CUSTOMER_LINK_MAX_USES).nullable().optional(),
  expires_at: z.string().max(64).nullable().optional(),
});

/** Anonymous agent-guest invite (VALETTO_AGENT_GUESTS=1 only). */
const agentSchema = z.object({
  kind: z.literal('agent'),
  offers: z.array(z.string()).min(1).max(50),
  daily_cap: z.number().int().min(1).max(MAX_SHARE_DAILY_CAP).optional(),
  max_uses: z.number().int().min(1).max(INVITE_MAX_USES).optional(),
  expires_in_days: z.number().int().min(INVITE_MIN_TTL_DAYS).max(INVITE_MAX_TTL_DAYS).optional(),
  label: z.string().max(INVITE_LABEL_MAX).optional(),
  approve_on_redeem: z.boolean().optional(),
});

const bodySchema = z.discriminatedUnion('kind', [customerSchema, agentSchema]);

export function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser(req);
    const { id } = await context.params;
    const agentId = requireUuid(id, 'agent');
    const enabled = agentGuestsEnabled();
    return json({
      invites: await listCustomerInvites(user.workspace.id, agentId),
      customer_access: await getCustomerAccess(user.workspace.id, agentId),
      agent_guests_enabled: enabled,
      agent_invites: enabled ? await listInvites(user.workspace.id, agentId) : [],
    });
  });
}

export function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireHumanOwner(req);
    const { id } = await context.params;
    const agentId = requireUuid(id, 'agent');
    const body = parseBody(bodySchema, await readJson(req));
    const origin = requestOrigin(req);
    if (body.kind === 'agent') {
      assertAgentGuestsEnabled();
      const { invite, token } = await createInvite(
        user.workspace.id,
        agentId,
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
      return json({ invite, token, url: inviteUrl(origin, token), agent_prompt: invitePrompt(origin, token) }, 201);
    }
    const { invite, token } = await createCustomerInvite(user.workspace.id, agentId, user.id, {
      kind: body.kind,
      label: body.label,
      email: body.email,
      offers: body.offers,
      dailyCap: body.daily_cap,
      maxUses: body.max_uses,
      expiresAt: body.expires_at,
    });
    return json({ invite, token, url: customerLinkUrl(origin, token) }, 201);
  });
}
