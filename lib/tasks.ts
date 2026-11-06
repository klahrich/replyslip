import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getDb, type Db } from '@/db';
import {
  agentOffers,
  agents,
  messages,
  taskAnswers,
  tasks,
  workspaces,
  type AgentRow,
  type MessageRow,
  type TaskAnswerRow,
  type TaskRow,
} from '@/db/schema';
import type { AgentPrincipal } from './agents';
import { MESSAGE_BODY_MAX, TASK_ANSWER_MAX } from './constants';
import { HttpError } from './errors';
import { assertExternalCredential } from './invites';
import { OWN_TASKS_ONLY_MESSAGE } from './oauth/scopes';
import { assertResultSchema, validateResult } from './validate';
import { assertWithinLimit } from './plans';
import { assertFreeTextFields, parseRecipient, resolveSharedTask } from './sharing';
import { CROSS_WORKSPACE_TASK_NOTICE, HELD_FOR_REVIEW_NOTICE } from './wake-notice';
import { deliverWebhookWake, enqueueWake, type WakeReason } from './wakes';
import { claimReviewNotice, sendReviewNotice } from './review-notice';
import { claimCustomerNotice, sendCustomerNotice } from './customer-notice';
import { sendersFor } from './task-senders';

const CLOSED = new Set(['done', 'failed']);
/** Statuses where the owner gates the task (review_first). Nothing held is ever shown to the sending side. */
export const HELD_STATUSES = new Set(['in_review', 'awaiting_release']);
export type HeldAction = 'result' | 'question' | 'failure';

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

type TaskLabels = {
  fromHandle: string | null;
  ownerHandle: string | null;
  offerName: string | null;
};

export function isCrossWorkspaceTask(task: Pick<TaskRow, 'fromWorkspaceId' | 'workspaceId'>): boolean {
  return task.fromWorkspaceId != null && task.fromWorkspaceId !== task.workspaceId;
}

/**
 * The row as `viewerWorkspaceId` may see it. The owner's workspace sees everything. Any other viewer (the sending
 * workspace: a guest agent or a customer) never sees held content while the owner reviews it, and never sees the
 * owner's note.
 */
export function taskViewFor(task: TaskRow, viewerWorkspaceId: string): TaskRow {
  if (viewerWorkspaceId === task.workspaceId) return task;
  const held = HELD_STATUSES.has(task.status);
  return {
    ...task,
    result: held ? null : task.result,
    question: held ? null : task.question,
    failReason: held ? null : task.failReason,
    heldAction: null,
    ownerNote: null,
  };
}

/** The guest's own handle is an internal id. External callers see the owner's public address only. */
function presentTask<T extends { from_workspace_handle: string | null }>(caller: AgentPrincipal, task: T): T {
  if (!caller.externalGuest) return task;
  return { ...task, from_workspace_handle: null };
}

export function serializeTask(
  row: TaskRow,
  fromName: string,
  toName: string,
  viewerWorkspaceId: string,
  labels?: TaskLabels,
) {
  const task = taskViewFor(row, viewerWorkspaceId);
  const ownerSide = viewerWorkspaceId === row.workspaceId;
  const cross = isCrossWorkspaceTask(task);
  const toAddress = cross && labels?.ownerHandle ? `@${labels.ownerHandle}/${toName}` : toName;
  return {
    id: task.id,
    from: fromName,
    to: toName,
    from_agent_id: task.fromAgentId,
    to_agent_id: task.toAgentId,
    title: task.title,
    description: task.description,
    result_schema: task.resultSchema,
    input_schema: task.inputSchema ?? null,
    input: task.input ?? null,
    status: task.status,
    result: task.result ?? null,
    question: task.question,
    fail_reason: task.failReason,
    created_at: task.createdAt.toISOString(),
    updated_at: task.updatedAt.toISOString(),
    completed_at: iso(task.completedAt),
    cross_workspace: cross,
    untrusted: cross,
    from_workspace_handle: cross ? (labels?.fromHandle ?? null) : null,
    to_address: toAddress,
    offer: labels?.offerName ?? null,
    notice: cross ? CROSS_WORKSPACE_TASK_NOTICE : null,
    review_mode: task.reviewMode === 'review_first' ? 'review_first' : 'auto',
    held_action: ownerSide ? (task.heldAction ?? null) : null,
    owner_note: ownerSide ? (task.ownerNote ?? null) : null,
    released_at: iso(task.releasedAt),
    review_notice: ownerSide && task.status === 'awaiting_release' ? HELD_FOR_REVIEW_NOTICE : null,
  };
}

