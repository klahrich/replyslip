import { randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db';
import {
  agentOffers,
  agentShares,
  agents,
  customerInviteOffers,
  customerInvites,
  customerPreapprovedEmails,
  users,
  workspaces,
  type AgentRow,
  type AgentShareRow,
  type CustomerInviteRow,
} from '@/db/schema';
import { brandingFor, brandingRow, ownerDisplayName, serializeBranding } from './customer-branding';
import {
  CUSTOMER_DEFAULT_DAILY_CAP,
  CUSTOMER_INVITE_MAX_ACTIVE_PER_AGENT,
  CUSTOMER_INVITE_MAX_TTL_DAYS,
  CUSTOMER_LINK_MAX_USES,
  CUSTOMER_SENDER_NAME,
  EMAIL_PATTERN,
  INVITE_LABEL_MAX,
  MAX_PENDING_PER_BOT,
  PENDING_NOTIFY_INTERVAL_MS,
  PENDING_REQUEST_TTL_DAYS,
  PREAPPROVED_EMAILS_MAX,
} from './constants';
import { randomToken, sha256, tokenPrefix } from './crypto';
import { getEmailSender } from './email';
import { HttpError } from './errors';
import { runAfterResponse } from './first-agent-alert';
import { consumeRateLimit } from './rate-limit';
import {
  assertClaimed,
  assertDailyCap,
  assertGuestSlot,
  countGuestSlots,
  dedupeOfferNames,
  deliverWakeIds,
  loadOffersByName,
  lockOwnerAgent,
  replaceShareOffers,
  revokeShareRow,
} from './sharing';

const DAY_MS = 24 * 60 * 60 * 1000;

export type CustomerInviteKind = 'personal' | 'public';
export type CustomerAccessMode = 'open_link' | 'approve_each';
export type CustomerInviteStatus = 'active' | 'expired' | 'used_up' | 'revoked';

/** Every message a customer sees is plain English and never says why beyond what they can act on. */
const LINK_NOT_FOUND = "This link doesn't work anymore. Ask the business that sent it for a new one.";
const LINK_EXPIRED = 'This link has expired. Ask the business that sent it for a new one.';
const LINK_USED_UP = 'This link has already been used. Ask the business that sent it for a new one.';
const EMAIL_MISMATCH = 'This invite is for a different email address. Sign in with the email the invite was sent to.';
const SHARE_REVOKED = 'This business has turned off your access.';
const QUEUE_FULL = "This business isn't accepting new customers right now. Try again later.";
const AT_CAPACITY = "This business can't add new customers right now.";

const notFound = () => new HttpError(404, 'invite_not_found', LINK_NOT_FOUND);

export function customerInviteStatus(invite: CustomerInviteRow, now = new Date()): CustomerInviteStatus {
  if (invite.revokedAt) return 'revoked';
  if (invite.expiresAt && invite.expiresAt.getTime() <= now.getTime()) return 'expired';
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) return 'used_up';
  return 'active';
}

/**
 * A dead link. `invite_used_up` carries the business's public branding in `details.bot.branding` (the same object
 * R1 returns), so the page can still show who sent it. Nothing else: no agent id, offers, handle, or owner data.
 */
async function statusError(
  db: Db,
  status: Exclude<CustomerInviteStatus, 'active'>,
  agent: { id: string; workspaceId: string },
): Promise<HttpError> {
  if (status === 'revoked') return notFound();
  if (status === 'expired') return new HttpError(410, 'invite_expired', LINK_EXPIRED);
  const branding = await brandingFor(db, agent);
  return new HttpError(410, 'invite_used_up', LINK_USED_UP, { bot: { branding } });
}

/**
 * The token rides in the fragment, which browsers never send to a server, so it stays out of access logs
 * and referrers. /i tells an rsl_ customer link from an rsi_ agent invite by the prefix.
 */
export function customerLinkUrl(origin: string, token: string): string {
  return `${origin}/i#${token}`;
}

export function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 320) {
    throw new HttpError(400, 'validation_error', 'Enter a valid email address.');
  }
  return email;
}

function cleanLabel(value: string | null | undefined): string | null {
  const label = value?.trim() ?? '';
  if (label.length === 0) return null;
  if (label.length > INVITE_LABEL_MAX) {
    throw new HttpError(400, 'validation_error', `label must be at most ${INVITE_LABEL_MAX} characters.`);
  }
  return label;
}

