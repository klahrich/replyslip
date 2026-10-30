import { randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db';
import {
  agentInviteOffers,
  agentInvites,
  agentKeys,
  agentOffers,
  agentShareOffers,
  agentShares,
  agents,
  messages,
  tasks,
  wakes,
  workspaces,
  type AgentInviteRow,
  type AgentRow,
  type AgentShareRow,
} from '@/db/schema';
import type { AgentPrincipal } from './agents';
import {
  AGENT_NAME_PATTERN,
  agentGuestsEnabled,
  CLAIM_TOKEN_TTL_DAYS,
  DEFAULT_SHARE_DAILY_CAP,
  INVITE_DEFAULT_TTL_DAYS,
  INVITE_HANDLE_PREFIX,
  INVITE_LABEL_MAX,
  INVITE_MAX_ACTIVE_PER_AGENT,
  INVITE_MAX_TTL_DAYS,
  INVITE_MAX_USES,
  INVITE_MIN_TTL_DAYS,
  INVITE_WORKSPACE_IDLE_DAYS,
} from './constants';
import { randomToken, sha256, tokenPrefix } from './crypto';
import { deliveryColumns, type DeliveryInput } from './delivery';
import { offerDisplayTitle } from './offer-title';
import { HttpError, isUniqueViolation } from './errors';
import { consumeRateLimit } from './rate-limit';
import {
  assertClaimed,
  assertGuestSlot,
  assertDailyCap,
  dedupeOfferNames,
  deliverWakeIds,
  loadOffersByName,
  lockOwnerAgent,
  notesMaxFor,
  replaceShareOffers,
  revokeShareRow,
} from './sharing';

/**
 * Anonymous agent guests sit behind VALETTO_AGENT_GUESTS=1. When it is off, every entry point
 * (create, preview, redeem, claim) answers like a route that does not exist.
 */
export function assertAgentGuestsEnabled(): void {
  if (!agentGuestsEnabled()) throw new HttpError(404, 'not_found', 'Not found.');
}

const GUEST_SLOT_MESSAGE = "The owner's plan has no room for another guest. Ask them to upgrade or remove a guest.";
const SHARE_REVOKED_MESSAGE = 'The owner revoked this access. An invite cannot restore it; ask the owner.';

const DAY_MS = 24 * 60 * 60 * 1000;
const HANDLE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const WORKSPACE_NAME_MAX = 80;

export type InviteStatus = 'active' | 'exhausted' | 'expired' | 'revoked';

export function inviteStatus(invite: AgentInviteRow, now = new Date()): InviteStatus {
  if (invite.revokedAt) return 'revoked';
  if (invite.expiresAt.getTime() <= now.getTime()) return 'expired';
  if (invite.uses >= invite.maxUses) return 'exhausted';
  return 'active';
}

function redeemError(status: Exclude<InviteStatus, 'active'>): HttpError {
  if (status === 'revoked') return new HttpError(410, 'invite_revoked', 'This invite was revoked. Ask the owner for a new one.');
  if (status === 'expired') return new HttpError(410, 'invite_expired', 'This invite has expired. Ask the owner for a new one.');
  return new HttpError(410, 'invite_exhausted', 'This invite has no uses left. Ask the owner for a new one.');
}

const INVITE_NOT_FOUND = 'No invite matches that token.';

function cleanLabel(value: string | undefined | null): string | null {
  const label = value?.trim() ?? '';
  if (label.length === 0) return null;
  if (label.length > INVITE_LABEL_MAX) {
    throw new HttpError(400, 'validation_error', `label must be at most ${INVITE_LABEL_MAX} characters.`);
  }
  return label;
}

function cleanDescription(description: string | undefined): string | null {
  const trimmed = description?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

export function inviteUrl(origin: string, token: string): string {
  return `${origin}/i#${token}`;
}

export function invitePrompt(origin: string, token: string): string {
  return [
    `Read ${origin}/skill.md, then redeem this ReplySlip invite: ${token}`,
    'Choose a name for yourself. If you are already on ReplySlip, use the redeem_invite tool instead.',
  ].join('\n');
}

async function offersForInvites(db: Db, inviteIds: string[]) {
  const map = new Map<string, { id: string; name: string }[]>();
  if (inviteIds.length === 0) return map;
  const rows = await db
    .select({ inviteId: agentInviteOffers.inviteId, id: agentOffers.id, name: agentOffers.name })
    .from(agentInviteOffers)
    .innerJoin(agentOffers, eq(agentOffers.id, agentInviteOffers.offerId))
    .where(inArray(agentInviteOffers.inviteId, inviteIds));
  for (const row of rows) {
    const list = map.get(row.inviteId) ?? [];
    list.push({ id: row.id, name: row.name });
    map.set(row.inviteId, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return map;
}

function inviteBody(invite: AgentInviteRow, offers: { id: string; name: string }[]) {
  return {
    id: invite.id,
    agent_id: invite.agentId,
    prefix: invite.tokenPrefix,
    label: invite.label,
    offers,
    daily_cap: invite.dailyCap,
    max_uses: invite.maxUses,
    uses: invite.uses,
    approve_on_redeem: invite.approveOnRedeem,
    expires_at: invite.expiresAt.toISOString(),
    revoked_at: invite.revokedAt?.toISOString() ?? null,
    created_at: invite.createdAt.toISOString(),
    status: inviteStatus(invite),
  };
}

export type SerializedInvite = ReturnType<typeof inviteBody>;

async function serializeInvite(db: Db, invite: AgentInviteRow): Promise<SerializedInvite> {
  const offers = await offersForInvites(db, [invite.id]);
  return inviteBody(invite, offers.get(invite.id) ?? []);
}

export type InviteCreator = { userId: string } | { agentId: string };

export async function createInvite(
  ownerWorkspaceId: string,
  agentId: string,
  creator: InviteCreator,
  input: {
    offerNames: string[];
    dailyCap?: number;
    maxUses?: number;
    expiresInDays?: number;
    label?: string;
    approveOnRedeem?: boolean;
  },
) {
  const dailyCap = input.dailyCap === undefined ? DEFAULT_SHARE_DAILY_CAP : assertDailyCap(input.dailyCap);
  const maxUses = input.maxUses ?? 1;
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > INVITE_MAX_USES) {
    throw new HttpError(400, 'validation_error', `max_uses must be an integer from 1 to ${INVITE_MAX_USES}.`);
  }
  const days = input.expiresInDays ?? INVITE_DEFAULT_TTL_DAYS;
  if (!Number.isInteger(days) || days < INVITE_MIN_TTL_DAYS || days > INVITE_MAX_TTL_DAYS) {
    throw new HttpError(
      400,
      'invalid_expiry',
      `Invites expire between ${INVITE_MIN_TTL_DAYS} and ${INVITE_MAX_TTL_DAYS} days.`,
    );
  }
  const label = cleanLabel(input.label);
  const offerNames = dedupeOfferNames(input.offerNames);
  // An agent key never approves. The database check enforces this as well.
  // Default off: the owner approves each redeemed guest unless they opt in when creating the invite.
  const approveOnRedeem = 'userId' in creator ? (input.approveOnRedeem ?? false) : false;
  assertAgentGuestsEnabled();
  const secret = randomToken('rsi_');
  const db = getDb();

  const invite = await db.transaction(async (tx) => {
    const agent = await lockOwnerAgent(tx, ownerWorkspaceId, agentId);
    await assertClaimed(tx, ownerWorkspaceId);
    if (!agent.shared) throw new HttpError(400, 'agent_not_shared', 'Turn on sharing before creating an invite.');
    const offers = await loadOffersByName(tx, agent.id, offerNames);
    const [active] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(agentInvites)
      .where(
        and(
          eq(agentInvites.agentId, agent.id),
          isNull(agentInvites.revokedAt),
          sql`${agentInvites.expiresAt} > now()`,
          sql`${agentInvites.uses} < ${agentInvites.maxUses}`,
        ),
      );
    if (Number(active?.count ?? 0) >= INVITE_MAX_ACTIVE_PER_AGENT) {
      throw new HttpError(429, 'too_many_invites', `This agent already has ${INVITE_MAX_ACTIVE_PER_AGENT} active invites.`);
    }
    const [row] = await tx
      .insert(agentInvites)
      .values({
        agentId: agent.id,
        workspaceId: ownerWorkspaceId,
        tokenHash: sha256(secret),
        tokenPrefix: tokenPrefix(secret),
        label,
        dailyCap,
        approveOnRedeem,
        maxUses,
        expiresAt: new Date(Date.now() + days * DAY_MS),
        createdByUserId: 'userId' in creator ? creator.userId : null,
        createdByAgentId: 'agentId' in creator ? creator.agentId : null,
      })
      .returning();
    if (!row) throw new HttpError(500, 'internal_error', 'Something went wrong.');
    await tx.insert(agentInviteOffers).values(offers.map((offer) => ({ inviteId: row.id, offerId: offer.id })));
    return row;
  });
  return { invite: await serializeInvite(db, invite), token: secret };
}

export async function listInvites(workspaceId: string, agentId: string): Promise<SerializedInvite[]> {
  const db = getDb();
  await lockOwnerAgent(db, workspaceId, agentId);
  const rows = await db
    .select()
    .from(agentInvites)
    .where(and(eq(agentInvites.agentId, agentId), eq(agentInvites.workspaceId, workspaceId)))
    .orderBy(desc(agentInvites.createdAt))
    .limit(100);
  const offers = await offersForInvites(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => inviteBody(row, offers.get(row.id) ?? []));
}

/** Stops future redemptions. With revokeShares, also revokes every live share redeemed from this invite. */
export async function revokeInvite(
  workspaceId: string,
  agentId: string,
  inviteId: string,
  options: { revokeShares?: boolean } = {},
) {
  const db = getDb();
  const saved = await db.transaction(async (tx) => {
    const agent = await lockOwnerAgent(tx, workspaceId, agentId);
    await tx.execute(sql`select id from agent_invites where id = ${inviteId} and agent_id = ${agent.id} for update`);
    const [invite] = await tx
      .select()
      .from(agentInvites)
      .where(and(eq(agentInvites.id, inviteId), eq(agentInvites.agentId, agent.id)))
      .limit(1);
    if (!invite) throw new HttpError(404, 'not_found', 'No invite was found.');
    const revoked = invite.revokedAt
      ? invite
      : (await tx.update(agentInvites).set({ revokedAt: new Date() }).where(eq(agentInvites.id, invite.id)).returning())[0];
    if (!revoked) throw new HttpError(500, 'internal_error', 'Something went wrong.');
    const wakeIds: string[] = [];
    let revokedShares = 0;
    let failedTasks = 0;
    if (options.revokeShares) {
      await tx.execute(
        sql`select id from agent_shares where invite_id = ${invite.id} and status in ('pending', 'approved') for update`,
      );
      const live = await tx
        .select()
        .from(agentShares)
        .where(and(eq(agentShares.inviteId, invite.id), inArray(agentShares.status, ['pending', 'approved'])));
      for (const share of live) {
        const closed = await revokeShareRow(tx, agent, share);
        wakeIds.push(...closed.wakeIds);
        failedTasks += closed.failed;
        revokedShares += 1;
      }
    }
    return { invite: revoked, wakeIds, revokedShares, failedTasks };
  });
  await deliverWakeIds(saved.wakeIds);
  return {
    invite: await serializeInvite(db, saved.invite),
    revoked_shares: saved.revokedShares,
    failed_tasks: saved.failedTasks,
  };
}

async function findInviteByToken(db: Db, token: string): Promise<AgentInviteRow | null> {
  const [invite] = await db.select().from(agentInvites).where(eq(agentInvites.tokenHash, sha256(token))).limit(1);
  return invite ?? null;
}

async function workspaceHandle(db: Db, workspaceId: string): Promise<string> {
  const [row] = await db.select({ handle: workspaces.handle }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!row?.handle) throw new HttpError(409, 'agent_not_shared', 'The owner stopped sharing this agent.');
  return row.handle;
}

async function offerCards(db: Db, offerIds: string[]) {
  if (offerIds.length === 0) return [];
  const rows = await db
    .select({
      name: agentOffers.name,
      title: agentOffers.title,
      description: agentOffers.description,
      resultSchema: agentOffers.resultSchema,
      inputSchema: agentOffers.inputSchema,
      notesEnabled: agentOffers.notesEnabled,
    })
    .from(agentOffers)
    .where(inArray(agentOffers.id, offerIds))
    .orderBy(agentOffers.name);
  return rows.map((offer) => ({
    name: offer.name,
    title: offerDisplayTitle(offer),
    description: offer.description,
    result_schema: offer.resultSchema,
    input_schema: offer.inputSchema ?? null,
    notes_enabled: offer.notesEnabled,
    notes_max: notesMaxFor(offer),
  }));
}

async function inviteOfferIds(db: Db, inviteId: string): Promise<string[]> {
  const rows = await db
    .select({ id: agentInviteOffers.offerId })
    .from(agentInviteOffers)
    .where(eq(agentInviteOffers.inviteId, inviteId));
  return rows.map((row) => row.id);
}

export type RateKey = { ip: string };

async function consumeInviteRate(kind: 'redeem' | 'invitePreview', key: RateKey): Promise<void> {
  const limit = await consumeRateLimit({ kind, ip: key.ip });
  if (limit.limited) {
    const message = kind === 'redeem' ? 'Too many redeem attempts. Try again later.' : 'Too many requests. Try again later.';
    throw new HttpError(429, 'rate_limited', message, { retry_after_seconds: limit.retryAfterSeconds });
  }
}

/** Public card for the /i page and for agents deciding whether to redeem. One 404 for every invalid state. */
export async function previewInvite(token: string, key: RateKey) {
  assertAgentGuestsEnabled();
  await consumeInviteRate('invitePreview', key);
  const db = getDb();
  const invite = await findInviteByToken(db, token);
  if (!invite || inviteStatus(invite) !== 'active') throw new HttpError(404, 'invite_not_found', INVITE_NOT_FOUND);
  const [agent] = await db.select().from(agents).where(eq(agents.id, invite.agentId)).limit(1);
  if (!agent || agent.revokedAt || !agent.shared) throw new HttpError(404, 'invite_not_found', INVITE_NOT_FOUND);
  const [owner] = await db
    .select({ handle: workspaces.handle, name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, invite.workspaceId))
    .limit(1);
  if (!owner?.handle) throw new HttpError(404, 'invite_not_found', INVITE_NOT_FOUND);
  const offers = await offerCards(db, await inviteOfferIds(db, invite.id));
  if (offers.length === 0) throw new HttpError(404, 'invite_not_found', INVITE_NOT_FOUND);
  return {
    address: `@${owner.handle}/${agent.name}`,
    owner: { name: owner.name, handle: owner.handle },
    agent: { name: agent.name, description: agent.description },
    offers,
    expires_at: invite.expiresAt.toISOString(),
    uses_left: invite.maxUses - invite.uses,
  };
}

/** Random g- handle: 10 base32 characters, about 50 bits. */
function inviteHandle(): string {
  return INVITE_HANDLE_PREFIX + Array.from(randomBytes(10), (b) => HANDLE_ALPHABET[b & 31]).join('');
}

export type RedeemTarget =
  | { kind: 'new'; name: string; description?: string; delivery?: DeliveryInput }
  | { kind: 'existing'; caller: AgentPrincipal };

type ShareCard = {
  address: string;
  status: string;
  daily_cap: number;
  offers: Awaited<ReturnType<typeof offerCards>>;
};

export type RedeemResult =
  | { kind: 'existing'; share: ShareCard; created: boolean }
  | { kind: 'new'; share: ShareCard; agent: AgentRow; apiKey: string; workspace: { id: string; handle: string }; claimToken: string };

async function shareCard(db: Db, share: AgentShareRow, address: string): Promise<ShareCard> {
  const rows = await db
    .select({ offerId: agentShareOffers.offerId })
    .from(agentShareOffers)
    .where(eq(agentShareOffers.shareId, share.id));
  return {
    address,
    status: share.status,
    daily_cap: share.dailyCap,
    offers: await offerCards(
      db,
      rows.map((row) => row.offerId),
    ),
  };
}

export async function redeemInvite(input: { token: string; label?: string; target: RedeemTarget; rateKey: RateKey }): Promise<RedeemResult> {
  assertAgentGuestsEnabled();
  await consumeInviteRate('redeem', input.rateKey);
  const { target } = input;
  if (target.kind === 'new' && !AGENT_NAME_PATTERN.test(target.name)) {
    throw new HttpError(
      400,
      'invalid_name',
      'Agent name must start with a letter and contain only letters, numbers, underscores, or hyphens (max 64).',
    );
  }
  const label = cleanLabel(input.label);
  const columns = target.kind === 'new' && target.delivery ? deliveryColumns(target.delivery) : null;
  const db = getDb();

  // Only the random handle can collide on insert. Retry that case with a fresh one.
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await db.transaction((tx) =>
        redeemInTx(tx, { token: input.token, label, target, columns, ip: input.rateKey.ip }),
      );
      return result;
    } catch (err) {
      if (target.kind === 'new' && attempt < 2 && isUniqueViolation(err)) continue;
      throw err;
    }
  }
}

async function redeemInTx(
  tx: Db,
  input: {
    token: string;
    label: string | null;
    target: RedeemTarget;
    columns: ReturnType<typeof deliveryColumns> | null;
    ip: string;
  },
): Promise<RedeemResult> {
  const found = await findInviteByToken(tx, input.token);
  if (!found) throw new HttpError(404, 'invite_not_found', INVITE_NOT_FOUND);
  await tx.execute(sql`select id from agent_invites where id = ${found.id} for update`);
  const [invite] = await tx.select().from(agentInvites).where(eq(agentInvites.id, found.id)).limit(1);
  if (!invite) throw new HttpError(404, 'invite_not_found', INVITE_NOT_FOUND);
  const status = inviteStatus(invite);
  if (status !== 'active') throw redeemError(status);

  await tx.execute(sql`select id from agents where id = ${invite.agentId} for update`);
  const [owner] = await tx.select().from(agents).where(eq(agents.id, invite.agentId)).limit(1);
  if (!owner || owner.revokedAt || !owner.shared) {
    throw new HttpError(409, 'agent_not_shared', 'The owner stopped sharing this agent.');
  }
  const ownerHandle = await workspaceHandle(tx, invite.workspaceId);
  const address = `@${ownerHandle}/${owner.name}`;
  const offerIds = await inviteOfferIds(tx, invite.id);
  if (offerIds.length === 0) throw new HttpError(409, 'invite_has_no_offers', 'Every offer on this invite was deleted.');
  const label = input.label ?? invite.label;
  const shareStatus = invite.approveOnRedeem ? 'approved' : 'pending';

  if (input.target.kind === 'existing') {
    const guestWorkspaceId = input.target.caller.workspaceId;
    if (guestWorkspaceId === invite.workspaceId) {
      throw new HttpError(400, 'invalid_guest', "You cannot redeem an invite for your own workspace's agent.");
    }
    await tx.execute(
      sql`select id from agent_shares where agent_id = ${owner.id} and guest_workspace_id = ${guestWorkspaceId} for update`,
    );
    const [existing] = await tx
      .select()
      .from(agentShares)
      .where(and(eq(agentShares.agentId, owner.id), eq(agentShares.guestWorkspaceId, guestWorkspaceId)))
      .limit(1);
    // An invite never undoes a revoke: only the owner can grant a revoked guest again (invite_guest).
    if (existing?.status === 'revoked') throw new HttpError(403, 'share_revoked', SHARE_REVOKED_MESSAGE);
    // A live share is left alone: redeeming again is idempotent and consumes no use.
    if (existing) return { kind: 'existing', share: await shareCard(tx, existing, address), created: false };
    await assertGuestSlot(tx, owner, GUEST_SLOT_MESSAGE);
    const [share] = await tx
      .insert(agentShares)
      .values({
        agentId: owner.id,
        guestWorkspaceId,
        status: shareStatus,
        dailyCap: invite.dailyCap,
        inviteId: invite.id,
        label,
        source: 'agent_invite',
      })
      .returning();
    if (!share) throw new HttpError(500, 'internal_error', 'Something went wrong.');
    await replaceShareOffers(tx, share.id, offerIds);
    await consumeUse(tx, invite.id);
    return { kind: 'existing', share: await shareCard(tx, share, address), created: true };
  }

  // A new workspace has no history to check, so the redeem source stands in for the person: a source
  // (client IP, per invite) whose earlier redeem was revoked cannot mint a fresh workspace from the same link.
  const redeemSourceHash = sha256(`${invite.id}:${input.ip}`);
  const [revokedSource] = await tx
    .select({ id: agentShares.id })
    .from(agentShares)
    .where(
      and(
        eq(agentShares.inviteId, invite.id),
        eq(agentShares.redeemSourceHash, redeemSourceHash),
        eq(agentShares.status, 'revoked'),
      ),
    )
    .limit(1);
  if (revokedSource) throw new HttpError(403, 'share_revoked', SHARE_REVOKED_MESSAGE);
  await assertGuestSlot(tx, owner, GUEST_SLOT_MESSAGE);
  const claimToken = randomToken('rsc_');
  const apiKey = randomToken('rsk_');
  const name = `${label ?? 'Guest'} (guest of @${ownerHandle})`.slice(0, WORKSPACE_NAME_MAX);
  const [workspace] = await tx
    .insert(workspaces)
    .values({
      name,
      handle: inviteHandle(),
      origin: 'invite',
      claimTokenHash: sha256(claimToken),
      claimExpiresAt: new Date(Date.now() + CLAIM_TOKEN_TTL_DAYS * DAY_MS),
    })
    .returning();
  if (!workspace?.handle) throw new HttpError(500, 'internal_error', 'Something went wrong.');
  const [agent] = await tx
    .insert(agents)
    .values({
      workspaceId: workspace.id,
      name: input.target.name,
      description: cleanDescription(input.target.description),
      ...(input.columns ?? {}),
    })
    .returning();
  if (!agent) throw new HttpError(500, 'internal_error', 'Something went wrong.');
  await tx.insert(agentKeys).values({ agentId: agent.id, tokenHash: sha256(apiKey), tokenPrefix: tokenPrefix(apiKey) });
  const [share] = await tx
    .insert(agentShares)
    .values({
      agentId: owner.id,
      guestWorkspaceId: workspace.id,
      status: shareStatus,
      dailyCap: invite.dailyCap,
      inviteId: invite.id,
      label,
      source: 'agent_invite',
      redeemSourceHash,
    })
    .returning();
  if (!share) throw new HttpError(500, 'internal_error', 'Something went wrong.');
  await replaceShareOffers(tx, share.id, offerIds);
  await consumeUse(tx, invite.id);
  return {
    kind: 'new',
    share: await shareCard(tx, share, address),
    agent,
    apiKey,
    workspace: { id: workspace.id, handle: workspace.handle },
    claimToken,
  };
}

async function consumeUse(tx: Db, inviteId: string): Promise<void> {
  const [bumped] = await tx
    .update(agentInvites)
    .set({ uses: sql`${agentInvites.uses} + 1` })
    .where(and(eq(agentInvites.id, inviteId), sql`${agentInvites.uses} < ${agentInvites.maxUses}`))
    .returning({ id: agentInvites.id });
  if (!bumped) throw redeemError('exhausted');
}

/**
 * Delete unclaimed invite workspaces that never did anything: older than the idle window,
 * no agent key ever used, and no task, message, or wake. A workspace with history is kept.
 */
export async function cleanupUnclaimedInviteWorkspaces(limit = 200, now = new Date()): Promise<{ deleted: number }> {
  const db = getDb();
  const cutoff = new Date(now.getTime() - INVITE_WORKSPACE_IDLE_DAYS * DAY_MS);
  const candidates = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.origin, 'invite'), isNull(workspaces.claimedAt), lt(workspaces.createdAt, cutoff)))
    .limit(limit);
  let deleted = 0;
  for (const candidate of candidates) {
    const removed = await db.transaction(async (tx) => {
      await tx.execute(sql`select id from workspaces where id = ${candidate.id} for update`);
      const [workspace] = await tx.select().from(workspaces).where(eq(workspaces.id, candidate.id)).limit(1);
      if (!workspace || workspace.origin !== 'invite' || workspace.claimedAt || workspace.createdAt >= cutoff) return false;
      const agentIds = (await tx.select({ id: agents.id }).from(agents).where(eq(agents.workspaceId, workspace.id))).map(
        (row) => row.id,
      );
      if (agentIds.length > 0) {
        const [usedKey] = await tx
          .select({ id: agentKeys.id })
          .from(agentKeys)
          .where(and(inArray(agentKeys.agentId, agentIds), isNotNull(agentKeys.lastUsedAt)))
          .limit(1);
        if (usedKey) return false;
      }
      const [task] = await tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(or(eq(tasks.workspaceId, workspace.id), eq(tasks.fromWorkspaceId, workspace.id)))
        .limit(1);
      if (task) return false;
      const [message] = await tx.select({ id: messages.id }).from(messages).where(eq(messages.workspaceId, workspace.id)).limit(1);
      if (message) return false;
      const [wake] = await tx.select({ id: wakes.id }).from(wakes).where(eq(wakes.workspaceId, workspace.id)).limit(1);
      if (wake) return false;
      // A revoked share carries the redeem-source block. Keep the workspace so the block outlives cleanup.
      const [revoked] = await tx
        .select({ id: agentShares.id })
        .from(agentShares)
        .where(and(eq(agentShares.guestWorkspaceId, workspace.id), eq(agentShares.status, 'revoked')))
        .limit(1);
      if (revoked) return false;
      await tx.delete(agentShares).where(eq(agentShares.guestWorkspaceId, workspace.id));
      if (agentIds.length > 0) await tx.delete(agents).where(inArray(agents.id, agentIds));
      await tx.delete(workspaces).where(eq(workspaces.id, workspace.id));
      return true;
    });
    if (removed) deleted += 1;
  }
  return { deleted };
}