export async function labelsFor(db: Db, rows: TaskRow[]): Promise<Map<string, TaskLabels>> {
  const workspaceIds = new Set<string>();
  const offerIds = new Set<string>();
  for (const task of rows) {
    workspaceIds.add(task.workspaceId);
    if (task.fromWorkspaceId) workspaceIds.add(task.fromWorkspaceId);
    if (task.offerId) offerIds.add(task.offerId);
  }
  const handles = new Map<string, string | null>();
  if (workspaceIds.size > 0) {
    const found = await db
      .select({ id: workspaces.id, handle: workspaces.handle })
      .from(workspaces)
      .where(inArray(workspaces.id, [...workspaceIds]));
    for (const row of found) handles.set(row.id, row.handle);
  }
  const offerNames = new Map<string, string>();
  if (offerIds.size > 0) {
    const found = await db
      .select({ id: agentOffers.id, name: agentOffers.name })
      .from(agentOffers)
      .where(inArray(agentOffers.id, [...offerIds]));
    for (const row of found) offerNames.set(row.id, row.name);
  }
  const labels = new Map<string, TaskLabels>();
  for (const task of rows) {
    labels.set(task.id, {
      fromHandle: task.fromWorkspaceId ? (handles.get(task.fromWorkspaceId) ?? null) : null,
      ownerHandle: handles.get(task.workspaceId) ?? null,
      offerName: task.offerId ? (offerNames.get(task.offerId) ?? null) : null,
    });
  }
  return labels;
}

export function serializeMessage(message: MessageRow, fromName: string, toName: string) {
  return {
    id: message.id,
    from: fromName,
    to: toName,
    from_agent_id: message.fromAgentId,
    to_agent_id: message.toAgentId,
    body: message.body,
    task_id: message.taskId,
    created_at: message.createdAt.toISOString(),
  };
}

async function agentById(db: Db, id: string): Promise<AgentRow | null> {
  const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  return agent ?? null;
}

async function activeAgentByName(db: Db, workspaceId: string, name: string): Promise<AgentRow> {
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.workspaceId, workspaceId), eq(agents.name, name)))
    .limit(1);
  // The hidden customer sender only sends; nothing in its workspace can assign it work.
  if (!agent || agent.revokedAt || agent.role !== 'agent') {
    throw new HttpError(404, 'agent_not_found', `No active agent named ${name} is in this workspace.`);
  }
  return agent;
}

export async function namesFor(db: Db, task: TaskRow): Promise<{ from: string; to: string }> {
  const from = await agentById(db, task.fromAgentId);
  const to = await agentById(db, task.toAgentId);
  return { from: from?.name ?? 'unknown', to: to?.name ?? 'unknown' };
}

export async function afterWake(wakeId: string | null): Promise<void> {
  if (!wakeId) return;
  await deliverWebhookWake(wakeId);
}