function parseExpiry(value: string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) throw new HttpError(400, 'invalid_expiry', 'expires_at must be an ISO 8601 time.');
  const now = Date.now();
  if (at.getTime() <= now) throw new HttpError(400, 'invalid_expiry', 'expires_at must be in the future.');
  if (at.getTime() > now + CUSTOMER_INVITE_MAX_TTL_DAYS * DAY_MS) {
    throw new HttpError(400, 'invalid_expiry', `expires_at can be at most ${CUSTOMER_INVITE_MAX_TTL_DAYS} days away.`);
  }
  return at;
}

function assertMaxUses(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > CUSTOMER_LINK_MAX_USES) {
    throw new HttpError(400, 'validation_error', `max_uses must be an integer from 1 to ${CUSTOMER_LINK_MAX_USES}.`);
  }
  return value;
}

async function offersForInvites(db: Db, inviteIds: string[]) {
  const map = new Map<string, { id: string; name: string }[]>();
  if (inviteIds.length === 0) return map;
  const rows = await db
    .select({ inviteId: customerInviteOffers.inviteId, id: agentOffers.id, name: agentOffers.name })
    .from(customerInviteOffers)
    .innerJoin(agentOffers, eq(agentOffers.id, customerInviteOffers.offerId))
    .where(inArray(customerInviteOffers.inviteId, inviteIds));
  for (const row of rows) {
    const list = map.get(row.inviteId) ?? [];
    list.push({ id: row.id, name: row.name });
    map.set(row.inviteId, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return map;
}

/** Owner view. The token itself is never stored, so only the prefix appears here. */
function inviteBody(invite: CustomerInviteRow, offers: { id: string; name: string }[]) {
  return {
    id: invite.id,
    agent_id: invite.agentId,
    kind: invite.kind as CustomerInviteKind,
    prefix: invite.tokenPrefix,
    label: invite.label,
    email: invite.email,
    all_offers: invite.allOffers,
    offers: invite.allOffers ? null : offers,
    daily_cap: invite.dailyCap,
    max_uses: invite.maxUses,
    uses: invite.uses,
    expires_at: invite.expiresAt?.toISOString() ?? null,
    revoked_at: invite.revokedAt?.toISOString() ?? null,
    rotated_at: invite.rotatedAt?.toISOString() ?? null,
    created_at: invite.createdAt.toISOString(),
    status: customerInviteStatus(invite),
  };
}

export type SerializedCustomerInvite = ReturnType<typeof inviteBody>;

async function serializeInvite(db: Db, invite: CustomerInviteRow): Promise<SerializedCustomerInvite> {
  const offers = await offersForInvites(db, [invite.id]);
  return inviteBody(invite, offers.get(invite.id) ?? []);
}

async function assertShareable(tx: Db, workspaceId: string, agent: AgentRow): Promise<void> {
  await assertClaimed(tx, workspaceId);
  if (!agent.shared) throw new HttpError(400, 'agent_not_shared', 'Turn on sharing before creating an invite.');
}

export type CreateCustomerInviteInput = {
  kind: CustomerInviteKind;
  label?: string | null;
  email?: string | null;
  /** Omitted or null: every offer, including offers added later. */
  offers?: string[] | null;
  dailyCap?: number;
  maxUses?: number | null;
  expiresAt?: string | null;
};

export async function createCustomerInvite(
  workspaceId: string,
  agentId: string,
  userId: string,
  input: CreateCustomerInviteInput,
): Promise<{ invite: SerializedCustomerInvite; token: string }> {
  const label = cleanLabel(input.label);
  const dailyCap = input.dailyCap === undefined ? CUSTOMER_DEFAULT_DAILY_CAP : assertDailyCap(input.dailyCap);
  const expiresAt = parseExpiry(input.expiresAt);
  const offerNames = input.offers === undefined || input.offers === null ? null : dedupeOfferNames(input.offers);
  let email: string | null = null;
  let maxUses: number | null;
  if (input.kind === 'personal') {
    if (input.maxUses !== undefined && input.maxUses !== null && input.maxUses !== 1) {
      throw new HttpError(400, 'validation_error', 'A personal invite is single use.');
    }
    maxUses = 1;
    email = input.email ? normalizeEmail(input.email) : null;
  } else {
    if (input.email) throw new HttpError(400, 'validation_error', 'Only a personal invite can be tied to an email.');
    maxUses = input.maxUses === undefined || input.maxUses === null ? null : assertMaxUses(input.maxUses);
  }
  const token = randomToken('rsl_');
  const db = getDb();
  const invite = await db.transaction(async (tx) => {
    const agent = await lockOwnerAgent(tx, workspaceId, agentId);
    await assertShareable(tx, workspaceId, agent);
    const offers = offerNames ? await loadOffersByName(tx, agent.id, offerNames) : [];
    if (input.kind === 'public') {
      const [current] = await tx
        .select()
        .from(customerInvites)
        .where(and(eq(customerInvites.agentId, agent.id), eq(customerInvites.kind, 'public'), isNull(customerInvites.revokedAt)))
        .limit(1);
      if (current) {
        // A dead link (expired or used up) is retired so the owner can make a new one; a live one is kept.
        if (customerInviteStatus(current) === 'active') {
          throw new HttpError(409, 'public_link_exists', 'This bot already has a public link. Reset or revoke it instead.');
        }
        await tx.update(customerInvites).set({ revokedAt: new Date() }).where(eq(customerInvites.id, current.id));
      }
    } else {
      const [active] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(customerInvites)
        .where(
          and(
            eq(customerInvites.agentId, agent.id),
            isNull(customerInvites.revokedAt),
            sql`(${customerInvites.expiresAt} is null or ${customerInvites.expiresAt} > now())`,
            sql`(${customerInvites.maxUses} is null or ${customerInvites.uses} < ${customerInvites.maxUses})`,
          ),
        );
      if (Number(active?.count ?? 0) >= CUSTOMER_INVITE_MAX_ACTIVE_PER_AGENT) {
        throw new HttpError(
          429,
          'too_many_invites',
          `This bot already has ${CUSTOMER_INVITE_MAX_ACTIVE_PER_AGENT} unused invites. Revoke some first.`,
        );
      }
    }
    const [row] = await tx
      .insert(customerInvites)
      .values({
        agentId: agent.id,
        kind: input.kind,
        tokenHash: sha256(token),
        tokenPrefix: tokenPrefix(token),
        label,
        email,
        allOffers: offerNames === null,
        dailyCap,
        maxUses,
        expiresAt,
        createdByUserId: userId,
      })
      .returning();
    if (!row) throw new HttpError(500, 'internal_error', 'Something went wrong.');
    if (offers.length > 0) {
      await tx.insert(customerInviteOffers).values(offers.map((offer) => ({ inviteId: row.id, offerId: offer.id })));
    }
    return row;
  });
  return { invite: await serializeInvite(db, invite), token };
}

export async function listCustomerInvites(workspaceId: string, agentId: string): Promise<SerializedCustomerInvite[]> {
  const db = getDb();
  const agent = await lockOwnerAgent(db, workspaceId, agentId);
  const rows = await db
    .select()
    .from(customerInvites)
    .where(eq(customerInvites.agentId, agent.id))
    .orderBy(desc(customerInvites.createdAt))
    .limit(200);
  const offers = await offersForInvites(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => inviteBody(row, offers.get(row.id) ?? []));
}

async function lockInvite(tx: Db, agent: AgentRow, inviteId: string): Promise<CustomerInviteRow> {
  await tx.execute(sql`select id from customer_invites where id = ${inviteId} and agent_id = ${agent.id} for update`);
  const [invite] = await tx
    .select()
    .from(customerInvites)
    .where(and(eq(customerInvites.id, inviteId), eq(customerInvites.agentId, agent.id)))
    .limit(1);
  if (!invite) throw new HttpError(404, 'not_found', 'No invite was found.');
  return invite;
}

/** True when the id is a customer invite on this owner's agent. Routes use it to pick the invite kind. */
export async function isCustomerInvite(workspaceId: string, agentId: string, inviteId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: customerInvites.id })
    .from(customerInvites)
    .innerJoin(agents, eq(agents.id, customerInvites.agentId))
    .where(and(eq(customerInvites.id, inviteId), eq(agents.id, agentId), eq(agents.workspaceId, workspaceId)))
    .limit(1);
  return Boolean(row);
}

