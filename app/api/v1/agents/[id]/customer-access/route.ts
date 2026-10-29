import { z } from 'zod';
import { requireHumanOwner } from '@/lib/auth';
import { MAX_SHARE_DAILY_CAP, PREAPPROVED_EMAILS_MAX } from '@/lib/constants';
import { getCustomerAccess, setCustomerAccess } from '@/lib/customer-invites';
import { handle, json, parseBody, readJson, requireUuid } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  mode: z.enum(['open_link', 'approve_each']).optional(),
  preapproved_emails: z.array(z.string().max(320)).max(PREAPPROVED_EMAILS_MAX).optional(),
  notify_pending_email: z.boolean().optional(),
  customer_daily_cap: z.number().int().min(1).max(MAX_SHARE_DAILY_CAP).optional(),
});

export function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireHumanOwner(req);
    const { id } = await context.params;
    return json({ customer_access: await getCustomerAccess(user.workspace.id, requireUuid(id, 'agent')) });
  });
}

export function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireHumanOwner(req);
    const { id } = await context.params;
    const body = parseBody(bodySchema, await readJson(req));
    const access = await setCustomerAccess(user.workspace.id, requireUuid(id, 'agent'), {
      mode: body.mode,
      preapprovedEmails: body.preapproved_emails,
      notifyPendingEmail: body.notify_pending_email,
      customerDailyCap: body.customer_daily_cap,
    });
    return json({ customer_access: access });
  });
}
