import { and, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db';
import {
  agentInvites,
  agentOffers,
  customerInvites,
  users,
  agentShareOffers,
  agentShares,
  agents,
  tasks,
  workspaces,
  type AgentRow,
  type AgentShareRow,
} from '@/db/schema';
import type { AgentPrincipal } from './agents';
import {
  ACCESS_REVOKED_REASON,
  AGENT_NAME_PATTERN,
  BOT_GUEST_TASK_RATE_KIND,
  DEFAULT_SHARE_DAILY_CAP,
  FORM_NOTES_MAX,
  GUEST_TASK_RATE_KIND,
  HANDLE_PATTERN,
  MAX_SHARE_DAILY_CAP,
  OFFER_DESCRIPTION_MAX,
  OFFER_NAME_PATTERN,
  SHARE_CAP_WINDOW_MS,
  SHARED_ADDRESS_PATTERN,
  TASK_DESCRIPTION_MAX,
  TASK_TITLE_MAX,
} from './constants';
import { brandingFor, cardBranding } from './customer-branding';
import { HttpError, isForeignKeyViolation, isUniqueViolation } from './errors';
import { assertOfferNameNotValetto, normalizeOfferTitle, offerDisplayTitle } from './offer-title';
import { assertInputSchema, validateInput, type InputSchema } from './input-schema';
import { assertGuestWorkspaceLimit, PlanLimitError } from './plans';
import { consumeKeyedRateLimit } from './rate-limit';
import { assertResultSchema, withResultOrder } from './validate';
import { deliverWebhookWake, enqueueWake } from './wakes';

export type RecipientAddress =
  | { kind: 'workspace'; name: string }
  | { kind: 'shared'; handle: string; agentName: string };

const SHARED_AGENT_MISSING = 'No shared agent was found at that address.';

export function parseRecipient(to: string): RecipientAddress {
  if (!to.includes('/') && !to.startsWith('@')) {
    if (!AGENT_NAME_PATTERN.test(to)) {
      throw new HttpError(
        400,
        'invalid_name',
        'Agent name must start with a letter and contain only letters, numbers, underscores, or hyphens (max 64).',
      );
    }
    return { kind: 'workspace', name: to };
  }
  const match = SHARED_ADDRESS_PATTERN.exec(to);
  if (!match?.[1] || !match[2]) {
    throw new HttpError(400, 'invalid_address', 'A shared agent is addressed as @handle/agentname.');
  }
  return { kind: 'shared', handle: match[1], agentName: match[2] };
}

export function assertHandle(value: string): string {
  const handle = value.trim();
  if (!HANDLE_PATTERN.test(handle)) {
    throw new HttpError(
      400,
      'invalid_handle',
      'A handle is 2–32 characters: a lowercase letter, then lowercase letters, numbers, or hyphens.',
    );
  }
  return handle;
}

function assertOfferName(value: string): string {
  const name = value.trim();
  if (!OFFER_NAME_PATTERN.test(name)) {
    throw new HttpError(
      400,
      'invalid_offer',
      'An offer name is 1–64 characters: a lowercase letter, then lowercase letters, numbers, underscores, or hyphens.',
    );
  }
  return name;
}

export function assertDailyCap(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_SHARE_DAILY_CAP) {
    throw new HttpError(400, 'validation_error', `daily_cap must be an integer from 1 to ${MAX_SHARE_DAILY_CAP}.`);
  }
  return value;
}

function assertOfferDescription(value: string): string {
  const description = value.trim();
  if (description.length < 1 || description.length > OFFER_DESCRIPTION_MAX) {
    throw new HttpError(400, 'validation_error', `Offer description must be 1–${OFFER_DESCRIPTION_MAX} characters.`);
  }
  return description;
}

export type PublicWorkspace = {
  id: string;
  name: string;
  handle: string | null;
  created_at: string;
};

export function publicWorkspace(workspace: { id: string; name: string; handle: string | null; createdAt: Date }): PublicWorkspace {
  return {
    id: workspace.id,
    name: workspace.name,
    handle: workspace.handle,
    created_at: workspace.createdAt.toISOString(),
  };
}

export async function setWorkspaceHandle(workspaceId: string, handle: string | null): Promise<PublicWorkspace> {
  const db = getDb();
  try {
    const updated = await db.transaction(async (tx) => {
      await tx.execute(sql`select id from workspaces where id = ${workspaceId} for update`);
      if (handle === null) {
        const [sharedAgent] = await tx
          .select({ id: agents.id })
          .from(agents)
          .where(and(eq(agents.workspaceId, workspaceId), eq(agents.shared, true), isNull(agents.revokedAt)))
          .limit(1);
        if (sharedAgent) {
          throw new HttpError(409, 'handle_in_use', 'Turn off sharing before clearing the handle.');
        }
      }
      const next = handle === null ? null : assertHandle(handle);
      const [row] = await tx
        .update(workspaces)
        .set({ handle: next })
        .where(eq(workspaces.id, workspaceId))
        .returning({
          id: workspaces.id,
          name: workspaces.name,
          handle: workspaces.handle,
          createdAt: workspaces.createdAt,
        });
      if (!row) throw new HttpError(404, 'not_found', 'No workspace was found.');
      return row;
    });
    return publicWorkspace(updated);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new HttpError(409, 'handle_taken', 'That handle is already in use.');
    }
    throw err;
  }
}

export async function lockOwnerAgent(tx: Db, workspaceId: string, agentId: string): Promise<AgentRow> {
  await tx.execute(sql`select id from agents where id = ${agentId} and workspace_id = ${workspaceId} for update`);
  const [agent] = await tx
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)))
    .limit(1);
  if (!agent || agent.revokedAt || agent.role !== 'agent') throw new HttpError(404, 'not_found', 'No agent was found.');
  return agent;
}

