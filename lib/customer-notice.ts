import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { agentOffers, type TaskRow } from '@/db/schema';
import { CUSTOMER_UPDATE_EMAIL_LIMIT } from './constants';
import { brandingFor } from './customer-branding';
import { getEmailSender, type CustomerUpdateEmail, type CustomerUpdateKind } from './email';
import { runAfterResponse } from './first-agent-alert';
import { offerDisplayTitle } from './offer-title';
import { absoluteUrl, canonicalOrigin } from './origin';
import { consumeKeyedRateLimit, pruneRateEvents } from './rate-limit';
import { customerRecipientFor } from './task-senders';

/** One customer email, claimed inside the transaction that made the change and sent after it commits. */
export type CustomerNotice = CustomerUpdateEmail;

/** The customer's request page (app/(customer)/c/[agentId]/r/[taskId]). */
export function customerRequestPath(agentId: string, taskId: string): string {
  return `/c/${agentId}/r/${taskId}`;
}

/**
 * What the customer can now see, or null. A status change counts, and so does a new question on a task that was
 * already waiting on one (a second ask, or a second released question). A retried or replayed call either 409s or
 * leaves the status and question as they were, so it never emails twice. Held statuses never notify: the release does.
 */
export function customerUpdateKind(
  before: Pick<TaskRow, 'status' | 'question'>,
  after: Pick<TaskRow, 'status' | 'question'>,
): CustomerUpdateKind | null {
  if (after.status === 'needs_info') {
    return before.status !== 'needs_info' || before.question !== after.question ? 'question' : null;
  }
  if (before.status === after.status) return null;
  if (after.status === 'done') return 'result';
  if (after.status === 'failed') return 'failure';
  return null;
}

/**
 * Call inside the transaction, after the status-guarded update. Returns the notice to send after commit, or null when
 * the task is not customer-sent, nothing customer-visible changed, or the recipient is over the hourly cap.
 */
export async function claimCustomerNotice(
  tx: Db,
  before: Pick<TaskRow, 'status' | 'question'>,
  after: TaskRow,
): Promise<CustomerNotice | null> {
  const kind = customerUpdateKind(before, after);
  if (!kind) return null;
  const recipient = await customerRecipientFor(tx, after);
  if (!recipient) return null;
  // The link must be absolute. With no APP_ORIGIN there is no safe origin to put in an email, so send nothing.
  const origin = canonicalOrigin();
  if (!origin) {
    console.error(`[replyslip] customer update notice skipped for task ${after.id}: APP_ORIGIN is not set, so there is no link origin.`);
    return null;
  }
  const limit = await consumeKeyedRateLimit(tx, {
    kind: CUSTOMER_UPDATE_EMAIL_LIMIT.kind,
    key: recipient.userId,
    limit: CUSTOMER_UPDATE_EMAIL_LIMIT.limit,
    windowMs: CUSTOMER_UPDATE_EMAIL_LIMIT.windowMs,
    prune: false,
  });
  if (limit.limited) {
    console.warn(
      `[replyslip] customer update notice dropped for task ${after.id}: the customer is over ${CUSTOMER_UPDATE_EMAIL_LIMIT.limit} emails an hour.`,
    );
    return null;
  }
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
  return {
    to: recipient.email,
    kind,
    businessName: branding.display_name,
    requestTitle,
    requestUrl: absoluteUrl(origin, customerRequestPath(after.toAgentId, after.id)),
  };
}

/** After the response. A send failure is logged without the address and never fails the request. */
export function sendCustomerNotice(notice: CustomerNotice | null): void {
  if (!notice) return;
  runAfterResponse(async () => {
    try {
      await getEmailSender().sendCustomerUpdate(notice);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      console.error(`[replyslip] customer update notice failed: ${reason}`);
    }
  });
}

/** Daily cron: the customer-email cap only looks back an hour, so rows older than a day are dropped there. */
export async function pruneCustomerNoticeEvents(db: Db): Promise<number> {
  return pruneRateEvents(db, CUSTOMER_UPDATE_EMAIL_LIMIT.kind);
}
