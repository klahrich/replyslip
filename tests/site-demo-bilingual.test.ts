import { randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db';
import { siteSuggestedAnswers } from '@/db/schema';
import { GET as demoRoute } from '@/app/api/v1/s/demo/[token]/route';
import { POST as messagesRoute } from '@/app/api/v1/s/demo/[token]/messages/route';
import { backfillSuggestedTranslations, generateSuggestedAnswers, listUncheckedSuggestedAnswers, setSuggestedAnswerChecked } from '@/lib/site-assistant/import';
import { setSiteLlmTransportForTests } from '@/lib/site-assistant/llm';
import { call } from './helpers';
import { bilingualModel, createSiteBusiness, createSiteDemo, MAPLE_CONTEXT, NO_MODEL, TEST_LLM_CONFIG, translationRequest } from './site-fixtures';
import { maintenanceUrl } from './test-database';

const URL_BASE = 'http://localhost';
const QUESTIONS = ['What areas do you serve?', 'Do you offer a warranty on interlock?', 'Do you do snow removal?'];

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

function rowsOf(businessId: string) {
  return getDb()
    .select()
    .from(siteSuggestedAnswers)
    .where(eq(siteSuggestedAnswers.businessId, businessId))
    .orderBy(asc(siteSuggestedAnswers.position), asc(siteSuggestedAnswers.language));
}

/** Today's production shape: one checked row per position, all in the business's language. */
async function seedOneLanguage(businessId: string, language: 'en' | 'fr', questions: string[], checked = true) {
  for (const [position, question] of questions.entries()) {
    await getDb()
      .insert(siteSuggestedAnswers)
      .values({
        businessId,
        position,
        question,
        answer: `Checked answer ${position}`,
        status: 'answered',
        topic: 'general',
        language,
        decidedBy: 'answered',
        sourcesKept: [],
        checkedAt: checked ? new Date('2026-10-30T12:00:00Z') : null,
      });
  }
}

describe('migration 0017 (position per language)', () => {
  it('backfills positions per business in order, keeps checks, and swaps the question unique for (business, position, language)', async () => {
    // A scratch database migrated to 0016 (the schema before this change), seeded, then migrated to the latest.
    const base = process.env.DATABASE_URL!;
    const name = `replyslip_mig17_${randomBytes(4).toString('hex')}`;
    const admin = postgres(maintenanceUrl(base), { max: 1, onnotice: () => {} });
    await admin.unsafe(`create database "${name}"`);
    const url = new URL(base);
    url.pathname = `/${name}`;
    const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
    try {
      const before = mkdtempSync(join(tmpdir(), 'drizzle-0016-'));
      mkdirSync(join(before, 'meta'));
      const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: { idx: number; tag: string }[] };
      const upTo16 = journal.entries.filter((entry) => entry.idx <= 16);
      writeFileSync(join(before, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: upTo16 }));
      for (const file of readdirSync('drizzle')) if (upTo16.some((entry) => `${entry.tag}.sql` === file)) copyFileSync(join('drizzle', file), join(before, file));
      await migrate(drizzle(sql), { migrationsFolder: before });

      const [a] = await sql`insert into site_businesses (slug, display_name, source_url, context_md) values ('alpha-co', 'Alpha', 'https://alpha.example/', 'x') returning id`;
      const [b] = await sql`insert into site_businesses (slug, display_name, source_url, context_md, language) values ('beta-co', 'Beta', 'https://beta.example/', 'x', 'fr') returning id`;
      const insert = (businessId: string, position: number, question: string, language: string, generatedAt: string) =>
        sql`insert into site_suggested_answers (business_id, position, question, answer, status, language, decided_by, generated_at, checked_at)
            values (${businessId}, ${position}, ${question}, 'An answer', 'answered', ${language}, 'answered', ${generatedAt}, '2026-10-30T12:00:00Z')`;
      // Alpha: today's shape (0, 1, 2), one of them in French because its question was.
      await insert(a!.id, 0, 'Q0', 'en', '2026-10-01T00:00:00Z');
      await insert(a!.id, 1, 'Q1 en français ?', 'fr', '2026-10-01T00:00:01Z');
      await insert(a!.id, 2, 'Q2', 'en', '2026-10-01T00:00:02Z');
      // Beta: repeated positions (not seen in prod, but possible under the old unique), renumbered by generated_at.
      await insert(b!.id, 5, 'Late', 'fr', '2026-10-02T00:00:00Z');
      await insert(b!.id, 1, 'Early', 'fr', '2026-10-01T00:00:00Z');
      await insert(b!.id, 1, 'Middle', 'fr', '2026-10-01T12:00:00Z');

      await migrate(drizzle(sql), { migrationsFolder: './drizzle' });

      const rows = await sql<{ business_id: string; position: number; question: string; language: string; checked_at: Date | null }[]>`
        select business_id, position, question, language, checked_at from site_suggested_answers order by business_id, position`;
      const of = (id: string) => rows.filter((row) => row.business_id === id).map((row) => [row.position, row.question, row.language]);
      expect(of(a!.id)).toEqual([[0, 'Q0', 'en'], [1, 'Q1 en français ?', 'fr'], [2, 'Q2', 'en']]);
      expect(of(b!.id)).toEqual([[0, 'Early', 'fr'], [1, 'Middle', 'fr'], [2, 'Late', 'fr']]);
      expect(rows.every((row) => row.checked_at !== null)).toBe(true);

      const indexes = await sql<{ indexname: string }[]>`select indexname from pg_indexes where tablename = 'site_suggested_answers'`;
      expect(indexes.map((row) => row.indexname)).toContain('site_suggested_answers_position_language_unique');
      expect(indexes.map((row) => row.indexname)).not.toContain('site_suggested_answers_question_unique');

      // The other language at the same position goes in, even with the same question text.
      await insert(a!.id, 0, 'Q0', 'fr', '2026-11-01T00:00:00Z');
      // A second row for the same (business, position, language) does not.
      await expect(insert(a!.id, 0, 'Another', 'en', '2026-11-01T00:00:00Z')).rejects.toMatchObject({ code: '23505' });
      await expect(insert(a!.id, -1, 'Negative', 'en', '2026-11-01T00:00:00Z')).rejects.toMatchObject({ code: '23514' });

      // Running the latest migrations again is a no-op.
      await migrate(drizzle(sql), { migrationsFolder: './drizzle' });
    } finally {
      await sql.end();
      await admin.unsafe(`drop database if exists "${name}" with (force)`);
      await admin.end();
    }
  });
});

