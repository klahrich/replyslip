import { z } from 'zod';
import { POLL_KEY_REJECTED, POLL_KEY_REQUIRED, authenticateWakePoller, recordWatcherSeen } from '@/lib/agents';
import { HttpError } from '@/lib/errors';
import { bearerToken, handle, json, parseBody, readOptionalJson } from '@/lib/http';
import { leaseHerdrWakes } from '@/lib/wakes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  /** false: identify the caller and lease nothing. The per-agent watcher does this once before it takes its lock. */
  lease: z.boolean().optional(),
});

export function POST(req: Request) {
  return handle(async () => {
    const token = bearerToken(req);
    if (!token) throw new HttpError(401, 'unauthorized', POLL_KEY_REQUIRED);
    const poller = await authenticateWakePoller(token);
    if (!poller) throw new HttpError(401, 'unauthorized', POLL_KEY_REJECTED);
    const body = parseBody(bodySchema, await readOptionalJson(req));
    if (poller.kind === 'watcher') {
      // Legacy workspace watcher key: every local agent in the workspace.
      await recordWatcherSeen(poller.keyId);
      const wakes = body.lease === false ? [] : await leaseHerdrWakes(poller.workspaceId);
      return json({ wakes, workspace_id: poller.workspaceId });
    }
    // An agent's own key: only that agent's wakes, never another agent's.
    const wakes = body.lease === false ? [] : await leaseHerdrWakes(poller.workspaceId, { agentId: poller.agentId });
    return json({ wakes, workspace_id: poller.workspaceId, agent_id: poller.agentId, agent_name: poller.agentName });
  });
}
