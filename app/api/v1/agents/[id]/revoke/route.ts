import { revokeAgent, serializeAgent } from '@/lib/agents';
import { requireUser } from '@/lib/auth';
import { handle, json, requireUuid } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser(req);
    const { id } = await context.params;
    const agent = await revokeAgent(user.workspace.id, requireUuid(id, 'agent'));
    return json({ agent: serializeAgent(agent) });
  });
}
