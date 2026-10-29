import { z } from 'zod';
import { requireHumanOwner } from '@/lib/auth';
import { isCustomerInvite, revokeCustomerInvite } from '@/lib/customer-invites';
import { handle, json, parseBody, readJson, requireUuid } from '@/lib/http';
import { revokeInvite } from '@/lib/invites';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** revoke_customers (customer invites) and revoke_shares (agent invites) mean the same thing. */
const bodySchema = z.object({ revoke_customers: z.boolean().optional(), revoke_shares: z.boolean().optional() });

export function POST(req: Request, context: { params: Promise<{ id: string; inviteId: string }> }) {
  return handle(async () => {
    const user = await requireHumanOwner(req);
    const { id, inviteId } = await context.params;
    const agentId = requireUuid(id, 'agent');
    const invite = requireUuid(inviteId, 'invite');
    // The body is optional: an empty POST revokes the invite only.
    const body = parseBody(bodySchema, req.headers.get('content-type') ? await readJson(req) : {});
    const alsoShares = body.revoke_customers ?? body.revoke_shares ?? false;
    if (await isCustomerInvite(user.workspace.id, agentId, invite)) {
      return json(await revokeCustomerInvite(user.workspace.id, agentId, invite, { revokeCustomers: alsoShares }));
    }
    // Revoking an agent invite stays possible with the flag off, so an owner can always shut one down.
    return json(await revokeInvite(user.workspace.id, agentId, invite, { revokeShares: alsoShares }));
  });
}
