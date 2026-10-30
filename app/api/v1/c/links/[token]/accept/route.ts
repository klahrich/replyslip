import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { acceptCustomerInvite } from '@/lib/customer-invites';
import { handleCustomer, json, parseBody, readJson } from '@/lib/http';
import { assertSameOrigin, publicOrigin } from '@/lib/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({}).strict();

/** R2: accept a customer link, or ask for access in approve_each mode. Session cookie only. */
export function POST(req: Request, context: { params: Promise<{ token: string }> }) {
  return handleCustomer(async () => {
    assertSameOrigin(req);
    parseBody(bodySchema, await readJson(req));
    const user = await requireUser(req);
    const { token } = await context.params;
    const result = await acceptCustomerInvite(
      { id: user.id, email: user.email, workspaceId: user.workspace.id },
      token,
      publicOrigin(req),
    );
    return json(result);
  });
}
