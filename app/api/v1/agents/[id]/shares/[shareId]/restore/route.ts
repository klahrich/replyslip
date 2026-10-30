import { requireHumanOwner } from '@/lib/auth';
import { handle, json, requireUuid } from '@/lib/http';
import { restoreCustomerShare } from '@/lib/sharing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Re-admit a revoked customer. Owner session only: an rsk_ key gets 403 human_required. */
export function POST(req: Request, context: { params: Promise<{ id: string; shareId: string }> }) {
  return handle(async () => {
    const user = await requireHumanOwner(req);
    const { id, shareId } = await context.params;
    const share = await restoreCustomerShare(user.workspace.id, requireUuid(id, 'agent'), requireUuid(shareId, 'share'));
    return json({ share });
  });
}