export async function sendMessage(
  caller: AgentPrincipal,
  input: { to: string; body: string; taskId?: string },
  // MCP OAuth (docs/design/mcp-oauth.md §5.7): a connected app may only message on tasks it created. Off for rsk_.
  options: { ownTasksOnly?: boolean } = {},
) {
  if (options.ownTasksOnly && !input.taskId) {
    throw new HttpError(403, 'insufficient_scope', OWN_TASKS_ONLY_MESSAGE);
  }
  if (input.body.length < 1 || input.body.length > MESSAGE_BODY_MAX) {
    throw new HttpError(400, 'validation_error', `Message body must be 1-${MESSAGE_BODY_MAX} characters.`);
  }
  const address = parseRecipient(input.to);
  if (address.kind === 'shared') {
    throw new HttpError(400, 'invalid_recipient', 'Messages stay inside your workspace. A shared agent accepts tasks only.');
  }
  const db = getDb();
  const written = await db.transaction(async (tx) => {
    const recipient = await activeAgentByName(tx, caller.workspaceId, address.name);
    if (recipient.id === caller.agentId) {
      throw new HttpError(400, 'invalid_recipient', 'An agent cannot message itself.');
    }
    let taskId: string | null = null;
    if (input.taskId) {
      const task = await loadVisibleTask(tx, caller, input.taskId);
      if (isCrossWorkspaceTask(task)) {
        throw new HttpError(
          400,
          'invalid_recipient',
          'Task-thread messages stay inside one workspace. Reply on a cross-workspace task with ask, complete_task, or fail_task.',
        );
      }
      const participant = task.fromAgentId === caller.agentId || task.toAgentId === caller.agentId;
      if (!participant) throw new HttpError(404, 'not_found', 'No task was found.');
      if (options.ownTasksOnly && task.fromAgentId !== caller.agentId) {
        throw new HttpError(403, 'insufficient_scope', OWN_TASKS_ONLY_MESSAGE);
      }
      const otherId = task.fromAgentId === caller.agentId ? task.toAgentId : task.fromAgentId;
      if (recipient.id !== otherId) {
        throw new HttpError(400, 'invalid_recipient', 'A task-thread message can only go to the other participant.');
      }
      taskId = task.id;
      // A thread message is a change to the task: list_tasks updated_since and its sort key off updated_at.
      await tx.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, task.id));
    }
    const [message] = await tx
      .insert(messages)
      .values({
        workspaceId: caller.workspaceId,
        fromAgentId: caller.agentId,
        toAgentId: recipient.id,
        body: input.body,
        taskId,
      })
      .returning();
    if (!message) throw new HttpError(500, 'internal_error', 'Something went wrong.');
    const wakeId = await enqueueWake(tx, {
      workspaceId: caller.workspaceId,
      agentId: recipient.id,
      reason: 'message',
      taskId,
      messageId: message.id,
    });
    const fromName = caller.agentName;
    return { payload: serializeMessage(message, fromName, recipient.name), wakeId };
  });
  await afterWake(written.wakeId);
  return written.payload;
}

export async function createTask(
  caller: AgentPrincipal,
  input: {
    to: string;
    title?: string;
    description?: string;
    input?: unknown;
    resultSchema?: unknown;
    offer?: string;
    /** Customer idempotency key (R5). Unique per sending workspace. */
    clientRequestId?: string;
  },
) {
  assertExternalCredential(caller);
  const address = parseRecipient(input.to);
  if (caller.externalGuest && address.kind === 'workspace') {
    throw new HttpError(403, 'insufficient_scope', 'This link can only send tasks to the shared agent it was granted.');
  }
  // In-workspace tasks are always free text (input_not_allowed). A shared offer decides in resolveSharedTask.
  const workspaceFields = address.kind === 'workspace' ? assertFreeTextFields(input) : null;
  const written = await getDb().transaction(async (tx) => {
    // The monthly cap is the sender's. A guest task is stored in the owner's workspace
    // so the shared agent's wakes and complete path stay the same, and from_workspace_id
    // is what countChargedTasksThisMonth (lib/plans.ts) charges.
    await assertWithinLimit(caller.workspaceId, 'tasks', tx);
    let recipient: AgentRow;
    let resultSchema: Record<string, unknown>;
    let workspaceId = caller.workspaceId;
    let offerId: string | null = null;
    let title: string;
    let description: string;
    let inputSchema: Record<string, unknown> | null = null;
    let formInput: Record<string, unknown> | null = null;
    if (address.kind === 'workspace') {
      const fields = workspaceFields ?? assertFreeTextFields(input);
      title = fields.title;
      description = fields.description;
      if (input.offer) {
        throw new HttpError(400, 'offer_not_allowed', 'offer is only for a shared address, @handle/agentname.');
      }
      if (input.resultSchema === undefined) {
        throw new HttpError(400, 'validation_error', 'result_schema is required for an agent in your workspace.');
      }
      resultSchema = assertResultSchema(input.resultSchema);
      recipient = await activeAgentByName(tx, caller.workspaceId, address.name);
      if (recipient.id === caller.agentId) {
        throw new HttpError(400, 'invalid_recipient', 'A task needs a different agent. There is no hand-off of your own task.');
      }
    } else {
      if (input.resultSchema !== undefined) {
        throw new HttpError(
          400,
          'result_schema_forbidden',
          'A guest task uses the offer schema. Do not send result_schema.',
        );
      }
      if (!input.offer) {
        throw new HttpError(400, 'offer_required', 'A guest task must name an offer from get_agent_card.');
      }
      const resolved = await resolveSharedTask(tx, caller, address, input.offer, {
        title: input.title,
        description: input.description,
        input: input.input,
      });
      recipient = resolved.recipient;
      title = resolved.title;
      description = resolved.description;
      inputSchema = resolved.inputSchema;
      formInput = resolved.input;
      resultSchema = resolved.resultSchema;
      workspaceId = recipient.workspaceId;
      offerId = resolved.offerId;
    }
    // review_first gates only tasks from another workspace (customers and guest agents). Snapshot the mode so a
    // later switch affects only new tasks.
    const review = workspaceId !== caller.workspaceId && recipient.reviewMode === 'review_first';
    const [task] = await tx
      .insert(tasks)
      .values({
        workspaceId,
        fromWorkspaceId: caller.workspaceId,
        fromAgentId: caller.agentId,
        toAgentId: recipient.id,
        offerId,
        title,
        description,
        resultSchema,
        inputSchema,
        input: formInput,
        clientRequestId: input.clientRequestId ?? null,
        status: review ? 'in_review' : 'open',
        reviewMode: review ? 'review_first' : null,
      })
      .returning();
    if (!task) throw new HttpError(500, 'internal_error', 'Something went wrong.');
    // In review the bot gets only a content-free review_needed wake for its owner; the task wake waits for Approve.
    const wakeId = await enqueueWake(tx, {
      workspaceId,
      agentId: recipient.id,
      reason: review ? 'review_needed' : 'task',
      taskId: task.id,
    });
    const reviewNotice = review ? await claimReviewNotice(tx, recipient) : null;
    const labels = await labelsFor(tx, [task]);
    return {
      payload: presentTask(caller, serializeTask(task, caller.agentName, recipient.name, caller.workspaceId, labels.get(task.id))),
      wakeId,
      reviewNotice,
    };
  });
  await afterWake(written.wakeId);
  if (written.reviewNotice) sendReviewNotice(written.reviewNotice);
  return written.payload;
}

