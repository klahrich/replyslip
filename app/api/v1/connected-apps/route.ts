import { requireHumanOwner } from '@/lib/auth';
import { json } from '@/lib/http';
import { listConnectedApps } from '@/lib/oauth/connected-apps';
import { handleOAuthSession } from '@/lib/oauth/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HUMAN_ONLY = 'Connected apps are managed by a signed-in human in the dashboard.';

/** GET /api/v1/connected-apps (§6.4). Session cookie only; an agent bearer is 403 human_required. */
export function GET(req: Request) {
  return handleOAuthSession(async () => {
    const user = await requireHumanOwner(req, HUMAN_ONLY);
    return json({ connected_apps: await listConnectedApps(user.workspace.id) });
  });
}