/** Changes apply to future acceptances only. Existing customers are edited through their share. */
export async function updateCustomerInvite(
  workspaceId: string,
  agentId: string,
  inviteId: string,
  input: { label?: string | null; offers?: string[] | null; dailyCap?: number; expiresAt?: string | null; maxUses?: number | null },
): Promise<SerializedCustomerInvite> {
  if (Object.values(input).every((value) => value === undefined)) {
    throw new HttpError(400, 'validation_error', 'Send label, offers, daily_cap, max_uses, or expires_at to update.');
  }
  const db = getDb();
  const saved = await db.transaction(async (tx) => {
    const agent = await lockOwnerAgent(tx, workspaceId, agentId);
    const invite = await lockInvite(tx, agent, inviteId);
    if (invite.revokedAt) throw new HttpError(409, 'invite_revoked', 'This invite was revoked.');
    const patch: Partial<typeof customerInvites.$inferInsert> = {};
    if (input.label !== undefined) patch.label = cleanLabel(input.label);
    if (input.dailyCap !== undefined) patch.dailyCap = assertDailyCap(input.dailyCap);
    if (input.expiresAt !== undefined) patch.expiresAt = parseExpiry(input.expiresAt);
    if (input.maxUses !== undefined) {
      if (invite.kind === 'personal') throw new HttpError(400, 'validation_error', 'A personal invite is single use.');
      const maxUses = input.maxUses === null ? null : assertMaxUses(input.maxUses);
      if (maxUses !== null && maxUses < invite.uses) {
        throw new HttpError(400, 'validation_error', `max_uses cannot be below the ${invite.uses} uses so far.`);
      }
      patch.maxUses = maxUses;
    }
    if (input.offers !== undefined) {
      await tx.delete(customerInviteOffers).where(eq(customerInviteOffers.inviteId, invite.id));
      if (input.offers === null) {
        patch.allOffers = true;
      } else {
        const offers = await loadOffersByName(tx, agent.id, dedupeOfferNames(input.offers));
        patch.allOffers = false;
        await tx.insert(customerInviteOffers).values(offers.map((offer) => ({ inviteId: invite.id, offerId: offer.id })));
      }
    }
    if (Object.keys(patch).length === 0) return invite;
    const [updated] = await tx.update(customerInvites).set(patch).where(eq(customerInvites.id, invite.id)).returning();
    if (!updated) throw new HttpError(500, 'internal_error', 'Something went wrong.');
    return updated;
  });
  return serializeInvite(db, saved);
}

