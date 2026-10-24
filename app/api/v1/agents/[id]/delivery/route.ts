import { setAgentDelivery, serializeAgent } from '@/lib/agents';
import { requireUser } from '@/lib/auth';
import { deliveryInputSchema } from '@/lib/delivery';
import { handle, json, parseBody, readJson, requireUuid } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser(req);
    const { id } = await context.params;
    const body = parseBody(deliveryInputSchema, await readJson(req));
    const agent = await setAgentDelivery(user.workspace.id, requireUuid(id, 'agent'), body);
    return json({ agent: serializeAgent(agent) });
  });
}
