import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import sharp from 'sharp';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db';
import * as schema from '@/db/schema';
import {
  rateEvents,
  siteBusinesses,
  siteConversations,
  siteDemoLinks,
  siteIpUsageDaily,
  siteMessageRequests,
  siteMessages,
  siteSuggestedAnswers,
  siteUsageDaily,
  siteUsageGlobalDaily,
  siteVisitorUsageDaily,
} from '@/db/schema';
import { GET as demoRoute } from '@/app/api/v1/s/demo/[token]/route';
import { POST as messagesRoute } from '@/app/api/v1/s/demo/[token]/messages/route';
import { GET as shotRoute } from '@/app/(customer)/s/demo/[token]/shot/[kind]/route';
import { capLimitsFor, ipKeysFor, reserveSiteUsage, secondsUntilUtcMidnight, settleSiteUsage, usageDay } from '@/lib/site-assistant/caps';
import { answerVisitorMessage } from '@/lib/site-assistant/answer';
import { createDemoLink, deleteOldDemoConversations, postDemoMessage, resolveDemo } from '@/lib/site-assistant/demo';
import {
  importRedbotBusinesses,
  listUncheckedSuggestedAnswers,
  loadRedbotBusinesses,
  revokeDemoLinks,
  setSuggestedAnswerChecked,
} from '@/lib/site-assistant/import';
import { resetSitePriceWarningsForTests, siteFallbackLlmConfig, siteLlmConfig, type SiteLlmConfig } from '@/lib/site-assistant/config';
import { setSiteLlmTransportForTests, type SiteLlmTransport } from '@/lib/site-assistant/llm';
import { siteRateKey } from '@/lib/site-assistant/routes';
import { detectVisitorLanguage } from '@/lib/site-assistant/keywords';
import { RATE_LIMITS } from '@/lib/constants';
import { cappedReply, needsOwnerReply } from '@/lib/site-assistant/replies';
import { call } from './helpers';
import { answer, createSiteBusiness, createSiteDemo, FIXTURE_DIR, fakeModel, MAPLE_CONTEXT, NO_MODEL, TEST_LLM_CONFIG } from './site-fixtures';

const URL_BASE = 'http://localhost';

beforeEach(() => {
  vi.stubEnv('VALETTO_SITE_ASSISTANT', '1');
  vi.stubEnv('SITE_LLM_API_KEY', 'test-not-a-real-key');
  vi.stubEnv('SITE_LLM_BASE_URL', 'https://llm.invalid/v1');
  setSiteLlmTransportForTests(NO_MODEL);
});

afterEach(() => {
  vi.unstubAllEnvs();
  setSiteLlmTransportForTests(null);
});

function info(token: string, cookie?: string, headers?: Record<string, string>) {
  return call(demoRoute as never, `${URL_BASE}/api/v1/s/demo/${token}`, { params: { token }, cookie, headers });
}
const conversation = info;
/** Each call comes from a fresh IP unless `x-forwarded-for` is given, so per-IP counts don't leak between tests. */
function send(token: string, body: unknown, cookie?: string, headers?: Record<string, string>) {
  const withIp = { 'x-forwarded-for': `test-${randomUUID()}`, ...headers };
  return call(messagesRoute as never, `${URL_BASE}/api/v1/s/demo/${token}/messages`, { params: { token }, body, cookie, headers: withIp });
}

function expectRetryAfterMidnight(res: Response) {
  const header = Number(res.headers.get('retry-after'));
  const expected = secondsUntilUtcMidnight();
  expect(header).toBeGreaterThanOrEqual(1);
  expect(Math.abs(header - expected)).toBeLessThanOrEqual(5);
}

async function usageCounts(businessId: string, conversationIds: string[], day = usageDay()) {
  const [business] = await getDb().select().from(siteUsageDaily).where(and(eq(siteUsageDaily.businessId, businessId), eq(siteUsageDaily.day, day)));
  const visitors = conversationIds.length
    ? await getDb().select().from(siteVisitorUsageDaily).where(and(inArray(siteVisitorUsageDaily.conversationId, conversationIds), eq(siteVisitorUsageDaily.day, day)))
    : [];
  return {
    businessMessages: business?.messages ?? 0,
    reserved: business?.reservedMicroUsd ?? 0,
    visitorMessages: visitors.reduce((sum, row) => sum + row.messages, 0),
  };
}

async function ipCount(ip: string, linkId: string, day = usageDay()) {
  const keys = ipKeysFor(ip, linkId);
  const rows = await getDb().select().from(siteIpUsageDaily).where(and(inArray(siteIpUsageDaily.keyHash, [keys.link, keys.all]), eq(siteIpUsageDaily.day, day)));
  return {
    link: rows.find((row) => row.keyHash === keys.link)?.messages ?? 0,
    all: rows.find((row) => row.keyHash === keys.all)?.messages ?? 0,
  };
}

async function linkConversations(linkId: string) {
  return getDb().select().from(siteConversations).where(eq(siteConversations.demoLinkId, linkId));
}
function shot(token: string, kind: string, headers?: Record<string, string>) {
  return call(shotRoute as never, `${URL_BASE}/s/demo/${token}/shot/${kind}`, { params: { token, kind }, headers });
}

function expectSiteHeaders(res: Response) {
  expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  expect(res.headers.get('cache-control')).toBe('private, no-store');
}

async function addSuggestion(businessId: string, checked: boolean, question = 'What areas do you serve?') {
  const [row] = await getDb()
    .insert(siteSuggestedAnswers)
    .values({
      businessId,
      position: 0,
      question,
      answer: 'We serve Ottawa, Kanata and Orleans.',
      status: 'answered',
      topic: 'general',
      language: 'en',
      decidedBy: 'answered',
      sourcesKept: ['serving Ottawa, Kanata and Orleans'],
      checkedAt: checked ? new Date() : null,
    })
    .returning();
  return row!;
}