export async function loadTask(db: Db, workspaceId: string, taskId: string): Promise<TaskRow> {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), or(eq(tasks.workspaceId, workspaceId), eq(tasks.fromWorkspaceId, workspaceId))))
    .limit(1);
  if (!task) throw new HttpError(404, 'not_found', 'No task was found.');
  return task;
}

async function loadVisibleTask(db: Db, caller: AgentPrincipal, taskId: string): Promise<TaskRow> {
  const task = await loadTask(db, caller.workspaceId, taskId);
  assertParticipant(task, caller);
  return task;
}

function assertParticipant(task: TaskRow, caller: AgentPrincipal): void {
  if (task.fromAgentId !== caller.agentId && task.toAgentId !== caller.agentId) {
    throw new HttpError(404, 'not_found', 'No task was found.');
  }
  // A request in review does not exist for the bot until its owner approves it.
  if (task.status === 'in_review' && task.toAgentId === caller.agentId) {
    throw new HttpError(404, 'not_found', 'No task was found.');
  }
}

function assertTarget(task: TaskRow, caller: AgentPrincipal): void {
  assertParticipant(task, caller);
  if (task.toAgentId !== caller.agentId) {
    throw new HttpError(403, 'forbidden', 'Only the target agent can close or question this task.');
  }
  if (CLOSED.has(task.status)) {
    throw new HttpError(409, 'task_closed', `This task is already ${task.status}.`);
  }
  if (task.status === 'awaiting_release') throw taskHeld();
}

function taskHeld(): HttpError {
  return new HttpError(
    409,
    'task_held',
    'Your answer on this task is waiting for your owner to release it. Wait for a sent_back wake before changing it.',
  );
}

