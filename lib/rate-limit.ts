import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { rateEvents } from '@/db/schema';
import { RATE_LIMITS } from './constants';

export async function consumeRateLimit(input: {
  kind: keyof typeof RATE_LIMITS;
  email?: string;
  ip: string;
}): Promise<{ limited: boolean; retryAfterSeconds: number }> {
  const db = getDb();
  const rule = RATE_LIMITS[input.kind];
  const since = new Date(Date.now() - rule.windowMs);
  await db.delete(rateEvents).where(sql`${rateEvents.createdAt} < now() - interval '1 day'`);

  return db.transaction(async (tx) => {
    const now = Date.now();
    let retryMs = 0;

    if ('email' in rule && input.email) {
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

    const ipRows = await tx
      .select({ createdAt: rateEvents.createdAt })
      .from(rateEvents)
      .where(and(eq(rateEvents.kind, input.kind), eq(rateEvents.ip, input.ip), gte(rateEvents.createdAt, since)))
      .orderBy(asc(rateEvents.createdAt));
    retryMs = Math.max(retryMs, retryDelayMs(ipRows.map((row) => row.createdAt), rule.ip, rule.windowMs, now));

    if (retryMs > 0) {
      return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)) };
    }

    await tx.insert(rateEvents).values({
      kind: input.kind,
      email: input.email ?? null,
      ip: input.ip,
    });
    return { limited: false, retryAfterSeconds: 0 };
  });
}

/** Milliseconds until a sliding window of `limit` events drops below the limit. 0 when another event still fits. */
function retryDelayMs(createdAt: Date[], limit: number, windowMs: number, now: number): number {
  if (createdAt.length < limit) return 0;
  const pivot = createdAt[createdAt.length - limit];
  if (!pivot) return 0;
  return Math.max(0, pivot.getTime() + windowMs - now);
}