/** Stops new acceptances for good. With revokeCustomers, also revokes every live share from this invite. */
export async function revokeCustomerInvite(
  workspaceId: string,
  agentId: string,
  inviteId: string,
  options: { revokeCustomers?: boolean } = {},
) {
  const db = getDb();
  const saved = await db.transaction(async (tx) => {
    const agent = await lockOwnerAgent(tx, workspaceId, agentId);
    const invite = await lockInvite(tx, agent, inviteId);
    const revoked = invite.revokedAt
      ? invite
      : (await tx.update(customerInvites).set({ revokedAt: new Date() }).where(eq(customerInvites.id, invite.id)).returning())[0];
    if (!revoked) throw new HttpError(500, 'internal_error', 'Something went wrong.');
    const wakeIds: string[] = [];
    let revokedCustomers = 0;
    let failedTasks = 0;
    if (options.revokeCustomers) {
      await tx.execute(
        sql`select id from agent_shares where customer_invite_id = ${invite.id} and status in ('pending', 'approved') for update`,
      );
      const live = await tx
        .select()
        .from(agentShares)
        .where(and(eq(agentShares.customerInviteId, invite.id), inArray(agentShares.status, ['pending', 'approved'])));
      for (const share of live) {
        const closed = await revokeShareRow(tx, agent, share);
        wakeIds.push(...closed.wakeIds);
        failedTasks += closed.failed;
        revokedCustomers += 1;
      }
    }
    return { invite: revoked, wakeIds, revokedCustomers, failedTasks };
  });
  await deliverWakeIds(saved.wakeIds);
  return {
    invite: await serializeInvite(db, saved.invite),
    revoked_customers: saved.revokedCustomers,
    failed_tasks: saved.failedTasks,
  };
}

/**
 * Reset a public link (spec 11.7): a new hash and prefix on the same row. The old hash is not kept,
 * so the old token looks exactly like one that never existed. Shares keep working.
 */