export async function getTask(caller: AgentPrincipal, taskId: string) {
  assertExternalCredential(caller);
  const db = getDb();
  const task = await loadVisibleTask(db, caller, taskId);
  if (caller.externalGuest && task.fromAgentId !== caller.agentId) {
    throw new HttpError(404, 'not_found', 'No task was found.');
  }
  const names = await namesFor(db, task);
  const labels = await labelsFor(db, [task]);
  const thread = await db
    .select()
    .from(messages)
    .where(and(eq(messages.taskId, task.id), eq(messages.workspaceId, caller.workspaceId)))
    .orderBy(messages.createdAt);
  const nameById = new Map<string, string>([
    [task.fromAgentId, names.from],
    [task.toAgentId, names.to],
  ]);
  return {
    task: presentTask(caller, serializeTask(task, names.from, names.to, caller.workspaceId, labels.get(task.id))),
    messages: thread.map((message) =>
      serializeMessage(message, nameById.get(message.fromAgentId) ?? 'unknown', nameById.get(message.toAgentId) ?? 'unknown'),
    ),
    answers: (await taskAnswersFor(db, task.id)).map(serializeAnswer),
  };
}

export function serializeAnswer(answer: TaskAnswerRow) {
  return {
    question: answer.question,
    answer: answer.answer,
    asked_at: answer.askedAt.toISOString(),
    answered_at: answer.answeredAt.toISOString(),
  };
}

export async function taskAnswersFor(db: Db, taskId: string): Promise<TaskAnswerRow[]> {
  return db
    .select()
    .from(taskAnswers)
    .where(eq(taskAnswers.taskId, taskId))
    .orderBy(taskAnswers.answeredAt, taskAnswers.id);
}

/**
 * FOR SHARE on the task's target agent, taken before any task lock. A revoked target is 404: its
 * tasks are closed and nothing may queue a wake for it.
 */
export async function lockTargetAgentShared(tx: Db, agentId: string): Promise<void> {
  const [agent] = await tx
    .select({ revokedAt: agents.revokedAt })
    .from(agents)
    .where(eq(agents.id, agentId))
    .for('share')
    .limit(1);
  if (!agent || agent.revokedAt) throw new HttpError(404, 'not_found', 'No task was found.');
}

/**
 * The sender answers a needs_info question (15.8). Works across workspaces, where task-thread
 * messages do not. Records the round in task_answers, reopens the task, and wakes the target.
 * It does not use the daily cap: it is the same request.
 */
export async function answerTask(caller: AgentPrincipal, taskId: string, answer: string) {
  assertExternalCredential(caller);
  const trimmed = answer.trim();
  if (trimmed.length < 1 || trimmed.length > TASK_ANSWER_MAX) {
    throw new HttpError(400, 'validation_error', `Answer must be 1-${TASK_ANSWER_MAX} characters.`, {
      fields: { answer: trimmed.length < 1 ? 'Required.' : `Use ${TASK_ANSWER_MAX} characters or fewer.` },
    });
  }
  const written = await getDb().transaction(async (tx) => {
    // Lock order everywhere: agent, then task (revokeAgent takes the agent FOR UPDATE, then fails its tasks).
    const seen = await loadTask(tx, caller.workspaceId, taskId);
    assertParticipant(seen, caller);
    await lockTargetAgentShared(tx, seen.toAgentId);
    await tx.execute(
      sql`select id from tasks where id = ${taskId} and (workspace_id = ${caller.workspaceId} or from_workspace_id = ${caller.workspaceId}) for update`,
    );
    const task = await loadTask(tx, caller.workspaceId, taskId);
    assertParticipant(task, caller);
    if (task.fromAgentId !== caller.agentId) {
      throw new HttpError(403, 'forbidden', 'Only the sender of this task can answer its question.');
    }
    if (task.status !== 'needs_info' || !task.question) {
      throw new HttpError(409, 'task_not_waiting', 'This request is not waiting for an answer.');
    }
    const now = new Date();
    await tx.insert(taskAnswers).values({
      taskId: task.id,
      question: task.question,
      answer: trimmed,
      askedAt: task.questionAskedAt ?? task.updatedAt,
      answeredAt: now,
    });
    const [updated] = await tx
      .update(tasks)
      .set({ status: 'open', question: null, questionAskedAt: null, updatedAt: now })
      .where(and(eq(tasks.id, task.id), eq(tasks.status, 'needs_info')))
      .returning();
    if (!updated) throw new HttpError(409, 'task_not_waiting', 'This request is not waiting for an answer.');
    const wakeId = await enqueueWake(tx, {
      workspaceId: updated.workspaceId,
      agentId: updated.toAgentId,
      reason: 'answer',
      taskId: updated.id,
    });
    const names = await namesFor(tx, updated);
    const labels = await labelsFor(tx, [updated]);
    return {
      payload: presentTask(caller, serializeTask(updated, names.from, names.to, caller.workspaceId, labels.get(updated.id))),
      wakeId,
    };
  });
  await afterWake(written.wakeId);
  return written.payload;
}

