import { z } from 'zod';
import { serializeAgent } from '@/lib/agents';
import { requireUser } from '@/lib/auth';
import { handle, json, parseBody, readJson, requireUuid } from '@/lib/http';
import { setAgentShared } from '@/lib/sharing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ shared: z.boolean() });

export function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser(req);
    const { id } = await context.params;
    const body = parseBody(bodySchema, await readJson(req));
    const agent = await setAgentShared(user.workspace.id, requireUuid(id, 'agent'), body.shared);
    return json({ agent: serializeAgent(agent) });
  });
}
