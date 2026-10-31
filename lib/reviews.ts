import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getDb, type Db } from '@/db';
import { agentOffers, agentShares, agents, tasks, users, workspaces, type AgentRow, type TaskRow } from '@/db/schema';
import { getAgent } from './agents';
import { OWNER_DECLINED_REASON, OWNER_NOTE_MAX, REVIEWS_LIST_MAX } from './constants';
import { inputDisplay, resultDisplay } from './customer-api';
import { consumeOrThrow } from './customer-invites';
import { HttpError } from './errors';
import { offerDisplayTitle } from './offer-title';
import { heldCountFor } from './review-notice';
import { afterWake, lockTargetAgentShared, serializeAnswer, taskAnswersFor, type HeldAction } from './tasks';
import { enqueueWake, reviewUrl, type WakeReason } from './wakes';

export type ReviewMode = 'auto' | 'review_first';
export type ReviewAction = 'approve' | 'decline' | 'release' | 'send_back';
export const REVIEW_ACTIONS: readonly ReviewAction[] = ['approve', 'decline', 'release', 'send_back'];

type Owner = { userId: string; workspaceId: string };

export function reviewModeOf(agent: Pick<AgentRow, 'reviewMode'>): ReviewMode {
  return agent.reviewMode === 'review_first' ? 'review_first' : 'auto';
}

// ---------- setting ----------

export type ReviewSettings = {
  agent_id: string;
  review_mode: ReviewMode;
  notify_review_email: boolean;
  held_count: number;
};

async function settingsFor(db: Db, agent: AgentRow): Promise<ReviewSettings> {
  return {
    agent_id: agent.id,
    review_mode: reviewModeOf(agent),
    notify_review_email: agent.notifyReviewEmail !== false,
    held_count: await heldCountFor(db, agent.id),
  };
}

export async function getReviewSettings(workspaceId: string, agentId: string): Promise<ReviewSettings> {
  const agent = await getAgent(workspaceId, agentId);
  return settingsFor(getDb(), agent);
}

/**
 * Human owner only (the route checks the session and Origin). Switching the mode affects only new tasks:
 * each task keeps the mode it was created with, so held items stay held until the owner acts on them.
 */
export async function setReviewSettings(
  owner: Owner,
  agentId: string,
  input: { reviewMode?: ReviewMode; notifyReviewEmail?: boolean },
): Promise<ReviewSettings> {
  await consumeOrThrow({ kind: 'reviewMode', agentId: owner.userId });
  const agent = await getAgent(owner.workspaceId, agentId);
  if (agent.revokedAt) throw new HttpError(409, 'agent_revoked', 'This agent is revoked.');
  const patch: Partial<AgentRow> = {};
  if (input.reviewMode !== undefined) patch.reviewMode = input.reviewMode;
  if (input.notifyReviewEmail !== undefined) patch.notifyReviewEmail = input.notifyReviewEmail;
  if (Object.keys(patch).length === 0) return settingsFor(getDb(), agent);
  const [updated] = await getDb()
    .update(agents)
    .set(patch)
    .where(and(eq(agents.id, agent.id), eq(agents.workspaceId, owner.workspaceId)))
    .returning();
  if (!updated) throw new HttpError(404, 'not_found', 'No agent was found.');
  return settingsFor(getDb(), updated);
}

// ---------- serialization ----------

type Stage = 'request' | 'answer';

function stageOf(task: TaskRow): Stage | null {
  if (task.status === 'in_review') return 'request';
  if (task.status === 'awaiting_release') return 'answer';
  return null;
}

function actionsFor(task: TaskRow): ReviewAction[] {
  if (task.status === 'in_review') return ['approve', 'decline'];
  if (task.status === 'awaiting_release') return ['release', 'send_back', 'decline'];
  return [];
}

type Context = {
  agentName: string;
  senderKind: 'customer' | 'agent';
  senderAgentName: string | null;
  senderHandle: string | null;
  customerEmail: string | null;
  offer: { name: string; title: string } | null;
};

async function contextsFor(db: Db, rows: TaskRow[]): Promise<Map<string, Context>> {
  const out = new Map<string, Context>();
  if (rows.length === 0) return out;
  const fromAgent = alias(agents, 'from_agent');
  const toAgent = alias(agents, 'to_agent');
  const fromWorkspace = alias(workspaces, 'from_workspace');
  const found = await db
    .select({
      id: tasks.id,
      toName: toAgent.name,
      fromName: fromAgent.name,
      fromRole: fromAgent.role,
      fromHandle: fromWorkspace.handle,
      offerName: agentOffers.name,
      offerTitle: agentOffers.title,
      customerEmail: users.email,
    })
    .from(tasks)
    .innerJoin(toAgent, eq(toAgent.id, tasks.toAgentId))
    .innerJoin(fromAgent, eq(fromAgent.id, tasks.fromAgentId))
    .leftJoin(fromWorkspace, eq(fromWorkspace.id, tasks.fromWorkspaceId))
    .leftJoin(agentOffers, eq(agentOffers.id, tasks.offerId))
    .leftJoin(
      agentShares,
      and(eq(agentShares.agentId, tasks.toAgentId), eq(agentShares.guestWorkspaceId, tasks.fromWorkspaceId)),
    )
    .leftJoin(users, and(eq(users.id, agentShares.requestedByUserId), eq(fromAgent.role, 'customer_sender')))
    .where(inArray(tasks.id, rows.map((row) => row.id)));
  for (const row of found) {
    const customer = row.fromRole === 'customer_sender';
    out.set(row.id, {
      agentName: row.toName,
      senderKind: customer ? 'customer' : 'agent',
      senderAgentName: customer ? null : row.fromName,
      senderHandle: customer ? null : (row.fromHandle ?? null),
      customerEmail: customer ? (row.customerEmail ?? null) : null,
      offer: row.offerName ? { name: row.offerName, title: offerDisplayTitle({ name: row.offerName, title: row.offerTitle }) } : null,
    });
  }
  return out;
}