/** Most tasks one list call returns. Past it, `next_cursor` fetches the next page. */
export const TASK_LIST_MAX = 100;

/** Where a list page starts: tasks changed at or after `updatedSince`, strictly after `cursor` in the sort. */
export type TaskPage = { updatedSince?: Date; cursor?: TaskCursor };
type TaskCursor = { updatedAt: string; id: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The cursor's timestamp keeps the database's microseconds, which a JS Date would round away. */
const CURSOR_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
/** ISO 8601 with a date and time and an explicit zone (Z or ±hh:mm), e.g. 2026-11-03T17:00:00Z. */
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/i;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True when the leading YYYY-MM-DD is a real calendar day (Date would roll 2026-02-30 over to March 2). */
function realCalendarDay(value: string): boolean {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** ISO 8601 timestamp with an offset, or a date alone, which means 00:00 UTC that day (Date parses it that way). */
export function parseUpdatedSince(value: string | null | undefined): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const shaped = (ISO_TS_RE.test(value) || ISO_DATE_RE.test(value)) && realCalendarDay(value);
  const date = shaped ? new Date(value) : new Date(Number.NaN);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, 'validation_error', 'updated_since must be an ISO 8601 timestamp or date, e.g. 2026-11-03T17:00:00Z or 2026-11-03.', {
      fields: { updated_since: 'Invalid timestamp.' },
    });
  }
  return date;
}

export function parseTaskCursor(value: string | null | undefined): TaskCursor | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const invalid = () =>
    new HttpError(400, 'validation_error', 'cursor is not valid. Pass next_cursor from the previous page as is.', {
      fields: { cursor: 'Invalid cursor.' },
    });
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== 'string' ||
    typeof parsed[1] !== 'string' ||
    !CURSOR_TS_RE.test(parsed[0]) ||
    !UUID_RE.test(parsed[1])
  ) {
    throw invalid();
  }
  return { updatedAt: parsed[0], id: parsed[1] };
}

function encodeTaskCursor(cursor: TaskCursor): string {
  return Buffer.from(JSON.stringify([cursor.updatedAt, cursor.id]), 'utf8').toString('base64url');
}