describe('import: both languages per position', () => {
  it('stores the listed question in its language and a translation in the other, same position, all unchecked', async () => {
    const business = await createSiteBusiness();
    const model = bilingualModel();
    const result = await generateSuggestedAnswers(
      getDb(),
      business.id,
      { displayName: business.displayName, contextMd: MAPLE_CONTEXT, suggestedQuestions: QUESTIONS, language: 'en' },
      { regenerate: false, transport: model.transport, config: TEST_LLM_CONFIG },
    );
    expect(result).toEqual({ count: 6, skipped: null, untranslated: 0 });
    expect(model.calls).toHaveLength(9);
    const rows = await rowsOf(business.id);
    expect(rows.map((row) => [row.position, row.language, row.question])).toEqual([
      [0, 'en', QUESTIONS[0]],
      [0, 'fr', `[fr] ${QUESTIONS[0]}`],
      [1, 'en', QUESTIONS[1]],
      [1, 'fr', `[fr] ${QUESTIONS[1]}`],
      [2, 'en', QUESTIONS[2]],
      [2, 'fr', `[fr] ${QUESTIONS[2]}`],
    ]);
    // Each row carries its own answer, to its own question.
    for (const row of rows) expect(row.answer).toBe(`Answer to: ${row.question}`);
    expect(rows.every((row) => row.checkedAt === null)).toBe(true);
  });

  it('translates a French site to English', async () => {
    const business = await createSiteBusiness({ language: 'fr' });
    const model = bilingualModel((_req, question) => ({
      status: 'answered',
      reply: `Réponse : ${question}`,
      topic: 'general',
      sources: ['serving Ottawa, Kanata and Orleans since 2009'],
      owner_question: null,
      language: question.startsWith('[en] ') ? 'en' : 'fr',
    }));
    const questions = ['Faites-vous la peinture extérieure ?', 'Quelles villes desservez-vous ?'];
    await generateSuggestedAnswers(
      getDb(),
      business.id,
      { displayName: business.displayName, contextMd: MAPLE_CONTEXT, suggestedQuestions: questions, language: 'fr' },
      { regenerate: false, transport: model.transport, config: TEST_LLM_CONFIG },
    );
    expect((await rowsOf(business.id)).map((row) => [row.position, row.language, row.question])).toEqual([
      [0, 'en', `[en] ${questions[0]}`],
      [0, 'fr', questions[0]],
      [1, 'en', `[en] ${questions[1]}`],
      [1, 'fr', questions[1]],
    ]);
  });

  it('keeps checked rows in both languages on a re-run, and regenerates both when the question at a position changes', async () => {
    const business = await createSiteBusiness();
    const entry = { displayName: business.displayName, contextMd: MAPLE_CONTEXT, suggestedQuestions: QUESTIONS, language: 'en' as const };
    const first = bilingualModel();
    await generateSuggestedAnswers(getDb(), business.id, entry, { regenerate: false, transport: first.transport, config: TEST_LLM_CONFIG });
    for (const row of await rowsOf(business.id)) await setSuggestedAnswerChecked(getDb(), row.id, true);
    const checked = await rowsOf(business.id);

    const again = bilingualModel();
    expect(await generateSuggestedAnswers(getDb(), business.id, entry, { regenerate: false, transport: again.transport, config: TEST_LLM_CONFIG })).toMatchObject({ count: 0 });
    expect(again.calls).toHaveLength(0);
    expect(await rowsOf(business.id)).toEqual(checked);

    const changed = bilingualModel();
    const questions = [QUESTIONS[0]!, 'Are you open on Saturdays?', QUESTIONS[2]!];
    await generateSuggestedAnswers(getDb(), business.id, { ...entry, suggestedQuestions: questions }, { regenerate: false, transport: changed.transport, config: TEST_LLM_CONFIG });
    expect(changed.calls).toHaveLength(3);
    const rows = await rowsOf(business.id);
    expect(rows.filter((row) => row.position === 1).map((row) => [row.language, row.question, row.checkedAt])).toEqual([
      ['en', 'Are you open on Saturdays?', null],
      ['fr', '[fr] Are you open on Saturdays?', null],
    ]);
    expect(rows.filter((row) => row.position !== 1)).toEqual(checked.filter((row) => row.position !== 1));

    // A shorter list drops the positions past its end, in both languages.
    await generateSuggestedAnswers(getDb(), business.id, { ...entry, suggestedQuestions: [QUESTIONS[0]!] }, { regenerate: false, transport: NO_MODEL, config: TEST_LLM_CONFIG });
    expect((await rowsOf(business.id)).map((row) => [row.position, row.language])).toEqual([[0, 'en'], [0, 'fr']]);
  });

  it('stores the listed question even when its translation fails, and says how many failed', async () => {
    const business = await createSiteBusiness();
    const model = bilingualModel();
    const flaky: typeof model.transport = async (req) => (translationRequest(req) ? { status: 400, text: '{}' } : model.transport(req));
    const result = await generateSuggestedAnswers(
      getDb(),
      business.id,
      { displayName: business.displayName, contextMd: MAPLE_CONTEXT, suggestedQuestions: QUESTIONS.slice(0, 2), language: 'en' },
      { regenerate: false, transport: flaky, config: TEST_LLM_CONFIG },
    );
    expect(result).toEqual({ count: 2, skipped: null, untranslated: 2 });
    expect((await rowsOf(business.id)).map((row) => [row.position, row.language])).toEqual([[0, 'en'], [1, 'en']]);
  });
});

