import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { agents, loginCodes, sessions, users, workspaces } from '@/db/schema';
import {
  EMAIL_PATTERN,
  LOGIN_CODE_MAX_ATTEMPTS,
  LOGIN_CODE_TTL_MS,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from './constants';
import {
  hashLoginCode,
  randomLoginCode,
  randomSessionToken,
  safeEqualHex,
  sha256,
} from './crypto';
import { getEmailSender } from './email';
import { authenticateAgentKey } from './agents';
import { HttpError } from './errors';
import { bearerToken, readCookie } from './http';
import { recordMarketingOptIn } from './marketing';
import { clientIp } from './origin';
import { consumeRateLimit } from './rate-limit';

export const REQUEST_CODE_MESSAGE =
  'If that email can receive mail, we sent a sign-in code. It expires in 10 minutes.';

export type SessionUser = {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  marketingOptIn: boolean;
  createdAt: Date;
  workspace: { id: string; name: string; handle: string | null; createdAt: Date } | null;
};

export type MarketingOptIn = { consentText: string };

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalized) || normalized.length > 320) {
    throw new HttpError(400, 'validation_error', 'Enter a valid email address.');
  }
  return normalized;
}

function workspaceNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  const cleaned = local.replace(/[^A-Za-z0-9]+/g, ' ').trim().slice(0, 40);
  return cleaned ? `${cleaned} workspace` : 'Workspace';
}

const SIGNUP_SOURCE_MAX = 200;

/** Trimmed, capped at 200 characters. Empty becomes null. Never written over an existing user. */
export function normalizeSignupSource(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, SIGNUP_SOURCE_MAX);
  return trimmed.length > 0 ? trimmed : null;
}

/** True only for a JSON boolean true. Anything else, including "true" or 1, is ignored. */
export function normalizeWantsSharing(value: unknown): boolean {
  return value === true;
}

export async function requestLoginCode(
  emailInput: string,
  req: Request,
  sourceInput?: string | null,
  options: { wantsSharing?: boolean } = {},
): Promise<{ limited: true; retryAfterSeconds: number } | { limited: false }> {
  const email = normalizeEmail(emailInput);
  const limit = await consumeRateLimit({
    kind: 'requestCode',
    email,
    ip: clientIp(req),
  });
  if (limit.limited) return { limited: true, retryAfterSeconds: limit.retryAfterSeconds };

  const db = getDb();
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  const wantsSharing = options.wantsSharing === true;
  if (existing.length === 0) {
    await db.insert(users).values({ email, signupSource: normalizeSignupSource(sourceInput), wantsSharing });
  } else if (wantsSharing) {
    // Sticky: an existing user can opt in later. Nothing here sets it back to false.
    await db.update(users).set({ wantsSharing: true }).where(and(eq(users.email, email), eq(users.wantsSharing, false)));
  }

  const code = randomLoginCode();
  const codeHash = hashLoginCode(code);
  const expiresAt = new Date(Date.now() + LOGIN_CODE_TTL_MS);

  await db.transaction(async (tx) => {
    await tx
      .update(loginCodes)
      .set({ invalidatedAt: new Date() })
      .where(and(eq(loginCodes.email, email), isNull(loginCodes.consumedAt), isNull(loginCodes.invalidatedAt)));
    await tx.insert(loginCodes).values({ email, codeHash, expiresAt });
  });

  await getEmailSender().sendLoginCode({ to: email, code });
  return { limited: false };
}

export async function renameWorkspace(workspaceId: string, name: string): Promise<{
  id: string;
  name: string;
  handle: string | null;
  createdAt: Date;
}> {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 80) {
    throw new HttpError(400, 'validation_error', 'Workspace name must be 1–80 characters.');
  }
  const [updated] = await getDb()
    .update(workspaces)
    .set({ name: trimmed })
    .where(eq(workspaces.id, workspaceId))
    .returning({ id: workspaces.id, name: workspaces.name, handle: workspaces.handle, createdAt: workspaces.createdAt });
  if (!updated) throw new HttpError(404, 'not_found', 'No workspace was found.');
  return updated;
}

const CLAIM_NOT_FOUND = 'This claim link is not valid.';
const ALREADY_IN_WORKSPACE =
  "This email already has a workspace. Ask your agent to call redeem_invite to add the share to it.";