export async function agentInWorkspaceByName(workspaceId: string, name: string): Promise<AgentRow> {
  if (!AGENT_NAME_PATTERN.test(name)) {
    throw new HttpError(
      400,
      'invalid_name',
      'Agent name must start with a letter and contain only letters, numbers, underscores, or hyphens (max 64).',
    );
  }
  const [agent] = await getDb()
    .select()
    .from(agents)
    .where(and(eq(agents.workspaceId, workspaceId), eq(agents.name, name)))
    .limit(1);
  if (!agent || agent.revokedAt || agent.role !== 'agent') {
    throw new HttpError(404, 'not_found', `No active agent named ${name} is in this workspace.`);
  }
  return agent;
}

export async function deliverWakeIds(wakeIds: string[]): Promise<void> {
  for (const wakeId of wakeIds) {
    await deliverWebhookWake(wakeId);
  }
}

export async function failGuestTasks(
  tx: Db,
  agent: AgentRow,
  guestWorkspaceId: string | null,
): Promise<{ wakeIds: string[]; failed: number }> {
  const conditions = [
    eq(tasks.toAgentId, agent.id),
    isNotNull(tasks.fromWorkspaceId),
    ne(tasks.fromWorkspaceId, agent.workspaceId),
    // Held review_first tasks close too, and what was held is dropped, so the sender never sees it.
    inArray(tasks.status, ['open', 'needs_info', 'in_review', 'awaiting_release']),
  ];
  if (guestWorkspaceId) conditions.push(eq(tasks.fromWorkspaceId, guestWorkspaceId));
  const closed = await tx
    .update(tasks)
    .set({
      status: 'failed',
      failReason: ACCESS_REVOKED_REASON,
      result: sql`case when ${tasks.status} = 'awaiting_release' then null else ${tasks.result} end`,
      question: sql`case when ${tasks.status} = 'awaiting_release' then null else ${tasks.question} end`,
      heldAction: null,
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(and(...conditions))
    .returning();
  const wakeIds: string[] = [];
  for (const task of closed) {
    const wakeId = await enqueueWake(tx, {
      workspaceId: task.workspaceId,
      agentId: task.fromAgentId,
      reason: 'failure',
      taskId: task.id,
    });
    if (wakeId) wakeIds.push(wakeId);
  }
  return { wakeIds, failed: closed.length };
}

/** Invite workspaces cannot share agents or create invites until a human claims them. */
export async function assertClaimed(db: Db, workspaceId: string): Promise<void> {
  const [workspace] = await db
    .select({ origin: workspaces.origin, claimedAt: workspaces.claimedAt })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (workspace?.origin === 'invite' && !workspace.claimedAt) {
    throw new HttpError(403, 'claim_required', 'Claim this workspace before sharing its agents.');
  }
}

export async function setAgentShared(workspaceId: string, agentId: string, shared: boolean): Promise<AgentRow> {
  const written = await getDb().transaction(async (tx) => {
    const agent = await lockOwnerAgent(tx, workspaceId, agentId);
    if (shared) {
      await assertClaimed(tx, workspaceId);
      const [workspace] = await tx
        .select({ handle: workspaces.handle })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1);
      if (!workspace?.handle) {
        throw new HttpError(400, 'handle_required', 'Set a workspace handle before sharing an agent.');
      }
    }
    const [updated] = await tx.update(agents).set({ shared }).where(eq(agents.id, agent.id)).returning();
    if (!updated) throw new HttpError(500, 'internal_error', 'Something went wrong.');
    const closed = shared ? { wakeIds: [] as string[], failed: 0 } : await failGuestTasks(tx, updated, null);
    return { agent: updated, wakeIds: closed.wakeIds };
  });
  await deliverWakeIds(written.wakeIds);
  return written.agent;
}

export function serializeOffer(offer: typeof agentOffers.$inferSelect) {
  return {
    id: offer.id,
    name: offer.name,
    /** What the owner set, or null. */
    title: offer.title,
    /** What customers see: title, else the humanized name. */
    display_title: offerDisplayTitle(offer),
    description: offer.description,
    result_schema: offer.resultSchema,
    input_schema: offer.inputSchema ?? null,
    notes_enabled: offer.notesEnabled,
    created_at: offer.createdAt.toISOString(),
  };
}

/** Max notes length a guest may send on this offer: null for a free-text offer, 0 when notes are off. */
export function notesMaxFor(offer: { inputSchema: Record<string, unknown> | null; notesEnabled: boolean }): number | null {
  if (!offer.inputSchema) return null;
  return offer.notesEnabled ? FORM_NOTES_MAX : 0;
}

export const INPUT_SCHEMA_CLEARED_WARNING = 'Guests can now send free text for this offer.';

/** undefined keeps the stored value, null clears it, anything else must pass the input profile. */
function parseInputSchemaArg(raw: unknown): InputSchema | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  return assertInputSchema(raw);
}

function assertNotesSetting(inputSchema: unknown, notesEnabled: boolean): void {
  if (!notesEnabled && !inputSchema) {
    throw new HttpError(
      400,
      'notes_required_without_input_schema',
      'notes_enabled can only be false on an offer with input_schema. A free-text offer needs its description.',
    );
  }
}

export async function listOffers(workspaceId: string, agentId: string) {
  await lockOwnerAgent(getDb(), workspaceId, agentId);
  const rows = await getDb()
    .select()
    .from(agentOffers)
    .where(eq(agentOffers.agentId, agentId))
    .orderBy(agentOffers.createdAt);
  return rows.map(serializeOffer);
}

