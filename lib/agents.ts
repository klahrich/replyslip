import { and, desc, eq, isNull, max, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { agentKeys, agents, joinCodes, watcherKeys, type AgentRow, type JoinCodeRow } from '@/db/schema';
import type { SessionUser } from './auth';
import {
  AGENT_NAME_PATTERN,
  JOIN_CODE_DEFAULT_TTL_MS,
  JOIN_CODE_MAX_PENDING,
  JOIN_CODE_MAX_TTL_MS,
  JOIN_CODE_MIN_TTL_MS,
  WATCHER_ONLINE_MS,
} from './constants';
import { randomToken, sha256, tokenPrefix } from './crypto';
import { applyDeliveryUpdate, deliveryColumns, publicDelivery, type DeliveryInput, type DeliveryUpdate } from './delivery';
import { agentCountForUpdate, loadFirstAgentNotice, queueFirstAgentAlert } from './first-agent-alert';
import { HttpError, isUniqueViolation } from './errors';
import { clientIp } from './origin';
import { assertWithinLimit } from './plans';
import { consumeRateLimit } from './rate-limit';

export type AgentPrincipal = {
  workspaceId: string;
  agentId: string;
  agentName: string;
  keyId: string;
};

type WorkspaceUser = SessionUser & { workspace: NonNullable<SessionUser['workspace']> };

function cleanDescription(description: string | undefined): string | null {
  const trimmed = description?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

export function serializeAgent(agent: AgentRow) {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    created_at: agent.createdAt.toISOString(),
    revoked_at: agent.revokedAt?.toISOString() ?? null,
    delivery: publicDelivery(agent),
  };
}

export async function createAgent(
  user: WorkspaceUser,
  input: { name: string; description?: string },
): Promise<AgentRow> {
  if (!AGENT_NAME_PATTERN.test(input.name)) {
    throw new HttpError(
      400,
      'invalid_name',
      'Agent name must start with a letter and contain only letters, numbers, underscores, or hyphens (max 64).',
    );
  }
  try {
    const created = await getDb().transaction(async (tx) => {
      await assertWithinLimit(user.workspace.id, 'agents', tx);
      const prior = await agentCountForUpdate(tx, user.workspace.id);
      const [agent] = await tx
        .insert(agents)
        .values({
          workspaceId: user.workspace.id,
          name: input.name,
          description: cleanDescription(input.description),
        })
        .returning();
      if (!agent) throw new HttpError(500, 'internal_error', 'Something went wrong.');
      const notice = prior === 0 ? await loadFirstAgentNotice(tx, agent) : null;
      return { agent, notice };
    });
    if (created.notice) queueFirstAgentAlert(created.notice);
    return created.agent;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new HttpError(409, 'name_taken', `An agent named ${input.name} already exists in this workspace.`);
    }
    throw err;
  }
}

export async function listAgents(workspaceId: string): Promise<AgentRow[]> {
  return getDb()
    .select()
    .from(agents)
    .where(eq(agents.workspaceId, workspaceId))
    .orderBy(desc(agents.createdAt));
}

export async function getAgent(workspaceId: string, agentId: string): Promise<AgentRow> {
  const [agent] = await getDb()
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)))
    .limit(1);
  if (!agent) throw new HttpError(404, 'not_found', 'No agent was found.');
  return agent;
}

export async function revokeAgent(workspaceId: string, agentId: string): Promise<AgentRow> {
  const db = getDb();
  const agent = await getAgent(workspaceId, agentId);
  if (agent.revokedAt) return agent;
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(agents).set({ revokedAt: now }).where(eq(agents.id, agent.id));
    await tx
      .update(agentKeys)
      .set({ revokedAt: now })
      .where(and(eq(agentKeys.agentId, agent.id), isNull(agentKeys.revokedAt)));
  });
  return { ...agent, revokedAt: now };
}

