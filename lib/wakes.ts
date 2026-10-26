import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db';
import { agents, tasks, wakes, type AgentRow } from '@/db/schema';
import { WAKE_MAX_ATTEMPTS, WEBHOOK_TIMEOUT_MS } from './constants';
import { HttpError } from './errors';
import { safeEqualString } from './crypto';
import { buildWebhookCall, localNudgeOf } from './delivery';
import { assertPublicWebhookUrl } from './webhook-url';
import { GUEST_WAKE_NOTICE, WAKE_NOTICE } from './wake-notice';

export type WakeReason = 'message' | 'task' | 'result' | 'question' | 'failure' | 'test';

export type WebhookAttempt = {
  outcome: 'delivered' | 'pending' | 'skipped';
  statusCode?: number;
  error?: string;
};

type WakeInsert = {
  workspaceId: string;
  agentId: string;
  reason: WakeReason;
  taskId?: string | null;
  messageId?: string | null;
};

export async function enqueueWake(tx: Db, input: WakeInsert): Promise<string | null> {
  const [agent] = await tx.select().from(agents).where(eq(agents.id, input.agentId)).limit(1);
  if (!agent || agent.revokedAt || agent.deliveryMode === 'none') return null;
  const [wake] = await tx
    .insert(wakes)
    .values({
      workspaceId: agent.workspaceId,
      agentId: input.agentId,
      reason: input.reason,
      taskId: input.taskId ?? null,
      messageId: input.messageId ?? null,
    })
    .returning();
  return wake?.id ?? null;
}

export function wakeNoticeBody(input: {
  id: string;
  agentName: string;
  reason: string;
  taskId: string | null;
  createdAt: Date;
  notice?: string;
}): string {
  return JSON.stringify({
    id: input.id,
    type: 'replyslip.wake',
    agent: input.agentName,
    reason: input.reason,
    task_id: input.taskId,
    notice: input.notice ?? WAKE_NOTICE,
    created_at: input.createdAt.toISOString(),
  });
}

async function noticeForTask(db: Db, taskId: string | null): Promise<string> {
  if (!taskId) return WAKE_NOTICE;
  const [task] = await db
    .select({ fromWorkspaceId: tasks.fromWorkspaceId, workspaceId: tasks.workspaceId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (task?.fromWorkspaceId && task.fromWorkspaceId !== task.workspaceId) return GUEST_WAKE_NOTICE;
  return WAKE_NOTICE;
}

function backoffSeconds(attempts: number): number {
  return Math.min(30 * 2 ** Math.max(0, attempts - 1), 3600);
}

/** Short, secret-free description of a webhook failure. Never includes the URL, a secret, or a response body. */
export function classifyWebhookFailure(err: unknown, statusCode?: number): string {
  if (statusCode !== undefined) return `http ${statusCode}`;
  const codes = new Set<string>();
  const names = new Set<string>();
  const messages: string[] = [];
  const stack: unknown[] = [err];
  const seen = new Set<unknown>();
  while (stack.length > 0) {
    const item = stack.pop();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    if (item instanceof Error) {
      names.add(item.name);
      messages.push(item.message);
    }
    const record = item as { code?: unknown; cause?: unknown; errors?: unknown[] };
    if (typeof record.code === 'string') codes.add(record.code);
    if (record.cause) stack.push(record.cause);
    if (Array.isArray(record.errors)) stack.push(...record.errors);
  }
  const text = messages.join('\n');
  if (
    names.has('TimeoutError') ||
    names.has('AbortError') ||
    codes.has('ABORT_ERR') ||
    codes.has('UND_ERR_CONNECT_TIMEOUT') ||
    /timeout/i.test(text)
  ) {
    return 'timeout';
  }
  if (codes.has('ENOTFOUND') || codes.has('EAI_AGAIN') || /ENOTFOUND|getaddrinfo/i.test(text)) return 'dns';
  if (codes.has('ECONNREFUSED') || /ECONNREFUSED/i.test(text)) return 'connection refused';
  if (/private|loopback/i.test(text)) return 'blocked private address';
  return 'delivery failed';
}

export function publicWakeError(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\bv1\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){2,}/g, '[secret]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [secret]')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 200);
}