describe('backfill of the missing language', () => {
  it('adds one unchecked row per position in the other language and leaves the checked rows alone', async () => {
    const business = await createSiteBusiness();
    await seedOneLanguage(business.id, 'en', QUESTIONS);
    const before = await rowsOf(business.id);

    const dry = await backfillSuggestedTranslations(getDb(), { slug: business.slug, dryRun: true, transport: NO_MODEL, config: TEST_LLM_CONFIG });
    expect(dry.map((row) => [row.position, row.from, row.language, row.outcome])).toEqual([
      [0, 'en', 'fr', 'planned'],
      [1, 'en', 'fr', 'planned'],
      [2, 'en', 'fr', 'planned'],
    ]);
    expect(await rowsOf(business.id)).toEqual(before);

    const model = bilingualModel();
    const done = await backfillSuggestedTranslations(getDb(), { slug: business.slug, transport: model.transport, config: TEST_LLM_CONFIG });
    expect(done.map((row) => row.outcome)).toEqual(['generated', 'generated', 'generated']);
    expect(model.calls).toHaveLength(6);
    const after = await rowsOf(business.id);
    expect(after.filter((row) => row.language === 'en')).toEqual(before);
    expect(after.filter((row) => row.language === 'fr').map((row) => [row.position, row.question, row.checkedAt])).toEqual(
      QUESTIONS.map((question, position) => [position, `[fr] ${question}`, null]),
    );
    // They wait for Karim like any new answer.
    const unchecked = await listUncheckedSuggestedAnswers(getDb(), business.slug);
    expect(unchecked.map((row) => [row.position, row.language])).toEqual([[0, 'fr'], [1, 'fr'], [2, 'fr']]);

    // Idempotent: a second run has nothing to do and calls no model.
    expect(await backfillSuggestedTranslations(getDb(), { slug: business.slug, transport: NO_MODEL, config: TEST_LLM_CONFIG })).toEqual([]);
    expect(await rowsOf(business.id)).toEqual(after);
  });

  it('backfills English for a French business, only for the slug asked, and retries a failed translation next run', async () => {
    const fr = await createSiteBusiness({ language: 'fr' });
    const other = await createSiteBusiness();
    await seedOneLanguage(fr.id, 'fr', ['Faites-vous la peinture extérieure ?', 'Quelles villes desservez-vous ?']);
    await seedOneLanguage(other.id, 'en', QUESTIONS);
    const model = bilingualModel();
    let failFirst = true;
    const flaky: typeof model.transport = async (req) => {
      if (translationRequest(req) && failFirst) {
        failFirst = false;
        return { status: 400, text: '{}' };
      }
      return model.transport(req);
    };
    const first = await backfillSuggestedTranslations(getDb(), { slug: fr.slug, transport: flaky, config: TEST_LLM_CONFIG });
    expect(first.map((row) => [row.position, row.language, row.outcome])).toEqual([[0, 'en', 'failed'], [1, 'en', 'generated']]);
    const second = await backfillSuggestedTranslations(getDb(), { slug: fr.slug, transport: model.transport, config: TEST_LLM_CONFIG });
    expect(second.map((row) => [row.position, row.language, row.outcome])).toEqual([[0, 'en', 'generated']]);
    expect((await rowsOf(fr.id)).map((row) => [row.position, row.language])).toEqual([[0, 'en'], [0, 'fr'], [1, 'en'], [1, 'fr']]);
    expect(await rowsOf(other.id)).toHaveLength(3);
  });

  it('refuses to run without a model key, before writing anything', async () => {
    const business = await createSiteBusiness();
    await seedOneLanguage(business.id, 'en', QUESTIONS);
    await expect(
      backfillSuggestedTranslations(getDb(), { slug: business.slug, transport: NO_MODEL, config: { ...TEST_LLM_CONFIG, apiKey: null } }),
    ).rejects.toThrow(/SITE_LLM_API_KEY/);
    expect(await rowsOf(business.id)).toHaveLength(3);
  });
});