export async function rotateCustomerInvite(
  workspaceId: string,
  agentId: string,
  inviteId: string,
): Promise<{ invite: SerializedCustomerInvite; token: string }> {
  const token = randomToken('rsl_');
  const db = getDb();
  const saved = await db.transaction(async (tx) => {
    const agent = await lockOwnerAgent(tx, workspaceId, agentId);
    const invite = await lockInvite(tx, agent, inviteId);
    if (invite.kind !== 'public') {
      throw new HttpError(400, 'not_public_link', 'Only a public link can be reset. Revoke a personal invite instead.');
    }
    if (invite.revokedAt) throw new HttpError(409, 'invite_revoked', 'This link was revoked. Create a new one.');
    const [updated] = await tx
      .update(customerInvites)
      .set({ tokenHash: sha256(token), tokenPrefix: tokenPrefix(token), rotatedAt: new Date() })
      .where(eq(customerInvites.id, invite.id))
      .returning();
    if (!updated) throw new HttpError(500, 'internal_error', 'Something went wrong.');
    return updated;
  });
  return { invite: await serializeInvite(db, saved), token };
}

export type CustomerAccess = {
  mode: CustomerAccessMode;
  notify_pending_email: boolean;
  customer_daily_cap: number;
  preapproved_emails: string[];
  pending_count: number;
  customer_count: number;
};

async function accessFor(db: Db, agent: AgentRow): Promise<CustomerAccess> {
  const emails = await db
    .select({ email: customerPreapprovedEmails.email })
    .from(customerPreapprovedEmails)
    .where(eq(customerPreapprovedEmails.agentId, agent.id))
    .orderBy(customerPreapprovedEmails.email);
  return {
    mode: agent.customerAccessMode as CustomerAccessMode,
    notify_pending_email: agent.notifyPendingEmail,
    customer_daily_cap: agent.customerDailyCap,
    preapproved_emails: emails.map((row) => row.email),
    pending_count: await pendingCustomerCount(db, agent.id),
    customer_count: await countGuestSlots(db, agent.id),
  };
}

export async function getCustomerAccess(workspaceId: string, agentId: string): Promise<CustomerAccess> {
  const db = getDb();
  return accessFor(db, await lockOwnerAgent(db, workspaceId, agentId));
}

/** Switching modes never changes existing shares. preapproved_emails, when sent, replaces the whole list. */
export async function setCustomerAccess(
  workspaceId: string,
  agentId: string,
  input: { mode?: CustomerAccessMode; preapprovedEmails?: string[]; notifyPendingEmail?: boolean; customerDailyCap?: number },
): Promise<CustomerAccess> {
  const emails = input.preapprovedEmails === undefined ? undefined : [...new Set(input.preapprovedEmails.map(normalizeEmail))];
  if (emails && emails.length > PREAPPROVED_EMAILS_MAX) {
    throw new HttpError(400, 'validation_error', `A bot can pre-approve at most ${PREAPPROVED_EMAILS_MAX} emails.`);
  }
  const dailyCap = input.customerDailyCap === undefined ? undefined : assertDailyCap(input.customerDailyCap);
  const db = getDb();
  return db.transaction(async (tx) => {
    let agent = await lockOwnerAgent(tx, workspaceId, agentId);
    const patch: Partial<typeof agents.$inferInsert> = {};
    if (input.mode !== undefined) patch.customerAccessMode = input.mode;
    if (input.notifyPendingEmail !== undefined) patch.notifyPendingEmail = input.notifyPendingEmail;
    if (dailyCap !== undefined) patch.customerDailyCap = dailyCap;
    if (Object.keys(patch).length > 0) {
      const [updated] = await tx.update(agents).set(patch).where(eq(agents.id, agent.id)).returning();
      if (!updated) throw new HttpError(500, 'internal_error', 'Something went wrong.');
      agent = updated;
    }
    if (emails) {
      await tx.delete(customerPreapprovedEmails).where(eq(customerPreapprovedEmails.agentId, agent.id));
      if (emails.length > 0) {
        await tx.insert(customerPreapprovedEmails).values(emails.map((email) => ({ agentId: agent.id, email })));
      }
    }
    return accessFor(tx, agent);
  });
}