/** Claim a due webhook wake and POST a short notice. Failures stay pending for cron. */
export async function deliverWebhookWake(wakeId: string): Promise<WebhookAttempt> {
  const db = getDb();
  const claimed = await db.transaction(async (tx) => {
    const locked = await tx.execute<{ id: string }>(sql`
      select w.id
      from wakes w
      inner join agents a on a.id = w.agent_id
      where w.id = ${wakeId}
        and w.status = 'pending'
        and w.next_attempt_at <= now()
        and a.delivery_mode = 'webhook'
        and a.revoked_at is null
      for update of w
    `);
    if (locked.length === 0) return null;
    const [updated] = await tx
      .update(wakes)
      .set({
        attempts: sql`${wakes.attempts} + 1`,
        nextAttemptAt: sql`now() + interval '2 minutes'`,
      })
      .where(eq(wakes.id, wakeId))
      .returning();
    return updated ?? null;
  });
  if (!claimed) return { outcome: 'skipped' };

  const [agent] = await db.select().from(agents).where(eq(agents.id, claimed.agentId)).limit(1);
  if (!agent || agent.deliveryMode !== 'webhook' || !agent.webhookUrl) {
    await markFailed(claimed.id, 'Agent has no webhook delivery config.');
    return { outcome: 'pending', error: 'delivery failed' };
  }

  try {
    assertPublicWebhookUrl(agent.webhookUrl);
    const body = wakeNoticeBody({
      id: claimed.id,
      agentName: agent.name,
      reason: claimed.reason,
      taskId: claimed.taskId,
      createdAt: claimed.createdAt,
      notice: await noticeForTask(db, claimed.taskId),
    });
    const call = buildWebhookCall(agent, body, claimed.id);
    const response = await fetch(call.url, {
      method: 'POST',
      headers: call.headers,
      body: call.body,
      redirect: 'manual',
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    await response.body?.cancel().catch(() => undefined);
    if (response.status < 200 || response.status >= 300) {
      throw Object.assign(new Error('http'), { statusCode: response.status });
    }
    await db
      .update(wakes)
      .set({ status: 'delivered', deliveredAt: new Date(), lastError: null })
      .where(and(eq(wakes.id, claimed.id), eq(wakes.status, 'pending')));
    return { outcome: 'delivered', statusCode: response.status };
  } catch (err) {
    const statusCode = err && typeof err === 'object' && 'statusCode' in err ? Number((err as { statusCode: unknown }).statusCode) : undefined;
    const error = classifyWebhookFailure(err, Number.isFinite(statusCode) ? statusCode : undefined);
    console.error(`[replyslip] webhook wake ${claimed.id} failed: ${error}`);
    if (claimed.attempts >= WAKE_MAX_ATTEMPTS) {
      await markFailed(claimed.id, error);
    } else {
      await db
        .update(wakes)
        .set({
          lastError: error.slice(0, 200),
          nextAttemptAt: new Date(Date.now() + backoffSeconds(claimed.attempts) * 1000),
        })
        .where(and(eq(wakes.id, claimed.id), eq(wakes.status, 'pending')));
    }
    return { outcome: 'pending', error, ...(Number.isFinite(statusCode) ? { statusCode } : {}) };
  }
}

async function markFailed(wakeId: string, message: string): Promise<void> {
  await getDb()
    .update(wakes)
    .set({ status: 'failed', lastError: message.slice(0, 500) })
    .where(and(eq(wakes.id, wakeId), eq(wakes.status, 'pending')));
}

export async function dispatchDueWebhookWakes(limit = 50): Promise<{ attempted: number; delivered: number }> {
  const db = getDb();
  const due = await db.execute<{ id: string }>(sql`
    select w.id
    from wakes w
    inner join agents a on a.id = w.agent_id
    where w.status = 'pending'
      and w.next_attempt_at <= now()
      and a.delivery_mode = 'webhook'
      and a.revoked_at is null
    order by w.created_at
    limit ${limit}
  `);
  let delivered = 0;
  for (const row of due) {
    const outcome = await deliverWebhookWake(row.id);
    if (outcome.outcome === 'delivered') delivered += 1;
  }
  return { attempted: due.length, delivered };
}

export async function leaseHerdrWakes(workspaceId: string, limit = 20) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const due = await tx.execute<{ id: string }>(sql`
      select w.id
      from wakes w
      inner join agents a on a.id = w.agent_id
      where w.workspace_id = ${workspaceId}
        and w.status = 'pending'
        and w.next_attempt_at <= now()
        and w.attempts < ${WAKE_MAX_ATTEMPTS}
        and a.revoked_at is null
        and (
          (
            a.delivery_mode = 'local'
            and a.local_driver is not null
            and coalesce(nullif(a.local_target, ''), a.herdr_pane) is not null
          )
          or (
            a.delivery_mode = 'herdr'
            and coalesce(nullif(a.local_target, ''), a.herdr_pane) is not null
          )
        )
      order by w.created_at
      limit ${limit}
      for update of w skip locked
    `);
    const ids = due.map((row) => row.id);
    if (ids.length === 0) return [];
    await tx
      .update(wakes)
      .set({
        attempts: sql`${wakes.attempts} + 1`,
        nextAttemptAt: sql`now() + interval '60 seconds'`,
      })
      .where(inArray(wakes.id, ids));
    const rows = await tx
      .select({
        id: wakes.id,
        reason: wakes.reason,
        taskId: wakes.taskId,
        agentName: agents.name,
        deliveryMode: agents.deliveryMode,
        localDriver: agents.localDriver,
        localTarget: agents.localTarget,
        herdrPane: agents.herdrPane,
        attempts: wakes.attempts,
      })
      .from(wakes)
      .innerJoin(agents, eq(agents.id, wakes.agentId))
      .where(inArray(wakes.id, ids));
    const exhausted = rows.filter((row) => row.attempts >= WAKE_MAX_ATTEMPTS).map((row) => row.id);
    if (exhausted.length > 0) {
      await tx
        .update(wakes)
        .set({ status: 'failed', lastError: 'Herdr watcher did not acknowledge the wake.' })
        .where(inArray(wakes.id, exhausted));
    }
    const taskIds = rows.flatMap((row) => (row.taskId ? [row.taskId] : []));
    const guestTaskIds = new Set<string>();
    if (taskIds.length > 0) {
      const found = await tx
        .select({ id: tasks.id, fromWorkspaceId: tasks.fromWorkspaceId, workspaceId: tasks.workspaceId })
        .from(tasks)
        .where(inArray(tasks.id, taskIds));
      for (const task of found) {
        if (task.fromWorkspaceId && task.fromWorkspaceId !== task.workspaceId) guestTaskIds.add(task.id);
      }
    }
    return rows.flatMap((row) => {
      if (exhausted.includes(row.id)) return [];
      const nudge = localNudgeOf(row);
      if (!nudge) return [];
      const guest = row.taskId != null && guestTaskIds.has(row.taskId);
      return [
        {
          id: row.id,
          driver: nudge.driver,
          target: nudge.target,
          pane: nudge.target,
          reason: row.reason,
          task_id: row.taskId,
          agent_name: row.agentName,
          ...(guest ? { notice: GUEST_WAKE_NOTICE } : {}),
        },
      ];
    });
  });
}

