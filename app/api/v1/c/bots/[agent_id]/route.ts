import { getCustomerBot, requireCustomer } from '@/lib/customer-api';
import { handleCustomer, jsonWithEtag, requireUuid } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** R4: one bot, its share, and its jobs. ETag and If-None-Match (15.9). */
export function GET(req: Request, context: { params: Promise<{ agent_id: string }> }) {
  return handleCustomer(async () => {
    const user = await requireCustomer(req);
    const { agent_id } = await context.params;
    return jsonWithEtag(req, await getCustomerBot(user, requireUuid(agent_id, 'page')));
  });
}