/** Pending customer requests (the dashboard badge). Pending invite_guest grants are not customers. */
export async function pendingCustomerCount(db: Db, agentId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentShares)
    .where(and(eq(agentShares.agentId, agentId), eq(agentShares.status, 'pending'), eq(agentShares.source, 'customer')));
  return Number(row?.count ?? 0);
}

// ---------------------------------------------------------------------------
// Customer side: R1 resolve and R2 accept (spec 15.3, 15.4).
// ---------------------------------------------------------------------------

type LinkContext = { invite: CustomerInviteRow; agent: AgentRow; displayName: string | null };

/**
 * Live invite plus its shared agent. Unknown, rotated, revoked, and unshared all give the same 404.
 *
 * With lock, rows are locked in the same order as every owner write (rotate, revoke, update):
 * agent first, then invite. The first lookup takes no lock; the hash is compared again once the invite
 * row is locked, so a rotate or revoke that committed first makes this token unknown.
 */
async function loadLink(db: Db, token: string, lock: boolean): Promise<LinkContext> {
  if (!token.startsWith('rsl_') || token.length > 200) throw notFound();
  const hash = sha256(token);
  const [found] = await db
    .select({ id: customerInvites.id, agentId: customerInvites.agentId })
    .from(customerInvites)
    .where(eq(customerInvites.tokenHash, hash))
    .limit(1);
  if (!found) throw notFound();
  if (lock) {
    await db.execute(sql`select id from agents where id = ${found.agentId} for update`);
    await db.execute(sql`select id from customer_invites where id = ${found.id} for update`);
  }
  const [invite] = await db
    .select()
    .from(customerInvites)
    .where(and(eq(customerInvites.id, found.id), eq(customerInvites.tokenHash, hash)))
    .limit(1);
  if (!invite || invite.revokedAt) throw notFound();
  const [agent] = await db.select().from(agents).where(eq(agents.id, invite.agentId)).limit(1);
  if (!agent || agent.revokedAt || !agent.shared || agent.role !== 'agent') throw notFound();
  const [owner] = await db
    .select({ handle: workspaces.handle, name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, agent.workspaceId))
    .limit(1);
  if (!owner?.handle) throw notFound();
  return { invite, agent, displayName: lock ? null : await ownerDisplayName(db, agent.workspaceId, owner.name) };
}

/** The owner's chosen workspace name, or null while it is still the default made from an email. */
async function shareFor(db: Db, agentId: string, workspaceId: string): Promise<AgentShareRow | null> {
  const [share] = await db
    .select()
    .from(agentShares)
    .where(and(eq(agentShares.agentId, agentId), eq(agentShares.guestWorkspaceId, workspaceId)))
    .limit(1);
  return share ?? null;
}

type ShareStatus = 'pending' | 'approved' | 'revoked';
export type CustomerNext = 'sign_in' | 'accept' | 'open_bot' | 'wait' | 'blocked';

function nextFor(status: ShareStatus | null): CustomerNext {
  if (status === 'approved') return 'open_bot';
  if (status === 'pending') return 'wait';
  if (status === 'revoked') return 'blocked';
  return 'accept';
}

export type CustomerViewer = { id: string; email: string; workspaceId: string | null } | null;

export async function consumeOrThrow(input: Parameters<typeof consumeRateLimit>[0]): Promise<void> {
  const limit = await consumeRateLimit(input);
  if (limit.limited) {
    throw new HttpError(429, 'rate_limited', 'Too many requests. Try again in a few minutes.', {
      retry_after_seconds: limit.retryAfterSeconds,
    });
  }
}

/**
 * R1. Branding, access mode, and the next step only: no offers, descriptions, owner names, handles,
 * emails, or use counts, because a public link gets forwarded.
 */
export async function resolveCustomerLink(token: string, viewer: CustomerViewer, ip: string) {
  await consumeOrThrow({ kind: 'customerLink', ip });
  const db = getDb();
  const { invite, agent, displayName } = await loadLink(db, token, false);
  const share = viewer?.workspaceId ? await shareFor(db, agent.id, viewer.workspaceId) : null;
  // Someone who already holds a share can always see where they stand, even on a used-up personal invite.
  if (!share) {
    const status = customerInviteStatus(invite);
    if (status !== 'active') throw await statusError(db, status, agent);
  }
  const shareStatus = (share?.status as ShareStatus | undefined) ?? null;
  const row = await brandingRow(db, agent.id);
  return {
    link: {
      kind: invite.kind as CustomerInviteKind,
      email_bound: invite.email !== null,
      expires_at: invite.expiresAt?.toISOString() ?? null,
    },
    bot: { agent_id: agent.id, branding: serializeBranding(row, displayName) },
    access_mode: (invite.kind === 'personal' ? 'open_link' : agent.customerAccessMode) as CustomerAccessMode,
    viewer: viewer ? { signed_in: true, share_status: shareStatus } : { signed_in: false },
    next: viewer ? nextFor(shareStatus) : ('sign_in' as CustomerNext),
  };
}

