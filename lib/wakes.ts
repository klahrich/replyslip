import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, type DbTx } from '@/db';
import { agents, wakes } from '@/db/schema';
import { WAKE_MAX_ATTEMPTS, WEBHOOK_TIMEOUT_MS } from './constants';
import { HttpError } from './errors';
import { safeEqualString } from './crypto';
import { buildWebhookCall, localNudgeOf } from './delivery';
import { WAKE_NOTICE } from './wake-notice';

export type WakeReason = 'message' | 'task' | 'result' | 'question' | 'failure';

type WakeInsert = {
  workspaceId: string;
  agentId: string;
  reason: WakeReason;
  taskId?: string | null;
  messageId?: string | null;
};

export async function enqueueWake(tx: DbTx, input: WakeInsert): Promise<string | null> {
  const [agent] = await tx.select().from(agents).where(eq(agents.id, input.agentId)).limit(1);
  if (!agent || agent.revokedAt || agent.deliveryMode === 'none') return null;
  const [wake] = await tx
    .insert(wakes)
    .values({
      workspaceId: input.workspaceId,
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
}): string {
  return JSON.stringify({
    id: input.id,
    type: 'replyslip.wake',
    agent: input.agentName,
    reason: input.reason,
    task_id: input.taskId,
    notice: WAKE_NOTICE,
    created_at: input.createdAt.toISOString(),
  });
}

function backoffSeconds(attempts: number): number {
  return Math.min(30 * 2 ** Math.max(0, attempts - 1), 3600);
}

/** Claim a due webhook wake and POST a short notice. Failures stay pending for cron. */
export async function deliverWebhookWake(wakeId: string): Promise<'delivered' | 'pending' | 'skipped'> {
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
  if (!claimed) return 'skipped';

  const [agent] = await db.select().from(agents).where(eq(agents.id, claimed.agentId)).limit(1);
  if (!agent || agent.deliveryMode !== 'webhook' || !agent.webhookUrl) {
    await markFailed(claimed.id, 'Agent has no webhook delivery config.');
    return 'pending';
  }

  try {
    const body = wakeNoticeBody({
      id: claimed.id,
      agentName: agent.name,
      reason: claimed.reason,
      taskId: claimed.taskId,
      createdAt: claimed.createdAt,
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
    if (response.status >= 300 && response.status < 400) {
      throw new Error(`Webhook redirected with HTTP ${response.status}`);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Webhook returned HTTP ${response.status}`);
    }
    await db
      .update(wakes)
      .set({ status: 'delivered', deliveredAt: new Date(), lastError: null })
      .where(and(eq(wakes.id, claimed.id), eq(wakes.status, 'pending')));
    return 'delivered';
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook delivery failed';
    console.error(`[replyslip] webhook wake ${claimed.id} failed: ${message}`);
    if (claimed.attempts >= WAKE_MAX_ATTEMPTS) {
      await markFailed(claimed.id, message);
    } else {
      await db
        .update(wakes)
        .set({
          lastError: message.slice(0, 500),
          nextAttemptAt: new Date(Date.now() + backoffSeconds(claimed.attempts) * 1000),
        })
        .where(and(eq(wakes.id, claimed.id), eq(wakes.status, 'pending')));
    }
    return 'pending';
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
    if (outcome === 'delivered') delivered += 1;
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
    return rows.flatMap((row) => {
      if (exhausted.includes(row.id)) return [];
      const nudge = localNudgeOf(row);
      if (!nudge) return [];
      return [
        {
          id: row.id,
          driver: nudge.driver,
          target: nudge.target,
          pane: nudge.target,
          reason: row.reason,
          task_id: row.taskId,
          agent_name: row.agentName,
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

export function assertCronAuthorized(req: Request): void {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!secret || !token || !safeEqualString(token, secret)) {
    throw new HttpError(401, 'unauthorized', 'Invalid cron secret.');
  }
}