export async function issueAgentKey(workspaceId: string, agentId: string): Promise<{
  id: string;
  prefix: string;
  createdAt: Date;
  secret: string;
}> {
  const agent = await getAgent(workspaceId, agentId);
  if (agent.revokedAt) {
    throw new HttpError(409, 'agent_revoked', 'This agent has been revoked.');
  }
  const secret = randomToken('rsk_');
  const [key] = await getDb()
    .insert(agentKeys)
    .values({
      agentId: agent.id,
      tokenHash: sha256(secret),
      tokenPrefix: tokenPrefix(secret),
    })
    .returning();
  if (!key) throw new HttpError(500, 'internal_error', 'Something went wrong.');
  return { id: key.id, prefix: key.tokenPrefix, createdAt: key.createdAt, secret };
}

export async function listAgentKeys(workspaceId: string, agentId: string) {
  await getAgent(workspaceId, agentId);
  const rows = await getDb()
    .select()
    .from(agentKeys)
    .where(eq(agentKeys.agentId, agentId))
    .orderBy(desc(agentKeys.createdAt));
  return rows.map((key) => ({
    id: key.id,
    prefix: key.tokenPrefix,
    created_at: key.createdAt.toISOString(),
    revoked_at: key.revokedAt?.toISOString() ?? null,
    last_used_at: key.lastUsedAt?.toISOString() ?? null,
  }));
}

export async function revokeAgentKey(workspaceId: string, agentId: string, keyId: string) {
  await getAgent(workspaceId, agentId);
  const [key] = await getDb()
    .update(agentKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(agentKeys.id, keyId), eq(agentKeys.agentId, agentId), isNull(agentKeys.revokedAt)))
    .returning();
  if (!key) {
    const [existing] = await getDb()
      .select()
      .from(agentKeys)
      .where(and(eq(agentKeys.id, keyId), eq(agentKeys.agentId, agentId)))
      .limit(1);
    if (!existing) throw new HttpError(404, 'not_found', 'No key was found.');
    return existing;
  }
  return key;
}

export async function setAgentDelivery(workspaceId: string, agentId: string, input: DeliveryUpdate) {
  const agent = await getAgent(workspaceId, agentId);
  if (agent.revokedAt) throw new HttpError(409, 'agent_revoked', 'This agent has been revoked.');
  const columns = applyDeliveryUpdate(agent, input);
  const [updated] = await getDb()
    .update(agents)
    .set(columns)
    .where(and(eq(agents.id, agent.id), eq(agents.workspaceId, workspaceId)))
    .returning();
  if (!updated) throw new HttpError(404, 'not_found', 'No agent was found.');
  return updated;
}

export async function authenticateAgentKey(token: string): Promise<AgentPrincipal | null> {
  const db = getDb();
  const [key] = await db.select().from(agentKeys).where(eq(agentKeys.tokenHash, sha256(token))).limit(1);
  if (!key || key.revokedAt) return null;
  const [agent] = await db.select().from(agents).where(eq(agents.id, key.agentId)).limit(1);
  if (!agent || agent.revokedAt) return null;
  await db.update(agentKeys).set({ lastUsedAt: new Date() }).where(eq(agentKeys.id, key.id));
  return {
    workspaceId: agent.workspaceId,
    agentId: agent.id,
    agentName: agent.name,
    keyId: key.id,
  };
}