/**
 * Owner-only view of one review_first task. Sender text is untrusted: render it as text.
 * customer_email is owner-only, like the share list; it never goes to a bot or an agent tool.
 */
async function serializeReview(db: Db, task: TaskRow, context: Context | undefined) {
  const held = task.status === 'awaiting_release' ? (task.heldAction as HeldAction | null) : null;
  const answers = await taskAnswersFor(db, task.id);
  return {
    task_id: task.id,
    status: task.status,
    stage: stageOf(task),
    held_action: held,
    actions: actionsFor(task),
    agent: { id: task.toAgentId, name: context?.agentName ?? 'unknown' },
    sender: {
      kind: context?.senderKind ?? 'agent',
      customer_email: context?.customerEmail ?? null,
      workspace_handle: context?.senderHandle ?? null,
      agent_name: context?.senderAgentName ?? null,
    },
    offer: context?.offer ?? null,
    title: task.title,
    notes: task.description ? task.description : null,
    input: task.input ?? null,
    input_display: inputDisplay(task.inputSchema ?? null, task.input ?? null),
    answers: answers.map(serializeAnswer),
    result: held === 'result' ? (task.result ?? null) : null,
    result_display: held === 'result' ? resultDisplay(task.resultSchema, task.result) : [],
    question: held === 'question' ? task.question : null,
    fail_message: held === 'failure' ? task.failReason : null,
    owner_note: task.ownerNote ?? null,
    reviewed_at: task.reviewedAt?.toISOString() ?? null,
    reviewed_by: task.reviewedBy ?? null,
    released_at: task.releasedAt?.toISOString() ?? null,
    created_at: task.createdAt.toISOString(),
    updated_at: task.updatedAt.toISOString(),
    completed_at: task.completedAt?.toISOString() ?? null,
    untrusted: true,
    review_url: reviewUrl(task.id),
  };
}

export type SerializedReview = Awaited<ReturnType<typeof serializeReview>>;

async function serializeOne(db: Db, task: TaskRow): Promise<SerializedReview> {
  const contexts = await contextsFor(db, [task]);
  return serializeReview(db, task, contexts.get(task.id));
}

// ---------- reads ----------

/** Held items in the owner's workspace, oldest first, plus counts for the dashboard badge. */
export async function listReviews(workspaceId: string, filter: { agentId?: string; limit?: number }) {
  const db = getDb();
  const held = and(
    eq(tasks.workspaceId, workspaceId),
    sql`${tasks.status} in ('in_review', 'awaiting_release')`,
    filter.agentId ? eq(tasks.toAgentId, filter.agentId) : undefined,
  );
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), REVIEWS_LIST_MAX);
  const rows = await db.select().from(tasks).where(held).orderBy(asc(tasks.updatedAt), asc(tasks.id)).limit(limit);
  const counts = await db
    .select({ agentId: tasks.toAgentId, status: tasks.status, count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(held)
    .groupBy(tasks.toAgentId, tasks.status)
    .orderBy(desc(sql`count(*)`));
  const contexts = await contextsFor(db, rows);
  const reviews: SerializedReview[] = [];
  for (const row of rows) reviews.push(await serializeReview(db, row, contexts.get(row.id)));
  const byAgent = new Map<string, { agent_id: string; in_review: number; awaiting_release: number }>();
  for (const row of counts) {
    const entry = byAgent.get(row.agentId) ?? { agent_id: row.agentId, in_review: 0, awaiting_release: 0 };
    if (row.status === 'in_review') entry.in_review += row.count;
    else entry.awaiting_release += row.count;
    byAgent.set(row.agentId, entry);
  }
  const total = counts.reduce((sum, row) => sum + row.count, 0);
  return { reviews, count: total, by_agent: [...byAgent.values()] };
}

/** Owner side only, review_first tasks only. Anything else is 404 so the id leaks nothing. */
async function ownedReviewTask(db: Db, workspaceId: string, taskId: string): Promise<TaskRow> {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId), eq(tasks.reviewMode, 'review_first')))
    .limit(1);
  if (!task) throw new HttpError(404, 'not_found', 'No review was found.');
  return task;
}

/** One item for the single review page. A finished item comes back with actions [] so the page can say so. */
export async function getReview(workspaceId: string, taskId: string) {
  const db = getDb();
  return { review: await serializeOne(db, await ownedReviewTask(db, workspaceId, taskId)) };
}

