import { z } from 'zod';
import { authenticateAgentKey } from '@/lib/agents';
import { HttpError } from '@/lib/errors';
import { bearerToken, handle, json, parseBody, readJson, requireUuid } from '@/lib/http';
import { TASK_ANSWER_MAX } from '@/lib/constants';
import { answerTask } from '@/lib/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ answer: z.string().max(TASK_ANSWER_MAX * 2) });

/** The sender agent answers a needs_info question (spec 15.8). Agent key only, like the MCP tool answer_task. */
export function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const token = bearerToken(req);
    const caller = token?.startsWith('rsk_') ? await authenticateAgentKey(token) : null;
    if (!caller) throw new HttpError(401, 'unauthorized', 'Send an agent key as Authorization: Bearer <api_key>.');
    const { id } = await context.params;
    const body = parseBody(bodySchema, await readJson(req));
    const task = await answerTask(caller, requireUuid(id, 'task'), body.answer);
    return json({ task });
  });
}
