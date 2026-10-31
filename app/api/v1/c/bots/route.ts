import { listCustomerBots, requireCustomer } from '@/lib/customer-api';
import { handleCustomer, json } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** R3: the signed-in customer's bots, approved, pending, and revoked. Not a customer → an empty list. */
export function GET(req: Request) {
  return handleCustomer(async () => {
    const user = await requireCustomer(req);
    return json(await listCustomerBots(user));
  });
}