export async function ackWakes(workspaceId: string, wakeIds: string[]): Promise<number> {
  if (wakeIds.length === 0) return 0;
  const updated = await getDb()
    .update(wakes)
    .set({ status: 'delivered', deliveredAt: new Date(), lastError: null })
    .where(and(eq(wakes.workspaceId, workspaceId), inArray(wakes.id, wakeIds), eq(wakes.status, 'pending')))
    .returning({ id: wakes.id });
  return updated.length;
}

export async function createTestWake(agent: AgentRow): Promise<string> {
  if (agent.revokedAt) throw new HttpError(409, 'agent_revoked', 'This agent has been revoked.');
  if (agent.deliveryMode === 'none') {
    throw new HttpError(
      400,
      'delivery_none',
      'This agent has delivery mode none, so there is nothing to wake. Set webhook or local delivery first.',
    );
  }
  if (agent.deliveryMode === 'webhook' && !agent.webhookUrl) {
    throw new HttpError(400, 'invalid_webhook_url', 'This agent has no webhook URL.');
  }
  if ((agent.deliveryMode === 'local' || agent.deliveryMode === 'herdr') && !localNudgeOf(agent)) {
    throw new HttpError(400, 'invalid_delivery', 'This agent has no local driver and target.');
  }
  const [wake] = await getDb()
    .insert(wakes)
    .values({
      workspaceId: agent.workspaceId,
      agentId: agent.id,
      reason: 'test',
      taskId: null,
      messageId: null,
    })
    .returning();
  if (!wake) throw new HttpError(500, 'internal_error', 'Something went wrong.');
  return wake.id;
}

