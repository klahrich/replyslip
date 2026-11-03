import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
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
 * Poll limits. The expected rate is one poll a minute; the id is cached for 10 seconds, so polling faster gives
 * nothing fresher.
 *
 * Good polls are limited per token only: one platform (Muse, say) polls every user's URL from a few server
 * addresses, so a per-IP cap on good polls would throttle all of them together. The count is a fixed window kept on
 * the wake_urls row (poll_window_started_at, poll_count), bumped by the one UPDATE that also finds the token. A poll
 * over the limit is refused by that UPDATE's WHERE, so it writes nothing. Not in-memory: on Vercel concurrent
 * requests land on different, short-lived instances, so a per-instance bucket would multiply the limit by the
 * instance count and reset on every cold start.
 *
 * Misses (unknown, revoked or rotated-away tokens) are recorded per IP (keyed hash) in rate_events, up to
 * missesPerIp per window. Past that a miss still gets the same 404, so a dead URL always reads as dead, but nothing
 * more is written for that IP until the window moves on. A 256-bit token cannot be guessed, so the cap is about
 * write load, not secrecy.
 */
export const WAKE_POLL_LIMITS = {
  /** Good polls per token per window: one every 3 seconds, well above the expected one a minute. */
  perToken: 300,
  /** Misses recorded per IP (keyed hash) per window. Past it, misses are still 404 but write nothing. */
  missesPerIp: 600,
  windowSeconds: 15 * 60,
} as const;
/** last_used_at moves at most this often, so a status read never needs more precision than a minute. */
const LAST_USED_GRANULARITY_SECONDS = 60;
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

type PollHit = { id: string; workspace_id: string; agent_id: string; counted: boolean; retry_after: number };

/**
 * The poll-counting statement: finds an active URL whose agent is not revoked and counts the poll against it. Its
 * only write is a single-row UPDATE. Whether the window is fresh is decided inside that UPDATE, against the row it
 * has locked (`w`), never against the CTE's snapshot: under concurrent polls Postgres re-checks the UPDATE's WHERE
 * and recomputes its SET on the newest row version, so a window is reset once and at most `perToken` polls count
 * per window. The UPDATE skips a token already at its limit, so a refused poll writes nothing (`counted` false).
 * No row for unknown and revoked tokens alike, with no write. last_used_at moves at most once a minute.
 */
export function countPollStatement(token: string): SQL {
  const window = sql`make_interval(secs => ${WAKE_POLL_LIMITS.windowSeconds})`;
  const fresh = sql`(w.poll_window_started_at is null or w.poll_window_started_at <= now() - ${window})`;
  return sql`
    with hit as (
      select u.id, u.workspace_id, u.agent_id, u.poll_window_started_at
      from wake_urls u
      join agents a on a.id = u.agent_id
      where u.token_hash = ${sha256(token)}
        and u.revoked_at is null
        and a.revoked_at is null
    ),
    counted as (
      update wake_urls w set
        poll_count = case when ${fresh} then 1 else w.poll_count + 1 end,
        poll_window_started_at = case when ${fresh} then now() else w.poll_window_started_at end,
        last_used_at = case
          when w.last_used_at is null or w.last_used_at <= now() - make_interval(secs => ${LAST_USED_GRANULARITY_SECONDS})
          then now() else w.last_used_at end
      from hit
      where w.id = hit.id
        and (${fresh} or w.poll_count < ${WAKE_POLL_LIMITS.perToken})
      returning w.id
    )
    select hit.id, hit.workspace_id, hit.agent_id,
      exists (select 1 from counted) as counted,
      greatest(1, ceil(extract(epoch from
        coalesce(hit.poll_window_started_at, now()) + ${window} - now())))::int as retry_after
    from hit
  `;
}

async function countPoll(token: string): Promise<PollHit | null> {
  const rows = await getDb().execute<PollHit>(countPollStatement(token));
  return rows[0] ?? null;
}

/**
 * IPs (keyed hash) known to be at the miss cap, and until when, on this instance. Only a shortcut: it skips the
 * count read for an IP this instance already saw at the cap. The answer is the same 404 either way, and a cold
 * instance simply reads the count again. Bounded so it cannot grow without limit.
 */
const ipsAtMissCap = new Map<string, number>();
const MAX_REMEMBERED_IPS = 10_000;

/** True when this IP (keyed hash) already has missesPerIp recorded misses in the window. Reads only. */
async function ipAtMissCap(ipKey: string): Promise<boolean> {
  const until = ipsAtMissCap.get(ipKey);
  if (until !== undefined) {
    if (until > Date.now()) return true;
    ipsAtMissCap.delete(ipKey);
  }
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
  if (!row || row.n < WAKE_POLL_LIMITS.missesPerIp || !row.oldest) return false;
  if (ipsAtMissCap.size >= MAX_REMEMBERED_IPS) ipsAtMissCap.clear();
  ipsAtMissCap.set(ipKey, new Date(row.oldest).getTime() + WAKE_POLL_LIMITS.windowSeconds * 1000);
  return true;
}

/** Test hook: forget the per-instance miss-cap shortcut. */
export function resetWakeMissCapCache(): void {
  ipsAtMissCap.clear();
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
 * GET /api/v1/wake/<token>. The query string is ignored: the answer depends on the path token alone. Unknown,
 * revoked and rotated-away tokens take the same path and always get the same 404, also past the per-IP miss cap.
 * The token lookup itself always runs, because a valid token from a busy IP must still be answered.
 */
export async function pollWakeUrl(req: Request, token: string): Promise<Response> {
  const hit = await countPoll(token);
  if (!hit) {
    const ipKey = keyedHash(IP_PURPOSE, clientIp(req)).slice(0, 40);
    if (!(await ipAtMissCap(ipKey))) await recordMiss(ipKey);
    return notFound();
  }
  if (!hit.counted) return rateLimited(hit.retry_after);
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

/** Wake-link status for GET /api/v1/agents: never the URL itself. */
export type AgentWakeUrlStatus = { active: true; prefix: string; created_at: string; last_used_at: string | null };

/** Each agent's active wake URL in the workspace, keyed by agent id, in one query. Agents without one are absent. */
export async function activeWakeUrlsByAgent(workspaceId: string): Promise<Map<string, AgentWakeUrlStatus>> {
  const rows = await getDb()
    .select({
      agentId: wakeUrls.agentId,
      prefix: wakeUrls.tokenPrefix,
      createdAt: wakeUrls.createdAt,
      lastUsedAt: wakeUrls.lastUsedAt,
    })
    .from(wakeUrls)
    .where(and(eq(wakeUrls.workspaceId, workspaceId), isNull(wakeUrls.revokedAt)));
  return new Map(
    rows.map((row) => [
      row.agentId,
      {
        active: true as const,
        prefix: row.prefix,
        created_at: row.createdAt.toISOString(),
        last_used_at: row.lastUsedAt?.toISOString() ?? null,
      },
    ]),
  );
}
