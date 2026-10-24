import { and, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { rateEvents } from '@/db/schema';
import { RATE_LIMITS } from './constants';

export async function consumeRateLimit(input: {
  kind: keyof typeof RATE_LIMITS;
  email?: string;
  ip: string;
}): Promise<{ limited: boolean }> {
  const db = getDb();
  const rule = RATE_LIMITS[input.kind];
  const since = new Date(Date.now() - rule.windowMs);
  await db
    .delete(rateEvents)
    .where(sql`${rateEvents.createdAt} < now() - interval '1 day'`);
  await db.insert(rateEvents).values({
    kind: input.kind,
    email: input.email ?? null,
    ip: input.ip,
  });

  if ('email' in rule && input.email) {
    const emailRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(rateEvents)
      .where(
        and(
          eq(rateEvents.kind, input.kind),
          eq(rateEvents.email, input.email),
          gte(rateEvents.createdAt, since),
        ),
      );
    if (Number(emailRows[0]?.count ?? 0) > rule.email) {
      return { limited: true };
    }
  }

  const ipRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(rateEvents)
    .where(
      and(eq(rateEvents.kind, input.kind), eq(rateEvents.ip, input.ip), gte(rateEvents.createdAt, since)),
    );
  if (Number(ipRows[0]?.count ?? 0) > rule.ip) {
    return { limited: true };
  }
  return { limited: false };
}