describe('demo info and conversation', () => {
  it('returns the banner, notice and only checked suggested questions', async () => {
    const { business, token } = await createSiteDemo();
    const checked = await addSuggestion(business.id, true);
    await addSuggestion(business.id, false, 'Do you do snow removal?');
    const res = await info(token);
    expect(res.status).toBe(200);
    expectSiteHeaders(res.res);
    expect(res.data.business).toEqual({ name: 'Maple Ridge Landscaping', status: 'unclaimed', tile: { color: expect.stringMatching(/^#[0-9a-f]{6}$/), logo_url: null }, language: 'en' });
    expect(Object.keys(res.data)).toEqual(expect.arrayContaining(['business', 'banner', 'suggested_questions', 'messages']));
    expect(res.data.messages).toEqual([]);
    expect(res.data.banner.en).toBe(
      "Demo built by Valetto from Maple Ridge Landscaping's public pages. Not operated by Maple Ridge Landscaping. Answers may be wrong.",
    );
    expect(res.data.banner.fr).toBe(
      'Démo créée par Valetto à partir des pages publiques de Maple Ridge Landscaping. Non exploitée par Maple Ridge Landscaping. Les réponses peuvent être erronées.',
    );
    expect(res.data.notice.en).toMatch(/demo/i);
    expect(res.data.suggested_questions).toEqual([
      { id: checked.id, question: checked.question, answer: checked.answer, language: 'en', checked_at: checked.checkedAt!.toISOString() },
    ]);
    expect(JSON.stringify(res.data)).not.toContain(business.id);
  });

  it('is 404 for unknown, malformed and revoked tokens, and 410 demo_expired when expired', async () => {
    const { business, token, link } = await createSiteDemo();
    expect((await info('short')).status).toBe(404);
    expect((await info('A'.repeat(32))).status).toBe(404);
    await getDb().update(siteDemoLinks).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(siteDemoLinks.id, link.id));
    const expired = await info(token);
    expect(expired.status).toBe(410);
    expect(expired.data.error.code).toBe('demo_expired');
    expectSiteHeaders(expired.res);
    expect((await conversation(token)).status).toBe(410);
    expect((await send(token, { client_message_id: randomUUID(), text: 'Hi' })).status).toBe(410);
    const fresh = await createDemoLink(getDb(), business.id);
    await revokeDemoLinks(getDb(), business.slug);
    const revoked = await info(fresh.token);
    expect(revoked.status).toBe(404);
    expect(revoked.data.error.code).toBe('demo_not_found');
  });

  it('defaults links to 30 days', async () => {
    const { link } = await createSiteDemo();
    const days = (link.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it('is 404 everywhere while the feature flag is off', async () => {
    const { token } = await createSiteDemo();
    vi.stubEnv('VALETTO_SITE_ASSISTANT', '');
    const res = await info(token);
    expect(res.status).toBe(404);
    expectSiteHeaders(res.res);
    expect((await shot(token, 'desktop')).status).toBe(404);
  });

  it('returns no messages and sets no cookie without a visitor cookie', async () => {
    const { token } = await createSiteDemo();
    const res = await conversation(token);
    expect(res.status).toBe(200);
    expect(res.data.messages).toEqual([]);
    expect(res.res.headers.get('set-cookie')).toBeNull();
  });
});

describe('messages', () => {
  it('answers, sets a demo-scoped visitor cookie, and lists the conversation', async () => {
    const { token } = await createSiteDemo();
    const model = fakeModel(() => answer({}));
    setSiteLlmTransportForTests(model.transport);
    const res = await send(token, { client_message_id: randomUUID(), text: 'What areas do you serve?' }, undefined, { 'x-forwarded-proto': 'https' });
    expect(res.status).toBe(200);
    expectSiteHeaders(res.res);
    expect(Object.keys(res.data)).toEqual(['message']);
    expect(res.data.message).toMatchObject({ role: 'assistant', status: 'answered', body: 'We serve Ottawa, Kanata and Orleans.' });
    expect(res.data.message).toHaveProperty('id');
    expect(res.data.message).toHaveProperty('created_at');
    const setCookie = res.res.headers.get('set-cookie')!;
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toContain(`Path=/api/v1/s/demo/${token}`);
    expect(model.calls).toHaveLength(1);

    const list = await conversation(token, res.cookie!);
    expect(list.data.messages.map((m: { role: string; status: string | null }) => [m.role, m.status])).toEqual([
      ['visitor', null],
      ['assistant', 'answered'],
    ]);
    // The cookie is scoped to this demo: another demo's load doesn't see this conversation.
    const other = await createSiteDemo();
    expect((await info(other.token, res.cookie!)).data.messages).toEqual([]);
  });

  it('sets Secure on the visitor cookie only over https or in production', async () => {
    const { token } = await createSiteDemo();
    setSiteLlmTransportForTests(fakeModel(() => answer({})).transport);
    const post = (headers?: Record<string, string>) => send(token, { client_message_id: randomUUID(), text: 'What areas do you serve?' }, undefined, headers);
    const flags = (res: Awaited<ReturnType<typeof post>>) => res.res.headers.get('set-cookie')!.split('; ').slice(1);

    // Plain http (the test URL is http://localhost): no Secure, so the browser keeps it.
    const plain = await post();
    expect(flags(plain)).toEqual(['HttpOnly', 'SameSite=Lax', `Path=/api/v1/s/demo/${token}`, 'Max-Age=2592000']);
    expect(flags(await post({ 'x-forwarded-proto': 'http' }))).not.toContain('Secure');
    // https behind the proxy.
    expect(flags(await post({ 'x-forwarded-proto': 'https' }))).toEqual(['HttpOnly', 'Secure', 'SameSite=Lax', `Path=/api/v1/s/demo/${token}`, 'Max-Age=2592000']);
    // https in the URL itself.
    const direct = await call(messagesRoute as never, `https://localhost/api/v1/s/demo/${token}/messages`, {
      params: { token },
      body: { client_message_id: randomUUID(), text: 'What areas do you serve?' },
      headers: { 'x-forwarded-for': `test-${randomUUID()}` },
    });
    expect(direct.res.headers.get('set-cookie')).toMatch(/; Secure;/);
    // Production always sets it, even if the proxy says http.
    vi.stubEnv('NODE_ENV', 'production');
    expect(flags(await post({ 'x-forwarded-proto': 'http' }))).toContain('Secure');
  });

  it('fails before writing a pending request when ENCRYPTION_KEY is missing', async () => {
    const { token, link } = await createSiteDemo();
    setSiteLlmTransportForTests(fakeModel(() => answer({})).transport);
    const demo = await resolveDemo(token);
    const clientMessageId = randomUUID();
    vi.stubEnv('ENCRYPTION_KEY', '');
    await expect(postDemoMessage(demo, randomUUID(), { clientMessageId, text: 'What areas do you serve?' }, { ip: '192.0.2.1' })).rejects.toThrow(/ENCRYPTION_KEY/);
    vi.unstubAllEnvs();
    expect(await getDb().select().from(siteMessageRequests).where(eq(siteMessageRequests.demoLinkId, link.id))).toHaveLength(0);
    expect(await linkConversations(link.id)).toHaveLength(0);
  });

  it('sends prior messages of this conversation only', async () => {
    const { token } = await createSiteDemo();
    const model = fakeModel(() => answer({}));
    setSiteLlmTransportForTests(model.transport);
    const first = await send(token, { client_message_id: randomUUID(), text: 'Do you do snow removal?' });
    await send(token, { client_message_id: randomUUID(), text: 'Other visitor secret question about lawns' });
    await send(token, { client_message_id: randomUUID(), text: 'And in Kanata?' }, first.cookie!);
    const third = JSON.parse(model.calls[2]!.body).input[0].content[0].text as string;
    expect(third).toContain('Do you do snow removal?');
    expect(third).not.toContain('Other visitor secret');
  });

  it('is idempotent on client_message_id', async () => {
    const { token } = await createSiteDemo();
    const model = fakeModel(() => answer({}));
    setSiteLlmTransportForTests(model.transport);
    const id = randomUUID();
    const a = await send(token, { client_message_id: id, text: 'What areas do you serve?' });
    const b = await send(token, { client_message_id: id, text: 'What areas do you serve?' }, a.cookie!);
    expect(b.status).toBe(200);
    expect(b.data.message.id).toBe(a.data.message.id);
    expect((await info(token, a.cookie!)).data.messages).toHaveLength(2);
    expect(model.calls).toHaveLength(1);
  });

  it('answers a tapped checked suggestion from storage with zero model calls', async () => {
    const { business, token } = await createSiteDemo();
    const suggestion = await addSuggestion(business.id, true);
    const unchecked = await addSuggestion(business.id, false, 'Unchecked?');
    const res = await send(token, { client_message_id: randomUUID(), suggested_question_id: suggestion.id });
    expect(res.status).toBe(200);
    expect(res.data.message).toMatchObject({ body: suggestion.answer, status: 'answered', suggested_question_id: suggestion.id });
    const saved = (await info(token, res.cookie!)).data.messages;
    expect(saved.map((m: { role: string; body: string }) => [m.role, m.body])).toEqual([
      ['visitor', suggestion.question],
      ['assistant', suggestion.answer],
    ]);
    const again = await send(token, { client_message_id: res.data.message.client_message_id, suggested_question_id: suggestion.id }, res.cookie!);
    expect(again.data.message.id).toBe(res.data.message.id);
    // client_message_id is optional on a tap.
    expect((await send(token, { suggested_question_id: suggestion.id }, res.cookie!)).status).toBe(200);
    expect((await send(token, { client_message_id: randomUUID(), suggested_question_id: unchecked.id })).status).toBe(404);
    const other = await createSiteDemo();
    expect((await send(other.token, { client_message_id: randomUUID(), suggested_question_id: suggestion.id })).status).toBe(404);
  });

  it('sends keyword questions to the owner without a call, with a demo note', async () => {
    const { token } = await createSiteDemo();
    const res = await send(token, { client_message_id: randomUUID(), text: 'How much for a patio?' });
    expect(res.data.message).toMatchObject({ status: 'needs_owner', body: needsOwnerReply('en'), handoff_reason: 'owner_topic' });
    expect(res.data.message.demo_note).toMatch(/always go straight to /);
  });

  it('sends a German question to the owner with the other-language note, without a model call', async () => {
    const { token } = await createSiteDemo();
    const model = fakeModel(() => answer({ language: 'fr' }));
    setSiteLlmTransportForTests(model.transport);
    const res = await send(token, { client_message_id: randomUUID(), text: 'Was kostet eine Fassadenreinigung und wann haben Sie Zeit?' });
    expect(res.data.message).toMatchObject({ status: 'needs_owner', body: needsOwnerReply('en'), handoff_reason: 'other_language', language: 'other' });
    expect(res.data.message.demo_note).toMatch(/^I can chat in English and French\./);
    expect(model.calls).toHaveLength(0);
  });

  it('sends every non-English, non-French probe to the owner through the route, whatever the model says', async () => {
    const { probes } = JSON.parse(readFileSync(join(FIXTURE_DIR, 'language-probes.json'), 'utf8')) as { probes: { language: string; text: string }[] };
    expect(probes.length).toBeGreaterThanOrEqual(22);
    const rows: string[] = [];
    let i = 0;
    for (const probe of probes) {
      const { token } = await createSiteDemo();
      const detected = detectVisitorLanguage(probe.text);
      // Where the server is sure, the fake model mislabels on purpose (en/fr) and is never called. Where the server
      // can't tell, the fake model gives the correct "other" tag: these 4 probes test that a model "other" still
      // reaches the owner, not a mislabel. Known limit: undecided text the model wrongly tags en/fr gets answered.
      const tag = detected === null ? 'other' : i++ % 2 ? 'fr' : 'en';
      const model = fakeModel(() => answer({ language: tag }));
      setSiteLlmTransportForTests(model.transport);
      const res = await send(token, { client_message_id: randomUUID(), text: probe.text });
      expect(res.status, probe.text).toBe(200);
      expect(res.data.message, probe.text).toMatchObject({ status: 'needs_owner', handoff_reason: 'other_language', language: 'other' });
      expect(res.data.message.demo_note, probe.text).toMatch(/^I can chat in English and French\./);
      // The server decides before the call when it knows; otherwise the model's "other" decides.
      expect(model.calls, probe.text).toHaveLength(detected === 'other' ? 0 : 1);
      rows.push(`${probe.language} | ${detected ?? 'undecided'} | ${tag} | ${res.data.message.status} | ${model.calls.length}`);
    }
    console.log(`[site-assistant] language probes (language | server | model tag | status | model calls)\n${rows.join('\n')}`);
  });

  it('rejects bad bodies, long text and cross-site posts', async () => {
    const { token } = await createSiteDemo();
    const long = await send(token, { client_message_id: randomUUID(), text: 'x'.repeat(1001) });
    expect(long.status).toBe(400);
    expect(long.data.error.code).toBe('message_too_long');
    expect((await send(token, { client_message_id: randomUUID(), text: 'x'.repeat(1000) })).status).toBe(200);
    expect((await send(token, { client_message_id: randomUUID(), body: 'What areas?' })).status).toBe(200);
    expect((await send(token, { text: 'no id' })).status).toBe(400);
    expect((await send(token, { client_message_id: randomUUID() })).status).toBe(400);
    expect((await send(token, { client_message_id: randomUUID(), text: 'a', suggested_question_id: randomUUID() })).status).toBe(400);
    expect((await send(token, { client_message_id: 'nope', text: 'a' })).status).toBe(400);
    expect((await send(token, { client_message_id: randomUUID(), text: 'a', email: 'x' })).status).toBe(400);
    const cross = await send(token, { client_message_id: randomUUID(), text: 'Hi' }, undefined, { 'sec-fetch-site': 'cross-site' });
    expect(cross.status).toBe(403);
    expectSiteHeaders(cross.res);
  });

  it('stops at the visitor cap with the fixed message', async () => {
    const { token } = await createSiteDemo({ visitorDailyMessageCap: 2 });
    setSiteLlmTransportForTests(fakeModel(() => answer({})).transport);
    const a = await send(token, { client_message_id: randomUUID(), text: 'Areas?' });
    await send(token, { client_message_id: randomUUID(), text: 'Areas?' }, a.cookie!);
    const id = randomUUID();
    const c = await send(token, { client_message_id: id, text: 'Areas?' }, a.cookie!);
    expect(c.status).toBe(429);
    expect(c.data.error).toMatchObject({ code: 'daily_limit', message: cappedReply('en') });
    expectSiteHeaders(c.res);
    expectRetryAfterMidnight(c.res);
    // Nothing kept for the capped attempt; the same id is free to retry later.
    expect((await info(token, a.cookie!)).data.messages).toHaveLength(4);
    expect(await getDb().select().from(siteMessages).where(eq(siteMessages.clientMessageId, id))).toHaveLength(0);
    // Another visitor still gets through.
    expect((await send(token, { client_message_id: randomUUID(), text: 'Areas?' })).data.message.status).toBe('answered');
  });

  it('counts by IP too, so clearing the cookie does not reset the limit, per link and across links', async () => {
    vi.stubEnv('SITE_IP_DAILY_MESSAGES_PER_LINK', '2');
    vi.stubEnv('SITE_IP_DAILY_MESSAGES', '3');
    const a = await createSiteDemo();
    const b = await createSiteDemo();
    setSiteLlmTransportForTests(fakeModel(() => answer({})).transport);
    const ip = { 'x-forwarded-for': `203.0.113.${Math.floor(Math.random() * 250)}, 10.0.0.1-${randomUUID()}` };
    // No cookie on any of these: each is a "new visitor".
    expect((await send(a.token, { client_message_id: randomUUID(), text: 'Areas?' }, undefined, ip)).status).toBe(200);
    expect((await send(a.token, { client_message_id: randomUUID(), text: 'Areas?' }, undefined, ip)).status).toBe(200);
    const third = await send(a.token, { client_message_id: randomUUID(), text: 'Areas?' }, undefined, ip);
    expect(third.status).toBe(429);
    expect(third.data.error).toMatchObject({ code: 'daily_limit', details: { reason: 'cap_ip_link' } });
    expectRetryAfterMidnight(third.res);
    // Another link from the same IP: room for one more under the all-links limit of 3.
    expect((await send(b.token, { client_message_id: randomUUID(), text: 'Areas?' }, undefined, ip)).status).toBe(200);
    const fifth = await send(b.token, { client_message_id: randomUUID(), text: 'Areas?' }, undefined, ip);
    expect(fifth.status).toBe(429);
    expect(fifth.data.error.details.reason).toBe('cap_ip_all');
    // Another IP is unaffected.
    expect((await send(a.token, { client_message_id: randomUUID(), text: 'Areas?' })).status).toBe(200);
    // The refused messages were given back to the visitor and business counts; only keyed hashes are stored.
    const ipValue = ip['x-forwarded-for'].split(',')[0]!.trim();
    expect(await ipCount(ipValue, a.link.id)).toEqual({ link: 2, all: 3 });
    expect((await usageCounts(a.business.id, (await linkConversations(a.link.id)).map((c) => c.id))).businessMessages).toBe(3);
    const stored = await getDb().select().from(siteIpUsageDaily);
    expect(stored.every((row) => /^[0-9a-f]{64}$/.test(row.keyHash) && !row.keyHash.includes(ipValue))).toBe(true);
  });

  it('makes one conversation and one model call for parallel no-cookie requests with the same client_message_id', async () => {
    const { token, link } = await createSiteDemo();
    const model = fakeModel(() => answer({}));
    const slow: typeof model.transport = async (req) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return model.transport(req);
    };
    setSiteLlmTransportForTests(slow);
    const id = randomUUID();
    const results = await Promise.all(Array.from({ length: 6 }, () => send(token, { client_message_id: id, text: 'What areas do you serve?' })));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(new Set(results.map((r) => r.data.message.id)).size).toBe(1);
    expect(model.calls).toHaveLength(1);
    const conversations = await linkConversations(link.id);
    expect(conversations).toHaveLength(1);
    // Only the request that owns the conversation hands out its cookie.
    const withCookie = results.filter((r) => r.res.headers.get('set-cookie'));
    expect(withCookie).toHaveLength(1);
    expect((await info(token, withCookie[0]!.cookie!)).data.messages).toHaveLength(2);
    expect(await getDb().select().from(siteMessages).where(eq(siteMessages.conversationId, conversations[0]!.id))).toHaveLength(2);
    // A later replay with no cookie gets the stored answer and no cookie.
    const later = await send(token, { client_message_id: id, text: 'What areas do you serve?' });
    expect(later.data.message.id).toBe(results[0]!.data.message.id);
    expect(later.res.headers.get('set-cookie')).toBeNull();
    expect(model.calls).toHaveLength(1);
  });

  it('refuses a client_message_id reused for a different question on the same link', async () => {
    const { token } = await createSiteDemo();
    setSiteLlmTransportForTests(fakeModel(() => answer({})).transport);
    const id = randomUUID();
    const first = await send(token, { client_message_id: id, text: 'What areas do you serve?' });
    expect(first.status).toBe(200);
    const reused = await send(token, { client_message_id: id, text: 'Something else entirely?' });
    expect(reused.status).toBe(409);
    expect(reused.data.error.code).toBe('client_message_id_reused');
    // The same id on another demo link is a separate key.
    const other = await createSiteDemo();
    expect((await send(other.token, { client_message_id: id, text: 'Something else entirely?' })).status).toBe(200);
  });

  it('gives back the counts and the reservation and marks the request failed when a reply throws, so a retry works', async () => {
    const { token, business, link } = await createSiteDemo();
    const model = fakeModel(() => answer({}));
    setSiteLlmTransportForTests(model.transport);
    const demo = await resolveDemo(token);
    const ip = `test-${randomUUID()}`;
    const visitor = randomUUID();
    const input = { clientMessageId: randomUUID(), text: 'What areas do you serve?' };
    await expect(
      postDemoMessage(demo, visitor, input, {
        ip,
        beforeStore: () => {
          throw new Error('crash mid-reply');
        },
      }),
    ).rejects.toThrow('crash mid-reply');
    const conversations = (await linkConversations(link.id)).map((c) => c.id);
    expect(await usageCounts(business.id, conversations)).toMatchObject({ businessMessages: 0, reserved: 0, visitorMessages: 0 });
    expect(await ipCount(ip, link.id)).toEqual({ link: 0, all: 0 });
    const [request] = await getDb().select().from(siteMessageRequests).where(eq(siteMessageRequests.clientMessageId, input.clientMessageId));
    expect(request!.state).toBe('failed');
    expect(await getDb().select().from(siteMessages).where(eq(siteMessages.clientMessageId, input.clientMessageId))).toHaveLength(0);

    // The retry takes the failed request over instead of getting 409.
    const retry = await postDemoMessage(demo, visitor, input, { ip });
    expect(retry.replayed).toBe(false);
    expect(retry.message.status).toBe('answered');
    expect(model.calls).toHaveLength(2);
    expect(await usageCounts(business.id, conversations)).toMatchObject({ businessMessages: 1, reserved: 0, visitorMessages: 1 });
    expect(await ipCount(ip, link.id)).toEqual({ link: 1, all: 1 });
  });

  it('a thrown database error mid-reply also releases and marks failed', async () => {
    const { token, business, link } = await createSiteDemo();
    setSiteLlmTransportForTests(fakeModel(() => answer({})).transport);
    const demo = await resolveDemo(token);
    const ip = `test-${randomUUID()}`;
    const input = { clientMessageId: randomUUID(), text: 'What areas do you serve?' };
    await expect(
      postDemoMessage(demo, randomUUID(), input, {
        ip,
        beforeStore: async () => {
          await getDb().execute(sql`select 1 / 0`);
        },
      }),
    ).rejects.toThrow();
    expect(await usageCounts(business.id, (await linkConversations(link.id)).map((c) => c.id))).toMatchObject({ businessMessages: 0, reserved: 0 });
    const res = await send(token, { client_message_id: input.clientMessageId, text: input.text });
    expect(res.status).toBe(200);
    expect(res.data.message.status).toBe('answered');
  });
});

describe('fallback model', () => {
  // Test prices for the fallback, deliberately different from the primary's 0.1 / 0.5.
  const config = { ...TEST_LLM_CONFIG, fallbackModel: 'gpt-6.1-terra', fallbackPriceInPerM: 0.3, fallbackPriceOutPerM: 1.5 };
  function stubFallbackEnv() {
    vi.stubEnv('SITE_LLM_FALLBACK_MODEL', 'gpt-6.1-terra');
    vi.stubEnv('SITE_LLM_FALLBACK_PRICE_IN_PER_M', '0.3');
    vi.stubEnv('SITE_LLM_FALLBACK_PRICE_OUT_PER_M', '1.5');
  }
  const ask = (transport: SiteLlmTransport, cfg: SiteLlmConfig = config) =>
    answerVisitorMessage(
      { businessName: 'Maple Ridge Landscaping', contextMd: MAPLE_CONTEXT, history: [], visitorMessage: 'What areas do you serve?' },
      { transport, config: cfg },
    );
  const notFound = { httpStatus: 404, text: JSON.stringify({ error: { code: 'model_not_found', message: 'no such model' } }) };

  it('retries once on the fallback when the primary model is not found', async () => {
    const model = fakeModel((_req, n) => (n === 1 ? notFound : answer({})));
    const result = await ask(model.transport);
    expect(result.status).toBe('answered');
    expect(result.model).toBe('gpt-6.1-terra');
    expect(model.calls).toHaveLength(2);
    expect(JSON.parse(model.calls[0]!.body).model).toBe('test-model');
    expect(JSON.parse(model.calls[1]!.body).model).toBe('gpt-6.1-terra');
  });

  it('retries on a 5xx, but not on a 400, and not when the fallback is off', async () => {
    const fiveHundred = fakeModel((_req, n) => (n === 1 ? { httpStatus: 503 } : answer({})));
    expect((await ask(fiveHundred.transport)).status).toBe('answered');
    expect(fiveHundred.calls).toHaveLength(2);

    const badRequest = fakeModel(() => ({ httpStatus: 400, text: JSON.stringify({ error: { code: 'invalid_request' } }) }));
    expect((await ask(badRequest.transport)).decidedBy).toBe('llm_error');
    expect(badRequest.calls).toHaveLength(1);

    const off = fakeModel((_req, n) => (n === 1 ? notFound : answer({})));
    expect((await ask(off.transport, { ...config, fallbackModel: null })).status).toBe('needs_owner');
    expect(off.calls).toHaveLength(1);

    const bothDown = fakeModel(() => ({ httpStatus: 500 }));
    expect((await ask(bothDown.transport)).status).toBe('needs_owner');
    expect(bothDown.calls).toHaveLength(2);
  });

  it('reserves the fallback separately and skips it when that reservation is refused', async () => {
    const reserves: number[] = [];
    const model = fakeModel((_req, n) => (n === 1 ? notFound : answer({})));
    const result = await answerVisitorMessage(
      { businessName: 'Maple Ridge Landscaping', contextMd: MAPLE_CONTEXT, history: [], visitorMessage: 'What areas do you serve?' },
      {
        transport: model.transport,
        config,
        reserve: async (worstCase) => {
          reserves.push(worstCase);
          return reserves.length === 1 ? { ok: true } : { ok: false, decidedBy: 'cap_business_cost' };
        },
      },
    );
    expect(reserves).toHaveLength(2);
    expect(reserves[1]).toBeGreaterThan(0);
    expect(model.calls).toHaveLength(1);
    expect(result).toMatchObject({ status: 'needs_owner', decidedBy: 'llm_fallback_capped', llmCalled: true, body: needsOwnerReply('en') });
  });

  it('goes to the owner without the fallback when the business cap is nearly used, and never passes the cap', async () => {
    stubFallbackEnv();
    const question = 'What areas do you serve?';
    const { token, business } = await createSiteDemo({ dailyCostCapMicroUsd: 10_000_000 });
    // The worst case the route will reserve for one call on this business and question.
    const reserves: number[] = [];
    await answerVisitorMessage(
      { businessName: business.displayName, contextMd: business.contextMd, history: [], visitorMessage: question },
      { transport: fakeModel(() => answer({})).transport, config: siteLlmConfig(), reserve: async (w) => (reserves.push(w), { ok: true }) },
    );
    const worstCase = reserves[0]!;
    // Room for one worst case and a half: the first call fits, the fallback's reservation doesn't.
    const cap = 10_000_000;
    const day = usageDay();
    await getDb()
      .insert(siteUsageDaily)
      .values({ businessId: business.id, day, costMicroUsd: cap - Math.floor(worstCase * 1.5) })
      .onConflictDoNothing();
    const model = fakeModel((_req, n) => (n === 1 ? notFound : answer({})));
    setSiteLlmTransportForTests(model.transport);
    const res = await send(token, { client_message_id: randomUUID(), text: question });
    expect(res.status).toBe(200);
    expect(res.data.message).toMatchObject({ status: 'needs_owner', body: needsOwnerReply('en'), handoff_reason: 'check_failed' });
    expect(model.calls).toHaveLength(1);
    const [row] = await getDb().select().from(siteMessages).where(eq(siteMessages.id, res.data.message.id));
    expect(row!.decidedBy).toBe('llm_fallback_capped');
    const [usage] = await getDb().select().from(siteUsageDaily).where(and(eq(siteUsageDaily.businessId, business.id), eq(siteUsageDaily.day, day)));
    expect(usage!.reservedMicroUsd).toBe(0);
    expect(usage!.costMicroUsd + usage!.reservedMicroUsd).toBeLessThanOrEqual(cap);
    expect(usage!.messages).toBe(1);
  });

  it('prices the fallback at its own rates, for the reservation and the charge', async () => {
    const reserves: number[] = [];
    const model = fakeModel((_req, n) => (n === 1 ? notFound : answer({})));
    const result = await answerVisitorMessage(
      { businessName: 'Maple Ridge Landscaping', contextMd: MAPLE_CONTEXT, history: [], visitorMessage: 'What areas do you serve?' },
      { transport: model.transport, config, reserve: async (w) => (reserves.push(w), { ok: true }) },
    );
    expect(result.status).toBe('answered');
    // Same token estimate, three times the price on both sides here.
    expect(reserves[1]).toBeGreaterThanOrEqual(reserves[0]! * 3 - 1);
    expect(reserves[1]).toBeLessThanOrEqual(reserves[0]! * 3 + 1);
    // The fake reports 1000 in / 100 out on the answering call: 1000 x 0.3 + 100 x 1.5 = 450, not 150 at luna's rates.
    expect(result.costMicroUsd).toBe(450);
  });

  it('makes no fallback call when the fallback has no prices configured', async () => {
    const model = fakeModel((_req, n) => (n === 1 ? notFound : answer({})));
    const result = await ask(model.transport, { ...config, fallbackPriceInPerM: null });
    expect(result).toMatchObject({ status: 'needs_owner', decidedBy: 'llm_error' });
    expect(model.calls).toHaveLength(1);
  });

  it.each([
    ['0', '0'],
    ['a negative value', '-0.5'],
    ['a non-number', 'cheap'],
  ])('keeps the fallback off, with one warning, when a fallback price is %s', async (_label, bad) => {
    resetSitePriceWarningsForTests();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const [badName, goodName] of [
        ['SITE_LLM_FALLBACK_PRICE_IN_PER_M', 'SITE_LLM_FALLBACK_PRICE_OUT_PER_M'],
        ['SITE_LLM_FALLBACK_PRICE_OUT_PER_M', 'SITE_LLM_FALLBACK_PRICE_IN_PER_M'],
      ] as const) {
        warn.mockClear();
        stubFallbackEnv();
        vi.stubEnv(badName, bad);
        vi.stubEnv(goodName, '1.5');
        const first = siteLlmConfig();
        expect(siteFallbackLlmConfig(first)).toBeNull();
        siteLlmConfig();
        expect(warn).toHaveBeenCalledTimes(1);
        const message = String(warn.mock.calls[0]![0]);
        // Names the setting only, never its value.
        expect(message).toBe(`[site-assistant] ${badName} must be a number above 0; the fallback model is off.`);
        expect(message).not.toMatch(/key|sk-|postgres/i);

        // And no second model call is made.
        const model = fakeModel((_req, n) => (n === 1 ? notFound : answer({})));
        const result = await ask(model.transport, { ...first, apiKey: config.apiKey });
        expect(result).toMatchObject({ status: 'needs_owner', decidedBy: 'llm_error' });
        expect(model.calls).toHaveLength(1);
      }
    } finally {
      warn.mockRestore();
    }
  });

  it('never prices the fallback at 0 or below, even when set in config directly', () => {
    for (const [inPrice, outPrice] of [[0, 1.5], [0.3, 0], [-1, 1.5], [0.3, Number.NaN], [Number.POSITIVE_INFINITY, 1.5]]) {
      expect(siteFallbackLlmConfig({ ...config, fallbackPriceInPerM: inPrice!, fallbackPriceOutPerM: outPrice! })).toBeNull();
    }
    expect(siteFallbackLlmConfig(config)).toMatchObject({ model: config.fallbackModel, priceInPerM: 0.3, priceOutPerM: 1.5 });
  });

  it('runs inside the one reservation and caps through the route', async () => {
    stubFallbackEnv();
    const { token, business } = await createSiteDemo();
    const model = fakeModel((_req, n) => (n === 1 ? notFound : answer({})));
    setSiteLlmTransportForTests(model.transport);
    const res = await send(token, { client_message_id: randomUUID(), text: 'What areas do you serve?' });
    expect(res.data.message.status).toBe('answered');
    expect(model.calls).toHaveLength(2);
    const [usage] = await getDb().select().from(siteUsageDaily).where(and(eq(siteUsageDaily.businessId, business.id), eq(siteUsageDaily.day, usageDay())));
    expect(usage).toMatchObject({ messages: 1, reservedMicroUsd: 0 });
    expect(usage!.costMicroUsd).toBeGreaterThan(0);
  });
});

describe('screenshots', () => {
  it('rate-limits screenshots in their own bucket, never against page loads or messages', async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#336699' } }).png().toBuffer();
    const { token } = await createSiteDemo({ desktopShot: png, desktopShotType: 'image/png', mobileShot: png, mobileShotType: 'image/png' });
    const ip = { 'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 250)}` };
    for (let i = 0; i < 20; i += 1) expect((await shot(token, i % 2 ? 'mobile' : 'desktop', ip)).status).toBe(200);
    const kinds = await getDb().select({ kind: rateEvents.kind }).from(rateEvents);
    expect(new Set(kinds.map((k) => k.kind))).toEqual(new Set(['siteShot']));

    // Use up this IP's whole page-load budget: screenshots still load, the page itself is limited.
    const key = siteRateKey(new Request('http://localhost/', { headers: ip }));
    await getDb().insert(rateEvents).values(Array.from({ length: RATE_LIMITS.siteEntry.ip }, () => ({ kind: 'siteEntry', ip: key })));
    expect((await info(token, undefined, ip)).status).toBe(429);
    expect((await shot(token, 'desktop', ip)).status).toBe(200);
    expect(RATE_LIMITS.siteShot.ip).toBeGreaterThanOrEqual(1_000);
  });

  it('stores only a keyed hash of the IP in rate_events, never the raw IP', async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#336699' } }).png().toBuffer();
    const { token } = await createSiteDemo({ desktopShot: png, desktopShotType: 'image/png' });
    setSiteLlmTransportForTests(fakeModel(() => answer({})).transport);
    const raw = '203.0.113.77';
    const ip = { 'x-forwarded-for': `${raw}, 10.0.0.1` };
    expect((await info(token, undefined, ip)).status).toBe(200);
    expect((await shot(token, 'desktop', ip)).status).toBe(200);
    expect((await send(token, { client_message_id: randomUUID(), text: 'What areas do you serve?' }, undefined, ip)).status).toBe(200);
    const rows = await getDb().select().from(rateEvents);
    expect(rows.map((r) => r.kind).sort()).toEqual(['siteEntry', 'siteMessage', 'siteShot']);
    for (const row of rows) {
      expect(row.ip).toMatch(/^[0-9a-f]{64}$/);
      expect(row.ip).not.toContain(raw);
    }
    expect(new Set(rows.map((r) => r.ip)).size).toBe(1);
    expect(await getDb().select().from(rateEvents).where(sql`${rateEvents.ip} like ${'%' + raw + '%'}`)).toHaveLength(0);
  });

  it('serves the stored image, private and noindex, and 404s for bad, revoked or expired tokens', async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#336699' } }).png().toBuffer();
    const { token, link } = await createSiteDemo({ desktopShot: png, desktopShotType: 'image/png' });
    const res = await shot(token, 'desktop');
    expect(res.status).toBe(200);
    expect(res.res.headers.get('content-type')).toBe('image/png');
    expectSiteHeaders(res.res);
    expect(res.res.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await shot(token, 'mobile')).status).toBe(404);
    expect((await shot(token, 'tablet')).status).toBe(404);
    expect((await shot('B'.repeat(32), 'desktop')).status).toBe(404);
    await getDb().update(siteDemoLinks).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(siteDemoLinks.id, link.id));
    const expired = await shot(token, 'desktop');
    expect(expired.status).toBe(404);
    expectSiteHeaders(expired.res);
  });
});

