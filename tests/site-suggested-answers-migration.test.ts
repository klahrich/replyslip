import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { maintenanceUrl } from './test-database';

// site_suggested_answers is no longer read or written by the app (chips are answered live), but the table and this
// migration stay until a later schema cleanup drops them.
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