function joinCodeStatus(code: JoinCodeRow, now = new Date()): 'pending' | 'consumed' | 'revoked' | 'expired' {
  if (code.revokedAt) return 'revoked';
  if (code.consumedAt) return 'consumed';
  if (code.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'pending';
}

export function serializeJoinCode(code: JoinCodeRow) {
  return {
    id: code.id,
    prefix: code.tokenPrefix,
    expires_at: code.expiresAt.toISOString(),
    created_at: code.createdAt.toISOString(),
    revoked_at: code.revokedAt?.toISOString() ?? null,
    consumed_at: code.consumedAt?.toISOString() ?? null,
    consumed_by_agent_id: code.consumedByAgentId,
    status: joinCodeStatus(code),
  };
}

export async function createJoinCode(user: WorkspaceUser, expiresInHours?: number) {
  const ttlMs = expiresInHours === undefined ? JOIN_CODE_DEFAULT_TTL_MS : expiresInHours * 60 * 60 * 1000;
  if (ttlMs < JOIN_CODE_MIN_TTL_MS || ttlMs > JOIN_CODE_MAX_TTL_MS) {
    throw new HttpError(400, 'invalid_expiry', 'Join codes expire between 1 hour and 7 days.');
  }
  const db = getDb();
  const pending = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(joinCodes)
    .where(
      and(
        eq(joinCodes.workspaceId, user.workspace.id),
        isNull(joinCodes.consumedAt),
        isNull(joinCodes.revokedAt),
        sql`${joinCodes.expiresAt} > now()`,
      ),
    );
  if (Number(pending[0]?.count ?? 0) >= JOIN_CODE_MAX_PENDING) {
    throw new HttpError(429, 'too_many_join_codes', `This workspace already has ${JOIN_CODE_MAX_PENDING} pending join codes.`);
  }
  const secret = randomToken('rjc_');
  const [code] = await db
    .insert(joinCodes)
    .values({
      workspaceId: user.workspace.id,
      tokenHash: sha256(secret),
      tokenPrefix: tokenPrefix(secret),
      expiresAt: new Date(Date.now() + ttlMs),
      createdByUserId: user.id,
    })
    .returning();
  if (!code) throw new HttpError(500, 'internal_error', 'Something went wrong.');
  return { code, secret };
}

export async function listJoinCodes(workspaceId: string) {
  const rows = await getDb()
    .select()
    .from(joinCodes)
    .where(eq(joinCodes.workspaceId, workspaceId))
    .orderBy(desc(joinCodes.createdAt))
    .limit(100);
  return rows.map(serializeJoinCode);
}

export async function revokeJoinCode(workspaceId: string, codeId: string) {
  const [code] = await getDb()
    .select()
    .from(joinCodes)
    .where(and(eq(joinCodes.id, codeId), eq(joinCodes.workspaceId, workspaceId)))
    .limit(1);
  if (!code) throw new HttpError(404, 'not_found', 'No join code was found.');
  if (joinCodeStatus(code) !== 'pending') {
    throw new HttpError(409, 'join_code_not_pending', 'Only a pending join code can be revoked.');
  }
  const [updated] = await getDb()
    .update(joinCodes)
    .set({ revokedAt: new Date() })
    .where(and(eq(joinCodes.id, code.id), isNull(joinCodes.revokedAt), isNull(joinCodes.consumedAt)))
    .returning();
  if (!updated) throw new HttpError(409, 'join_code_not_pending', 'Only a pending join code can be revoked.');
  return updated;
}

export async function rotateJoinCode(user: WorkspaceUser, codeId: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const locked = await tx.execute<{ id: string }>(
      sql`select id from join_codes where id = ${codeId} and workspace_id = ${user.workspace.id} for update`,
    );
    if (locked.length === 0) throw new HttpError(404, 'not_found', 'No join code was found.');
    const [code] = await tx.select().from(joinCodes).where(eq(joinCodes.id, codeId)).limit(1);
    if (!code || joinCodeStatus(code) !== 'pending') {
      throw new HttpError(409, 'join_code_not_pending', 'Only a pending join code can be rotated.');
    }
    await tx.update(joinCodes).set({ revokedAt: new Date() }).where(eq(joinCodes.id, code.id));
    const secret = randomToken('rjc_');
    const [created] = await tx
      .insert(joinCodes)
      .values({
        workspaceId: user.workspace.id,
        tokenHash: sha256(secret),
        tokenPrefix: tokenPrefix(secret),
        expiresAt: new Date(Date.now() + JOIN_CODE_DEFAULT_TTL_MS),
        createdByUserId: user.id,
      })
      .returning();
    if (!created) throw new HttpError(500, 'internal_error', 'Something went wrong.');
    return { code: created, secret };
  });
}

export type LoadedJoinCode =
  | { ok: true; code: JoinCodeRow }
  | { ok: false; status: number; code: string; message: string };

