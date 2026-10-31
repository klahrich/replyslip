import { z } from 'zod';
import { answerCustomerRequest, requireCustomer } from '@/lib/customer-api';
import { handleCustomer, json, parseBody, readJson, requireUuid } from '@/lib/http';
import { assertSameOrigin } from '@/lib/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ answer: z.string().max(8_000) }).strict();

/** R8: answer the bot's question. Session cookie, same origin. */
export function POST(req: Request, context: { params: Promise<{ task_id: string }> }) {
  return handleCustomer(async () => {
    assertSameOrigin(req);
    const raw = await readJson(req);
    const user = await requireCustomer(req);
    const { task_id } = await context.params;
    const taskId = requireUuid(task_id, 'request');
    const body = parseBody(bodySchema, raw);
    return json(await answerCustomerRequest(user, taskId, body.answer));
  });
}