/** Public summary for the claim page. One 404 for an unknown or already claimed token. */
export async function previewClaim(claimToken: string) {
  const db = getDb();
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.claimTokenHash, sha256(claimToken)), isNull(workspaces.claimedAt)))
    .limit(1);
  if (!workspace) throw new HttpError(404, 'claim_not_found', CLAIM_NOT_FOUND);
  const agentRows = await db
    .select({ name: agents.name })
    .from(agents)
    .where(and(eq(agents.workspaceId, workspace.id), isNull(agents.revokedAt)));
  return { workspace: { name: workspace.name, handle: workspace.handle }, agents: agentRows };
}

export async function verifyLoginCode(
  emailInput: string,
  codeInput: string,
  marketing?: MarketingOptIn,
  claimToken?: string,
): Promise<{ token: string; user: SessionUser }> {
  const email = normalizeEmail(emailInput);
  if (!/^\d{6}$/.test(codeInput)) {
    throw new HttpError(401, 'invalid_code', 'That code is not valid.');
  }

  const db = getDb();
  const [latest] = await db
    .select()
    .from(loginCodes)
    .where(eq(loginCodes.email, email))
    .orderBy(desc(loginCodes.createdAt))
    .limit(1);

  const providedHash = hashLoginCode(codeInput);
  if (!latest) {
    safeEqualHex(providedHash, hashLoginCode('000000'));
    throw new HttpError(401, 'invalid_code', 'That code is not valid.');
  }

  const matches = safeEqualHex(providedHash, latest.codeHash);
  if (latest.invalidatedAt) {
    throw new HttpError(401, 'invalid_code', 'That code is not valid. Request a new one.');
  }
  if (latest.consumedAt) {
    if (matches) {
      throw new HttpError(401, 'code_already_used', 'That code has already been used. Request a new one.');
    }
    throw new HttpError(401, 'invalid_code', 'That code is not valid.');
  }
  if (latest.expiresAt.getTime() <= Date.now()) {
    throw new HttpError(401, 'expired_code', 'That code has expired. Request a new one.');
  }
  if (latest.attempts >= LOGIN_CODE_MAX_ATTEMPTS) {
    throw new HttpError(401, 'code_exhausted', 'Too many attempts. Request a new code.');
  }
  if (!matches) {
    const [updated] = await db
      .update(loginCodes)
      .set({ attempts: sql`${loginCodes.attempts} + 1` })
      .where(and(eq(loginCodes.id, latest.id), isNull(loginCodes.consumedAt)))
      .returning({ attempts: loginCodes.attempts });
    if ((updated?.attempts ?? LOGIN_CODE_MAX_ATTEMPTS) >= LOGIN_CODE_MAX_ATTEMPTS) {
      throw new HttpError(401, 'code_exhausted', 'Too many attempts. Request a new code.');
    }
    throw new HttpError(401, 'invalid_code', 'That code is not valid.');
  }

  // A claim that cannot succeed is refused before the code is consumed, so the person can retry without a new code.
  const claimHash = claimToken ? sha256(claimToken) : null;
  if (claimHash) {
    const [owner] = await db.select({ workspaceId: users.workspaceId }).from(users).where(eq(users.email, email)).limit(1);
    if (owner?.workspaceId) throw new HttpError(409, 'already_in_workspace', ALREADY_IN_WORKSPACE);
    const [claimable] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.claimTokenHash, claimHash), isNull(workspaces.claimedAt)))
      .limit(1);
    if (!claimable) throw new HttpError(404, 'claim_not_found', CLAIM_NOT_FOUND);
  }

  const token = randomSessionToken();
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  const user = await db.transaction(async (tx) => {
    const [consumed] = await tx
      .update(loginCodes)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(loginCodes.id, latest.id),
          isNull(loginCodes.consumedAt),
          isNull(loginCodes.invalidatedAt),
        ),
      )
      .returning({ id: loginCodes.id });
    if (!consumed) {
      throw new HttpError(401, 'code_already_used', 'That code has already been used. Request a new one.');
    }

    const [row] = await tx.select().from(users).where(eq(users.email, email)).limit(1);
    if (!row) {
      throw new HttpError(500, 'internal_error', 'Something went wrong.');
    }

    let workspaceId = row.workspaceId;
    let workspace: { id: string; name: string; handle: string | null; createdAt: Date } | null = null;
    if (claimHash && workspaceId) throw new HttpError(409, 'already_in_workspace', ALREADY_IN_WORKSPACE);
    if (!workspaceId) {
      let created: typeof workspaces.$inferSelect | undefined;
      if (claimHash) {
        await tx.execute(sql`select id from workspaces where claim_token_hash = ${claimHash} for update`);
        [created] = await tx
          .update(workspaces)
          .set({ claimTokenHash: null, claimedAt: new Date() })
          .where(and(eq(workspaces.claimTokenHash, claimHash), isNull(workspaces.claimedAt)))
          .returning();
        if (!created) throw new HttpError(404, 'claim_not_found', CLAIM_NOT_FOUND);
      } else {
        [created] = await tx
          .insert(workspaces)
          .values({ name: workspaceNameFromEmail(email) })
          .returning();
      }
      if (!created) throw new HttpError(500, 'internal_error', 'Something went wrong.');
      workspaceId = created.id;
      workspace = { id: created.id, name: created.name, handle: created.handle, createdAt: created.createdAt };
      await tx
        .update(users)
        .set({ workspaceId, emailVerifiedAt: new Date() })
        .where(and(eq(users.id, row.id), isNull(users.workspaceId)));
    } else {
      const [existingWorkspace] = await tx
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1);
      if (!existingWorkspace) throw new HttpError(500, 'internal_error', 'Something went wrong.');
      workspace = {
        id: existingWorkspace.id,
        name: existingWorkspace.name,
        handle: existingWorkspace.handle,
        createdAt: existingWorkspace.createdAt,
      };
      if (!row.emailVerifiedAt) {
        await tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, row.id));
      }
    }

    if (marketing) await recordMarketingOptIn(tx, row.id, marketing.consentText);
    await tx.insert(sessions).values({ userId: row.id, tokenHash, expiresAt });
    const [fresh] = await tx.select().from(users).where(eq(users.id, row.id)).limit(1);
    if (!fresh || !workspace) throw new HttpError(500, 'internal_error', 'Something went wrong.');
    return {
      id: fresh.id,
      email: fresh.email,
      emailVerifiedAt: fresh.emailVerifiedAt,
      marketingOptIn: fresh.marketingOptIn,
      createdAt: fresh.createdAt,
      workspace,
    } satisfies SessionUser;
  });

  return { token, user };
}

