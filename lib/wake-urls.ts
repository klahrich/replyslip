import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { rateEvents, wakeUrls } from '@/db/schema';
import { authenticateAgentKey, getAgent } from './agents';
import { requireHumanOwner, requireUser } from './auth';
import { keyedHash, randomToken, sha256, tokenPrefix } from './crypto';
import { HttpError, isUniqueViolation } from './errors';
import { bearerToken } from './http';
import { absoluteUrl, clientIp } from './origin';

/**
 * Public wake URLs. GET /api/v1/wake/<token> answers only {"id": "<opaque>"}. The id changes whenever a wake row is
 * written for the URL's subject (a task, message, answer, result, question, failure, review or test wake), so an
 * outside platform that cannot hold a secret knows when to fetch the real content through MCP with OAuth.
 *
 * The token is 256 random bits and only its sha256 is stored. Unknown and revoked tokens take the same path and give
 * the same 404.
 */

export const WAKE_URL_TOKEN_PREFIX = 'rwu_';
export const WAKE_URL_PATH = '/api/v1/wake/';
/** Short client cache. Polls inside it never reach us; after it, If-None-Match gets a body-less 304. */
export const WAKE_POLL_CACHE_CONTROL = 'private, max-age=10';
const NO_STORE = 'no-store';
const ID_PURPOSE = 'wake_url_id';
const IP_PURPOSE = 'wake_url_ip';

/**
 * Poll limits. Valid tokens are limited per token only: one platform (Muse, say) polls every user's URL from a few
 * server addresses, so a per-IP cap on good polls would throttle all of them together. The per-IP limit counts only
 * misses (unknown or revoked tokens): that is what token guessing or a client stuck on dead URLs looks like, and a
 * legitimate client almost never misses. A 256-bit token cannot be guessed anyway, so the miss cap is about load.
 *
 * The per-token count is a fixed window kept on the wake_urls row (poll_window_started_at, poll_count), bumped by the
 * same UPDATE that finds the token. A good poll therefore never inserts a row: one indexed UPDATE plus the marker read.
 * Misses are rare, so they go to rate_events like other limits. Not in-memory: on Vercel every concurrent request can
 * land on a different, short-lived instance, so a per-instance bucket would multiply the limit by the instance count
 * and reset on every cold start.
 */
export const WAKE_POLL_LIMITS = {
  /** Polls per token per window: one every 3 seconds. */
  perToken: 300,
  /** Unknown or revoked token lookups per IP (keyed hash) per window. */
  missesPerIp: 600,
  windowSeconds: 15 * 60,
} as const;
const MISS_KIND = 'wakeMiss';
/**
 * The marker counts wake rows from this long before the newest one. A wake row written by a transaction that commits
 * after a newer row still changes the count, as long as its transaction took less than this.
 */
const MARKER_LATE_COMMIT_WINDOW = '5 minutes';

/**
 * Whose wakes a URL reports. Every query below goes through this type, so another scope (for example a whole
 * workspace) is a new variant here plus its wakeMarker branch.
 */
export type WakeSubject = { kind: 'agent'; workspaceId: string; agentId: string };

type WakeUrlRow = typeof wakeUrls.$inferSelect;

function subjectKey(subject: WakeSubject): string {
  return `agent:${subject.agentId}`;
}

export function wakeUrlFor(origin: string, token: string): string {
  return absoluteUrl(origin, `${WAKE_URL_PATH}${token}`);
}

export function serializeWakeUrl(row: WakeUrlRow) {
  return {
    id: row.id,
    agent_id: row.agentId,
    prefix: row.tokenPrefix,
    created_at: row.createdAt.toISOString(),
    revoked_at: row.revokedAt?.toISOString() ?? null,
    last_used_at: row.lastUsedAt?.toISOString() ?? null,
    status: row.revokedAt ? 'revoked' : 'active',
  };
}

