import { z } from 'zod';
import { createAgent, listAgents, serializeAgent } from '@/lib/agents';
import { agentWakeActivity } from '@/lib/wakes';
import { requireUser } from '@/lib/auth';
import { handle, json, parseBody, readJson } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  name: z.string(),
  description: z.string().max(2000).optional(),
});

export function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    const rows = await listAgents(user.workspace.id);
    const activity = await agentWakeActivity(user.workspace.id);
    return json({
      agents: rows.map((agent) => {
        const wake = activity.get(agent.id);
        return {
          ...serializeAgent(agent),
          last_delivered_at: wake?.last_delivered_at ?? null,
          last_failed_at: wake?.last_failed_at ?? null,
          last_error: wake?.last_error ?? null,
        };
      }),
    });
  });
}

export function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    const body = parseBody(bodySchema, await readJson(req));
    const agent = await createAgent(user, body);
    return json({ agent: serializeAgent(agent) }, 201);
  });
}
