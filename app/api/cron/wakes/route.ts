import { handle, json } from '@/lib/http';
import { cleanupExpiredCustomerRequests } from '@/lib/customer-invites';
import { cleanupUnclaimedInviteWorkspaces } from '@/lib/invites';
import { assertCronAuthorized, dispatchDueWebhookWakes } from '@/lib/wakes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function run(req: Request) {
  return handle(async () => {
    assertCronAuthorized(req);
    const result = await dispatchDueWebhookWakes();
    // Hobby allows one daily cron, so invite-workspace cleanup rides along with wake retries.
    const cleanup = await cleanupUnclaimedInviteWorkspaces();
    const expired = await cleanupExpiredCustomerRequests();
    return json({
      ok: true,
      ...result,
      invite_workspaces_deleted: cleanup.deleted,
      customer_requests_expired: expired.deleted,
    });
  });
}

export function GET(req: Request) {
  return run(req);
}

export function POST(req: Request) {
  return run(req);
}
