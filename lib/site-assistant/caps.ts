import { sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { keyedHash } from '@/lib/crypto';
import { siteGlobalDailyCostCapMicroUsd, siteIpDailyLimits } from './config';
import type { CapDecision } from './answer';

/** UTC day key for the usage tables. Reserve and settle use the same key even across midnight. */
export function usageDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export type CapLimits = {
  visitorDailyMessages: number;
  ipLinkDailyMessages: number;
  ipAllDailyMessages: number;
  businessDailyMessages: number;
  businessDailyCostMicroUsd: number;
  globalDailyCostMicroUsd: number;
};

export function capLimitsFor(business: {
  visitorDailyMessageCap: number;
  dailyMessageCap: number;
  dailyCostCapMicroUsd: number;
}): CapLimits {
  const ip = siteIpDailyLimits();
  return {
    visitorDailyMessages: business.visitorDailyMessageCap,
    ipLinkDailyMessages: ip.perLink,
    ipAllDailyMessages: ip.all,
    businessDailyMessages: business.dailyMessageCap,
    businessDailyCostMicroUsd: business.dailyCostCapMicroUsd,
    globalDailyCostMicroUsd: siteGlobalDailyCostCapMicroUsd(),
  };
}

/** HMAC keys for the per-IP counts: this IP on this demo link, and this IP on every demo link. */
export type IpKeys = { link: string; all: string };

export function ipKeysFor(ip: string, demoLinkId: string): IpKeys {
  return { link: keyedHash('site-ip-link', `${demoLinkId}|${ip}`), all: keyedHash('site-ip-all', ip) };
}

class CapHit extends Error {
  constructor(readonly decidedBy: Extract<CapDecision, { ok: false }>['decidedBy']) {
    super(decidedBy);
  }
}

/**
 * Takes one visitor message against the visitor and business message caps, and reserves `costMicroUsd` (the
 * worst case of the coming model call, 0 when no call is made) against the business cost cap, then the global
 * one. One transaction of conditional upserts: each row is locked by its ON CONFLICT DO UPDATE, so two requests
 * at once can't both pass the last slot. Any cap hit rolls the whole thing back.
 *
 * `messages: 0` reserves cost only (a second call for a message already counted).
 */
export async function reserveSiteUsage(
  db: Db,
  input: {
    businessId: string;
    conversationId: string;
    /** Required when messages is 1. */
    ipKeys?: IpKeys;
    day: string;
    messages: 0 | 1;
    costMicroUsd: number;
    limits: CapLimits;
  },
): Promise<CapDecision> {
  const { businessId, conversationId, day, messages, limits } = input;
  if (messages > 0 && !input.ipKeys) throw new Error('reserveSiteUsage: ipKeys are required to count a message');
  const cost = Math.max(0, Math.ceil(input.costMicroUsd));
  try {
    await db.transaction(async (tx) => {
      if (messages > 0) {
        if (limits.visitorDailyMessages < 1) throw new CapHit('cap_visitor');
        const visitor = await tx.execute(sql`
          insert into site_visitor_usage_daily (conversation_id, business_id, day, messages)
          values (${conversationId}, ${businessId}, ${day}, 1)
          on conflict (conversation_id, day) do update set messages = site_visitor_usage_daily.messages + 1
          where site_visitor_usage_daily.messages + 1 <= ${limits.visitorDailyMessages}
          returning messages`);
        if (visitor.length === 0) throw new CapHit('cap_visitor');

        // Per IP, so a cleared cookie doesn't reset the count: this link first, then all links.
        for (const [key, max, reason] of [
          [input.ipKeys!.link, limits.ipLinkDailyMessages, 'cap_ip_link'],
          [input.ipKeys!.all, limits.ipAllDailyMessages, 'cap_ip_all'],
        ] as const) {
          if (max < 1) throw new CapHit(reason);
          const ipRow = await tx.execute(sql`
            insert into site_ip_usage_daily (key_hash, day, messages)
            values (${key}, ${day}, 1)
            on conflict (key_hash, day) do update set messages = site_ip_usage_daily.messages + 1
            where site_ip_usage_daily.messages + 1 <= ${max}
            returning messages`);
          if (ipRow.length === 0) throw new CapHit(reason);
        }
      }

      // Per-business caps before the global one.
      if (messages > 0 && limits.businessDailyMessages < 1) throw new CapHit('cap_business_messages');
      if (cost > limits.businessDailyCostMicroUsd) throw new CapHit('cap_business_cost');
      const business = await tx.execute(sql`
        insert into site_usage_daily (business_id, day, messages, reserved_micro_usd)
        values (${businessId}, ${day}, ${messages}, ${cost})
        on conflict (business_id, day) do update set
          messages = site_usage_daily.messages + excluded.messages,
          reserved_micro_usd = site_usage_daily.reserved_micro_usd + excluded.reserved_micro_usd
        where site_usage_daily.messages + excluded.messages <= ${limits.businessDailyMessages}
          and site_usage_daily.cost_micro_usd + site_usage_daily.reserved_micro_usd + excluded.reserved_micro_usd
            <= ${limits.businessDailyCostMicroUsd}
        returning messages, cost_micro_usd, reserved_micro_usd`);
      if (business.length === 0) {
        // Tell the two business caps apart for the stored decided_by.
        const [row] = await tx.execute<{ messages: number }>(sql`
          select messages from site_usage_daily where business_id = ${businessId} and day = ${day}`);
        throw new CapHit(row && Number(row.messages) + messages > limits.businessDailyMessages ? 'cap_business_messages' : 'cap_business_cost');
      }

      if (cost > 0) {
        if (cost > limits.globalDailyCostMicroUsd) throw new CapHit('cap_global_cost');
        const global = await tx.execute(sql`
          insert into site_usage_global_daily (day, reserved_micro_usd)
          values (${day}, ${cost})
          on conflict (day) do update set
            reserved_micro_usd = site_usage_global_daily.reserved_micro_usd + excluded.reserved_micro_usd
          where site_usage_global_daily.cost_micro_usd + site_usage_global_daily.reserved_micro_usd
            + excluded.reserved_micro_usd <= ${limits.globalDailyCostMicroUsd}
          returning day`);
        if (global.length === 0) throw new CapHit('cap_global_cost');
      }
    });
  } catch (err) {
    if (err instanceof CapHit) return { ok: false, decidedBy: err.decidedBy };
    throw err;
  }
  return { ok: true };
}

/**
 * Replaces a reservation with the actual usage of the call (0 tokens when the call failed before usage).
 * Run once per successful reservation, whatever the call's outcome.
 */
export async function settleSiteUsage(
  db: Db,
  input: {
    businessId: string;
    day: string;
    reservedMicroUsd: number;
    actualMicroUsd: number;
    inputTokens: number;
    outputTokens: number;
    llmCalled: boolean;
  },
): Promise<void> {
  const reserved = Math.max(0, Math.ceil(input.reservedMicroUsd));
  const actual = Math.max(0, Math.ceil(input.actualMicroUsd));
  const calls = input.llmCalled ? 1 : 0;
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      update site_usage_daily set
        reserved_micro_usd = greatest(0, reserved_micro_usd - ${reserved}),
        cost_micro_usd = cost_micro_usd + ${actual},
        input_tokens = input_tokens + ${input.inputTokens},
        output_tokens = output_tokens + ${input.outputTokens},
        llm_calls = llm_calls + ${calls}
      where business_id = ${input.businessId} and day = ${input.day}`);
    await tx.execute(sql`
      insert into site_usage_global_daily (day, reserved_micro_usd, cost_micro_usd, llm_calls)
      values (${input.day}, 0, ${actual}, ${calls})
      on conflict (day) do update set
        reserved_micro_usd = greatest(0, site_usage_global_daily.reserved_micro_usd - ${reserved}),
        cost_micro_usd = site_usage_global_daily.cost_micro_usd + ${actual},
        llm_calls = site_usage_global_daily.llm_calls + ${calls}`);
  });
}

/**
 * Undoes a reservation that never reached settle: a message the cost cap refused after it was counted, or a
 * request that threw mid-reply. `messages: 1` gives back the visitor, IP and business message counts;
 * `reservedMicroUsd` gives back in-flight cost on the business and global rows.
 */
export async function releaseSiteUsage(
  db: Db,
  input: {
    businessId: string;
    conversationId: string;
    ipKeys: IpKeys;
    day: string;
    messages: 0 | 1;
    reservedMicroUsd: number;
  },
): Promise<void> {
  const reserved = Math.max(0, Math.ceil(input.reservedMicroUsd));
  const messages = input.messages;
  if (messages === 0 && reserved === 0) return;
  await db.transaction(async (tx) => {
    if (messages > 0) {
      await tx.execute(sql`
        update site_visitor_usage_daily set messages = greatest(0, messages - 1)
        where conversation_id = ${input.conversationId} and day = ${input.day}`);
      await tx.execute(sql`
        update site_ip_usage_daily set messages = greatest(0, messages - 1)
        where key_hash in (${input.ipKeys.link}, ${input.ipKeys.all}) and day = ${input.day}`);
    }
    await tx.execute(sql`
      update site_usage_daily set
        messages = greatest(0, messages - ${messages}),
        reserved_micro_usd = greatest(0, reserved_micro_usd - ${reserved})
      where business_id = ${input.businessId} and day = ${input.day}`);
    if (reserved > 0) {
      await tx.execute(sql`
        update site_usage_global_daily set reserved_micro_usd = greatest(0, reserved_micro_usd - ${reserved})
        where day = ${input.day}`);
    }
  });
}

/** Seconds until the next UTC midnight, when the daily counts start over (at least 1). */
export function secondsUntilUtcMidnight(now = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

/** Per-IP rows are only needed for today; anything older than `keepDays` days goes. */
export async function deleteOldIpUsage(db: Db, keepDays = 2): Promise<number> {
  const rows = await db.execute(sql`
    delete from site_ip_usage_daily where day < (now() at time zone 'utc')::date - ${keepDays}::int returning day`);
  return rows.length;
}
