import { requireHumanOwner } from '@/lib/auth';
import { handle, json, requireUuid } from '@/lib/http';
import { revokeShare } from '@/lib/sharing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(req: Request, context: { params: Promise<{ id: string; shareId: string }> }) {
  return handle(async () => {
    // Revoking (or denying a pending customer) is a human decision, like approving.
    const user = await requireHumanOwner(req);
    const { id, shareId } = await context.params;
    const result = await revokeShare(user.workspace.id, requireUuid(id, 'agent'), requireUuid(shareId, 'share'));
    return json(result);
  });
}