export async function createOffer(
  workspaceId: string,
  agentId: string,
  input: {
    name: string;
    title?: unknown;
    description: string;
    resultSchema: unknown;
    inputSchema?: unknown;
    notesEnabled?: boolean;
  },
) {
  const name = assertOfferName(input.name);
  assertOfferNameNotValetto(name);
  const title = normalizeOfferTitle(input.title) ?? null;
  const description = assertOfferDescription(input.description);
  const resultSchema = withResultOrder(assertResultSchema(input.resultSchema));
  const inputSchema = parseInputSchemaArg(input.inputSchema) ?? null;
  const notesEnabled = input.notesEnabled ?? true;
  assertNotesSetting(inputSchema, notesEnabled);
  try {
    const [offer] = await getDb().transaction(async (tx) => {
      const agent = await lockOwnerAgent(tx, workspaceId, agentId);
      const rows = await tx
        .insert(agentOffers)
        .values({ agentId: agent.id, name, title, description, resultSchema, inputSchema, notesEnabled })
        .returning();
      if (rows[0]) await grantToAllOffersCustomers(tx, agent.id, rows[0].id);
      return rows;
    });
    if (!offer) throw new HttpError(500, 'internal_error', 'Something went wrong.');
    return serializeOffer(offer);
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, 'offer_taken', `An offer named ${name} already exists on this agent.`);
    throw err;
  }
}

/**
 * A customer whose invite grants all offers gets every new offer too (spec 11.4), in the same
 * transaction, so agent_share_offers stays the only grant table the task path reads.
 */
async function grantToAllOffersCustomers(tx: Db, agentId: string, offerId: string): Promise<void> {
  await tx.execute(sql`
    insert into agent_share_offers (share_id, offer_id)
    select s.id, ${offerId}::uuid
    from agent_shares s
    join customer_invites ci on ci.id = s.customer_invite_id
    where s.agent_id = ${agentId} and s.status <> 'revoked' and ci.all_offers
    on conflict do nothing
  `);
}

/**
 * Shares that use one of the agent's guest slots: approved shares of any source, plus pending
 * invite_guest and agent-invite shares. A pending customer request counts only toward MAX_PENDING_PER_BOT.
 */
export async function countGuestSlots(tx: Db, agentId: string): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(agentShares)
    .where(
      and(
        eq(agentShares.agentId, agentId),
        sql`(${agentShares.status} = 'approved' or (${agentShares.status} = 'pending' and ${agentShares.source} <> 'customer'))`,
      ),
    );
  const used = Number(row?.count ?? 0);
  return Number.isFinite(used) ? used : 0;
}

/** Refuse one more guest slot on a free owner at the cap. `message` rewords the error for whoever sees it. */
export async function assertGuestSlot(tx: Db, owner: AgentRow, message?: string): Promise<void> {
  try {
    await assertGuestWorkspaceLimit(owner.workspaceId, await countGuestSlots(tx, owner.id), tx);
  } catch (err) {
    if (message && err instanceof PlanLimitError) throw new PlanLimitError({ ...err.body, message });
    throw err;
  }
}

export async function updateOffer(
  workspaceId: string,
  agentId: string,
  offerId: string,
  input: {
    name?: string;
    title?: unknown;
    description?: string;
    resultSchema?: unknown;
    inputSchema?: unknown;
    notesEnabled?: boolean;
  },
) {
  if (
    input.name === undefined &&
    input.title === undefined &&
    input.description === undefined &&
    input.resultSchema === undefined &&
    input.inputSchema === undefined &&
    input.notesEnabled === undefined
  ) {
    throw new HttpError(400, 'validation_error', 'Send a name, title, description, result_schema, input_schema, or notes_enabled to update.');
  }
  const name = input.name === undefined ? undefined : assertOfferName(input.name);
  const title = normalizeOfferTitle(input.title);
  const description = input.description === undefined ? undefined : assertOfferDescription(input.description);
  const resultSchema = input.resultSchema === undefined ? undefined : withResultOrder(assertResultSchema(input.resultSchema));
  const inputSchema = parseInputSchemaArg(input.inputSchema);
  const notesEnabled = input.notesEnabled;
  try {
    const offer = await getDb().transaction(async (tx) => {
      const agent = await lockOwnerAgent(tx, workspaceId, agentId);
      const [existing] = await tx
        .select()
        .from(agentOffers)
        .where(and(eq(agentOffers.id, offerId), eq(agentOffers.agentId, agent.id)))
        .limit(1);
      if (!existing) throw new HttpError(404, 'not_found', 'No offer was found.');
      if (name !== undefined && name !== existing.name) assertOfferNameNotValetto(name);
      assertNotesSetting(
        inputSchema === undefined ? existing.inputSchema : inputSchema,
        notesEnabled ?? existing.notesEnabled,
      );
      const [updated] = await tx
        .update(agentOffers)
        .set({
          ...(name !== undefined ? { name } : {}),
          ...(title !== undefined ? { title } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(resultSchema !== undefined ? { resultSchema } : {}),
          ...(inputSchema !== undefined ? { inputSchema } : {}),
          ...(notesEnabled !== undefined ? { notesEnabled } : {}),
        })
        .where(eq(agentOffers.id, existing.id))
        .returning();
      return updated ? { row: updated, cleared: inputSchema === null && existing.inputSchema !== null } : null;
    });
    if (!offer) throw new HttpError(500, 'internal_error', 'Something went wrong.');
    return { offer: serializeOffer(offer.row), ...(offer.cleared ? { warning: INPUT_SCHEMA_CLEARED_WARNING } : {}) };
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, 'offer_taken', 'An offer with that name already exists on this agent.');
    throw err;
  }
}

export async function deleteOffer(workspaceId: string, agentId: string, offerId: string): Promise<void> {
  try {
    const removed = await getDb().transaction(async (tx) => {
      const agent = await lockOwnerAgent(tx, workspaceId, agentId);
      const rows = await tx
        .delete(agentOffers)
        .where(and(eq(agentOffers.id, offerId), eq(agentOffers.agentId, agent.id)))
        .returning({ id: agentOffers.id });
      return rows.length;
    });
    if (removed === 0) throw new HttpError(404, 'not_found', 'No offer was found.');
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      throw new HttpError(409, 'offer_in_use', 'This offer is on a task and cannot be deleted.');
    }
    throw err;
  }
}

