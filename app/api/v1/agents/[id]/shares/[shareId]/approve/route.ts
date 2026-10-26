import { requireHumanOwner } from '@/lib/auth';
import { handle, json, requireUuid } from '@/lib/http';
import { approveShare } from '@/lib/sharing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(req: Request, context: { params: Promise<{ id: string; shareId: string }> }) {
  return handle(async () => {
    const user = await requireHumanOwner(req);
    const { id, shareId } = await context.params;
    const share = await approveShare(user.workspace.id, requireUuid(id, 'agent'), requireUuid(shareId, 'share'));
    return json({ share });
  });
}
