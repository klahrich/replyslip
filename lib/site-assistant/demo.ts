import { randomBytes } from 'node:crypto';
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db';
import {
  siteBusinesses,
  siteConversations,
  siteDemoLinks,
  siteMessageRequests,
  siteMessages,
  siteSuggestedAnswers,
  type SiteBusinessRow,
  type SiteDemoLinkRow,
  type SiteMessageRow,
} from '@/db/schema';
import { sha256 } from '@/lib/crypto';
import { HttpError, isUniqueViolation } from '@/lib/errors';
import { answerVisitorMessage, type SiteAnswerResult } from './answer';
import {
  capLimitsFor,
  ipKeysFor,
  releaseSiteUsage,
  reserveSiteUsage,
  secondsUntilUtcMidnight,
  settleSiteUsage,
  usageDay,
} from './caps';
import { SITE_DEMO_LINK_TTL_DAYS, SITE_DEMO_RETENTION_DAYS, SITE_MESSAGE_MAX_CHARS } from './config';
import type { SiteLlmTransport } from './llm';
import { bannerText, cappedReply, demoNote, noticeText, replyLanguage } from './replies';
import { handoffReason } from './rules';

/**
 * Demo links are /s/demo/<token>. The token is in the path, so it shows up in Vercel's access logs. We accept that
 * for the demo: links expire after 30 days, can be revoked, and only reach public-site information (no visitor
 * contact is taken). The `demo/` prefix keeps tokens from colliding with sibling routes (/s/claim, /s/p, ...).
 */
export const DEMO_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;

/** 32 base64url characters (24 random bytes). Only the sha256 is stored. */
export function newDemoToken(): string {
  return randomBytes(24).toString('base64url');
}

export async function createDemoLink(
  db: Db,
  businessId: string,
  ttlDays = SITE_DEMO_LINK_TTL_DAYS,
): Promise<{ token: string; link: SiteDemoLinkRow }> {
  const token = newDemoToken();
  const [link] = await db
    .insert(siteDemoLinks)
    .values({ businessId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlDays * 86_400_000) })
    .returning();
  return { token, link: link! };
}

export const DEMO_NOT_FOUND = () => new HttpError(404, 'demo_not_found', 'This demo link does not work.');
const DEMO_EXPIRED = () => new HttpError(410, 'demo_expired', 'This demo link has expired.');

/** Business columns every route needs. The screenshot bytes are read only by the image route. */
const businessColumns = {
  id: siteBusinesses.id,
  slug: siteBusinesses.slug,
  displayName: siteBusinesses.displayName,
  contextMd: siteBusinesses.contextMd,
  visitorDailyMessageCap: siteBusinesses.visitorDailyMessageCap,
  dailyMessageCap: siteBusinesses.dailyMessageCap,
  dailyCostCapMicroUsd: siteBusinesses.dailyCostCapMicroUsd,
  tileColor: siteBusinesses.tileColor,
  language: siteBusinesses.language,
  hasDesktopShot: sql<boolean>`${siteBusinesses.desktopShot} is not null`,
  hasMobileShot: sql<boolean>`${siteBusinesses.mobileShot} is not null`,
};

export type DemoBusiness = Pick<
  SiteBusinessRow,
  | 'id'
  | 'slug'
  | 'displayName'
  | 'contextMd'
  | 'visitorDailyMessageCap'
  | 'dailyMessageCap'
  | 'dailyCostCapMicroUsd'
  | 'tileColor'
  | 'language'
> & { hasDesktopShot: boolean; hasMobileShot: boolean };

export type ResolvedDemo = { link: SiteDemoLinkRow; business: DemoBusiness };

/**
 * The only way a /s or /api/v1/s route finds its business: from the token, server-side. Unknown or revoked
 * tokens are 404; expired ones are 410 demo_expired (a deliberate exception to "same error for every failure",
 * harmless with random tokens) unless `expiredAs404` (the image routes).
 */