export async function upsertOfferByName(
  workspaceId: string,
  agentId: string,
  input: {
    name: string;
    title?: unknown;
    description: string;
    resultSchema: unknown;
    inputSchema?: unknown;
    notesEnabled?: boolean;
  },
) {
  const name = assertOfferName(input.name);
  // Omitting title keeps the stored one; null or "" clears it.
  const title = normalizeOfferTitle(input.title);
  const description = assertOfferDescription(input.description);
  const resultSchema = withResultOrder(assertResultSchema(input.resultSchema));
  // Omitting input_schema keeps the stored shape; only an explicit null reopens free text.
  const inputSchema = parseInputSchemaArg(input.inputSchema);
  const notesEnabled = input.notesEnabled;
  const written = await getDb().transaction(async (tx) => {
    const agent = await lockOwnerAgent(tx, workspaceId, agentId);
    const [existing] = await tx
      .select()
      .from(agentOffers)
      .where(and(eq(agentOffers.agentId, agent.id), eq(agentOffers.name, name)))
      .limit(1);
    if (!existing) {
      assertOfferNameNotValetto(name);
      const finalSchema = inputSchema ?? null;
      const finalNotes = notesEnabled ?? true;
      assertNotesSetting(finalSchema, finalNotes);
      const [created] = await tx
        .insert(agentOffers)
        .values({
          agentId: agent.id,
          name,
          title: title ?? null,
          description,
          resultSchema,
          inputSchema: finalSchema,
          notesEnabled: finalNotes,
        })
        .returning();
      if (!created) throw new HttpError(500, 'internal_error', 'Something went wrong.');
      await grantToAllOffersCustomers(tx, agent.id, created.id);
      return { offer: created, created: true, cleared: false };
    }
    assertNotesSetting(inputSchema === undefined ? existing.inputSchema : inputSchema, notesEnabled ?? existing.notesEnabled);
    const [updated] = await tx
      .update(agentOffers)
      .set({
        description,
        resultSchema,
        ...(title !== undefined ? { title } : {}),
        ...(inputSchema !== undefined ? { inputSchema } : {}),
        ...(notesEnabled !== undefined ? { notesEnabled } : {}),
      })
      .where(eq(agentOffers.id, existing.id))
      .returning();
    if (!updated) throw new HttpError(500, 'internal_error', 'Something went wrong.');
    return { offer: updated, created: false, cleared: inputSchema === null && existing.inputSchema !== null };
  });
  return {
    offer: serializeOffer(written.offer),
    created: written.created,
    ...(written.cleared ? { warning: INPUT_SCHEMA_CLEARED_WARNING } : {}),
  };
}

export async function deleteOfferByName(workspaceId: string, agentId: string, name: string): Promise<void> {
  const offerName = assertOfferName(name);
  const [offer] = await getDb()
    .select({ id: agentOffers.id })
    .from(agentOffers)
    .innerJoin(agents, eq(agents.id, agentOffers.agentId))
    .where(and(eq(agents.workspaceId, workspaceId), eq(agents.id, agentId), eq(agentOffers.name, offerName)))
    .limit(1);
  if (!offer) throw new HttpError(404, 'not_found', 'No offer was found.');
  await deleteOffer(workspaceId, agentId, offer.id);
}

type ShareRow = AgentShareRow;

async function offersForShares(db: Db, shareIds: string[]) {
  const map = new Map<string, { id: string; name: string }[]>();
  if (shareIds.length === 0) return map;
  const rows = await db
    .select({ shareId: agentShareOffers.shareId, id: agentOffers.id, name: agentOffers.name })
    .from(agentShareOffers)
    .innerJoin(agentOffers, eq(agentOffers.id, agentShareOffers.offerId))
    .where(inArray(agentShareOffers.shareId, shareIds));
  for (const row of rows) {
    const list = map.get(row.shareId) ?? [];
    list.push({ id: row.id, name: row.name });
    map.set(row.shareId, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return map;
}

type ShareExtras = { invitePrefix: string | null; customerEmail: string | null; customerInvitePrefix: string | null };

/** Owner-only view of a share. customer_email never goes to a guest, a card, or an agent tool. */
function shareBody(share: ShareRow, guestHandle: string | null, extras: ShareExtras, offers: { id: string; name: string }[]) {
  return {
    id: share.id,
    agent_id: share.agentId,
    guest_workspace_id: share.guestWorkspaceId,
    guest_handle: guestHandle,
    label: share.label,
    source: share.source,
    invite_id: share.inviteId,
    invite_prefix: extras.invitePrefix,
    customer_invite_id: share.customerInviteId,
    customer_invite_prefix: extras.customerInvitePrefix,
    customer_email: extras.customerEmail,
    status: share.status,
    daily_cap: share.dailyCap,
    offers,
    created_at: share.createdAt.toISOString(),
    updated_at: share.updatedAt.toISOString(),
  };
}

export async function serializeShare(db: Db, share: ShareRow, guestHandle: string | null) {
  const offers = await offersForShares(db, [share.id]);
  const extras: ShareExtras = { invitePrefix: null, customerEmail: null, customerInvitePrefix: null };
  if (share.inviteId) {
    const [invite] = await db
      .select({ prefix: agentInvites.tokenPrefix })
      .from(agentInvites)
      .where(eq(agentInvites.id, share.inviteId))
      .limit(1);
    extras.invitePrefix = invite?.prefix ?? null;
  }
  if (share.customerInviteId) {
    const [invite] = await db
      .select({ prefix: customerInvites.tokenPrefix })
      .from(customerInvites)
      .where(eq(customerInvites.id, share.customerInviteId))
      .limit(1);
    extras.customerInvitePrefix = invite?.prefix ?? null;
  }
  if (share.requestedByUserId) {
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, share.requestedByUserId)).limit(1);
    extras.customerEmail = user?.email ?? null;
  }
  return shareBody(share, guestHandle, extras, offers.get(share.id) ?? []);
}