describe('caps', () => {
  const clients: ReturnType<typeof postgres>[] = [];
  afterAll(async () => {
    await Promise.all(clients.map((c) => c.end()));
  });
  function separateDb() {
    const client = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, onnotice: () => {} });
    clients.push(client);
    return drizzle(client, { schema });
  }
  async function conversationFor(businessId: string, linkId: string) {
    const [row] = await getDb()
      .insert(siteConversations)
      .values({ businessId, demoLinkId: linkId, visitorTokenHash: randomUUID() })
      .returning();
    return row!;
  }

  it('lets exactly the cap through when requests race on separate connections', async () => {
    const { business, link } = await createSiteDemo({ dailyMessageCap: 5, visitorDailyMessageCap: 100 });
    const convo = await conversationFor(business.id, link.id);
    const day = usageDay();
    const limits = capLimitsFor({ ...business, dailyMessageCap: 5 });
    const dbs = Array.from({ length: 12 }, () => separateDb());
    // A fresh IP each run: the shared test DB keeps per-IP daily counts across runs.
    const ipKeys = ipKeysFor(`test-${randomUUID()}`, link.id);
    const results = await Promise.all(
      dbs.map((db) => reserveSiteUsage(db, { businessId: business.id, conversationId: convo.id, ipKeys, day, messages: 1, costMicroUsd: 0, limits })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.decidedBy === 'cap_business_messages')).toBe(true);
    const [usage] = await getDb().select().from(siteUsageDaily).where(and(eq(siteUsageDaily.businessId, business.id), eq(siteUsageDaily.day, day)));
    expect(usage!.messages).toBe(5);
  });

  it('reserves worst-case cost atomically against the business cap, then settles to actual', async () => {
    const { business, link } = await createSiteDemo({ dailyCostCapMicroUsd: 1_000 });
    const convo = await conversationFor(business.id, link.id);
    const day = usageDay();
    const limits = { ...capLimitsFor(business), businessDailyCostMicroUsd: 1_000, globalDailyCostMicroUsd: 10_000_000_000 };
    const dbs = Array.from({ length: 8 }, () => separateDb());
    const results = await Promise.all(
      dbs.map((db) => reserveSiteUsage(db, { businessId: business.id, conversationId: convo.id, day, messages: 0, costMicroUsd: 300, limits })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, decidedBy: 'cap_business_cost' });
    await settleSiteUsage(getDb(), { businessId: business.id, day, reservedMicroUsd: 300, actualMicroUsd: 50, inputTokens: 100, outputTokens: 10, llmCalled: true });
    const [usage] = await getDb().select().from(siteUsageDaily).where(and(eq(siteUsageDaily.businessId, business.id), eq(siteUsageDaily.day, day)));
    expect(usage).toMatchObject({ reservedMicroUsd: 600, costMicroUsd: 50, llmCalls: 1, inputTokens: 100 });
    // Freed room: one more 300 fits (50 + 600 + 300 <= 1000), the next doesn't.
    expect((await reserveSiteUsage(getDb(), { businessId: business.id, conversationId: convo.id, day, messages: 0, costMicroUsd: 300, limits })).ok).toBe(true);
    expect((await reserveSiteUsage(getDb(), { businessId: business.id, conversationId: convo.id, day, messages: 0, costMicroUsd: 300, limits })).ok).toBe(false);
  });

  it('checks the business cap before the global one, and the global cap across businesses', async () => {
    const day = '2099-01-01';
    await getDb().delete(siteUsageGlobalDaily).where(eq(siteUsageGlobalDaily.day, day));
    const a = await createSiteDemo();
    const b = await createSiteDemo();
    const ca = await conversationFor(a.business.id, a.link.id);
    const cb = await conversationFor(b.business.id, b.link.id);
    const limits = { visitorDailyMessages: 100, ipLinkDailyMessages: 100, ipAllDailyMessages: 100, businessDailyMessages: 100, businessDailyCostMicroUsd: 600, globalDailyCostMicroUsd: 1_000 };
    expect(await reserveSiteUsage(getDb(), { businessId: a.business.id, conversationId: ca.id, day, messages: 0, costMicroUsd: 700, limits })).toEqual({ ok: false, decidedBy: 'cap_business_cost' });
    expect((await reserveSiteUsage(getDb(), { businessId: a.business.id, conversationId: ca.id, day, messages: 0, costMicroUsd: 600, limits })).ok).toBe(true);
    expect(await reserveSiteUsage(getDb(), { businessId: b.business.id, conversationId: cb.id, day, messages: 0, costMicroUsd: 500, limits })).toEqual({ ok: false, decidedBy: 'cap_global_cost' });
    // The failed global check rolled back b's business reservation.
    const [rowB] = await getDb().select().from(siteUsageDaily).where(and(eq(siteUsageDaily.businessId, b.business.id), eq(siteUsageDaily.day, day)));
    expect(rowB?.reservedMicroUsd ?? 0).toBe(0);
    await getDb().delete(siteUsageGlobalDaily).where(eq(siteUsageGlobalDaily.day, day));
  });

  it('caps a business through the route with no model call past the cap', async () => {
    const { token } = await createSiteDemo({ dailyCostCapMicroUsd: 1 });
    const res = await send(token, { client_message_id: randomUUID(), text: 'What areas do you serve?' });
    expect(res.status).toBe(429);
    expect(res.data.error.code).toBe('daily_limit');
    expectRetryAfterMidnight(res.res);
  });

  it('gives the visitor, IP and business message counts back when the cost cap refuses', async () => {
    const { token, business, link } = await createSiteDemo({ dailyCostCapMicroUsd: 1 });
    const ip = `test-${randomUUID()}`;
    const res = await send(token, { client_message_id: randomUUID(), text: 'What areas do you serve?' }, undefined, { 'x-forwarded-for': ip });
    expect(res.status).toBe(429);
    expect(res.data.error.details.reason).toBe('cap_business_cost');
    const conversations = (await linkConversations(link.id)).map((c) => c.id);
    expect(await usageCounts(business.id, conversations)).toMatchObject({ businessMessages: 0, reserved: 0, visitorMessages: 0 });
    expect(await ipCount(ip, link.id)).toEqual({ link: 0, all: 0 });
    expect(await getDb().select().from(siteMessageRequests).where(eq(siteMessageRequests.demoLinkId, link.id))).toHaveLength(0);
  });
});