describe('demo page and taps in either language', () => {
  function info(token: string, cookie?: string) {
    return call(demoRoute as never, `${URL_BASE}/api/v1/s/demo/${token}`, { params: { token }, cookie });
  }
  function send(token: string, body: unknown, cookie?: string) {
    return call(messagesRoute as never, `${URL_BASE}/api/v1/s/demo/${token}/messages`, {
      params: { token },
      body,
      cookie,
      headers: { 'x-forwarded-for': `test-${randomUUID()}` },
    });
  }

  it('lists checked rows of both languages with their position, in position order, and answers a tap on either', async () => {
    const { business, token } = await createSiteDemo();
    const model = bilingualModel();
    await generateSuggestedAnswers(
      getDb(),
      business.id,
      { displayName: business.displayName, contextMd: MAPLE_CONTEXT, suggestedQuestions: QUESTIONS.slice(0, 2), language: 'en' },
      { regenerate: false, transport: model.transport, config: TEST_LLM_CONFIG },
    );
    const rows = await rowsOf(business.id);
    // Leave position 1 in French unchecked: it must not show, and a tap on it is refused.
    const uncheckedFr = rows.find((row) => row.position === 1 && row.language === 'fr')!;
    for (const row of rows) if (row.id !== uncheckedFr.id) await setSuggestedAnswerChecked(getDb(), row.id, true);

    const page = await info(token);
    expect(page.status).toBe(200);
    expect(page.data.suggested_questions.map((s: { position: number; language: string }) => [s.position, s.language])).toEqual([
      [0, 'en'],
      [0, 'fr'],
      [1, 'en'],
    ]);

    const fr = rows.find((row) => row.position === 0 && row.language === 'fr')!;
    const en = rows.find((row) => row.position === 0 && row.language === 'en')!;
    setSiteLlmTransportForTests(NO_MODEL);
    const tapFr = await send(token, { client_message_id: randomUUID(), suggested_question_id: fr.id });
    expect(tapFr.status).toBe(200);
    expect(tapFr.data.message).toMatchObject({ body: fr.answer, language: 'fr', suggested_question_id: fr.id });

    const tapEn = await send(token, { client_message_id: randomUUID(), suggested_question_id: en.id }, tapFr.cookie!);
    expect(tapEn.status).toBe(200);
    expect(tapEn.data.message).toMatchObject({ body: en.answer, language: 'en', suggested_question_id: en.id });

    const saved = (await info(token, tapFr.cookie!)).data.messages.map((m: { role: string; body: string }) => [m.role, m.body]);
    expect(saved).toEqual([
      ['visitor', fr.question],
      ['assistant', fr.answer],
      ['visitor', en.question],
      ['assistant', en.answer],
    ]);

    const refused = await send(token, { client_message_id: randomUUID(), suggested_question_id: uncheckedFr.id });
    expect(refused.status).toBe(404);
    expect(refused.data.error.code).toBe('suggested_question_not_found');
    // A row of another business, in either language, is not found here.
    const other = await createSiteDemo();
    expect((await send(other.token, { client_message_id: randomUUID(), suggested_question_id: fr.id })).status).toBe(404);
    const stored = await getDb().select().from(siteSuggestedAnswers).where(and(eq(siteSuggestedAnswers.businessId, business.id)));
    expect(stored).toHaveLength(4);
  });
});