/** The hidden keyless agent a customer workspace sends tasks as. Locks the workspace so two accepts make one. */
export async function ensureSenderAgent(tx: Db, workspaceId: string): Promise<AgentRow> {
  await tx.execute(sql`select id from workspaces where id = ${workspaceId} for update`);
  const [existing] = await tx
    .select()
    .from(agents)
    .where(and(eq(agents.workspaceId, workspaceId), eq(agents.role, 'customer_sender'), isNull(agents.revokedAt)))
    .limit(1);
  if (existing) return existing;
  // Checked up front instead of catching a unique violation, which would abort the transaction.
  let name: string = CUSTOMER_SENDER_NAME;
  const [taken] = await tx
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.workspaceId, workspaceId), eq(agents.name, name)))
    .limit(1);
  if (taken) name = `${CUSTOMER_SENDER_NAME}-${randomBytes(4).toString('hex')}`;
  const [created] = await tx
    .insert(agents)
    .values({ workspaceId, name, role: 'customer_sender', deliveryMode: 'none' })
    .returning();
  if (!created) throw new HttpError(500, 'internal_error', 'Something went wrong.');
  return created;
}

async function isPreapproved(tx: Db, agentId: string, email: string): Promise<boolean> {
  const [row] = await tx
    .select({ email: customerPreapprovedEmails.email })
    .from(customerPreapprovedEmails)
    .where(and(eq(customerPreapprovedEmails.agentId, agentId), eq(customerPreapprovedEmails.email, email.toLowerCase())))
    .limit(1);
  return Boolean(row);
}

async function grantOfferIds(tx: Db, invite: CustomerInviteRow, agentId: string): Promise<string[]> {
  if (invite.allOffers) {
    const rows = await tx.select({ id: agentOffers.id }).from(agentOffers).where(eq(agentOffers.agentId, agentId));
    return rows.map((row) => row.id);
  }
  const rows = await tx
    .select({ id: customerInviteOffers.offerId })
    .from(customerInviteOffers)
    .where(eq(customerInviteOffers.inviteId, invite.id));
  return rows.map((row) => row.id);
}

type PendingNotice = { agentName: string; pendingCount: number; recipients: string[] };

/** Claims the hourly notice slot inside the accept transaction, so concurrent requests send one email. */
async function claimPendingNotice(tx: Db, agent: AgentRow): Promise<PendingNotice | null> {
  if (!agent.notifyPendingEmail) return null;
  const cutoff = new Date(Date.now() - PENDING_NOTIFY_INTERVAL_MS);
  const [claimed] = await tx
    .update(agents)
    .set({ pendingNotifiedAt: new Date() })
    .where(
      and(
        eq(agents.id, agent.id),
        eq(agents.notifyPendingEmail, true),
        or(isNull(agents.pendingNotifiedAt), lte(agents.pendingNotifiedAt, cutoff)),
      ),
    )
    .returning({ id: agents.id });
  if (!claimed) return null;
  const owners = await tx
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.workspaceId, agent.workspaceId), sql`${users.emailVerifiedAt} is not null`));
  if (owners.length === 0) return null;
  return { agentName: agent.name, pendingCount: await pendingCustomerCount(tx, agent.id), recipients: owners.map((o) => o.email) };
}

function sendPendingNotice(notice: PendingNotice, origin: string): void {
  const dashboardUrl = `${origin}/dashboard`;
  runAfterResponse(async () => {
    for (const to of notice.recipients) {
      try {
        await getEmailSender().sendPendingCustomers({
          to,
          agentName: notice.agentName,
          pendingCount: notice.pendingCount,
          dashboardUrl,
        });
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : 'unknown error';
        console.error(`[replyslip] pending-customers notice failed: ${reason}`);
      }
    }
  });
}

