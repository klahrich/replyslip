import { sessionUser } from '@/lib/auth';
import { resolveCustomerLink } from '@/lib/customer-invites';
import { handleCustomer, json } from '@/lib/http';
import { clientIp } from '@/lib/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** R1: resolve a customer link. Works signed out; a session only adds the viewer's share status. */
export function GET(req: Request, context: { params: Promise<{ token: string }> }) {
  return handleCustomer(async () => {
    const { token } = await context.params;
    const user = await sessionUser(req);
    const viewer = user ? { id: user.id, email: user.email, workspaceId: user.workspace?.id ?? null } : null;
    return json(await resolveCustomerLink(token, viewer, clientIp(req)));
  });
}
