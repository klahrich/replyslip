import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { agents, wakeUrls } from '@/db/schema';
import { authenticateAgentKey, getAgent } from './agents';
import { requireUser } from './auth';
import { keyedHash, randomToken, sha256, tokenPrefix } from './crypto';
import { HttpError, isUniqueViolation } from './errors';
import { bearerToken } from './http';
import { absoluteUrl, clientIp } from './origin';
import { consumeRateLimit } from './rate-limit';

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
const RATE_KEY_PURPOSE = 'wake_url_rate';
const IP_PURPOSE = 'wake_url_ip';
/** last_used_at is written at most this often per URL, so steady polling does not write a row each time. */
const LAST_USED_GRANULARITY_SECONDS = 60;

/**
 * Whose wakes a URL reports. Every query below goes through this type, so another scope (for example a whole
 * workspace) is a new variant here plus its wakeMarker branch.
 */
export type WakeSubject = { kind: 'agent'; workspaceId: string; agentId: string };

type WakeUrlRow = typeof wakeUrls.$inferSelect;

function subjectOf(row: Pick<WakeUrlRow, 'workspaceId' | 'agentId'>): WakeSubject {
  return { kind: 'agent', workspaceId: row.workspaceId, agentId: row.agentId };
}

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

/** Change marker: how many wake rows the subject has and when the newest one was written (microseconds, as text). */
export async function wakeMarker(subject: WakeSubject): Promise<string> {
  const rows = await getDb().execute<{ n: number; last: string | null }>(sql`
    select count(*)::int as n, max(created_at)::text as last
    from wakes
    where agent_id = ${subject.agentId}
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

/** Active URL whose subject still exists and is not revoked, else null. One indexed query either way. */
async function findActiveWakeUrl(token: string): Promise<WakeUrlRow | null> {
  const [row] = await getDb()
    .select({ url: wakeUrls })
    .from(wakeUrls)
    .innerJoin(agents, eq(agents.id, wakeUrls.agentId))
    .where(and(eq(wakeUrls.tokenHash, sha256(token)), isNull(wakeUrls.revokedAt), isNull(agents.revokedAt)))
    .limit(1);
  return row?.url ?? null;
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
    .some((part) => part !== '*' && part.replace(/^W\//, '') === bare);
}

/**
 * GET /api/v1/wake/<token>. Rate limit first (per token and per IP), so unknown tokens are limited the same way and
 * cost the same. The query string is ignored: the answer depends on the path token alone.
 */
export async function pollWakeUrl(req: Request, token: string): Promise<Response> {
  const limit = await consumeRateLimit({
    kind: 'wakePoll',
    agentId: keyedHash(RATE_KEY_PURPOSE, token).slice(0, 40),
    ip: keyedHash(IP_PURPOSE, clientIp(req)).slice(0, 40),
  });
  if (limit.limited) {
    const headers = baseHeaders(NO_STORE);
    headers.set('retry-after', String(limit.retryAfterSeconds));
    return new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'Too many requests. Try again later.' } }), {
      status: 429,
      headers,
    });
  }
  const row = await findActiveWakeUrl(token);
  if (!row) return notFound();
  const subject = subjectOf(row);
  const id = wakeChangeId(row.id, subject, await wakeMarker(subject));
  await getDb().execute(sql`
    update wake_urls set last_used_at = now()
    where id = ${row.id}
      and (last_used_at is null or last_used_at < now() - make_interval(secs => ${LAST_USED_GRANULARITY_SECONDS}))
  `);
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
 * Owner check for the management routes. Either a signed-in owner (any agent in their workspace) or the agent's own
 * rsk_ key (only that agent: a key never manages another agent's URL). OAuth access tokens (rsoa_) are refused: a
 * connected app cannot mint or read wake URLs. A revoked agent gets no new URL.
 */
export async function requireWakeUrlOwner(req: Request, agentId: string, options: { forWrite: boolean }): Promise<WakeSubject> {
  const token = bearerToken(req);
  if (token?.startsWith('rsoa_')) {
    throw new HttpError(403, 'forbidden', 'Connected apps cannot manage wake URLs. Use the agent key or the dashboard.');
  }
  let workspaceId: string;
  if (token?.startsWith('rsk_')) {
    const principal = await authenticateAgentKey(token);
    if (!principal) throw new HttpError(401, 'unauthorized', 'Agent key rejected.');
    if (principal.agentId !== agentId) throw new HttpError(404, 'not_found', 'No agent was found.');
    workspaceId = principal.workspaceId;
  } else {
    workspaceId = (await requireUser(req)).workspace.id;
  }
  const agent = await getAgent(workspaceId, agentId);
  if (options.forWrite && agent.revokedAt) throw new HttpError(409, 'agent_revoked', 'This agent has been revoked.');
  return { kind: 'agent', workspaceId, agentId: agent.id };
}
