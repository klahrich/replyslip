import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { agentOffers, type TaskRow } from '@/db/schema';
import { CUSTOMER_UPDATE_EMAIL_LIMIT } from './constants';
import { brandingFor } from './customer-branding';
import { getEmailSender, type CustomerUpdateEmail, type CustomerUpdateKind } from './email';
import { runAfterResponse } from './first-agent-alert';
import { offerDisplayTitle } from './offer-title';
import { absoluteUrl, canonicalOrigin } from './origin';
import { consumeKeyedRateLimit } from './rate-limit';
import { customerRecipientFor } from './task-senders';

/** One customer email, claimed inside the transaction that made the change and sent after it commits. */
export type CustomerNotice = Omit<CustomerUpdateEmail, 'requestUrl'> & { agentId: string; taskId: string };

/** The customer's request page (app/(customer)/c/[agentId]/r/[taskId]). */
export function customerRequestPath(agentId: string, taskId: string): string {
  return `/c/${agentId}/r/${taskId}`;
}

/**
 * What the customer can now see, or null. Only a status change counts, so a retried or replayed call (which either
 * 409s or leaves the status where it was) never emails twice. Held statuses never notify: the release does.
 */
export function customerUpdateKind(before: Pick<TaskRow, 'status'>, after: Pick<TaskRow, 'status'>): CustomerUpdateKind | null {
  if (before.status === after.status) return null;
  if (after.status === 'needs_info') return 'question';
  if (after.status === 'done') return 'result';
  if (after.status === 'failed') return 'failure';
  return null;
}

/**
 * Call inside the transaction, after the status-guarded update. Returns the notice to send after commit, or null when
 * the task is not customer-sent, nothing customer-visible changed, or the recipient is over the hourly cap.
 */
export async function claimCustomerNotice(tx: Db, before: Pick<TaskRow, 'status'>, after: TaskRow): Promise<CustomerNotice | null> {
  const kind = customerUpdateKind(before, after);
  if (!kind) return null;
  const recipient = await customerRecipientFor(tx, after);
  if (!recipient) return null;
  const limit = await consumeKeyedRateLimit(tx, {
    kind: CUSTOMER_UPDATE_EMAIL_LIMIT.kind,
    key: recipient.userId,
    limit: CUSTOMER_UPDATE_EMAIL_LIMIT.limit,
    windowMs: CUSTOMER_UPDATE_EMAIL_LIMIT.windowMs,
  });
  if (limit.limited) return null;
  const branding = await brandingFor(tx, { id: after.toAgentId, workspaceId: after.workspaceId });
  let requestTitle = after.title;
  if (after.offerId) {
    const [offer] = await tx
      .select({ name: agentOffers.name, title: agentOffers.title })
      .from(agentOffers)
      .where(eq(agentOffers.id, after.offerId))
      .limit(1);
    if (offer) requestTitle = offerDisplayTitle(offer);
  }
  return { to: recipient.email, kind, businessName: branding.display_name, requestTitle, agentId: after.toAgentId, taskId: after.id };
}

/** After the response. A send failure is logged without the address and never fails the request. */
export function sendCustomerNotice(notice: CustomerNotice | null): void {
  if (!notice) return;
  runAfterResponse(async () => {
    try {
      await getEmailSender().sendCustomerUpdate({
        to: notice.to,
        kind: notice.kind,
        businessName: notice.businessName,
        requestTitle: notice.requestTitle,
        requestUrl: absoluteUrl(canonicalOrigin() ?? '', customerRequestPath(notice.agentId, notice.taskId)),
      });
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      console.error(`[replyslip] customer update notice failed: ${reason}`);
    }
  });
}
