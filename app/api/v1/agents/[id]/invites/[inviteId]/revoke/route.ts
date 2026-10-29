import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { handle, json, parseBody, readJson, requireUuid } from '@/lib/http';
import { revokeInvite } from '@/lib/invites';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ revoke_shares: z.boolean().optional() });

export function POST(req: Request, context: { params: Promise<{ id: string; inviteId: string }> }) {
  return handle(async () => {
    const user = await requireUser(req);
    const { id, inviteId } = await context.params;
    // The body is optional: an empty POST revokes the invite only.
    const body = parseBody(bodySchema, req.headers.get('content-type') ? await readJson(req) : {});
    const result = await revokeInvite(user.workspace.id, requireUuid(id, 'agent'), requireUuid(inviteId, 'invite'), {
      revokeShares: body.revoke_shares ?? false,
    });
    return json(result);
  });
}