// ---------- actions ----------

function invalidState(task: TaskRow, action: ReviewAction): HttpError {
  const verb = action === 'send_back' ? 'send back' : action;
  return new HttpError(409, 'invalid_review_state', `This item is ${task.status}; you cannot ${verb} it now.`, {
    status: task.status,
    actions: actionsFor(task),
  });
}

function cleanNote(note: string | undefined, required: boolean): string | null {
  const trimmed = (note ?? '').trim();
  if (!trimmed) {
    if (required) {
      throw new HttpError(400, 'validation_error', 'Add a note for your bot.', { fields: { note: 'Required.' } });
    }
    return null;
  }
  if ([...trimmed].length > OWNER_NOTE_MAX) {
    throw new HttpError(400, 'validation_error', `Use ${OWNER_NOTE_MAX} characters or fewer.`, {
      fields: { note: `Use ${OWNER_NOTE_MAX} characters or fewer.` },
    });
  }
  return trimmed;
}

type Change = { set: Partial<TaskRow>; wake: { agentId: string; reason: WakeReason } | null };

function planFor(task: TaskRow, action: ReviewAction, note: string | null, owner: Owner, now: Date): Change {
  const reviewed = { reviewedAt: now, reviewedBy: owner.userId, updatedAt: now };
  switch (action) {
    case 'approve':
      if (task.status !== 'in_review') throw invalidState(task, action);
      return { set: { ...reviewed, status: 'open' }, wake: { agentId: task.toAgentId, reason: 'task' } };
    case 'decline':
      if (task.status !== 'in_review' && task.status !== 'awaiting_release') throw invalidState(task, action);
      // Whatever was held is dropped, so it can never reach the sender.
      return {
        set: {
          ...reviewed,
          status: 'failed',
          failReason: OWNER_DECLINED_REASON,
          result: null,
          question: null,
          questionAskedAt: null,
          heldAction: null,
          ownerNote: note,
          completedAt: now,
        },
        wake: { agentId: task.fromAgentId, reason: 'failure' },
      };
    case 'release': {
      if (task.status !== 'awaiting_release') throw invalidState(task, action);
      const released = { ...reviewed, releasedAt: now, heldAction: null };
      if (task.heldAction === 'result') {
        return { set: { ...released, status: 'done', completedAt: now }, wake: { agentId: task.fromAgentId, reason: 'result' } };
      }
      if (task.heldAction === 'question') {
        return {
          set: { ...released, status: 'needs_info', questionAskedAt: now },
          wake: { agentId: task.fromAgentId, reason: 'question' },
        };
      }
      if (task.heldAction === 'failure') {
        return { set: { ...released, status: 'failed', completedAt: now }, wake: { agentId: task.fromAgentId, reason: 'failure' } };
      }
      throw invalidState(task, action);
    }
    case 'send_back':
      if (task.status !== 'awaiting_release') throw invalidState(task, action);
      return {
        set: { ...reviewed, status: 'open', result: null, question: null, failReason: null, heldAction: null, ownerNote: note },
        wake: { agentId: task.toAgentId, reason: 'sent_back' },
      };
  }
}

/**
 * Approve, Decline, Release or Send back. Human owner only (the route checks the session and Origin).
 * Lock order is the same as answerTask and revokeAgent: the target agent FOR SHARE (a revoked agent is 404),
 * then the task FOR UPDATE, then a status-guarded update. None of these use the daily cap again.
 */
export async function actOnReview(owner: Owner, taskId: string, action: ReviewAction, input: { note?: string }) {
  const note = action === 'send_back' || action === 'decline' ? cleanNote(input.note, action === 'send_back') : null;
  if (action !== 'send_back' && action !== 'decline' && input.note !== undefined) {
    throw new HttpError(400, 'validation_error', 'Only Send back and Decline take a note.', { fields: { note: 'Not allowed.' } });
  }
  await consumeOrThrow({ kind: 'reviewAction', agentId: owner.userId });
  const db = getDb();
  const written = await db.transaction(async (tx) => {
    const seen = await ownedReviewTask(tx, owner.workspaceId, taskId);
    await lockTargetAgentShared(tx, seen.toAgentId);
    await tx.execute(sql`select id from tasks where id = ${taskId} and workspace_id = ${owner.workspaceId} for update`);
    const task = await ownedReviewTask(tx, owner.workspaceId, taskId);
    const now = new Date();
    const change = planFor(task, action, note, owner, now);
    const [updated] = await tx
      .update(tasks)
      .set(change.set)
      .where(and(eq(tasks.id, task.id), eq(tasks.workspaceId, owner.workspaceId), eq(tasks.status, task.status)))
      .returning();
    if (!updated) throw invalidState(task, action);
    const wakeId = change.wake
      ? await enqueueWake(tx, { workspaceId: updated.workspaceId, agentId: change.wake.agentId, reason: change.wake.reason, taskId: updated.id })
      : null;
    return { task: updated, wakeId };
  });
  await afterWake(written.wakeId);
  return { review: await serializeOne(db, written.task) };
}
