import { handle, json } from '@/lib/http';
import { getDb } from '@/db';
import { cleanupExpiredCustomerRequests } from '@/lib/customer-invites';
import { pruneCustomerNoticeEvents } from '@/lib/customer-notice';
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
    const pruned = await pruneCustomerNoticeEvents(getDb());
    return json({
      ok: true,
      ...result,
      invite_workspaces_deleted: cleanup.deleted,
      customer_requests_expired: expired.deleted,
      customer_email_events_pruned: pruned,
    });
  });
}

export function GET(req: Request) {
  return run(req);
}

export function POST(req: Request) {
  return run(req);
}