/**
 * Change marker: the newest wake row's created_at (microseconds, as text) and how many of the subject's wake rows
 * fall in the few minutes up to it. Both bounds come from the wakes_agent_created_idx index, so the cost does not grow
 * with the agent's history. The count catches a row whose created_at is older than the newest but committed later.
 */
export async function wakeMarker(subject: WakeSubject): Promise<string> {
  const rows = await getDb().execute<{ n: number; last: string | null }>(sql`
    with newest as (select max(created_at) as last from wakes where agent_id = ${subject.agentId})
    select newest.last::text as last,
      (select count(*)::int from wakes w
        where w.agent_id = ${subject.agentId}
          and w.created_at >= newest.last - ${MARKER_LATE_COMMIT_WINDOW}::interval) as n
    from newest
  `);
  const row = rows[0];
  return `${row?.n ?? 0}|${row?.last ?? ''}`;
}

/**
 * The opaque id: an HMAC (ENCRYPTION_KEY) of the URL id, the subject and the marker. Never a task id. The URL id is
 * in it, so a rotated URL starts on a new id and two URLs never share ids.
 */
export function wakeChangeId(wakeUrlId: string, subject: WakeSubject, marker: string): string {
  return keyedHash(ID_PURPOSE, `${wakeUrlId}\u0000${subjectKey(subject)}\u0000${marker}`).slice(0, 32);
}

type PollHit = { id: string; workspace_id: string; agent_id: string; poll_count: number; retry_after: number };

/**
 * Finds an active URL whose agent is not revoked and counts the poll against it, in one UPDATE. Null for unknown and
 * revoked tokens alike.
 */
async function countPoll(token: string): Promise<PollHit | null> {
  const rows = await getDb().execute<PollHit>(sql`
    update wake_urls u set
      poll_count = case when u.poll_window_started_at is null
          or u.poll_window_started_at <= now() - make_interval(secs => ${WAKE_POLL_LIMITS.windowSeconds})
        then 1 else u.poll_count + 1 end,
      poll_window_started_at = case when u.poll_window_started_at is null
          or u.poll_window_started_at <= now() - make_interval(secs => ${WAKE_POLL_LIMITS.windowSeconds})
        then now() else u.poll_window_started_at end,
      last_used_at = now()
    from agents a
    where u.token_hash = ${sha256(token)}
      and u.revoked_at is null
      and a.id = u.agent_id
      and a.revoked_at is null
    returning u.id, u.workspace_id, u.agent_id, u.poll_count,
      greatest(1, ceil(extract(epoch from
        u.poll_window_started_at + make_interval(secs => ${WAKE_POLL_LIMITS.windowSeconds}) - now())))::int as retry_after
  `);
  return rows[0] ?? null;
}

/** True when this IP (keyed hash) already has the maximum misses in the window. Reads only. */
async function ipOverMissLimit(ipKey: string): Promise<{ limited: boolean; retryAfter: number }> {
  const rows = await getDb().execute<{ n: number; oldest: string | null }>(sql`
    select count(*)::int as n, min(created_at)::text as oldest from (
      select created_at from rate_events
      where kind = ${MISS_KIND} and ip = ${ipKey}
        and created_at > now() - make_interval(secs => ${WAKE_POLL_LIMITS.windowSeconds})
      order by created_at desc
      limit ${WAKE_POLL_LIMITS.missesPerIp}
    ) recent
  `);
  const row = rows[0];
  if (!row || row.n < WAKE_POLL_LIMITS.missesPerIp || !row.oldest) return { limited: false, retryAfter: 0 };
  const retryMs = new Date(row.oldest).getTime() + WAKE_POLL_LIMITS.windowSeconds * 1000 - Date.now();
  return { limited: true, retryAfter: Math.max(1, Math.ceil(retryMs / 1000)) };
}

async function recordMiss(ipKey: string): Promise<void> {
  const db = getDb();
  await db.insert(rateEvents).values({ kind: MISS_KIND, ip: ipKey });
  await db.delete(rateEvents).where(
    and(eq(rateEvents.kind, MISS_KIND), sql`${rateEvents.createdAt} < now() - interval '1 day'`),
  );
}