export async function loadOffersByName(tx: Db, agentId: string, names: string[]) {
  const rows = await tx
    .select()
    .from(agentOffers)
    .where(and(eq(agentOffers.agentId, agentId), inArray(agentOffers.name, names)));
  if (rows.length !== names.length) {
    const found = new Set(rows.map((row) => row.name));
    const missing = names.find((name) => !found.has(name));
    throw new HttpError(404, 'offer_not_found', `No offer named ${missing ?? 'that'} is on this agent.`);
  }
  return rows;
}

export async function replaceShareOffers(tx: Db, shareId: string, offerIds: string[]) {
  await tx.delete(agentShareOffers).where(eq(agentShareOffers.shareId, shareId));
  if (offerIds.length === 0) return;
  await tx.insert(agentShareOffers).values(offerIds.map((offerId) => ({ shareId, offerId })));
}

export function dedupeOfferNames(names: string[]): string[] {
  if (names.length < 1 || names.length > 50) {
    throw new HttpError(400, 'validation_error', 'Send between 1 and 50 offer names.');
  }
  return [...new Set(names.map((name) => assertOfferName(name)))];
}

export async function listShares(workspaceId: string, agentId: string) {
  const db = getDb();
  await lockOwnerAgent(db, workspaceId, agentId);
  const rows = await db
    .select({
      share: agentShares,
      guestHandle: workspaces.handle,
      invitePrefix: agentInvites.tokenPrefix,
      customerInvitePrefix: customerInvites.tokenPrefix,
      customerEmail: users.email,
    })
    .from(agentShares)
    .innerJoin(workspaces, eq(workspaces.id, agentShares.guestWorkspaceId))
    .leftJoin(agentInvites, eq(agentInvites.id, agentShares.inviteId))
    .leftJoin(customerInvites, eq(customerInvites.id, agentShares.customerInviteId))
    .leftJoin(users, eq(users.id, agentShares.requestedByUserId))
    .where(eq(agentShares.agentId, agentId))
    .orderBy(agentShares.createdAt);
  const offers = await offersForShares(
    db,
    rows.map((row) => row.share.id),
  );
  return rows.map((row) =>
    shareBody(
      row.share,
      row.guestHandle,
      { invitePrefix: row.invitePrefix, customerEmail: row.customerEmail, customerInvitePrefix: row.customerInvitePrefix },
      offers.get(row.share.id) ?? [],
    ),
  );
}

async function guestWorkspaceByHandle(tx: Db, handle: string, ownerWorkspaceId: string) {
  const [guest] = await tx.select().from(workspaces).where(eq(workspaces.handle, handle)).limit(1);
  if (!guest) throw new HttpError(404, 'not_found', 'No workspace has that handle.');
  if (guest.id === ownerWorkspaceId) {
    throw new HttpError(400, 'invalid_guest', 'You cannot share an agent with its own workspace.');
  }
  return guest;
}

export async function inviteGuest(
  workspaceId: string,
  agentId: string,
  input: { guestHandle: string; offerNames: string[]; dailyCap?: number },
) {
  const guestHandle = assertHandle(input.guestHandle);
  const dailyCap = input.dailyCap === undefined ? DEFAULT_SHARE_DAILY_CAP : assertDailyCap(input.dailyCap);
  const offerNames = dedupeOfferNames(input.offerNames);
  const db = getDb();
  const share = await db.transaction(async (tx) => {
    const agent = await lockOwnerAgent(tx, workspaceId, agentId);
    const guest = await guestWorkspaceByHandle(tx, guestHandle, workspaceId);
    const offers = await loadOffersByName(tx, agent.id, offerNames);
    const [existing] = await tx
      .select()
      .from(agentShares)
      .where(and(eq(agentShares.agentId, agent.id), eq(agentShares.guestWorkspaceId, guest.id)))
      .limit(1);
    // A pending customer request does not hold a slot, so turning it into an invite_guest grant needs one.
    const needsSlot =
      !existing || existing.status === 'revoked' || (existing.status === 'pending' && existing.source === 'customer');
    if (needsSlot) await assertGuestSlot(tx, agent);
    const now = new Date();
    // Invite never approves. A new grant and a re-opened revoked grant are pending.
    // A grant that is already pending or approved keeps that status.
    const nextStatus = existing?.status === 'pending' || existing?.status === 'approved' ? existing.status : 'pending';
    // Re-opening a revoked share, or turning a pending customer request into a grant, makes it the owner's
    // invite_guest grant. It leaves the customer queue: no 14-day expiry, no all-offers top-ups.
    const becomesHandle = existing !== undefined && existing.source === 'customer' && existing.status !== 'approved';
    let saved: ShareRow | undefined;
    if (!existing) {
      const [created] = await tx
        .insert(agentShares)
        .values({
          agentId: agent.id,
          guestWorkspaceId: guest.id,
          status: nextStatus,
          dailyCap,
          updatedAt: now,
        })
        .returning();
      saved = created;
    } else {
      const [updated] = await tx
        .update(agentShares)
        .set({
          status: nextStatus,
          dailyCap,
          updatedAt: now,
          ...(becomesHandle ? { source: 'handle', customerInviteId: null } : {}),
        })
        .where(eq(agentShares.id, existing.id))
        .returning();
      saved = updated;
    }
    if (!saved) throw new HttpError(500, 'internal_error', 'Something went wrong.');
    await replaceShareOffers(
      tx,
      saved.id,
      offers.map((offer) => offer.id),
    );
    return { share: saved, guestHandle: guest.handle };
  });
  return serializeShare(db, share.share, share.guestHandle);
}

async function shareInWorkspace(tx: Db, workspaceId: string, agentId: string, shareId: string) {
  const agent = await lockOwnerAgent(tx, workspaceId, agentId);
  await tx.execute(sql`select id from agent_shares where id = ${shareId} and agent_id = ${agent.id} for update`);
  const [row] = await tx
    .select({ share: agentShares, guestHandle: workspaces.handle })
    .from(agentShares)
    .innerJoin(workspaces, eq(workspaces.id, agentShares.guestWorkspaceId))
    .where(and(eq(agentShares.id, shareId), eq(agentShares.agentId, agent.id)))
    .limit(1);
  if (!row) throw new HttpError(404, 'not_found', 'No share was found.');
  return { agent, ...row };
}