export type AcceptResult = {
  share: { status: 'pending' | 'approved'; requested_at: string };
  bot: { agent_id: string };
  next: 'open_bot' | 'wait';
};

/**
 * R2 (spec 11.3). One transaction: lock the agent then the invite, check it, upsert the one share per customer per bot,
 * grant offers, make sure the sender agent exists, and use one invite use. Idempotent for a live share.
 */
export async function acceptCustomerInvite(
  user: { id: string; email: string; workspaceId: string },
  token: string,
  origin: string,
): Promise<AcceptResult> {
  await consumeOrThrow({ kind: 'customerAccept', agentId: user.id });
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const { invite, agent } = await loadLink(tx, token, true);
    if (agent.workspaceId === user.workspaceId) {
      throw new HttpError(400, 'invalid_guest', "You can't be a customer of your own bot.");
    }
    if (invite.email && invite.email !== user.email.toLowerCase()) {
      throw new HttpError(403, 'invite_email_mismatch', EMAIL_MISMATCH);
    }
    await tx.execute(
      sql`select id from agent_shares where agent_id = ${agent.id} and guest_workspace_id = ${user.workspaceId} for update`,
    );
    const existing = await shareFor(tx, agent.id, user.workspaceId);
    // A link never undoes an owner's revoke or deny.
    if (existing?.status === 'revoked') throw new HttpError(403, 'share_revoked', SHARE_REVOKED);
    if (existing) return { share: existing, notice: null };

    const status = customerInviteStatus(invite);
    if (status !== 'active') throw await statusError(tx, status, agent);

    const approved =
      invite.kind === 'personal' ||
      agent.customerAccessMode === 'open_link' ||
      (await isPreapproved(tx, agent.id, user.email));
    if (approved) {
      await assertGuestSlot(tx, agent, AT_CAPACITY);
    } else if ((await pendingCustomerCount(tx, agent.id)) >= MAX_PENDING_PER_BOT) {
      throw new HttpError(429, 'pending_queue_full', QUEUE_FULL);
    }
    const [share] = await tx
      .insert(agentShares)
      .values({
        agentId: agent.id,
        guestWorkspaceId: user.workspaceId,
        status: approved ? 'approved' : 'pending',
        dailyCap: invite.dailyCap,
        source: 'customer',
        customerInviteId: invite.id,
        requestedByUserId: user.id,
        label: invite.label,
      })
      .returning();
    if (!share) throw new HttpError(500, 'internal_error', 'Something went wrong.');
    await replaceShareOffers(tx, share.id, await grantOfferIds(tx, invite, agent.id));
    await ensureSenderAgent(tx, user.workspaceId);
    const [bumped] = await tx
      .update(customerInvites)
      .set({ uses: sql`${customerInvites.uses} + 1` })
      .where(
        and(
          eq(customerInvites.id, invite.id),
          sql`(${customerInvites.maxUses} is null or ${customerInvites.uses} < ${customerInvites.maxUses})`,
        ),
      )
      .returning({ id: customerInvites.id });
    if (!bumped) throw await statusError(tx, 'used_up', agent);
    const notice = approved ? null : await claimPendingNotice(tx, agent);
    return { share, notice };
  });
  if (result.notice) sendPendingNotice(result.notice, origin);
  const status = result.share.status === 'approved' ? 'approved' : 'pending';
  return {
    share: { status, requested_at: result.share.createdAt.toISOString() },
    bot: { agent_id: result.share.agentId },
    next: status === 'approved' ? 'open_bot' : 'wait',
  };
}

/**
 * Daily cron: a pending customer request older than 14 days is deleted. It has no tasks, so nothing else
 * changes, and the customer can ask again. A share that was ever revoked is never deleted: the row is
 * what keeps a revoked customer out.
 */
export async function cleanupExpiredCustomerRequests(now = new Date()): Promise<{ deleted: number }> {
  const cutoff = new Date(now.getTime() - PENDING_REQUEST_TTL_DAYS * DAY_MS);
  const deleted = await getDb()
    .delete(agentShares)
    .where(
      and(
        eq(agentShares.status, 'pending'),
        eq(agentShares.source, 'customer'),
        isNull(agentShares.lastRevokedAt),
        lt(agentShares.createdAt, cutoff),
      ),
    )
    .returning({ id: agentShares.id });
  return { deleted: deleted.length };
}