describe('business isolation (composite foreign keys)', () => {
  it('rejects a conversation, message or usage row that points at another business', async () => {
    const a = await createSiteDemo();
    const b = await createSiteBusiness();
    const db = getDb();
    await expect(
      db.insert(siteConversations).values({ businessId: b.id, demoLinkId: a.link.id, visitorTokenHash: randomUUID() }),
    ).rejects.toThrow();
    const [convo] = await db.insert(siteConversations).values({ businessId: a.business.id, demoLinkId: a.link.id, visitorTokenHash: randomUUID() }).returning();
    await expect(db.insert(siteMessages).values({ businessId: b.id, conversationId: convo!.id, role: 'visitor', body: 'x' })).rejects.toThrow();
    await expect(db.insert(siteVisitorUsageDaily).values({ businessId: b.id, conversationId: convo!.id, day: usageDay(), messages: 1 })).rejects.toThrow();
    const suggestionB = await addSuggestion(b.id, true);
    await expect(
      db.insert(siteMessages).values({ businessId: a.business.id, conversationId: convo!.id, role: 'visitor', body: 'x', suggestedAnswerId: suggestionB.id }),
    ).rejects.toThrow();
  });
});

describe('retention', () => {
  it('deletes conversations idle for 30 days with their messages', async () => {
    const { business, link } = await createSiteDemo();
    const db = getDb();
    const [old] = await db.insert(siteConversations).values({ businessId: business.id, demoLinkId: link.id, visitorTokenHash: randomUUID() }).returning();
    const [recent] = await db.insert(siteConversations).values({ businessId: business.id, demoLinkId: link.id, visitorTokenHash: randomUUID() }).returning();
    await db.insert(siteMessages).values({ businessId: business.id, conversationId: old!.id, role: 'visitor', body: 'old' });
    await db.update(siteConversations).set({ lastMessageAt: sql`now() - interval '31 days'` }).where(eq(siteConversations.id, old!.id));
    expect(await deleteOldDemoConversations(db)).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(siteConversations).where(eq(siteConversations.id, old!.id))).toHaveLength(0);
    expect(await db.select().from(siteMessages).where(eq(siteMessages.conversationId, old!.id))).toHaveLength(0);
    expect(await db.select().from(siteConversations).where(eq(siteConversations.id, recent!.id))).toHaveLength(1);
  });
});