export async function loadJoinCode(token: string): Promise<LoadedJoinCode> {
  const [code] = await getDb().select().from(joinCodes).where(eq(joinCodes.tokenHash, sha256(token))).limit(1);
  if (!code) return { ok: false, status: 401, code: 'invalid_join_code', message: 'Invalid join code.' };
  if (code.revokedAt) {
    return { ok: false, status: 401, code: 'join_code_revoked', message: 'This join code has been revoked.' };
  }
  if (code.consumedAt) {
    return { ok: false, status: 401, code: 'join_code_used', message: 'This join code has already been used.' };
  }
  if (code.expiresAt.getTime() <= Date.now()) {
    return { ok: false, status: 401, code: 'join_code_expired', message: 'This join code has expired.' };
  }
  return { ok: true, code };
}

export async function registerAgentWithJoinCode(input: {
  token: string;
  name: string;
  description?: string;
  delivery?: DeliveryInput;
  req: Request;
}): Promise<{ agent: AgentRow; apiKey: string }> {
  const limit = await consumeRateLimit({ kind: 'register', ip: clientIp(input.req) });
  if (limit.limited) {
    throw new HttpError(429, 'rate_limited', 'Too many registration attempts. Try again later.');
  }
  if (!AGENT_NAME_PATTERN.test(input.name)) {
    throw new HttpError(
      400,
      'invalid_name',
      'Agent name must start with a letter and contain only letters, numbers, underscores, or hyphens (max 64).',
    );
  }
  const loaded = await loadJoinCode(input.token);
  if (!loaded.ok) throw new HttpError(loaded.status, loaded.code, loaded.message);
  const columns = input.delivery ? deliveryColumns(input.delivery) : null;
  const secret = randomToken('rsk_');

  try {
    const created = await getDb().transaction(async (tx) => {
      await tx.execute(sql`select id from join_codes where id = ${loaded.code.id} for update`);
      const [fresh] = await tx.select().from(joinCodes).where(eq(joinCodes.id, loaded.code.id)).limit(1);
      if (!fresh || fresh.revokedAt) {
        throw new HttpError(401, 'join_code_revoked', 'This join code has been revoked.');
      }
      if (fresh.consumedAt) {
        throw new HttpError(401, 'join_code_used', 'This join code has already been used.');
      }
      if (fresh.expiresAt.getTime() <= Date.now()) {
        throw new HttpError(401, 'join_code_expired', 'This join code has expired.');
      }
      await assertWithinLimit(fresh.workspaceId, 'agents', tx);
      const prior = await agentCountForUpdate(tx, fresh.workspaceId);
      const [agent] = await tx
        .insert(agents)
        .values({
          workspaceId: fresh.workspaceId,
          name: input.name,
          description: cleanDescription(input.description),
          ...(columns ?? {}),
        })
        .returning();
      if (!agent) throw new HttpError(500, 'internal_error', 'Something went wrong.');
      await tx.insert(agentKeys).values({
        agentId: agent.id,
        tokenHash: sha256(secret),
        tokenPrefix: tokenPrefix(secret),
      });
      const [consumed] = await tx
        .update(joinCodes)
        .set({ consumedAt: new Date(), consumedByAgentId: agent.id })
        .where(and(eq(joinCodes.id, fresh.id), isNull(joinCodes.consumedAt), isNull(joinCodes.revokedAt)))
        .returning({ id: joinCodes.id });
      if (!consumed) {
        throw new HttpError(401, 'join_code_used', 'This join code has already been used.');
      }
      const notice = prior === 0 ? await loadFirstAgentNotice(tx, agent) : null;
      return { agent, apiKey: secret, notice };
    });
    if (created.notice) queueFirstAgentAlert(created.notice);
    return { agent: created.agent, apiKey: created.apiKey };
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new HttpError(409, 'name_taken', `An agent named ${input.name} already exists in this workspace.`);
    }
    throw err;
  }
}

