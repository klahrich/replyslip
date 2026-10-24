import { revokeWatcherKey } from '@/lib/agents';
import { requireUser } from '@/lib/auth';
import { handle, json, requireUuid } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser(req);
    const { id } = await context.params;
    const key = await revokeWatcherKey(user.workspace.id, requireUuid(id, 'watcher key'));
    return json({
      watcher_key: {
        id: key.id,
        name: key.name,
        prefix: key.tokenPrefix,
        created_at: key.createdAt.toISOString(),
        revoked_at: key.revokedAt?.toISOString() ?? null,
        last_used_at: key.lastUsedAt?.toISOString() ?? null,
      },
    });
  });
}