export async function logoutSession(req: Request): Promise<void> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return;
  await getDb().delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

export async function sessionUser(req: Request): Promise<SessionUser | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const db = getDb();
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, sha256(token)))
    .limit(1);
  if (!session || session.expiresAt.getTime() <= Date.now()) {
    if (session) await db.delete(sessions).where(eq(sessions.id, session.id));
    return null;
  }
  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user) return null;
  let workspace: SessionUser['workspace'] = null;
  if (user.workspaceId) {
    const [row] = await db.select().from(workspaces).where(eq(workspaces.id, user.workspaceId)).limit(1);
    if (row) workspace = { id: row.id, name: row.name, handle: row.handle, createdAt: row.createdAt };
  }
  return {
    id: user.id,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt,
    marketingOptIn: user.marketingOptIn,
    createdAt: user.createdAt,
    workspace,
  };
}

export function serializeUser(user: SessionUser) {
  return {
    user: {
      id: user.id,
      email: user.email,
      email_verified_at: user.emailVerifiedAt?.toISOString() ?? null,
      marketing_opt_in: user.marketingOptIn,
      created_at: user.createdAt.toISOString(),
    },
    workspace: user.workspace
      ? {
          id: user.workspace.id,
          name: user.workspace.name,
          handle: user.workspace.handle,
          created_at: user.workspace.createdAt.toISOString(),
        }
      : null,
  };
}

export async function requireUser(req: Request): Promise<SessionUser & { workspace: NonNullable<SessionUser['workspace']> }> {
  const user = await sessionUser(req);
  if (!user) {
    throw new HttpError(401, 'unauthorized', 'Sign in required.');
  }
  if (!user.workspace) {
    throw new HttpError(409, 'workspace_required', 'This account has no workspace yet.');
  }
  return user as SessionUser & { workspace: NonNullable<SessionUser['workspace']> };
}

export const HUMAN_APPROVAL_MESSAGE = 'A signed-in human must approve guests in the dashboard.';

/**
 * Session cookie for a human owner. An agent API key (`rsk_`) is a different
 * credential: it is looked up as an agent key, not as a session, and cannot approve.
 */
export async function requireHumanOwner(
  req: Request,
): Promise<SessionUser & { workspace: NonNullable<SessionUser['workspace']> }> {
  const token = bearerToken(req);
  if (token?.startsWith('rsk_')) {
    await authenticateAgentKey(token, { recordUse: false });
    throw new HttpError(403, 'human_required', HUMAN_APPROVAL_MESSAGE);
  }
  return requireUser(req);
}
