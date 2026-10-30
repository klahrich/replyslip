import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getDb, type Db } from '@/db';
import { agentOffers, agents, messages, tasks, workspaces, type AgentRow, type MessageRow, type TaskRow } from '@/db/schema';
import type { AgentPrincipal } from './agents';
import { MESSAGE_BODY_MAX } from './constants';
import { HttpError } from './errors';
import { assertResultSchema, validateResult } from './validate';
import { assertWithinLimit } from './plans';
import { assertFreeTextFields, parseRecipient, resolveSharedTask } from './sharing';
import { CROSS_WORKSPACE_TASK_NOTICE } from './wake-notice';
import { deliverWebhookWake, enqueueWake, type WakeReason } from './wakes';

const CLOSED = new Set(['done', 'failed']);

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

export function serializeTask(task: TaskRow, fromName: string, toName: string, labels?: TaskLabels) {
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
  };
}

async function labelsFor(db: Db, rows: TaskRow[]): Promise<Map<string, TaskLabels>> {
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
  if (!agent || agent.revokedAt) {
    throw new HttpError(404, 'agent_not_found', `No active agent named ${name} is in this workspace.`);
  }
  return agent;
}

async function namesFor(db: Db, task: TaskRow): Promise<{ from: string; to: string }> {
  const from = await agentById(db, task.fromAgentId);
  const to = await agentById(db, task.toAgentId);
  return { from: from?.name ?? 'unknown', to: to?.name ?? 'unknown' };
}

async function afterWake(wakeId: string | null): Promise<void> {
  if (!wakeId) return;
  await deliverWebhookWake(wakeId);
}

export async function sendMessage(
  caller: AgentPrincipal,
  input: { to: string; body: string; taskId?: string },
) {
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
      const otherId = task.fromAgentId === caller.agentId ? task.toAgentId : task.fromAgentId;
      if (recipient.id !== otherId) {
        throw new HttpError(400, 'invalid_recipient', 'A task-thread message can only go to the other participant.');
      }
      taskId = task.id;
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
  input: { to: string; title?: string; description?: string; input?: unknown; resultSchema?: unknown; offer?: string },
) {
  const address = parseRecipient(input.to);
  // In-workspace tasks are always free text (input_not_allowed). A shared offer decides in resolveSharedTask.
  const workspaceFields = address.kind === 'workspace' ? assertFreeTextFields(input) : null;
  const written = await getDb().transaction(async (tx) => {
    // The monthly cap is the sender's. A guest task is stored in the owner's workspace
    // so the shared agent's wakes and complete path stay the same, and from_workspace_id
    // is what countTasksThisMonth charges.
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
        status: 'open',
      })
      .returning();
    if (!task) throw new HttpError(500, 'internal_error', 'Something went wrong.');
    const wakeId = await enqueueWake(tx, {
      workspaceId,
      agentId: recipient.id,
      reason: 'task',
      taskId: task.id,
    });
    const labels = await labelsFor(tx, [task]);
    return { payload: serializeTask(task, caller.agentName, recipient.name, labels.get(task.id)), wakeId };
  });
  await afterWake(written.wakeId);
  return written.payload;
}

async function loadTask(db: Db, workspaceId: string, taskId: string): Promise<TaskRow> {
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
}

function assertTarget(task: TaskRow, caller: AgentPrincipal): void {
  assertParticipant(task, caller);
  if (task.toAgentId !== caller.agentId) {
    throw new HttpError(403, 'forbidden', 'Only the target agent can close or question this task.');
  }
  if (CLOSED.has(task.status)) {
    throw new HttpError(409, 'task_closed', `This task is already ${task.status}.`);
  }
}

export async function getTask(caller: AgentPrincipal, taskId: string) {
  const db = getDb();
  const task = await loadVisibleTask(db, caller, taskId);
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
    task: serializeTask(task, names.from, names.to, labels.get(task.id)),
    messages: thread.map((message) =>
      serializeMessage(message, nameById.get(message.fromAgentId) ?? 'unknown', nameById.get(message.toAgentId) ?? 'unknown'),
    ),
  };
}

export async function listTasks(
  caller: AgentPrincipal,
  filter: { status?: string; role?: 'sent' | 'received' | 'any' },
) {
  const role = filter.role ?? 'any';
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
  const rows = await getDb()
    .select({
      task: tasks,
      fromName: fromAgent.name,
      toName: toAgent.name,
    })
    .from(tasks)
    .innerJoin(fromAgent, eq(fromAgent.id, tasks.fromAgentId))
    .innerJoin(toAgent, eq(toAgent.id, tasks.toAgentId))
    .where(and(...conditions))
    .orderBy(desc(tasks.createdAt))
    .limit(100);
  const labels = await labelsFor(
    getDb(),
    rows.map((row) => row.task),
  );
  return rows.map((row) => serializeTask(row.task, row.fromName, row.toName, labels.get(row.task.id)));
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
  },
) {
  const written = await getDb().transaction(async (tx) => {
    await tx.execute(sql`select id from tasks where id = ${taskId} and workspace_id = ${caller.workspaceId} for update`);
    const task = await loadTask(tx, caller.workspaceId, taskId);
    assertTarget(task, caller);
    const change = mutate(task);
    const now = new Date();
    const [updated] = await tx
      .update(tasks)
      .set({
        status: change.status,
        result: change.result === undefined ? task.result : change.result,
        question: change.question === undefined ? task.question : change.question,
        failReason: change.failReason === undefined ? task.failReason : change.failReason,
        updatedAt: now,
        completedAt: change.completed ? now : task.completedAt,
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
    const wakeId = await enqueueWake(tx, {
      workspaceId: caller.workspaceId,
      agentId: updated.fromAgentId,
      reason: change.reason,
      taskId: updated.id,
    });
    const names = await namesFor(tx, updated);
    const labels = await labelsFor(tx, [updated]);
    return { payload: serializeTask(updated, names.from, names.to, labels.get(updated.id)), wakeId };
  });
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
  }));
}

export async function listWorkspaceTasks(workspaceId: string, status: string | undefined, limit: number) {
  const fromAgent = alias(agents, 'from_agent');
  const toAgent = alias(agents, 'to_agent');
  const visible = or(eq(tasks.workspaceId, workspaceId), eq(tasks.fromWorkspaceId, workspaceId));
  const conditions = visible ? [visible] : [];
  if (status) conditions.push(eq(tasks.status, status));
  const rows = await getDb()
    .select({
      task: tasks,
      fromName: fromAgent.name,
      toName: toAgent.name,
    })
    .from(tasks)
    .innerJoin(fromAgent, eq(fromAgent.id, tasks.fromAgentId))
    .innerJoin(toAgent, eq(toAgent.id, tasks.toAgentId))
    .where(and(...conditions))
    .orderBy(desc(tasks.createdAt))
    .limit(limit);
  const labels = await labelsFor(
    getDb(),
    rows.map((row) => row.task),
  );
  return rows.map((row) => serializeTask(row.task, row.fromName, row.toName, labels.get(row.task.id)));
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
  return {
    task: serializeTask(task, names.from, names.to, labels.get(task.id)),
    messages: thread.map((message) =>
      serializeMessage(message, nameById.get(message.fromAgentId) ?? 'unknown', nameById.get(message.toAgentId) ?? 'unknown'),
    ),
  };
}