export async function resolveDemo(token: string, opts: { expiredAs404?: boolean } = {}): Promise<ResolvedDemo> {
  if (!DEMO_TOKEN_PATTERN.test(token)) throw DEMO_NOT_FOUND();
  const db = getDb();
  const [row] = await db
    .select({ link: siteDemoLinks, business: businessColumns })
    .from(siteDemoLinks)
    .innerJoin(siteBusinesses, eq(siteBusinesses.id, siteDemoLinks.businessId))
    .where(eq(siteDemoLinks.tokenHash, sha256(token)))
    .limit(1);
  if (!row || row.link.revokedAt) throw DEMO_NOT_FOUND();
  if (row.link.expiresAt.getTime() <= Date.now()) throw opts.expiredAs404 ? DEMO_NOT_FOUND() : DEMO_EXPIRED();
  return row;
}

// ---------------------------------------------------------------------------------------------------------------
// Visitor cookie: random, HttpOnly, scoped by path to this demo's API, stored only as sha256.

export const VISITOR_COOKIE = 'valetto_sv';
const VISITOR_COOKIE_MAX_AGE = SITE_DEMO_RETENTION_DAYS * 86_400;

export function visitorCookiePath(token: string): string {
  return `/api/v1/s/demo/${token}`;
}

/**
 * `secure` adds the Secure flag. The route sets it for https requests and always in production; without it a
 * browser on plain http (a LAN test box, say) would drop the cookie and every message would start a new visitor.
 */
export function visitorCookieHeader(token: string, value: string, secure = true): string {
  return [
    `${VISITOR_COOKIE}=${value}`,
    'HttpOnly',
    ...(secure ? ['Secure'] : []),
    'SameSite=Lax',
    `Path=${visitorCookiePath(token)}`,
    `Max-Age=${VISITOR_COOKIE_MAX_AGE}`,
  ].join('; ');
}

const VISITOR_VALUE = /^[A-Za-z0-9_-]{32,128}$/;

export function validVisitorValue(value: string | null): string | null {
  return value && VISITOR_VALUE.test(value) ? value : null;
}

export function newVisitorValue(): string {
  return randomBytes(32).toString('base64url');
}