const cursorTs = sql<string>`to_char(${tasks.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** Filters and sort shared by the agent and workspace lists: updated_at desc, then id desc, keyset paged. */
function pageConditions(page: TaskPage) {
  const conditions = [];
  if (page.updatedSince) conditions.push(sql`${tasks.updatedAt} >= ${page.updatedSince.toISOString()}::timestamptz`);
  if (page.cursor) {
    conditions.push(sql`(${tasks.updatedAt}, ${tasks.id}) < (${page.cursor.updatedAt}::timestamptz, ${page.cursor.id}::uuid)`);
  }
  return conditions;
}

function nextCursor<T extends { task: TaskRow; cursorTs: string }>(rows: T[], limit: number): string | null {
  if (rows.length <= limit) return null;
  const last = rows[limit - 1]!;
  return encodeTaskCursor({ updatedAt: last.cursorTs, id: last.task.id });
}

export async function listTasks(
  caller: AgentPrincipal,
  filter: { status?: string; role?: 'sent' | 'received' | 'any' } & TaskPage,
) {
  assertExternalCredential(caller);
  if (caller.externalGuest && filter.role === 'received') return { tasks: [], next_cursor: null };
  const role = caller.externalGuest ? 'sent' : (filter.role ?? 'any');
  const fromAgent = alias(agents, 'from_agent');
  const toAgent = alias(agents, 'to_agent');
  const visible = or(eq(tasks.workspaceId, caller.workspaceId), eq(tasks.fromWorkspaceId, caller.workspaceId));
  const conditions = visible ? [visible] : [];
  if (role === 'sent') conditions.push(eq(tasks.fromAgentId, caller.agentId));
  else if (role === 'received') conditions.push(eq(tasks.toAgentId, caller.agentId));
  else {
    const either = or(eq(tasks.fromAgentId, caller.agentId), eq(tasks.toAgentId, caller.agentId));
    if (either) conditions.push(either);
  }
  if (filter.status) conditions.push(eq(tasks.status, filter.status));
  // A request in review is invisible to its target bot until the owner approves it.
  conditions.push(sql`not (${tasks.toAgentId} = ${caller.agentId} and ${tasks.status} = 'in_review')`);
  conditions.push(...pageConditions(filter));
  const fetched = await getDb()
    .select({
      task: tasks,
      fromName: fromAgent.name,
      toName: toAgent.name,
      cursorTs,
    })
    .from(tasks)
    .innerJoin(fromAgent, eq(fromAgent.id, tasks.fromAgentId))
    .innerJoin(toAgent, eq(toAgent.id, tasks.toAgentId))
    .where(and(...conditions))
    .orderBy(desc(tasks.updatedAt), desc(tasks.id))
    .limit(TASK_LIST_MAX + 1);
  const rows = fetched.slice(0, TASK_LIST_MAX);
  const labels = await labelsFor(
    getDb(),
    rows.map((row) => row.task),
  );
  return {
    tasks: rows.map((row) =>
      presentTask(caller, serializeTask(row.task, row.fromName, row.toName, caller.workspaceId, labels.get(row.task.id))),
    ),
    next_cursor: nextCursor(fetched, TASK_LIST_MAX),
  };
}

async function closeOrQuestion(
  caller: AgentPrincipal,
  taskId: string,
  mutate: (task: TaskRow) => {
    status: string;
    result?: unknown;
    question?: string | null;
    failReason?: string | null;
    completed: boolean;
    reason: WakeReason;
    held: HeldAction;
  },
) {
  const written = await getDb().transaction(async (tx) => {
    // Same lock order as answerTask and revokeAgent: the target agent (the caller), then the task.
    await lockTargetAgentShared(tx, caller.agentId);
    await tx.execute(sql`select id from tasks where id = ${taskId} and workspace_id = ${caller.workspaceId} for update`);
    const task = await loadTask(tx, caller.workspaceId, taskId);
    assertTarget(task, caller);
    const change = mutate(task);
    const now = new Date();
    // review_first (snapshotted on the task): store what the bot did, hold it, and wake nobody. The owner
    // releases it (lib/reviews.ts), which applies the real status and wakes the sender then.
    const hold = task.reviewMode === 'review_first' && isCrossWorkspaceTask(task);
    const [updated] = await tx
      .update(tasks)
      .set({
        status: hold ? 'awaiting_release' : change.status,
        result: change.result === undefined ? task.result : change.result,
        question: change.question === undefined ? task.question : change.question,
        failReason: change.failReason === undefined ? task.failReason : change.failReason,
        questionAskedAt: !hold && change.status === 'needs_info' ? now : task.questionAskedAt,
        heldAction: hold ? change.held : null,
        updatedAt: now,
        completedAt: !hold && change.completed ? now : task.completedAt,
      })
      .where(
        and(
          eq(tasks.id, task.id),
          eq(tasks.workspaceId, caller.workspaceId),
          eq(tasks.toAgentId, caller.agentId),
          sql`${tasks.status} in ('open', 'needs_info')`,
        ),
      )
      .returning();
    if (!updated) throw new HttpError(409, 'task_closed', 'This task is already closed.');
    const wakeId = hold
      ? null
      : await enqueueWake(tx, {
          workspaceId: caller.workspaceId,
          agentId: updated.fromAgentId,
          reason: change.reason,
          taskId: updated.id,
        });
    // Held answers never notify the customer; the owner's release does (lib/reviews.ts).
    const customerNotice = hold ? null : await claimCustomerNotice(tx, task, updated);
    const names = await namesFor(tx, updated);
    const labels = await labelsFor(tx, [updated]);
    return {
      payload: serializeTask(updated, names.from, names.to, caller.workspaceId, labels.get(updated.id)),
      wakeId,
      customerNotice,
    };
  });
  sendCustomerNotice(written.customerNotice);
  await afterWake(written.wakeId);
  return written.payload;
}

export async function completeTask(caller: AgentPrincipal, taskId: string, result: unknown) {
  const db = getDb();
  const existing = await loadVisibleTask(db, caller, taskId);
  assertTarget(existing, caller);
  const check = validateResult(existing.resultSchema, result);
  if (!check.ok) {
    throw new HttpError(
      400,
      'result_schema_mismatch',
      'Result does not match the task result_schema. Nothing was saved and the sender was not woken.',
      { validation_errors: check.errors },
    );
  }
  return closeOrQuestion(caller, taskId, () => ({
    status: 'done',
    result,
    completed: true,
    reason: 'result',
    held: 'result',
  }));
}

export async function askTask(caller: AgentPrincipal, taskId: string, question: string) {
  const trimmed = question.trim();
  if (trimmed.length < 1 || trimmed.length > 8000) {
    throw new HttpError(400, 'validation_error', 'Question must be 1-8000 characters.');
  }
  const existing = await loadVisibleTask(getDb(), caller, taskId);
  assertTarget(existing, caller);
  if (!isCrossWorkspaceTask(existing)) await assertWithinLimit(caller.workspaceId, 'tasks');
  return closeOrQuestion(caller, taskId, () => ({
    status: 'needs_info',
    question: trimmed,
    completed: false,
    reason: 'question',
    held: 'question',
  }));
}

export async function failTask(caller: AgentPrincipal, taskId: string, reason: string) {
  const trimmed = reason.trim();
  if (trimmed.length < 1 || trimmed.length > 8000) {
    throw new HttpError(400, 'validation_error', 'Failure reason must be 1-8000 characters.');
  }
  return closeOrQuestion(caller, taskId, () => ({
    status: 'failed',
    failReason: trimmed,
    completed: true,
    reason: 'failure',
    held: 'failure',
  }));
}

export async function listWorkspaceTasks(
  workspaceId: string,
  status: string | undefined,
  limit: number,
  page: TaskPage = {},
) {
  const fromAgent = alias(agents, 'from_agent');
  const toAgent = alias(agents, 'to_agent');
  const visible = or(eq(tasks.workspaceId, workspaceId), eq(tasks.fromWorkspaceId, workspaceId));
  const conditions = visible ? [visible] : [];
  if (status) conditions.push(eq(tasks.status, status));
  conditions.push(...pageConditions(page));
  const fetched = await getDb()
    .select({
      task: tasks,
      fromName: fromAgent.name,
      toName: toAgent.name,
      cursorTs,
    })
    .from(tasks)
    .innerJoin(fromAgent, eq(fromAgent.id, tasks.fromAgentId))
    .innerJoin(toAgent, eq(toAgent.id, tasks.toAgentId))
    .where(and(...conditions))
    .orderBy(desc(tasks.updatedAt), desc(tasks.id))
    .limit(limit + 1);
  const rows = fetched.slice(0, limit);
  const labels = await labelsFor(
    getDb(),
    rows.map((row) => row.task),
  );
  const senders = await sendersFor(
    getDb(),
    rows.map((row) => row.task),
    workspaceId,
  );
  return {
    tasks: rows.map((row) => ({
      ...serializeTask(row.task, row.fromName, row.toName, workspaceId, labels.get(row.task.id)),
      sender: senders.get(row.task.id) ?? null,
    })),
    next_cursor: nextCursor(fetched, limit),
  };
}

export async function getWorkspaceTask(workspaceId: string, taskId: string) {
  const db = getDb();
  const task = await loadTask(db, workspaceId, taskId);
  const names = await namesFor(db, task);
  const labels = await labelsFor(db, [task]);
  const thread = await db
    .select()
    .from(messages)
    .where(and(eq(messages.taskId, task.id), eq(messages.workspaceId, workspaceId)))
    .orderBy(messages.createdAt);
  const nameById = new Map<string, string>([
    [task.fromAgentId, names.from],
    [task.toAgentId, names.to],
  ]);
  const senders = await sendersFor(db, [task], workspaceId);
  return {
    task: { ...serializeTask(task, names.from, names.to, workspaceId, labels.get(task.id)), sender: senders.get(task.id) ?? null },
    messages: thread.map((message) =>
      serializeMessage(message, nameById.get(message.fromAgentId) ?? 'unknown', nameById.get(message.toAgentId) ?? 'unknown'),
    ),
  };
}
