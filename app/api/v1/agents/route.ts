import { z } from 'zod';
import { createAgent, listAgents, serializeAgent } from '@/lib/agents';
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
    return json({ agents: rows.map(serializeAgent) });
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
