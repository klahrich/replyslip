import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db';
import { rateEvents } from '@/db/schema';
import { RATE_LIMITS } from './constants';

type RateRule = { windowMs: number; email?: number; ip?: number; agent?: number };

export async function consumeRateLimit(input: {
  kind: keyof typeof RATE_LIMITS;
  email?: string;
  ip?: string;
  /** Per-agent limits store the agent id in rate_events.email. That column has no other meaning for those kinds. */
  agentId?: string;
}): Promise<{ limited: boolean; retryAfterSeconds: number }> {
  const db = getDb();
  const rule = RATE_LIMITS[input.kind] as RateRule;
  const since = new Date(Date.now() - rule.windowMs);
  await db.delete(rateEvents).where(sql`${rateEvents.createdAt} < now() - interval '1 day'`);

  return db.transaction(async (tx) => {
    const now = Date.now();
    let retryMs = 0;

    if (rule.email !== undefined && input.email) {
      const emailRows = await tx
        .select({ createdAt: rateEvents.createdAt })
        .from(rateEvents)
        .where(
          and(
            eq(rateEvents.kind, input.kind),
            eq(rateEvents.email, input.email),
            gte(rateEvents.createdAt, since),
          ),
        )
        .orderBy(asc(rateEvents.createdAt));
      retryMs = Math.max(retryMs, retryDelayMs(emailRows.map((row) => row.createdAt), rule.email, rule.windowMs, now));
    }

    if (rule.agent !== undefined) {
      if (!input.agentId) throw new Error('agentId is required for this rate limit');
      const agentRows = await tx
        .select({ createdAt: rateEvents.createdAt })
        .from(rateEvents)
        .where(
          and(
            eq(rateEvents.kind, input.kind),
            eq(rateEvents.email, input.agentId),
            gte(rateEvents.createdAt, since),
          ),
        )
        .orderBy(asc(rateEvents.createdAt));
      retryMs = Math.max(retryMs, retryDelayMs(agentRows.map((row) => row.createdAt), rule.agent, rule.windowMs, now));
    }

    if (rule.ip !== undefined) {
      if (!input.ip) throw new Error('ip is required for this rate limit');
      const ipRows = await tx
        .select({ createdAt: rateEvents.createdAt })
        .from(rateEvents)
        .where(and(eq(rateEvents.kind, input.kind), eq(rateEvents.ip, input.ip), gte(rateEvents.createdAt, since)))
        .orderBy(asc(rateEvents.createdAt));
      retryMs = Math.max(retryMs, retryDelayMs(ipRows.map((row) => row.createdAt), rule.ip, rule.windowMs, now));
    }

    if (retryMs > 0) {
      return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)) };
    }

    await tx.insert(rateEvents).values({
      kind: input.kind,
      email: rule.agent !== undefined ? (input.agentId ?? null) : (input.email ?? null),
      ip: input.ip ?? null,
    });
    return { limited: false, retryAfterSeconds: 0 };
  });
}

/**
 * Sliding window for a per-row cap, such as a share's daily guest-task limit.
 * The caller holds the row lock. `key` is stored in rate_events.email. A full window inserts nothing.
 */
export async function consumeKeyedRateLimit(
  tx: Db,
  input: { kind: string; key: string; limit: number; windowMs: number },
): Promise<{ limited: boolean; retryAfterSeconds: number }> {
  const since = new Date(Date.now() - input.windowMs);
  await tx
    .delete(rateEvents)
    .where(and(eq(rateEvents.kind, input.kind), sql`${rateEvents.createdAt} < now() - interval '1 day'`));
  const rows = await tx
    .select({ createdAt: rateEvents.createdAt })
    .from(rateEvents)
    .where(and(eq(rateEvents.kind, input.kind), eq(rateEvents.email, input.key), gte(rateEvents.createdAt, since)))
    .orderBy(asc(rateEvents.createdAt));
  if (rows.length >= input.limit) {
    const retryMs = retryDelayMs(
      rows.map((row) => row.createdAt),
      input.limit,
      input.windowMs,
      Date.now(),
    );
    return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil((retryMs || input.windowMs) / 1000)) };
  }
  await tx.insert(rateEvents).values({ kind: input.kind, email: input.key, ip: null });
  return { limited: false, retryAfterSeconds: 0 };
}

/** Milliseconds until a sliding window of `limit` events drops below the limit. 0 when another event still fits. */
function retryDelayMs(createdAt: Date[], limit: number, windowMs: number, now: number): number {
  if (createdAt.length < limit) return 0;
  const pivot = createdAt[createdAt.length - limit];
  if (!pivot) return 0;
  return Math.max(0, pivot.getTime() + windowMs - now);
}
