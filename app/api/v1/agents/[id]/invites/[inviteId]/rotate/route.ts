import { requireHumanOwner } from '@/lib/auth';
import { customerLinkUrl, rotateCustomerInvite } from '@/lib/customer-invites';
import { handle, json, requireUuid } from '@/lib/http';
import { publicOrigin } from '@/lib/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reset a public link: the old link stops working at once, existing customers keep access. */
export function POST(req: Request, context: { params: Promise<{ id: string; inviteId: string }> }) {
  return handle(async () => {
    const user = await requireHumanOwner(req);
    const { id, inviteId } = await context.params;
    const { invite, token } = await rotateCustomerInvite(
      user.workspace.id,
      requireUuid(id, 'agent'),
      requireUuid(inviteId, 'invite'),
    );
    return json({ invite, token, url: customerLinkUrl(publicOrigin(req), token) });
  });
}
