import { z } from 'zod';
import { requireExternalCaller } from '@/lib/external-guest';
import { handle, json, parseBody, readJson, requireUuid } from '@/lib/http';
import { answerTask } from '@/lib/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  answer: z.string().min(1).max(2000),
});

const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };

export function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const caller = await requireExternalCaller(req);
    const { id } = await context.params;
    const body = parseBody(bodySchema, await readJson(req));
    const task = await answerTask(caller, requireUuid(id, 'task'), body.answer);
    return json({ task }, 200, headers);
  });
}