export async function approveShare(workspaceId: string, agentId: string, shareId: string) {
  const db = getDb();
  const saved = await db.transaction(async (tx) => {
    const current = await shareInWorkspace(tx, workspaceId, agentId, shareId);
    if (current.share.status === 'revoked') {
      throw new HttpError(409, 'share_revoked', 'This grant was revoked. Invite the guest again.');
    }
    if (current.share.status === 'approved') return current;
    // A pending customer request moves from the pending queue into the customer cap here (spec 11.6).
    if (current.share.source === 'customer') await assertGuestSlot(tx, current.agent);
    const [updated] = await tx
      .update(agentShares)
      .set({ status: 'approved', updatedAt: new Date() })
      .where(eq(agentShares.id, current.share.id))
      .returning();
    if (!updated) throw new HttpError(500, 'internal_error', 'Something went wrong.');
    return { ...current, share: updated };
  });
  return serializeShare(db, saved.share, saved.guestHandle);
}

/**
 * Re-admit a revoked customer (owner session only). The share goes straight to approved, takes a guest
 * slot, and keeps its offers; an all-offers customer also gets offers added while they were out.
 * Only customer shares: invite_guest grants are re-opened with invite_guest, agent guests with a new invite.
 */
export async function restoreCustomerShare(workspaceId: string, agentId: string, shareId: string) {
  const db = getDb();
  const saved = await db.transaction(async (tx) => {
    const current = await shareInWorkspace(tx, workspaceId, agentId, shareId);
    if (current.share.source !== 'customer') {
      throw new HttpError(409, 'not_customer_share', 'Only a customer can be restored. Invite this guest again instead.');
    }
    if (current.share.status !== 'revoked') {
      throw new HttpError(409, 'share_not_revoked', 'This customer still has access or is waiting for approval.');
    }
    await assertGuestSlot(tx, current.agent);
    const [updated] = await tx
      .update(agentShares)
      .set({ status: 'approved', updatedAt: new Date() })
      .where(eq(agentShares.id, current.share.id))
      .returning();
    if (!updated) throw new HttpError(500, 'internal_error', 'Something went wrong.');
    await tx.execute(sql`
      insert into agent_share_offers (share_id, offer_id)
      select ${updated.id}::uuid, o.id
      from agent_offers o
      join customer_invites ci on ci.id = ${updated.customerInviteId}::uuid and ci.all_offers
      where o.agent_id = ${current.agent.id}
      on conflict do nothing
    `);
    return { ...current, share: updated };
  });
  return serializeShare(db, saved.share, saved.guestHandle);
}

export async function updateShare(
  workspaceId: string,
  agentId: string,
  shareId: string,
  input: { offerNames?: string[]; dailyCap?: number },
) {
  if (input.offerNames === undefined && input.dailyCap === undefined) {
    throw new HttpError(400, 'validation_error', 'Send offers or daily_cap to update.');
  }
  const dailyCap = input.dailyCap === undefined ? undefined : assertDailyCap(input.dailyCap);
  const offerNames = input.offerNames === undefined ? undefined : dedupeOfferNames(input.offerNames);
  const db = getDb();
  const saved = await db.transaction(async (tx) => {
    const current = await shareInWorkspace(tx, workspaceId, agentId, shareId);
    if (current.share.status === 'revoked') {
      throw new HttpError(409, 'share_revoked', 'This grant was revoked. Invite the guest again.');
    }
    const [updated] = await tx
      .update(agentShares)
      .set({
        ...(dailyCap !== undefined ? { dailyCap } : {}),
        updatedAt: new Date(),
      })
      .where(eq(agentShares.id, current.share.id))
      .returning();
    if (!updated) throw new HttpError(500, 'internal_error', 'Something went wrong.');
    if (offerNames) {
      const offers = await loadOffersByName(tx, current.agent.id, offerNames);
      await replaceShareOffers(
        tx,
        updated.id,
        offers.map((offer) => offer.id),
      );
    }
    return { share: updated, guestHandle: current.guestHandle };
  });
  return serializeShare(db, saved.share, saved.guestHandle);
}

/** Revoke one locked share row and fail that guest's open tasks. Deliver the returned wake ids after commit. */
export async function revokeShareRow(
  tx: Db,
  agent: AgentRow,
  share: ShareRow,
): Promise<{ share: ShareRow; wakeIds: string[]; failed: number }> {
  if (share.status === 'revoked') return { share, wakeIds: [], failed: 0 };
  const [updated] = await tx
    .update(agentShares)
    .set({ status: 'revoked', lastRevokedAt: new Date(), updatedAt: new Date() })
    .where(eq(agentShares.id, share.id))
    .returning();
  if (!updated) throw new HttpError(500, 'internal_error', 'Something went wrong.');
  const closed = await failGuestTasks(tx, agent, updated.guestWorkspaceId);
  return { share: updated, wakeIds: closed.wakeIds, failed: closed.failed };
}

export async function revokeShare(workspaceId: string, agentId: string, shareId: string) {
  const db = getDb();
  const saved = await db.transaction(async (tx) => {
    const current = await shareInWorkspace(tx, workspaceId, agentId, shareId);
    const revoked = await revokeShareRow(tx, current.agent, current.share);
    return { ...revoked, guestHandle: current.guestHandle };
  });
  await deliverWakeIds(saved.wakeIds);
  const share = await serializeShare(db, saved.share, saved.guestHandle);
  return { share, failed_tasks: saved.failed };
}