function baseHeaders(cacheControl: string): Headers {
  return new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': cacheControl,
    'x-robots-tag': 'noindex, nofollow',
    'referrer-policy': 'no-referrer',
  });
}

function notFound(): Response {
  return new Response(JSON.stringify({ error: { code: 'not_found', message: 'Not found.' } }), {
    status: 404,
    headers: baseHeaders(NO_STORE),
  });
}

function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  const bare = etag.replace(/^W\//, '');
  return header
    .split(',')
    .map((part) => part.trim())
    .some((part) => part === '*' || part.replace(/^W\//, '') === bare);
}

function rateLimited(retryAfterSeconds: number): Response {
  const headers = baseHeaders(NO_STORE);
  headers.set('retry-after', String(retryAfterSeconds));
  return new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'Too many requests. Try again later.' } }), {
    status: 429,
    headers,
  });
}

/**
 * GET /api/v1/wake/<token>. The query string is ignored: the answer depends on the path token alone. Unknown and
 * revoked tokens take the same path (one UPDATE that matches nothing, the miss check, one insert) and get the same 404.
 */
export async function pollWakeUrl(req: Request, token: string): Promise<Response> {
  const hit = await countPoll(token);
  if (!hit) {
    const ipKey = keyedHash(IP_PURPOSE, clientIp(req)).slice(0, 40);
    const miss = await ipOverMissLimit(ipKey);
    if (miss.limited) return rateLimited(miss.retryAfter);
    await recordMiss(ipKey);
    return notFound();
  }
  if (hit.poll_count > WAKE_POLL_LIMITS.perToken) return rateLimited(hit.retry_after);
  const subject: WakeSubject = { kind: 'agent', workspaceId: hit.workspace_id, agentId: hit.agent_id };
  const id = wakeChangeId(hit.id, subject, await wakeMarker(subject));
  const etag = `"${id}"`;
  const headers = baseHeaders(WAKE_POLL_CACHE_CONTROL);
  headers.set('etag', etag);
  if (etagMatches(req.headers.get('if-none-match'), etag)) {
    headers.delete('content-type');
    return new Response(null, { status: 304, headers });
  }
  return new Response(JSON.stringify({ id }), { status: 200, headers });
}

/** A new active URL for the subject. 409 wake_url_exists when one is already active: rotate or revoke it first. */
export async function issueWakeUrl(subject: WakeSubject, origin: string): Promise<{ row: WakeUrlRow; url: string }> {
  const token = randomToken(WAKE_URL_TOKEN_PREFIX);
  try {
    const [row] = await getDb()
      .insert(wakeUrls)
      .values({
        workspaceId: subject.workspaceId,
        agentId: subject.agentId,
        tokenHash: sha256(token),
        tokenPrefix: tokenPrefix(token),
      })
      .returning();
    if (!row) throw new HttpError(500, 'internal_error', 'Something went wrong.');
    return { row, url: wakeUrlFor(origin, token) };
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new HttpError(409, 'wake_url_exists', 'This agent already has an active wake URL. Rotate or revoke it first.');
    }
    throw err;
  }
}

export async function listWakeUrls(subject: WakeSubject) {
  const rows = await getDb()
    .select()
    .from(wakeUrls)
    .where(and(eq(wakeUrls.workspaceId, subject.workspaceId), eq(wakeUrls.agentId, subject.agentId)))
    .orderBy(desc(wakeUrls.createdAt))
    .limit(50);
  return rows.map(serializeWakeUrl);
}

function wakeUrlWhere(subject: WakeSubject, wakeUrlId: string) {
  return and(eq(wakeUrls.id, wakeUrlId), eq(wakeUrls.workspaceId, subject.workspaceId), eq(wakeUrls.agentId, subject.agentId));
}

