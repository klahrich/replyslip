/**
 * Suggestion chips answered live: the demo payload lists the business's own suggested questions with their
 * language, a chip tap is a typed message through the live endpoint (same model path, same caps), and the import
 * makes no model calls for suggested answers. Synthetic fixtures only.
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db';
import { siteBusinesses, siteMessages, siteSuggestedAnswers, siteUsageDaily, siteVisitorUsageDaily } from '@/db/schema';
import { GET as demoRoute } from '@/app/api/v1/s/demo/[token]/route';
import { POST as messagesRoute } from '@/app/api/v1/s/demo/[token]/messages/route';
import { usageDay } from '@/lib/site-assistant/caps';
import { parseContextMarkdown } from '@/lib/site-assistant/context';
import { demoSuggestions } from '@/lib/site-assistant/demo';
import { importRedbotBusinesses, loadRedbotBusinesses } from '@/lib/site-assistant/import';
import { setSiteLlmTransportForTests } from '@/lib/site-assistant/llm';
import { call } from './helpers';
import { answer, createSiteDemo, FIXTURE_DIR, fakeModel, NO_MODEL, visitorMessageOf } from './site-fixtures';

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

function info(token: string, cookie?: string) {
  return call(demoRoute as never, `${URL_BASE}/api/v1/s/demo/${token}`, { params: { token }, cookie });
}
function send(token: string, body: unknown, cookie?: string) {
  const headers = { 'x-forwarded-for': `test-${randomUUID()}` };
  return call(messagesRoute as never, `${URL_BASE}/api/v1/s/demo/${token}/messages`, { params: { token }, body, cookie, headers });
}

const QUESTIONS = ['What areas do you serve?', 'Do you offer a warranty on interlock?', 'Do you do snow removal?'];

describe('demo payload: suggestions', () => {
  it("lists the business's suggested questions in order with position and language, and ignores stored answers", async () => {
    const { business, token } = await createSiteDemo({ suggestedQuestions: QUESTIONS });
    // A stored, checked answer left over from the old stored-answer tap: never in the payload.
    await getDb().insert(siteSuggestedAnswers).values({
      businessId: business.id,
      position: 0,
      question: 'A stored question',
      answer: 'A stored answer.',
      status: 'answered',
      topic: 'general',
      language: 'en',
      decidedBy: 'answered',
      sourcesKept: [],
      checkedAt: new Date(),
    });
    const res = await info(token);
    expect(res.status).toBe(200);
    expect(res.data.suggestions).toEqual(QUESTIONS.map((question, position) => ({ position, language: 'en', question })));
    expect(JSON.stringify(res.data.suggestions)).not.toContain('stored');
    expect(res.data).not.toHaveProperty('suggested_questions');
  });

  it('is an empty list when the business has no suggested questions', async () => {
    const { token } = await createSiteDemo();
    expect((await info(token)).data.suggestions).toEqual([]);
  });
});

describe('suggestion language', () => {
  it('tags French questions on a French site fr', () => {
    expect(demoSuggestions({ language: 'fr', suggestedQuestions: ['Quelles hauteurs de clôture offrez-vous?', "Est-ce que le PVC demande de l'entretien?"] })).toEqual([
      { position: 0, language: 'fr', question: 'Quelles hauteurs de clôture offrez-vous?' },
      { position: 1, language: 'fr', question: "Est-ce que le PVC demande de l'entretien?" },
    ]);
  });

  it("tags English questions on a French site en: the question's own language wins over the site's", () => {
    const out = demoSuggestions({ language: 'fr', suggestedQuestions: ['How soon can you come out for a quote, and is it free?', 'Do you serve my area?'] });
    expect(out.map((s) => s.language)).toEqual(['en', 'en']);
  });

  it('gives an undecidable question the language of its list, else the site language', () => {
    const list = demoSuggestions({ language: 'en', suggestedQuestions: ['Est-ce que vous faites les toitures?', 'Garantie?', 'Combien de temps prend une installation?'] });
    expect(list.map((s) => [s.position, s.language])).toEqual([[0, 'fr'], [1, 'fr'], [2, 'fr']]);
    expect(demoSuggestions({ language: 'fr', suggestedQuestions: ['Garantie?'] })).toEqual([{ position: 0, language: 'fr', question: 'Garantie?' }]);
    expect(demoSuggestions({ language: 'en', suggestedQuestions: ['Warranty?'] })).toEqual([{ position: 0, language: 'en', question: 'Warranty?' }]);
  });

  it('keeps each position stable when a blank entry is skipped', () => {
    expect(demoSuggestions({ language: 'en', suggestedQuestions: ['What are your hours?', '  ', 'Do you do snow removal?'] }).map((s) => s.position)).toEqual([0, 2]);
  });
});

describe('a chip tap is a live typed message', () => {
  it('answers the chip question through the model, stores it like a typed one, and counts it', async () => {
    const { business, token } = await createSiteDemo({ suggestedQuestions: QUESTIONS });
    const model = fakeModel(() => answer({ reply: 'We serve Ottawa, Kanata and Orleans.' }));
    setSiteLlmTransportForTests(model.transport);
    const chip = (await info(token)).data.suggestions[0];
    const res = await send(token, { client_message_id: randomUUID(), text: chip.question });
    expect(res.status).toBe(200);
    expect(res.data.message).toMatchObject({ role: 'assistant', status: 'answered', body: 'We serve Ottawa, Kanata and Orleans.' });
    expect(res.data.message).not.toHaveProperty('suggested_question_id');
    expect(model.calls).toHaveLength(1);
    expect(visitorMessageOf(model.calls[0]!)).toBe(chip.question);
    // Answered from the business's context.
    expect(JSON.parse(model.calls[0]!.body).input[0].content[0].text).toContain('family-run landscaping company');

    const rows = await getDb().select().from(siteMessages).where(eq(siteMessages.businessId, business.id));
    expect(rows.map((row) => [row.role, row.body, row.suggestedAnswerId])).toEqual(
      expect.arrayContaining([
        ['visitor', chip.question, null],
        ['assistant', 'We serve Ottawa, Kanata and Orleans.', null],
      ]),
    );
    const [usage] = await getDb().select().from(siteUsageDaily).where(and(eq(siteUsageDaily.businessId, business.id), eq(siteUsageDaily.day, usageDay())));
    expect(usage!.messages).toBe(1);
    const visitors = await getDb().select().from(siteVisitorUsageDaily).where(eq(siteVisitorUsageDaily.day, usageDay()));
    expect(visitors.some((row) => row.messages === 1)).toBe(true);
  });

  it('goes through the owner handoff rules like a typed message', async () => {
    const { token } = await createSiteDemo({ suggestedQuestions: ['How much for a patio?'] });
    const res = await send(token, { client_message_id: randomUUID(), text: 'How much for a patio?' });
    expect(res.data.message).toMatchObject({ status: 'needs_owner', handoff_reason: 'owner_topic' });
  });

  it("counts against the visitor's daily cap like typed messages", async () => {
    const { token } = await createSiteDemo({ suggestedQuestions: QUESTIONS, visitorDailyMessageCap: 1 });
    setSiteLlmTransportForTests(fakeModel(() => answer({})).transport);
    const first = await send(token, { client_message_id: randomUUID(), text: QUESTIONS[0] });
    expect(first.status).toBe(200);
    const second = await send(token, { client_message_id: randomUUID(), text: QUESTIONS[1] }, first.cookie!);
    expect(second.status).toBe(429);
    expect(second.data.error.code).toBe('daily_limit');
  });
});

describe('import: no suggested answers', () => {
  it('loads context, questions, language and shots with no model call and no stored answers', async () => {
    const db = getDb();
    for (const slug of ['maple-ridge-landscaping', 'peinture-boreale']) await db.delete(siteBusinesses).where(eq(siteBusinesses.slug, slug));
    const businesses = loadRedbotBusinesses(join(FIXTURE_DIR, 'context'), join(FIXTURE_DIR, 'shots'));
    const model = fakeModel(() => answer({}));
    setSiteLlmTransportForTests(model.transport);
    const logs: string[] = [];
    await importRedbotBusinesses(db, businesses, {
      linkFile: join(mkdtempSync(join(tmpdir(), 'site-import-')), 'links.txt'),
      baseUrl: 'https://valetto.test',
      log: (line) => logs.push(line),
    });
    expect(model.calls).toHaveLength(0);
    const rows = await db.select().from(siteBusinesses).where(eq(siteBusinesses.slug, 'maple-ridge-landscaping'));
    expect(rows[0]).toMatchObject({ suggestedQuestions: QUESTIONS, language: 'en', desktopShotType: 'image/webp' });
    expect(rows[0]!.contextMd).not.toContain('Suggested questions');
    expect(await db.select().from(siteSuggestedAnswers).where(eq(siteSuggestedAnswers.businessId, rows[0]!.id))).toEqual([]);
    expect(logs.join('\n')).not.toMatch(/suggested answers/);
    expect(logs[0]).toMatch(/3 suggested question\(s\)/);
  });
});

describe('context: suggested questions headings', () => {
  const md = (heading: string) =>
    [
      '# Heart Example',
      '',
      'Site: https://heart.example/',
      '',
      '## Services',
      '- Kitchen renovations',
      '',
      heading,
      '- How soon can you come out for a quote, and is it free?',
      '- Do you serve my area?',
      '',
      '## Hours',
      'Monday to Friday, 8 to 5.',
    ].join('\n');

  for (const heading of ['## Suggested customer questions (for the assistant)', '## Suggested questions', '### Questions suggérées']) {
    it(`reads "${heading}" and keeps it out of the context`, () => {
      const parsed = parseContextMarkdown(md(heading));
      expect(parsed.suggestedQuestions).toEqual(['How soon can you come out for a quote, and is it free?', 'Do you serve my area?']);
      expect(parsed.contextMd).not.toMatch(/suggested|sugg[ée]r[ée]es|come out for a quote|serve my area/i);
      expect(parsed.contextMd).toContain('Kitchen renovations');
      expect(parsed.contextMd).toContain('Monday to Friday, 8 to 5.');
    });
  }
});
