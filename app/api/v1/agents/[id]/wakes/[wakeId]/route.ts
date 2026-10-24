import { getAgent } from '@/lib/agents';
import { requireUser } from '@/lib/auth';
import { handle, json, requireUuid } from '@/lib/http';
import { getAgentWake } from '@/lib/wakes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request, context: { params: Promise<{ id: string; wakeId: string }> }) {
  return handle(async () => {
    const user = await requireUser(req);
    const { id, wakeId } = await context.params;
    const agentId = requireUuid(id, 'agent');
    await getAgent(user.workspace.id, agentId);
    const wake = await getAgentWake(user.workspace.id, agentId, requireUuid(wakeId, 'wake'));
    return json({ wake });
  });
}
