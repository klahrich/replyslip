import { randomBytes } from 'node:crypto';
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db';
import {
  siteBusinesses,
  siteConversations,
  siteDemoLinks,
  siteMessages,
  siteSuggestedAnswers,
  type SiteBusinessRow,
  type SiteDemoLinkRow,
  type SiteMessageRow,
} from '@/db/schema';
import { sha256 } from '@/lib/crypto';
import { HttpError, isUniqueViolation } from '@/lib/errors';
import { answerVisitorMessage, type SiteAnswerResult } from './answer';
import { capLimitsFor, reserveSiteUsage, settleSiteUsage, usageDay } from './caps';
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

export function visitorCookieHeader(token: string, value: string): string {
  return [
    `${VISITOR_COOKIE}=${value}`,
    'HttpOnly',
    'Secure',
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

async function findOrCreateConversation(demo: ResolvedDemo, visitor: string) {
  const existing = await findConversation(demo, visitor);
  if (existing) return existing;
  const [created] = await getDb()
    .insert(siteConversations)
    .values({ businessId: demo.business.id, demoLinkId: demo.link.id, visitorTokenHash: sha256(visitor) })
    .onConflictDoNothing()
    .returning();
  return created ?? (await findConversation(demo, visitor))!;
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

export type PostMessageDeps = { transport?: SiteLlmTransport; db?: Db };

async function existingReply(conversationId: string, businessId: string, clientMessageId: string) {
  const rows = await getDb()
    .select()
    .from(siteMessages)
    .where(
      and(
        eq(siteMessages.conversationId, conversationId),
        eq(siteMessages.businessId, businessId),
        eq(siteMessages.clientMessageId, clientMessageId),
      ),
    );
  return {
    visitor: rows.find((row) => row.role === 'visitor') ?? null,
    assistant: rows.find((row) => row.role === 'assistant') ?? null,
  };
}

function replyBody(demo: ResolvedDemo, visitor: SiteMessageRow, assistant: SiteMessageRow, replayed: boolean) {
  return {
    message: publicMessage(assistant, demo.business.displayName),
    visitor: publicMessage(visitor, demo.business.displayName),
    replayed,
  };
}

/** Any daily cap. A different code from the short-burst `rate_limited`, so the page shows its daily-limit text. */
function dailyLimit(decidedBy: string): HttpError {
  return new HttpError(429, 'daily_limit', cappedReply('en'), { reason: decidedBy, message_fr: cappedReply('fr') });
}

/**
 * One visitor message in, one checked reply out (no streaming). Idempotent on client_message_id: a retry gets the
 * stored reply and no second model call. A retry while the first is still running gets 409 message_in_progress.
 * A daily cap is 429 daily_limit and keeps no rows, so a retry with the same client_message_id can go through
 * tomorrow. Suggested-question taps are never capped (no model call).
 */
export async function postDemoMessage(
  demo: ResolvedDemo,
  visitorValue: string,
  input: PostMessageInput,
  deps: PostMessageDeps = {},
) {
  const db = getDb();
  const business = demo.business;
  const conversation = await findOrCreateConversation(demo, visitorValue);

  const prior = await existingReply(conversation.id, business.id, input.clientMessageId);
  if (prior.visitor && prior.assistant) return replyBody(demo, prior.visitor, prior.assistant, true);
  if (prior.visitor) throw new HttpError(409, 'message_in_progress', 'This message is still being answered.');

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

  // History before this message, for the prompt. Only this conversation, only this business.
  const history = (await conversationMessages(conversation.id, business.id)).map((row) => ({
    role: row.role as 'visitor' | 'assistant',
    body: row.body,
  }));

  let visitorRow: SiteMessageRow;
  try {
    [visitorRow] = (await db
      .insert(siteMessages)
      .values({
        businessId: business.id,
        conversationId: conversation.id,
        role: 'visitor',
        body: text,
        clientMessageId: input.clientMessageId,
        suggestedAnswerId: suggestion?.id ?? null,
      })
      .returning()) as [SiteMessageRow];
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const again = await existingReply(conversation.id, business.id, input.clientMessageId);
    if (again.visitor && again.assistant) return replyBody(demo, again.visitor, again.assistant, true);
    throw new HttpError(409, 'message_in_progress', 'This message is still being answered.');
  }

  let result: SiteAnswerResult;
  const dropVisitorRow = () => db.delete(siteMessages).where(and(eq(siteMessages.id, visitorRow.id), eq(siteMessages.businessId, business.id)));
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
    const day = usageDay();
    const limits = capLimitsFor(business);
    const capDb = deps.db ?? db;
    const answerInput = { businessName: business.displayName, contextMd: business.contextMd, history, visitorMessage: text };
    const counted = await reserveSiteUsage(capDb, {
      businessId: business.id,
      conversationId: conversation.id,
      day,
      messages: 1,
      costMicroUsd: 0,
      limits,
    });
    if (!counted.ok) {
      await dropVisitorRow();
      throw dailyLimit(counted.decidedBy);
    } else {
      let reserved = 0;
      result = await answerVisitorMessage(answerInput, {
        transport: deps.transport,
        reserve: async (worstCase) => {
          const decision = await reserveSiteUsage(capDb, {
            businessId: business.id,
            conversationId: conversation.id,
            day,
            messages: 0,
            costMicroUsd: worstCase,
            limits,
          });
          if (decision.ok) reserved = worstCase;
          return decision;
        },
      });
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
      }
      if (result.status === 'capped') {
        await dropVisitorRow();
        throw dailyLimit(result.decidedBy);
      }
    }
  }

  const [assistantRow] = (await db
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
    })
    .returning()) as [SiteMessageRow];
  await db
    .update(siteConversations)
    .set({ lastMessageAt: new Date(), language: result.language })
    .where(and(eq(siteConversations.id, conversation.id), eq(siteConversations.businessId, business.id)));

  return replyBody(demo, visitorRow, assistantRow, false);
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