describe('import', () => {
  it('loads RedBot files, stores shots, writes links to a private file, and pre-generates unchecked answers', async () => {
    const db = getDb();
    for (const slug of ['maple-ridge-landscaping', 'peinture-boreale']) await db.delete(siteBusinesses).where(eq(siteBusinesses.slug, slug));
    const businesses = loadRedbotBusinesses(join(FIXTURE_DIR, 'context'), join(FIXTURE_DIR, 'shots'));
    expect(businesses.map((b) => b.slug)).toEqual(['maple-ridge-landscaping', 'peinture-boreale']);
    expect(businesses[0]).toMatchObject({ displayName: 'Maple Ridge Landscaping', sourceUrl: 'https://maple-ridge-landscaping.example/' });
    expect(businesses[0]!.suggestedQuestions).toEqual(['What areas do you serve?', 'Do you offer a warranty on interlock?', 'Do you do snow removal?']);
    expect(businesses[1]!.suggestedQuestions[0]).toBe('Faites-vous la peinture extérieure ?');
    expect(businesses[0]!.contextMd).not.toContain('Suggested questions');

    const dir = mkdtempSync(join(tmpdir(), 'site-import-'));
    const linkFile = join(dir, 'links.txt');
    const model = fakeModel((req) => {
      const text = JSON.parse(req.body).input[0].content[0].text as string;
      return text.includes('Peinture') ? answer({ reply: 'Oui.', language: 'fr', sources: ['Peinture extérieure : revêtement, galeries et clôtures'] }) : answer({});
    });
    const logs: string[] = [];
    await importRedbotBusinesses(db, businesses, { linkFile, baseUrl: 'https://valetto.test', transport: model.transport, config: TEST_LLM_CONFIG, log: (l) => logs.push(l) });

    expect(statSync(linkFile).mode & 0o777).toBe(0o600);
    const lines = readFileSync(linkFile, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^maple-ridge-landscaping\thttps:\/\/valetto\.test\/s\/demo\/[A-Za-z0-9_-]{32}\texpires /);
    expect(logs.join('\n')).not.toMatch(/\/s\/demo\//);

    const [maple] = await db.select().from(siteBusinesses).where(eq(siteBusinesses.slug, 'maple-ridge-landscaping'));
    expect(maple!.desktopShotType).toBe('image/webp');
    expect(maple!.tileColor).toBe('#2f5d50');
    expect(maple!.language).toBe('en');
    const [boreale] = await db.select({ language: siteBusinesses.language }).from(siteBusinesses).where(eq(siteBusinesses.slug, 'peinture-boreale'));
    expect(boreale!.language).toBe('fr');
    const meta = await sharp(maple!.desktopShot!).metadata();
    expect(meta.width).toBe(1440);
    expect(meta.height).toBeLessThanOrEqual(2000);
    expect(model.calls).toHaveLength(6);
    const unchecked = await listUncheckedSuggestedAnswers(db, 'maple-ridge-landscaping');
    expect(unchecked).toHaveLength(3);

    // The page shows nothing until Karim checks one.
    const token = lines[0]!.split('\t')[1]!.split('/').pop()!;
    expect((await info(token)).data.suggested_questions).toEqual([]);
    expect(await setSuggestedAnswerChecked(db, unchecked[0]!.id, true)).toBe(true);
    expect((await info(token)).data.suggested_questions).toHaveLength(1);

    // Re-run: no new link, checked answers kept, unchecked ones regenerated.
    await importRedbotBusinesses(db, businesses, { linkFile, baseUrl: 'https://valetto.test', transport: model.transport, config: TEST_LLM_CONFIG, log: () => {} });
    expect(readFileSync(linkFile, 'utf8').trim().split('\n')).toHaveLength(2);
    expect(model.calls).toHaveLength(6 + 5);
    expect((await info(token)).data.suggested_questions).toHaveLength(1);
  });

  it("reads RedBot's file layout: array index, screenshots object, Language line, desktop fallback to context/<slug>.png", () => {
    const root = mkdtempSync(join(tmpdir(), 'site-redbot-'));
    const context = join(root, 'context');
    const shots = join(root, 'shots');
    mkdirSync(context);
    mkdirSync(shots);
    const md = (title: string, lang: string, q: string) =>
      `# ${title}\nSource: https://${title.toLowerCase().replace(/[^a-z]+/g, '-')}.example/\nScraped: 2026-10-30\nLanguage: ${lang}\n\n## Suggested questions\n1. ${q}\n\n## About\nText.\n`;
    writeFileSync(join(context, 'alpha.md'), md('Alpha Services', 'en', 'What are your hours?'));
    writeFileSync(join(context, 'beta.md'), md('Beta Atelier', 'fr', 'Êtes-vous ouverts le samedi?'));
    writeFileSync(join(context, 'gamma.md'), md('Gamma Company', 'en', 'Do you offer gift cards?'));
    writeFileSync(
      join(context, 'index.json'),
      JSON.stringify([
        { slug: 'alpha', name: 'Alpha Services', site: 'https://alpha.example/', language: 'en', screenshots: { desktop_1440: 'shots/alpha-desktop.png', mobile_390: 'shots/alpha-mobile.png' } },
        { slug: 'beta', name: 'Beta Atelier', site: 'https://beta.example/', screenshots: { desktop_1440: 'shots/beta-desktop.png' } },
        { slug: 'gamma', name: 'Gamma Company', site: 'https://gamma.example/', language: 'fr' },
      ]),
    );
    const png = join(FIXTURE_DIR, 'shots', 'maple-ridge-landscaping-desktop.png');
    copyFileSync(png, join(shots, 'alpha-desktop.png'));
    copyFileSync(join(FIXTURE_DIR, 'shots', 'maple-ridge-landscaping-mobile.png'), join(shots, 'alpha-mobile.png'));
    copyFileSync(png, join(context, 'beta.png'));
    copyFileSync(png, join(context, 'gamma.png'));
    copyFileSync(png, join(shots, 'gamma-desktop.png'));

    const [alpha, beta, gamma] = loadRedbotBusinesses(context);
    expect(alpha).toMatchObject({ slug: 'alpha', displayName: 'Alpha Services', sourceUrl: 'https://alpha.example/', language: 'en', suggestedQuestions: ['What are your hours?'] });
    expect(alpha!.desktopShotPath).toBe(join(shots, 'alpha-desktop.png'));
    expect(alpha!.mobileShotPath).toBe(join(shots, 'alpha-mobile.png'));
    // No language in the index: the file's Language line decides. Desktop falls back to context/<slug>.png.
    expect(beta).toMatchObject({ language: 'fr', desktopShotPath: join(context, 'beta.png'), mobileShotPath: null });
    // shots/ wins over context/<slug>.png, and the index's language wins over the file.
    expect(gamma).toMatchObject({ language: 'fr', desktopShotPath: join(shots, 'gamma-desktop.png') });
  });

  it('skips the suggested answers without a key, and says so', async () => {
    const db = getDb();
    await db.delete(siteBusinesses).where(eq(siteBusinesses.slug, 'maple-ridge-landscaping'));
    const businesses = loadRedbotBusinesses(join(FIXTURE_DIR, 'context'), join(FIXTURE_DIR, 'shots')).slice(0, 1);
    const logs: string[] = [];
    const dir = mkdtempSync(join(tmpdir(), 'site-import-'));
    await importRedbotBusinesses(db, businesses, {
      linkFile: join(dir, 'links.txt'),
      baseUrl: 'https://valetto.test',
      transport: NO_MODEL,
      config: { ...TEST_LLM_CONFIG, apiKey: null },
      log: (l) => logs.push(l),
    });
    expect(logs[0]).toMatch(/suggested answers skipped \(SITE_LLM_API_KEY is not set\)/);
  });
});
