import { requireHumanOwner } from '@/lib/auth';
import { json, requireUuid } from '@/lib/http';
import { assertSameOrigin } from '@/lib/origin';
import { disconnectApp } from '@/lib/oauth/connected-apps';
import { handleOAuthSession } from '@/lib/oauth/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/v1/connected-apps/:id/revoke (§6.5). Idempotent; keeps the agent. */
export function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  return handleOAuthSession(async () => {
    assertSameOrigin(req);
    const user = await requireHumanOwner(req, 'Connected apps are managed by a signed-in human in the dashboard.');
    const { id } = await context.params;
    return json({ connected_app: await disconnectApp(user.workspace.id, requireUuid(id, 'connected app')) });
  });
}