export async function getAgentWake(workspaceId: string, agentId: string, wakeId: string) {
  const [wake] = await getDb()
    .select()
    .from(wakes)
    .where(and(eq(wakes.id, wakeId), eq(wakes.agentId, agentId), eq(wakes.workspaceId, workspaceId)))
    .limit(1);
  if (!wake) throw new HttpError(404, 'not_found', 'No wake was found.');
  return {
    id: wake.id,
    agent_id: wake.agentId,
    status: wake.status,
    reason: wake.reason,
    task_id: wake.taskId,
    attempts: wake.attempts,
    last_error: publicWakeError(wake.lastError),
    delivered_at: wake.deliveredAt?.toISOString() ?? null,
    created_at: wake.createdAt.toISOString(),
  };
}

export type AgentWakeActivity = {
  last_delivered_at: string | null;
  last_failed_at: string | null;
  last_error: string | null;
};

function isoTime(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function agentWakeActivity(workspaceId: string): Promise<Map<string, AgentWakeActivity>> {
  const db = getDb();
  const delivered = await db.execute<{ agent_id: string; last_delivered_at: Date | string | null }>(sql`
    select agent_id, max(delivered_at) as last_delivered_at
    from wakes
    where workspace_id = ${workspaceId} and status = 'delivered'
    group by agent_id
  `);
  const failed = await db.execute<{ agent_id: string; last_failed_at: Date | string; last_error: string | null }>(sql`
    select distinct on (agent_id) agent_id, created_at as last_failed_at, last_error
    from wakes
    where workspace_id = ${workspaceId} and status = 'failed'
    order by agent_id, created_at desc
  `);
  const map = new Map<string, AgentWakeActivity>();
  for (const row of delivered) {
    map.set(row.agent_id, {
      last_delivered_at: isoTime(row.last_delivered_at),
      last_failed_at: null,
      last_error: null,
    });
  }
  for (const row of failed) {
    const current = map.get(row.agent_id) ?? { last_delivered_at: null, last_failed_at: null, last_error: null };
    current.last_failed_at = isoTime(row.last_failed_at);
    current.last_error = publicWakeError(row.last_error);
    map.set(row.agent_id, current);
  }
  return map;
}

export function assertCronAuthorized(req: Request): void {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!secret || !token || !safeEqualString(token, secret)) {
    throw new HttpError(401, 'unauthorized', 'Invalid cron secret.');
  }
}