async function findConversation(demo: ResolvedDemo, visitor: string) {
  const [row] = await getDb()
    .select()
    .from(siteConversations)
    .where(
      and(
        eq(siteConversations.demoLinkId, demo.link.id),
        eq(siteConversations.businessId, demo.business.id),
        eq(siteConversations.visitorTokenHash, sha256(visitor)),
      ),
    )
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Response shapes.

export type PublicSuggestedQuestion = {
  id: string;
  question: string;
  answer: string;
  language: string;
  checked_at: string;
};

async function checkedSuggestions(businessId: string): Promise<PublicSuggestedQuestion[]> {
  const rows = await getDb()
    .select()
    .from(siteSuggestedAnswers)
    .where(and(eq(siteSuggestedAnswers.businessId, businessId), isNotNull(siteSuggestedAnswers.checkedAt)))
    .orderBy(asc(siteSuggestedAnswers.position));
  return rows.map((row) => ({
    id: row.id,
    question: row.question,
    answer: row.answer,
    language: row.language,
    checked_at: row.checkedAt!.toISOString(),
  }));
}

/** Muted brand-like colours for the chat tile when RedBot gave none. Picked from the slug, so it never changes. */
const TILE_COLORS = ['#2f5d50', '#3b5b8c', '#7a4b2a', '#5b4a8a', '#8a3b4b', '#2f6f7a', '#6b6b2f', '#444c56'];

export function tileColor(business: Pick<DemoBusiness, 'slug' | 'tileColor'>): string {
  if (business.tileColor) return business.tileColor;
  let hash = 0;
  for (const ch of business.slug) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return TILE_COLORS[hash % TILE_COLORS.length]!;
}

/**
 * LandingBot's DemoMessage (PR #111): id, role, body, status (assistant rows only), created_at. Extra fields the
 * page may ignore: language, client_message_id, suggested_question_id, handoff_reason and demo_note (the page
 * shows its own demo note today).
 */
export function publicMessage(row: SiteMessageRow, businessName: string) {
  const reason = row.role === 'assistant' && row.status === 'needs_owner' ? handoffReason(row.decidedBy) : null;
  return {
    id: row.id,
    role: row.role,
    body: row.body,
    status: row.role === 'assistant' ? row.status : null,
    created_at: row.createdAt.toISOString(),
    language: row.language,
    client_message_id: row.clientMessageId,
    suggested_question_id: row.suggestedAnswerId,
    handoff_reason: reason,
    demo_note: reason ? demoNote(reason, replyLanguage(row.language), businessName) : null,
  };
}

async function conversationMessages(conversationId: string, businessId: string) {
  return getDb()
    .select()
    .from(siteMessages)
    .where(
      and(
        eq(siteMessages.conversationId, conversationId),
        eq(siteMessages.businessId, businessId),
        // A capped attempt keeps no rows, but never show a stray one.
        sql`${siteMessages.status} is distinct from 'capped'`,
      ),
    )
    .orderBy(asc(siteMessages.createdAt), sql`case when ${siteMessages.role} = 'visitor' then 0 else 1 end`);
}

/**
 * GET /api/v1/s/demo/:token. LandingBot's DemoConversation: business, banner, suggested_questions (checked rows
 * only) and this visitor's messages (from the visitor cookie; none without one). Plus notice, expires_at and
 * message_max_chars, which the page may ignore.
 */
export async function demoView(demo: ResolvedDemo, visitorValue: string | null) {
  const { business, link } = demo;
  const conversation = visitorValue ? await findConversation(demo, visitorValue) : null;
  const rows = conversation ? await conversationMessages(conversation.id, business.id) : [];
  return {
    business: {
      name: business.displayName,
      status: 'unclaimed' as const,
      tile: { color: tileColor(business), logo_url: null },
      language: business.language,
    },
    banner: bannerText(business.displayName),
    suggested_questions: await checkedSuggestions(business.id),
    messages: rows.map((row) => publicMessage(row, business.displayName)),
    notice: noticeText(),
    expires_at: link.expiresAt.toISOString(),
    message_max_chars: SITE_MESSAGE_MAX_CHARS,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Posting a message.

export type PostMessageInput =
  | { clientMessageId: string; text: string; suggestedQuestionId?: undefined }
  | { clientMessageId: string; suggestedQuestionId: string; text?: undefined };

export type PostMessageDeps = {
  transport?: SiteLlmTransport;
  /** Database for the cap counters (tests pass separate clients to race them). */
  db?: Db;
  /** Client IP, for the per-IP daily counts. Only its keyed hash is stored. */
  ip?: string;
  /** Test hook: runs after the answer, before anything is stored. A throw here exercises the cleanup path. */
  beforeStore?: () => Promise<void> | void;
};

/** A pending request older than this is treated as dead (the function timeout is 60 s) and can be taken over. */
const REQUEST_STALE_MS = 90_000;
/** How long a duplicate waits for the first request with the same client_message_id before giving up with 409. */
const REQUEST_WAIT_MS = 45_000;
const REQUEST_POLL_MS = 150;

type MessageRequestRow = typeof siteMessageRequests.$inferSelect;
type ConversationRow = typeof siteConversations.$inferSelect;

function inProgress(): HttpError {
  return new HttpError(409, 'message_in_progress', 'This message is still being answered.');
}

/** Any daily cap. A different code from the short-burst `rate_limited`, so the page shows its daily-limit text. */
function dailyLimit(decidedBy: string): HttpError {
  return new HttpError(429, 'daily_limit', cappedReply('en'), {
    reason: decidedBy,
    message_fr: cappedReply('fr'),
    retry_after_seconds: secondsUntilUtcMidnight(),
  });
}

function replyBody(demo: ResolvedDemo, visitor: SiteMessageRow, assistant: SiteMessageRow, replayed: boolean) {
  return {
    message: publicMessage(assistant, demo.business.displayName),
    visitor: publicMessage(visitor, demo.business.displayName),
    replayed,
  };
}

async function findRequest(demo: ResolvedDemo, clientMessageId: string): Promise<MessageRequestRow | null> {
  const [row] = await getDb()
    .select()
    .from(siteMessageRequests)
    .where(
      and(
        eq(siteMessageRequests.demoLinkId, demo.link.id),
        eq(siteMessageRequests.businessId, demo.business.id),
        eq(siteMessageRequests.clientMessageId, clientMessageId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function storedReply(demo: ResolvedDemo, request: MessageRequestRow) {
  const rows = await getDb()
    .select()
    .from(siteMessages)
    .where(
      and(
        eq(siteMessages.businessId, demo.business.id),
        eq(siteMessages.conversationId, request.conversationId),
        inArray(siteMessages.id, [request.visitorMessageId!, request.assistantMessageId!]),
      ),
    );
  const visitor = rows.find((row) => row.id === request.visitorMessageId);
  const assistant = rows.find((row) => row.id === request.assistantMessageId);
  if (!visitor || !assistant) throw inProgress();
  return replyBody(demo, visitor, assistant, true);
}

class LostRace extends Error {}

type Claim =
  | { kind: 'replay'; reply: ReturnType<typeof replyBody>; ownsConversation: boolean }
  | { kind: 'claimed'; conversation: ConversationRow; ownsConversation: boolean };

/**
 * Takes the (demo link, client_message_id) key, or finds who has it. New key: the conversation (found or created
 * for this cookie) and the request row go in one transaction, so a lost race leaves no stray conversation. Done:
 * replay. Failed or stale: take it over. In flight: wait for it, then replay. Same key, different question: 409.
 */
async function claimRequest(demo: ResolvedDemo, visitorValue: string, clientMessageId: string, requestHash: string): Promise<Claim> {
  const db = getDb();
  const visitorHash = sha256(visitorValue);
  const started = Date.now();
  for (;;) {
    const existing = await findRequest(demo, clientMessageId);
    if (!existing) {
      try {
        return await db.transaction(async (tx) => {
          await tx
            .insert(siteConversations)
            .values({ businessId: demo.business.id, demoLinkId: demo.link.id, visitorTokenHash: visitorHash })
            .onConflictDoNothing();
          const [conversation] = await tx
            .select()
            .from(siteConversations)
            .where(
              and(
                eq(siteConversations.demoLinkId, demo.link.id),
                eq(siteConversations.businessId, demo.business.id),
                eq(siteConversations.visitorTokenHash, visitorHash),
              ),
            )
            .limit(1);
          const [row] = await tx
            .insert(siteMessageRequests)
            .values({
              demoLinkId: demo.link.id,
              clientMessageId,
              businessId: demo.business.id,
              conversationId: conversation!.id,
              requestHash,
            })
            .onConflictDoNothing()
            .returning();
          if (!row) throw new LostRace();
          return { kind: 'claimed' as const, conversation: conversation!, ownsConversation: true };
        });
      } catch (err) {
        if (err instanceof LostRace || isUniqueViolation(err)) continue;
        throw err;
      }
    }

    if (existing.requestHash !== requestHash) {
      throw new HttpError(409, 'client_message_id_reused', 'This client_message_id was already used for another message.');
    }
    const [conversation] = await db
      .select()
      .from(siteConversations)
      .where(and(eq(siteConversations.id, existing.conversationId), eq(siteConversations.businessId, demo.business.id)))
      .limit(1);
    const ownsConversation = conversation?.visitorTokenHash === visitorHash;
    if (existing.state === 'done') return { kind: 'replay', reply: await storedReply(demo, existing), ownsConversation };

    const stale = Date.now() - existing.updatedAt.getTime() > REQUEST_STALE_MS;
    if (existing.state === 'failed' || stale) {
      const [taken] = await db
        .update(siteMessageRequests)
        .set({ state: 'pending', updatedAt: new Date() })
        .where(
          and(
            eq(siteMessageRequests.demoLinkId, existing.demoLinkId),
            eq(siteMessageRequests.clientMessageId, existing.clientMessageId),
            eq(siteMessageRequests.state, existing.state),
            eq(siteMessageRequests.updatedAt, existing.updatedAt),
          ),
        )
        .returning();
      if (taken && conversation) return { kind: 'claimed', conversation, ownsConversation };
      continue;
    }

    if (Date.now() - started > REQUEST_WAIT_MS) throw inProgress();
    await new Promise((resolve) => setTimeout(resolve, REQUEST_POLL_MS));
  }
}

/**
 * One visitor message in, one checked reply out (no streaming).
 *
 * Idempotent on client_message_id across the whole demo link: a second request with the same id (with or without
 * the cookie, in parallel or later) waits for or replays the first, with no second model call.
 *
 * A daily cap is 429 daily_limit and keeps no rows, so the same id can go through tomorrow. A throw mid-reply
 * gives back the counts and the cost reservation and marks the request failed, so a retry can take it over.
 * Suggested-question taps are never capped (no model call).
 */
export async function postDemoMessage(
  demo: ResolvedDemo,
  visitorValue: string,
  input: PostMessageInput,
  deps: PostMessageDeps = {},
): Promise<ReturnType<typeof replyBody> & { ownsConversation: boolean }> {
  const db = getDb();
  const business = demo.business;

  let suggestion: typeof siteSuggestedAnswers.$inferSelect | null = null;
  if (input.suggestedQuestionId !== undefined) {
    const [row] = await db
      .select()
      .from(siteSuggestedAnswers)
      .where(
        and(
          eq(siteSuggestedAnswers.id, input.suggestedQuestionId),
          eq(siteSuggestedAnswers.businessId, business.id),
          isNotNull(siteSuggestedAnswers.checkedAt),
        ),
      )
      .limit(1);
    if (!row) throw new HttpError(404, 'suggested_question_not_found', 'That suggested question is not available.');
    suggestion = row;
  }
  const text = suggestion ? suggestion.question : input.text!;
  const requestHash = sha256(suggestion ? `tap\u0000${suggestion.id}` : `text\u0000${text}`);

  // Keyed hashes first: a missing ENCRYPTION_KEY fails here, before any pending request row is written.
  const ipKeys = ipKeysFor(deps.ip ?? 'unknown', demo.link.id);
  const claim = await claimRequest(demo, visitorValue, input.clientMessageId, requestHash);
  if (claim.kind === 'replay') return { ...claim.reply, ownsConversation: claim.ownsConversation };
  const conversation = claim.conversation;
  const requestKey = and(
    eq(siteMessageRequests.demoLinkId, demo.link.id),
    eq(siteMessageRequests.clientMessageId, input.clientMessageId),
  );
  const visitorAt = new Date();

  const capDb = deps.db ?? db;
  const day = usageDay();
  const limits = capLimitsFor(business);
  let counted = false;
  let reserved = 0;
  let capped = false;
  let finished = false;

  try {
    // History before this message, for the prompt. Only this conversation, only this business.
    const history = (await conversationMessages(conversation.id, business.id)).map((row) => ({
      role: row.role as 'visitor' | 'assistant',
      body: row.body,
    }));

    let result: SiteAnswerResult;
    let suggestedDecidedBy: string | null = null;
    if (suggestion) {
      // A tap on a Karim-checked suggestion: the stored answer, no model call, no cap.
      result = {
        status: suggestion.status as SiteAnswerResult['status'],
        body: suggestion.answer,
        topic: suggestion.topic,
        language: suggestion.language as SiteAnswerResult['language'],
        decidedBy: 'answered',
        sourcesKept: suggestion.sourcesKept,
        sourcesDropped: [],
        ownerQuestion: null,
        rawOutput: null,
        llmCalled: false,
        inputTokens: 0,
        outputTokens: 0,
        costMicroUsd: 0,
      };
      suggestedDecidedBy = suggestion.decidedBy;
    } else {
      const decision = await reserveSiteUsage(capDb, {
        businessId: business.id,
        conversationId: conversation.id,
        ipKeys,
        day,
        messages: 1,
        costMicroUsd: 0,
        limits,
      });
      if (!decision.ok) {
        capped = true;
        throw dailyLimit(decision.decidedBy);
      }
      counted = true;
      result = await answerVisitorMessage(
        { businessName: business.displayName, contextMd: business.contextMd, history, visitorMessage: text, businessLanguage: business.language },
        {
          transport: deps.transport,
          reserve: async (worstCase) => {
            const costDecision = await reserveSiteUsage(capDb, {
              businessId: business.id,
              conversationId: conversation.id,
              day,
              messages: 0,
              costMicroUsd: worstCase,
              limits,
            });
            // Added up: a fallback call reserves again on top of the first call's reservation.
            if (costDecision.ok) reserved += worstCase;
            return costDecision;
          },
        },
      );
      if (reserved > 0 || result.llmCalled) {
        await settleSiteUsage(capDb, {
          businessId: business.id,
          day,
          reservedMicroUsd: reserved,
          actualMicroUsd: result.costMicroUsd,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          llmCalled: result.llmCalled,
        });
        reserved = 0;
      }
      if (result.status === 'capped') {
        // The cost cap refused it after the message was counted: the finally block gives the counts back.
        capped = true;
        throw dailyLimit(result.decidedBy);
      }
    }

    await deps.beforeStore?.();

    const stored = await db.transaction(async (tx) => {
      const [visitorRow] = (await tx
        .insert(siteMessages)
        .values({
          businessId: business.id,
          conversationId: conversation.id,
          role: 'visitor',
          body: text,
          clientMessageId: input.clientMessageId,
          suggestedAnswerId: suggestion?.id ?? null,
          createdAt: visitorAt,
        })
        .returning()) as [SiteMessageRow];
      const [assistantRow] = (await tx
        .insert(siteMessages)
        .values({
          businessId: business.id,
          conversationId: conversation.id,
          role: 'assistant',
          body: result.body,
          status: result.status,
          topic: result.topic,
          language: result.language,
          decidedBy: suggestedDecidedBy ?? result.decidedBy,
          sourcesKept: result.sourcesKept,
          sourcesDropped: result.sourcesDropped,
          ownerQuestion: result.ownerQuestion,
          rawOutput: result.rawOutput ?? null,
          suggestedAnswerId: suggestion?.id ?? null,
          clientMessageId: input.clientMessageId,
          inputTokens: result.llmCalled ? result.inputTokens : null,
          outputTokens: result.llmCalled ? result.outputTokens : null,
          costMicroUsd: result.llmCalled ? result.costMicroUsd : null,
          createdAt: new Date(Math.max(Date.now(), visitorAt.getTime() + 1)),
        })
        .returning()) as [SiteMessageRow];
      await tx
        .update(siteMessageRequests)
        .set({ state: 'done', visitorMessageId: visitorRow.id, assistantMessageId: assistantRow.id, updatedAt: new Date() })
        .where(requestKey);
      await tx
        .update(siteConversations)
        .set({ lastMessageAt: new Date(), language: result.language })
        .where(and(eq(siteConversations.id, conversation.id), eq(siteConversations.businessId, business.id)));
      return { visitorRow, assistantRow };
    });
    finished = true;
    return { ...replyBody(demo, stored.visitorRow, stored.assistantRow, false), ownsConversation: claim.ownsConversation };
  } finally {
    if (!finished) {
      try {
        // Give back what this request took. The settled cost of a model call that did run stays spent.
        await releaseSiteUsage(capDb, {
          businessId: business.id,
          conversationId: conversation.id,
          ipKeys,
          day,
          messages: counted ? 1 : 0,
          reservedMicroUsd: reserved,
        });
      } catch (err) {
        console.error('site demo: releasing usage failed', err);
      }
      try {
        if (capped) {
          // A capped attempt keeps no rows, so the same client_message_id can go through tomorrow.
          await db.delete(siteMessageRequests).where(and(requestKey, eq(siteMessageRequests.state, 'pending')));
        } else {
          await db
            .update(siteMessageRequests)
            .set({ state: 'failed', updatedAt: new Date() })
            .where(and(requestKey, eq(siteMessageRequests.state, 'pending')));
        }
      } catch (err) {
        console.error('site demo: marking the request failed did not work', err);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Screenshots and retention.

export async function demoShot(
  demo: ResolvedDemo,
  kind: 'desktop' | 'mobile',
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const [row] = await getDb()
    .select(
      kind === 'desktop'
        ? { bytes: siteBusinesses.desktopShot, contentType: siteBusinesses.desktopShotType }
        : { bytes: siteBusinesses.mobileShot, contentType: siteBusinesses.mobileShotType },
    )
    .from(siteBusinesses)
    .where(eq(siteBusinesses.id, demo.business.id))
    .limit(1);
  return row?.bytes && row.contentType ? { bytes: row.bytes, contentType: row.contentType } : null;
}

/**
 * Deletes demo conversations (and their messages and visitor usage, by cascade) whose last message is older
 * than the retention window. No cron yet: run scripts/site-demo-cleanup.ts by hand.
 */
export async function deleteOldDemoConversations(
  db: Db = getDb(),
  retentionDays = SITE_DEMO_RETENTION_DAYS,
): Promise<number> {
  const deleted = await db
    .delete(siteConversations)
    .where(sql`${siteConversations.lastMessageAt} < now() - make_interval(days => ${retentionDays})`)
    .returning({ id: siteConversations.id });
  return deleted.length;
}