export async function issueWatcherKey(workspaceId: string, name: string) {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 80) {
    throw new HttpError(400, 'validation_error', 'Watcher name must be 1-80 characters.');
  }
  const secret = randomToken('rsw_');
  const [key] = await getDb()
    .insert(watcherKeys)
    .values({
      workspaceId,
      name: trimmed,
      tokenHash: sha256(secret),
      tokenPrefix: tokenPrefix(secret),
    })
    .returning();
  if (!key) throw new HttpError(500, 'internal_error', 'Something went wrong.');
  return { key, secret };
}

type WatcherKeyRow = typeof watcherKeys.$inferSelect;

export function serializeWatcherKey(key: WatcherKeyRow) {
  return {
    id: key.id,
    name: key.name,
    prefix: key.tokenPrefix,
    created_at: key.createdAt.toISOString(),
    revoked_at: key.revokedAt?.toISOString() ?? null,
    last_used_at: key.lastUsedAt?.toISOString() ?? null,
    last_seen_at: key.lastSeenAt?.toISOString() ?? null,
  };
}

export async function listWatcherKeys(workspaceId: string) {
  const rows = await getDb()
    .select()
    .from(watcherKeys)
    .where(eq(watcherKeys.workspaceId, workspaceId))
    .orderBy(desc(watcherKeys.createdAt));
  return rows.map(serializeWatcherKey);
}

/** Poll only. Ack updates last_used_at through authenticateWatcherKey and leaves last_seen_at alone. */
export async function recordWatcherSeen(keyId: string, at = new Date()): Promise<void> {
  await getDb().update(watcherKeys).set({ lastSeenAt: at }).where(eq(watcherKeys.id, keyId));
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Newest poll time among watcher keys that can still deliver this workspace. Revoked keys do not count. */
export async function workspaceWatcherLastSeen(workspaceId: string): Promise<Date | null> {
  const [row] = await getDb()
    .select({ seen: max(watcherKeys.lastSeenAt) })
    .from(watcherKeys)
    .where(and(eq(watcherKeys.workspaceId, workspaceId), isNull(watcherKeys.revokedAt)));
  return asDate(row?.seen);
}

export function isLocalDelivery(agent: { deliveryMode: string }): boolean {
  return agent.deliveryMode === 'local' || agent.deliveryMode === 'herdr';
}

export type WatcherPresence = {
  watcher_last_seen_at: string | null;
  watcher_online: boolean;
};

/**
 * One workspace watcher delivers every local agent, so they share the newest poll.
 * Webhook and none agents are not delivered that way.
 */
export function watcherPresence(agent: { deliveryMode: string }, lastSeen: Date | null, now = Date.now()): WatcherPresence {
  if (!isLocalDelivery(agent) || !lastSeen) {
    return { watcher_last_seen_at: null, watcher_online: false };
  }
  return {
    watcher_last_seen_at: lastSeen.toISOString(),
    watcher_online: now - lastSeen.getTime() <= WATCHER_ONLINE_MS,
  };
}

export async function revokeWatcherKey(workspaceId: string, keyId: string) {
  const [key] = await getDb()
    .update(watcherKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(watcherKeys.id, keyId), eq(watcherKeys.workspaceId, workspaceId), isNull(watcherKeys.revokedAt)))
    .returning();
  if (key) return key;
  const [existing] = await getDb()
    .select()
    .from(watcherKeys)
    .where(and(eq(watcherKeys.id, keyId), eq(watcherKeys.workspaceId, workspaceId)))
    .limit(1);
  if (!existing) throw new HttpError(404, 'not_found', 'No watcher key was found.');
  return existing;
}

export async function authenticateWatcherKey(token: string): Promise<{ workspaceId: string; keyId: string } | null> {
  const db = getDb();
  const [key] = await db.select().from(watcherKeys).where(eq(watcherKeys.tokenHash, sha256(token))).limit(1);
  if (!key || key.revokedAt) return null;
  await db.update(watcherKeys).set({ lastUsedAt: new Date() }).where(eq(watcherKeys.id, key.id));
  return { workspaceId: key.workspaceId, keyId: key.id };
}
