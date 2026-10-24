import { revokeAgentKey } from '@/lib/agents';
import { requireUser } from '@/lib/auth';
import { handle, json, requireUuid } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(req: Request, context: { params: Promise<{ id: string; keyId: string }> }) {
  return handle(async () => {
    const user = await requireUser(req);
    const { id, keyId } = await context.params;
    const key = await revokeAgentKey(user.workspace.id, requireUuid(id, 'agent'), requireUuid(keyId, 'key'));
    return json({
      key: {
        id: key.id,
        prefix: key.tokenPrefix,
        created_at: key.createdAt.toISOString(),
        revoked_at: key.revokedAt?.toISOString() ?? null,
        last_used_at: key.lastUsedAt?.toISOString() ?? null,
      },
    });
  });
}
