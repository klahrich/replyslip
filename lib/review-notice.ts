import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { agents, tasks, users, type AgentRow } from '@/db/schema';
import { PENDING_NOTIFY_INTERVAL_MS } from './constants';
import { getEmailSender } from './email';
import { runAfterResponse } from './first-agent-alert';
import { absoluteUrl, canonicalOrigin } from './origin';

export type ReviewNotice = { agentName: string; waitingCount: number; recipients: string[] };

/** The owner's review list. The single-item page is reviewPath(task_id) in lib/wake-notice.ts. */
export const REVIEWS_PATH = '/dashboard/reviews';

/** Held items (in_review or awaiting_release) on one agent. */
export async function heldCountFor(db: Db, agentId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(eq(tasks.toAgentId, agentId), sql`${tasks.status} in ('in_review', 'awaiting_release')`));
  return row?.count ?? 0;
}

/**
 * Claims the hourly review email slot inside the create transaction, so concurrent requests send one email.
 * notify_review_email null counts as on. Recipients are the workspace's verified humans.
 */
export async function claimReviewNotice(tx: Db, agent: AgentRow): Promise<ReviewNotice | null> {
  if (agent.notifyReviewEmail === false) return null;
  const cutoff = new Date(Date.now() - PENDING_NOTIFY_INTERVAL_MS);
  const [claimed] = await tx
    .update(agents)
    .set({ reviewNotifiedAt: new Date() })
    .where(
      and(
        eq(agents.id, agent.id),
        or(isNull(agents.notifyReviewEmail), eq(agents.notifyReviewEmail, true)),
        or(isNull(agents.reviewNotifiedAt), lte(agents.reviewNotifiedAt, cutoff)),
      ),
    )
    .returning({ id: agents.id });
  if (!claimed) return null;
  const owners = await tx
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.workspaceId, agent.workspaceId), sql`${users.emailVerifiedAt} is not null`));
  if (owners.length === 0) return null;
  return { agentName: agent.name, waitingCount: await heldCountFor(tx, agent.id), recipients: owners.map((o) => o.email) };
}

/** After the response. A send failure is logged without the address and never fails the request. */
export function sendReviewNotice(notice: ReviewNotice): void {
  runAfterResponse(async () => {
    for (const to of notice.recipients) {
      try {
        const reviewUrl = absoluteUrl(canonicalOrigin() ?? '', REVIEWS_PATH);
        await getEmailSender().sendReviewNeeded({
          to,
          agentName: notice.agentName,
          waitingCount: notice.waitingCount,
          reviewUrl,
        });
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : 'unknown error';
        console.error(`[replyslip] review-needed notice failed: ${reason}`);
      }
    }
  });
}
