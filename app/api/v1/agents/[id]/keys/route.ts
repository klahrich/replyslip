import { issueAgentKey, listAgentKeys } from '@/lib/agents';
import { requireUser } from '@/lib/auth';
import { handle, json, requireUuid } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser(req);
    const { id } = await context.params;
    const keys = await listAgentKeys(user.workspace.id, requireUuid(id, 'agent'));
    return json({ keys });
  });
}

export function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser(req);
    const { id } = await context.params;
    const key = await issueAgentKey(user.workspace.id, requireUuid(id, 'agent'));
    return json(
      {
        key: {
          id: key.id,
          prefix: key.prefix,
          created_at: key.createdAt.toISOString(),
          secret: key.secret,
        },
      },
      201,
    );
  });
}
