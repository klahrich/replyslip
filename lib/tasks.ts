import { and, desc, eq, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getDb, type Db } from '@/db';
import { agents, messages, tasks, type AgentRow, type MessageRow, type TaskRow } from '@/db/schema';
import type { AgentPrincipal } from './agents';
import { MESSAGE_BODY_MAX, TASK_DESCRIPTION_MAX, TASK_TITLE_MAX } from './constants';
import { HttpError } from './errors';
import { assertResultSchema, validateResult } from './validate';
import { assertWithinLimit } from './plans';
import { deliverWebhookWake, enqueueWake, type WakeReason } from './wakes';

const CLOSED = new Set(['done', 'failed']);

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

export function serializeTask(task: TaskRow, fromName: string, toName: string) {
  return {
    id: task.id,
    from: fromName,
    to: toName,
    from_agent_id: task.fromAgentId,
    to_agent_id: task.toAgentId,
    title: task.title,
    description: task.description,
    result_schema: task.resultSchema,
    status: task.status,
    result: task.result ?? null,
    question: task.question,
    fail_reason: task.failReason,
    created_at: task.createdAt.toISOString(),
    updated_at: task.updatedAt.toISOString(),
    completed_at: iso(task.completedAt),
  };
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
  const db = getDb();
  const written = await db.transaction(async (tx) => {
    const recipient = await activeAgentByName(tx, caller.workspaceId, input.to);
    if (recipient.id === caller.agentId) {
      throw new HttpError(400, 'invalid_recipient', 'An agent cannot message itself.');
    }
    let taskId: string | null = null;
    if (input.taskId) {
      const task = await loadTask(tx, caller.workspaceId, input.taskId);
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
  input: { to: string; title: string; description: string; resultSchema: unknown },
) {
  if (input.title.trim().length < 1 || input.title.length > TASK_TITLE_MAX) {
    throw new HttpError(400, 'validation_error', `Title must be 1-${TASK_TITLE_MAX} characters.`);
  }
  if (input.description.length < 1 || input.description.length > TASK_DESCRIPTION_MAX) {
    throw new HttpError(400, 'validation_error', `Description must be 1-${TASK_DESCRIPTION_MAX} characters.`);
  }
  const resultSchema = assertResultSchema(input.resultSchema);
  const written = await getDb().transaction(async (tx) => {
    await assertWithinLimit(caller.workspaceId, 'tasks', tx);
    const recipient = await activeAgentByName(tx, caller.workspaceId, input.to);
    if (recipient.id === caller.agentId) {
      throw new HttpError(400, 'invalid_recipient', 'A task needs a different agent. There is no hand-off of your own task.');
    }
    const [task] = await tx
      .insert(tasks)
      .values({
        workspaceId: caller.workspaceId,
        fromAgentId: caller.agentId,
        toAgentId: recipient.id,
        title: input.title.trim(),
        description: input.description,
        resultSchema,
        status: 'open',
      })
      .returning();
    if (!task) throw new HttpError(500, 'internal_error', 'Something went wrong.');
    const wakeId = await enqueueWake(tx, {
      workspaceId: caller.workspaceId,
      agentId: recipient.id,
      reason: 'task',
      taskId: task.id,
    });
    return { payload: serializeTask(task, caller.agentName, recipient.name), wakeId };
  });
  await afterWake(written.wakeId);
  return written.payload;
}

async function loadTask(db: Db, workspaceId: string, taskId: string): Promise<TaskRow> {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)))
    .limit(1);
  if (!task) throw new HttpError(404, 'not_found', 'No task was found.');
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
  const task = await loadTask(db, caller.workspaceId, taskId);
  assertParticipant(task, caller);
  const names = await namesFor(db, task);
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
    task: serializeTask(task, names.from, names.to),
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
  const conditions = [eq(tasks.workspaceId, caller.workspaceId)];
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
  return rows.map((row) => serializeTask(row.task, row.fromName, row.toName));
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
    return { payload: serializeTask(updated, names.from, names.to), wakeId };
  });
  await afterWake(written.wakeId);
  return written.payload;
}

export async function completeTask(caller: AgentPrincipal, taskId: string, result: unknown) {
  const db = getDb();
  const existing = await loadTask(db, caller.workspaceId, taskId);
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
  await assertWithinLimit(caller.workspaceId, 'tasks');
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
  const conditions = [eq(tasks.workspaceId, workspaceId)];
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
  return rows.map((row) => serializeTask(row.task, row.fromName, row.toName));
}

export async function getWorkspaceTask(workspaceId: string, taskId: string) {
  const db = getDb();
  const task = await loadTask(db, workspaceId, taskId);
  const names = await namesFor(db, task);
  const thread = await db
    .select()
    .from(messages)
    .where(eq(messages.taskId, task.id))
    .orderBy(messages.createdAt);
  const nameById = new Map<string, string>([
    [task.fromAgentId, names.from],
    [task.toAgentId, names.to],
  ]);
  return {
    task: serializeTask(task, names.from, names.to),
    messages: thread.map((message) =>
      serializeMessage(message, nameById.get(message.fromAgentId) ?? 'unknown', nameById.get(message.toAgentId) ?? 'unknown'),
    ),
  };
}
