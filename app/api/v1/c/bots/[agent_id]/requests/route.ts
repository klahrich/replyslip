import { z } from 'zod';
import { createCustomerRequest, listCustomerRequests, parseListQuery, requireCustomer } from '@/lib/customer-api';
import { handleCustomer, json, jsonWithEtag, parseBody, readJson, requireUuid } from '@/lib/http';
import { assertSameOrigin } from '@/lib/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    offer: z.string().min(1).max(64),
    input: z.record(z.string(), z.json()).optional(),
    notes: z.string().max(8_000).nullable().optional(),
    client_request_id: z.uuid().optional(),
  })
  .strict();

/** R5: send a request as the customer's hidden sender agent. Session cookie, same origin. */
export function POST(req: Request, context: { params: Promise<{ agent_id: string }> }) {
  return handleCustomer(async () => {
    assertSameOrigin(req);
    const raw = await readJson(req);
    const user = await requireCustomer(req);
    const { agent_id } = await context.params;
    const agentId = requireUuid(agent_id, 'page');
    const body = parseBody(bodySchema, raw);
    const result = await createCustomerRequest(user, agentId, body);
    return json(result.body, result.status);
  });
}

/** R6: this customer's requests to the bot, newest first. ETag and If-None-Match (15.9). */
export function GET(req: Request, context: { params: Promise<{ agent_id: string }> }) {
  return handleCustomer(async () => {
    const user = await requireCustomer(req);
    const { agent_id } = await context.params;
    const agentId = requireUuid(agent_id, 'page');
    const query = parseListQuery(new URL(req.url));
    const { body, etag } = await listCustomerRequests(user, agentId, query);
    return jsonWithEtag(req, body, etag);
  });
}