async function shareIdForGuest(workspaceId: string, agentId: string, guestHandle: string): Promise<string> {
  const handle = assertHandle(guestHandle);
  const agent = await agentInWorkspaceByName(workspaceId, (await lockOwnerAgent(getDb(), workspaceId, agentId)).name);
  const [row] = await getDb()
    .select({ id: agentShares.id })
    .from(agentShares)
    .innerJoin(workspaces, eq(workspaces.id, agentShares.guestWorkspaceId))
    .where(and(eq(agentShares.agentId, agent.id), eq(workspaces.handle, handle)))
    .limit(1);
  if (!row) throw new HttpError(404, 'not_found', 'No share was found for that handle.');
  return row.id;
}

export async function revokeGuestByHandle(workspaceId: string, agentId: string, guestHandle: string) {
  const shareId = await shareIdForGuest(workspaceId, agentId, guestHandle);
  return revokeShare(workspaceId, agentId, shareId);
}

function addressOf(handle: string, agentName: string): string {
  return `@${handle}/${agentName}`;
}

function notShared(address: string): HttpError {
  return new HttpError(404, 'agent_not_found', `${SHARED_AGENT_MISSING} (${address})`);
}

/** The guest-facing error for an offer that is unknown or not in the grant. Same code, status, and wording for both. */
function offerNotAvailable(offer: string, address: string): HttpError {
  return new HttpError(404, 'offer_not_found', `No offer named ${offer} is available to you on ${address}. Call get_agent_card for your offers.`);
}

export type ResolvedShare = {
  recipient: AgentRow;
  offerId: string;
  resultSchema: Record<string, unknown>;
  ownerHandle: string;
  /** What to store on the task: the server title for a form offer, or the sender's. */
  title: string;
  description: string;
  inputSchema: Record<string, unknown> | null;
  input: Record<string, unknown> | null;
};

/** What a guest sent besides to/offer. Which fields are required depends on the offer. */
export type GuestTaskFields = { title?: string; description?: string; input?: unknown };

export function assertFreeTextFields(fields: GuestTaskFields): { title: string; description: string } {
  if (fields.input !== undefined) {
    throw new HttpError(
      400,
      'input_not_allowed',
      'input is only for an offer with input_schema. Send title and description for this offer.',
    );
  }
  const title = fields.title ?? '';
  const description = fields.description ?? '';
  if (title.trim().length < 1 || title.length > TASK_TITLE_MAX) {
    throw new HttpError(400, 'validation_error', `Title must be 1-${TASK_TITLE_MAX} characters.`);
  }
  if (description.length < 1 || description.length > TASK_DESCRIPTION_MAX) {
    throw new HttpError(400, 'validation_error', `Description must be 1-${TASK_DESCRIPTION_MAX} characters.`);
  }
  return { title: title.trim(), description };
}

/**
 * Form offer: the server sets the title, notes go in description, and input must match the
 * offer's schema. Runs after the grant lookup and before the daily cap, inside the same transaction.
 */
function assertFormFields(
  offer: { name: string; title: string | null; inputSchema: Record<string, unknown>; notesEnabled: boolean },
  fields: GuestTaskFields,
): { title: string; description: string; input: Record<string, unknown> } {
  if (fields.title !== undefined) {
    throw new HttpError(
      400,
      'validation_error',
      'Leave out title for an offer with input_schema. The server sets it. Put any notes in description.',
    );
  }
  const notes = fields.description ?? '';
  if (!offer.notesEnabled && notes.length > 0) {
    throw new HttpError(400, 'validation_error', 'This offer does not take notes. Leave out description.');
  }
  if (notes.length > FORM_NOTES_MAX) {
    throw new HttpError(400, 'validation_error', `Notes (description) must be at most ${FORM_NOTES_MAX} characters on a form offer.`);
  }
  if (fields.input === undefined) {
    throw new HttpError(400, 'input_required', 'This offer has input_schema. Send input that matches it.', {
      input_schema: offer.inputSchema,
    });
  }
  const checked = validateInput(offer.inputSchema, fields.input);
  if (!checked.ok) {
    if (checked.errors.some((error) => error.keyword === 'schema')) {
      console.error('input_schema failed to compile at create time', { offerName: offer.name });
    }
    throw new HttpError(400, 'invalid_input', 'input does not match the offer input_schema.', {
      validation_errors: checked.errors,
    });
  }
  const schemaTitle = typeof offer.inputSchema.title === 'string' ? offer.inputSchema.title.trim() : '';
  return {
    // The owner's offer title, else the form's own title, else the offer name. Customer views humanize
    // a stored raw name (customer-api requestTitle), so agent guests keep seeing the name they sent.
    title: (offer.title || schemaTitle || offer.name).slice(0, TASK_TITLE_MAX),
    description: notes,
    input: fields.input as Record<string, unknown>,
  };
}

