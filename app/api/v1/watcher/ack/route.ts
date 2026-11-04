import { z } from 'zod';
import { POLL_KEY_REJECTED, POLL_KEY_REQUIRED, authenticateWakePoller } from '@/lib/agents';
import { HttpError } from '@/lib/errors';
import { bearerToken, handle, json, parseBody, readJson } from '@/lib/http';
import { ackWakes } from '@/lib/wakes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  wake_ids: z.array(z.uuid()).max(50),
});

export function POST(req: Request) {
  return handle(async () => {
    const token = bearerToken(req);
    if (!token) throw new HttpError(401, 'unauthorized', POLL_KEY_REQUIRED);
    const poller = await authenticateWakePoller(token);
    if (!poller) throw new HttpError(401, 'unauthorized', POLL_KEY_REJECTED);
    const body = parseBody(bodySchema, await readJson(req));
    // An agent key acks only its own agent's wakes. Another agent's wake id is ignored and not counted.
    const scope = poller.kind === 'agent' ? { agentId: poller.agentId } : {};
    const acked = await ackWakes(poller.workspaceId, body.wake_ids, scope);
    return json({ acked });
  });
}