/** Revokes one URL. Idempotent: an already revoked URL comes back as it is. 404 when it is not the subject's. */
export async function revokeWakeUrl(subject: WakeSubject, wakeUrlId: string): Promise<WakeUrlRow> {
  const db = getDb();
  const [revoked] = await db
    .update(wakeUrls)
    .set({ revokedAt: new Date() })
    .where(and(wakeUrlWhere(subject, wakeUrlId), isNull(wakeUrls.revokedAt)))
    .returning();
  if (revoked) return revoked;
  const [existing] = await db.select().from(wakeUrls).where(wakeUrlWhere(subject, wakeUrlId)).limit(1);
  if (!existing) throw new HttpError(404, 'not_found', 'No wake URL was found.');
  return existing;
}

/** Revokes an active URL and issues its replacement in one transaction. 409 wake_url_not_active when already revoked. */
export async function rotateWakeUrl(
  subject: WakeSubject,
  wakeUrlId: string,
  origin: string,
): Promise<{ row: WakeUrlRow; url: string; revoked: WakeUrlRow }> {
  const token = randomToken(WAKE_URL_TOKEN_PREFIX);
  return getDb().transaction(async (tx) => {
    const [existing] = await tx.select().from(wakeUrls).where(wakeUrlWhere(subject, wakeUrlId)).limit(1);
    if (!existing) throw new HttpError(404, 'not_found', 'No wake URL was found.');
    const [revoked] = await tx
      .update(wakeUrls)
      .set({ revokedAt: new Date() })
      .where(and(eq(wakeUrls.id, existing.id), isNull(wakeUrls.revokedAt)))
      .returning();
    if (!revoked) throw new HttpError(409, 'wake_url_not_active', 'Only an active wake URL can be rotated.');
    const [row] = await tx
      .insert(wakeUrls)
      .values({
        workspaceId: subject.workspaceId,
        agentId: subject.agentId,
        tokenHash: sha256(token),
        tokenPrefix: tokenPrefix(token),
      })
      .returning();
    if (!row) throw new HttpError(500, 'internal_error', 'Something went wrong.');
    return { row, url: wakeUrlFor(origin, token), revoked };
  });
}

/**
 * Who may manage an agent's wake URL.
 * - Issue and rotate (`issue: true`) mint a new bearer secret, so only a signed-in human owner may: a dashboard
 *   session. The agent's own rsk_ key gets 403 human_required, like other owner-only actions, and a connected app's
 *   rsoa_ token gets the same.
 * - List and revoke also accept the agent's own rsk_ key. List shows prefixes only and never a URL. Revoke only takes
 *   access away, so an agent (or whoever holds its key) can kill a leaked URL without a human; it cannot get one back.
 * A key for another agent gets the same 404 as an agent that does not exist. A revoked agent cannot be issued a URL.
 */
export async function requireWakeUrlOwner(req: Request, agentId: string, options: { issue: boolean }): Promise<WakeSubject> {
  const token = bearerToken(req);
  let workspaceId: string;
  if (options.issue) {
    workspaceId = (await requireHumanOwner(req, 'Only the owner can issue or rotate a wake URL, from the dashboard.')).workspace.id;
  } else if (token?.startsWith('rsoa_')) {
    throw new HttpError(403, 'human_required', 'Connected apps cannot manage wake URLs. Use the agent key or the dashboard.');
  } else if (token?.startsWith('rsk_')) {
    const principal = await authenticateAgentKey(token);
    if (!principal) throw new HttpError(401, 'unauthorized', 'Agent key rejected.');
    if (principal.agentId !== agentId) throw new HttpError(404, 'not_found', 'No agent was found.');
    workspaceId = principal.workspaceId;
  } else {
    workspaceId = (await requireUser(req)).workspace.id;
  }
  const agent = await getAgent(workspaceId, agentId);
  if (options.issue && agent.revokedAt) throw new HttpError(409, 'agent_revoked', 'This agent has been revoked.');
  return { kind: 'agent', workspaceId, agentId: agent.id };
}