export async function resolveSharedTask(
  tx: Db,
  caller: AgentPrincipal,
  address: { handle: string; agentName: string },
  offerName: string,
  fields: GuestTaskFields = {},
): Promise<ResolvedShare> {
  const shown = addressOf(address.handle, address.agentName);
  const offer = assertOfferName(offerName);
  const [owner] = await tx.select().from(workspaces).where(eq(workspaces.handle, address.handle)).limit(1);
  if (!owner) throw notShared(shown);
  await tx.execute(sql`select id from agents where workspace_id = ${owner.id} and name = ${address.agentName} for update`);
  const [recipient] = await tx
    .select()
    .from(agents)
    .where(and(eq(agents.workspaceId, owner.id), eq(agents.name, address.agentName), isNull(agents.revokedAt)))
    .limit(1);
  if (!recipient || !recipient.shared) throw notShared(shown);
  if (recipient.workspaceId === caller.workspaceId) {
    throw new HttpError(400, 'invalid_recipient', 'Use the bare agent name for an agent in your workspace.');
  }
  if (recipient.id === caller.agentId) {
    throw new HttpError(400, 'invalid_recipient', 'A task needs a different agent. There is no hand-off of your own task.');
  }
  const [share] = await tx
    .select()
    .from(agentShares)
    .where(and(eq(agentShares.agentId, recipient.id), eq(agentShares.guestWorkspaceId, caller.workspaceId)))
    .limit(1);
  if (!share) {
    throw new HttpError(403, 'share_required', `This workspace does not have access to ${shown}.`);
  }
  await tx.execute(sql`select id from agent_shares where id = ${share.id} for update`);
  const [fresh] = await tx.select().from(agentShares).where(eq(agentShares.id, share.id)).limit(1);
  if (!fresh || fresh.status === 'revoked') {
    throw new HttpError(403, 'share_revoked', `Access to ${shown} was revoked.`);
  }
  if (fresh.status !== 'approved') {
    throw new HttpError(403, 'share_pending', `Access to ${shown} is not approved yet.`);
  }
  // One lookup through the grant: an offer the owner has but did not grant looks exactly like an unknown name,
  // so a guest cannot probe which offers exist.
  const [menu] = await tx
    .select({
      id: agentOffers.id,
      name: agentOffers.name,
      title: agentOffers.title,
      resultSchema: agentOffers.resultSchema,
      inputSchema: agentOffers.inputSchema,
      notesEnabled: agentOffers.notesEnabled,
    })
    .from(agentShareOffers)
    .innerJoin(agentOffers, eq(agentOffers.id, agentShareOffers.offerId))
    .where(and(eq(agentShareOffers.shareId, fresh.id), eq(agentOffers.agentId, recipient.id), eq(agentOffers.name, offer)))
    .limit(1);
  if (!menu) throw offerNotAvailable(offer, shown);
  // Input checks come after the grant lookup (an ungranted offer stays offer_not_found) and before the
  // cap, so a rejected input never uses the guest's daily cap.
  const accepted = menu.inputSchema
    ? assertFormFields(
        { name: menu.name, title: menu.title, inputSchema: menu.inputSchema, notesEnabled: menu.notesEnabled },
        fields,
      )
    : { ...assertFreeTextFields(fields), input: null };
  const cap = await consumeKeyedRateLimit(tx, {
    kind: GUEST_TASK_RATE_KIND,
    key: fresh.id,
    limit: fresh.dailyCap,
    windowMs: SHARE_CAP_WINDOW_MS,
  });
  if (cap.limited) {
    throw new HttpError(429, 'rate_limited', 'This share is at its daily task cap.', {
      retry_after_seconds: cap.retryAfterSeconds,
      daily_cap: fresh.dailyCap,
      scope: 'share',
    });
  }
  // Total across every customer of this agent (customer-link shares only, so existing handle and agent-invite
  // guests keep their per-share cap alone). Both cap rows roll back with the task if anything later fails.
  const botCap = fresh.source !== 'customer' ? { limited: false as const, retryAfterSeconds: 0 } : await consumeKeyedRateLimit(tx, {
    kind: BOT_GUEST_TASK_RATE_KIND,
    key: recipient.id,
    limit: recipient.customerDailyCap,
    windowMs: SHARE_CAP_WINDOW_MS,
  });
  if (botCap.limited) {
    throw new HttpError(429, 'rate_limited', 'This agent is at its daily task cap for guests.', {
      retry_after_seconds: botCap.retryAfterSeconds,
      daily_cap: recipient.customerDailyCap,
      scope: 'bot',
    });
  }
  return {
    recipient,
    offerId: menu.id,
    resultSchema: menu.resultSchema,
    ownerHandle: address.handle,
    title: accepted.title,
    description: accepted.description,
    inputSchema: accepted.input ? menu.inputSchema : null,
    input: accepted.input,
  };
}

export async function getAgentCard(caller: AgentPrincipal, to: string) {
  const address = parseRecipient(to);
  if (address.kind !== 'shared') {
    throw new HttpError(400, 'invalid_address', 'get_agent_card takes a shared address, @handle/agentname.');
  }
  const shown = addressOf(address.handle, address.agentName);
  const db = getDb();
  const [owner] = await db.select().from(workspaces).where(eq(workspaces.handle, address.handle)).limit(1);
  if (!owner) throw notShared(shown);
  const [recipient] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.workspaceId, owner.id), eq(agents.name, address.agentName), isNull(agents.revokedAt), eq(agents.shared, true)))
    .limit(1);
  if (!recipient) throw notShared(shown);
  if (recipient.workspaceId === caller.workspaceId) {
    throw new HttpError(400, 'invalid_address', 'Use your workspace tools for an agent in your own workspace.');
  }
  const [share] = await db
    .select()
    .from(agentShares)
    .where(and(eq(agentShares.agentId, recipient.id), eq(agentShares.guestWorkspaceId, caller.workspaceId)))
    .limit(1);
  if (!share) throw new HttpError(403, 'share_required', `This workspace does not have access to ${shown}.`);
  if (share.status === 'revoked') throw new HttpError(403, 'share_revoked', `Access to ${shown} was revoked.`);
  if (share.status !== 'approved') throw new HttpError(403, 'share_pending', `Access to ${shown} is not approved yet.`);
  const offers = await db
    .select({
      name: agentOffers.name,
      title: agentOffers.title,
      description: agentOffers.description,
      resultSchema: agentOffers.resultSchema,
      inputSchema: agentOffers.inputSchema,
      notesEnabled: agentOffers.notesEnabled,
    })
    .from(agentShareOffers)
    .innerJoin(agentOffers, eq(agentOffers.id, agentShareOffers.offerId))
    .where(eq(agentShareOffers.shareId, share.id))
    .orderBy(agentOffers.name);
  const branding = cardBranding(await brandingFor(db, recipient, owner.name));
  return {
    address: shown,
    name: recipient.name,
    description: recipient.description,
    branding,
    offers: offers.map((offer) => ({
      name: offer.name,
      title: offerDisplayTitle(offer),
      description: offer.description,
      result_schema: offer.resultSchema,
      input_schema: offer.inputSchema ?? null,
      notes_enabled: offer.notesEnabled,
      notes_max: notesMaxFor(offer),
    })),
  };
}
