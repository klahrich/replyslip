import { getCustomerRequest, requireCustomer } from '@/lib/customer-api';
import { handleCustomer, jsonWithEtag, requireUuid } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** R7: one request. 404 unless this customer's workspace sent it. ETag and If-None-Match (15.9). */
export function GET(req: Request, context: { params: Promise<{ task_id: string }> }) {
  return handleCustomer(async () => {
    const user = await requireCustomer(req);
    const { task_id } = await context.params;
    return jsonWithEtag(req, await getCustomerRequest(user, requireUuid(task_id, 'request')));
  });
}
