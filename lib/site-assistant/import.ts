import { appendFileSync, chmodSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { and, asc, eq, gt, gte, inArray, isNull, sql } from 'drizzle-orm';
import sharp from 'sharp';
import type { Db } from '@/db';
import { siteBusinesses, siteDemoLinks, siteSuggestedAnswers } from '@/db/schema';
import { answerVisitorMessage } from './answer';
import { siteLlmConfig, type SiteLlmConfig } from './config';
import { parseContextMarkdown } from './context';
import { createDemoLink } from './demo';
import type { SiteLlmTransport } from './llm';
import { guessLanguage, guessPageLanguage } from './keywords';
import { otherLanguage, translateSuggestedQuestion, type DemoLanguage } from './translate';

/** One business as RedBot hands it over. */
export type RedbotBusiness = {
  slug: string;
  displayName: string;
  sourceUrl: string;
  scrapedAt: Date | null;
  contextMd: string;
  suggestedQuestions: string[];
  language: 'en' | 'fr';
  /** `#rrggbb` from index.json (`tile_color`, `brand_color` or `color`); null lets the server pick one. */
  tileColor: string | null;
  desktopShotPath: string | null;
  mobileShotPath: string | null;
};

const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;

function pick(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function firstExisting(paths: (string | null)[]): string | null {
  for (const path of paths) if (path && existsSync(path) && statSync(path).isFile()) return path;
  return null;
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp'];

/**
 * `<shotsDir>/<slug>-<kind>.<ext>` first (RedBot's shoot.py names), then `<shotsDir>/<slug>/<kind>.<ext>`, then
 * an explicit path from index.json (relative to the context dir or its parent), then, for desktop only,
 * `<contextDir>/<slug>.<ext>`.
 */
function shotPath(shotsDir: string, contextDir: string, slug: string, kind: 'desktop' | 'mobile', explicit: string | null) {
  return firstExisting([
    ...IMAGE_EXTS.map((ext) => join(shotsDir, `${slug}-${kind}.${ext}`)),
    ...IMAGE_EXTS.map((ext) => join(shotsDir, slug, `${kind}.${ext}`)),
    explicit ? resolve(contextDir, explicit) : null,
    explicit ? resolve(dirname(contextDir), explicit) : null,
    ...(kind === 'desktop' ? IMAGE_EXTS.map((ext) => join(contextDir, `${slug}.${ext}`)) : []),
  ]);
}

function nested(meta: Record<string, unknown>, key: string, inner: string[]): string | null {
  const value = meta[key];
  return value && typeof value === 'object' ? pick(value as Record<string, unknown>, inner) : null;
}

/**
 * Reads RedBot's hand-off. Tolerant on purpose because the format isn't fixed yet:
 * - `<contextDir>/index.json`: an array, or `{ businesses: [...] }`, of objects with `slug` and optional
 *   `name`/`display_name`/`business_name`, `source_url`/`url`, `context`/`context_file`/`file`/`md`,
 *   `desktop`/`desktop_shot`, `mobile`/`mobile_shot` (paths relative to contextDir);
 * - otherwise every `<contextDir>/*.md`, slug from the file name.
 * Screenshots default to `<shotsDir>/<slug>-desktop.png` and `-mobile.png` (RedBot's shoot.py names).
 */
export function loadRedbotBusinesses(contextDir: string, shotsDir: string = join(dirname(resolve(contextDir)), 'shots')) {
  const dir = resolve(contextDir);
  const indexPath = join(dir, 'index.json');
  type Entry = { slug: string; meta: Record<string, unknown>; mdPath: string };
  const entries: Entry[] = [];
  if (existsSync(indexPath)) {
    const parsed = JSON.parse(readFileSync(indexPath, 'utf8')) as unknown;
    const list = Array.isArray(parsed) ? parsed : (parsed as { businesses?: unknown }).businesses;
    if (!Array.isArray(list)) throw new Error('index.json must be an array or { "businesses": [...] }.');
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue;
      const meta = raw as Record<string, unknown>;
      const slug = pick(meta, ['slug', 'id']);
      if (!slug) throw new Error('An index.json entry has no slug.');
      const file = pick(meta, ['context_file', 'context', 'file', 'md', 'path']) ?? `${slug}.md`;
      const mdPath = firstExisting([resolve(dir, file), join(dir, slug, 'context.md'), join(dir, `${slug}.md`)]);
      if (!mdPath) throw new Error(`No context markdown for ${slug}.`);
      entries.push({ slug, meta, mdPath });
    }
  } else {
    for (const name of readdirSync(dir).sort()) {
      if (extname(name) !== '.md') continue;
      entries.push({ slug: basename(name, '.md'), meta: {}, mdPath: join(dir, name) });
    }
  }

  return entries.map(({ slug, meta, mdPath }): RedbotBusiness => {
    if (!SLUG.test(slug)) throw new Error(`Bad slug: ${slug}`);
    const parsed = parseContextMarkdown(readFileSync(mdPath, 'utf8'));
    const sourceUrl = pick(meta, ['source_url', 'url', 'site', 'homepage']) ?? parsed.sourceUrl;
    if (!sourceUrl || !/^https?:\/\//.test(sourceUrl)) throw new Error(`No source URL for ${slug}.`);
    const scraped = pick(meta, ['scraped_at', 'scraped', 'date']);
    const scrapedAt = scraped && !Number.isNaN(new Date(scraped).getTime()) ? new Date(scraped) : parsed.scrapedAt;
    const metaLanguage = pick(meta, ['language', 'lang'])?.toLowerCase();
    const language: 'en' | 'fr' =
      metaLanguage === 'fr' || metaLanguage === 'en' ? metaLanguage : (parsed.language ?? guessPageLanguage(parsed.contextMd.slice(0, 8_000)));
    const metaQuestions = Array.isArray(meta.suggested_questions)
      ? (meta.suggested_questions as unknown[]).filter((q): q is string => typeof q === 'string' && q.trim() !== '')
      : [];
    return {
      slug,
      displayName: (pick(meta, ['display_name', 'name', 'business_name', 'business']) ?? parsed.title ?? slug).slice(0, 120),
      sourceUrl,
      scrapedAt,
      contextMd: parsed.contextMd,
      suggestedQuestions: (metaQuestions.length > 0 ? metaQuestions.map((q) => q.trim()) : parsed.suggestedQuestions).slice(0, 10),
      tileColor: ((c) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null))(pick(meta, ['tile_color', 'brand_color', 'color'])),
      language,
      desktopShotPath: shotPath(shotsDir, dir, slug, 'desktop', pick(meta, ['desktop', 'desktop_shot']) ?? nested(meta, 'screenshots', ['desktop_1440', 'desktop'])),
      mobileShotPath: shotPath(shotsDir, dir, slug, 'mobile', pick(meta, ['mobile', 'mobile_shot']) ?? nested(meta, 'screenshots', ['mobile_390', 'mobile'])),
    };
  });
}

/**
 * Full-page screenshots can be many MB. The backdrop only needs the top of the page, so crop to the first screen
 * or so and re-encode as webp. `raw` stores the file as is.
 */
export async function prepareShot(
  path: string,
  kind: 'desktop' | 'mobile',
  raw = false,
): Promise<{ bytes: Buffer; contentType: string }> {
  const file = readFileSync(path);
  if (raw) {
    const ext = extname(path).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return { bytes: file, contentType };
  }
  const width = kind === 'desktop' ? 1440 : 780;
  const maxHeight = kind === 'desktop' ? 2000 : 1700;
  const resized = await sharp(file).resize({ width, withoutEnlargement: true }).toBuffer({ resolveWithObject: true });
  const height = Math.min(resized.info.height, maxHeight);
  const bytes = await sharp(resized.data)
    .extract({ left: 0, top: 0, width: resized.info.width, height })
    .webp({ quality: 80 })
    .toBuffer();
  return { bytes, contentType: 'image/webp' };
}

export type ImportOptions = {
  rawShots?: boolean;
  newLink?: boolean;
  /**
   * @deprecated Off by default: the demo answers suggested questions live when tapped. On, the import also
   * pre-generates stored answers (site_suggested_answers) for the page deployed before `suggestions`.
   */
  generateSuggestedAnswers?: boolean;
  /** With `generateSuggestedAnswers` only: regenerate checked rows too. */
  regenerate?: boolean;
  linkFile: string;
  baseUrl: string;
  transport?: SiteLlmTransport;
  config?: SiteLlmConfig;
  log: (line: string) => void;
};

/** Appends one demo URL to a local file readable only by its owner. URLs never go to stdout. */
export function writeLinkFile(path: string, line: string): void {
  appendFileSync(path, `${line}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/**
 * Loads each business: context, suggested questions, language, tile colour and screenshots, plus a demo link when it
 * has no live one. No model calls: suggested questions are answered live when a visitor taps them. Stored answers
 * are generated only with the deprecated `generateSuggestedAnswers`.
 */
export async function importRedbotBusinesses(db: Db, businesses: RedbotBusiness[], options: ImportOptions) {
  const config = options.generateSuggestedAnswers ? (options.config ?? siteLlmConfig()) : null;
  const summary: { slug: string; created: boolean; link: boolean; generated: number; skipped: string | null }[] = [];
  for (const entry of businesses) {
    const desktop = entry.desktopShotPath ? await prepareShot(entry.desktopShotPath, 'desktop', options.rawShots) : null;
    const mobile = entry.mobileShotPath ? await prepareShot(entry.mobileShotPath, 'mobile', options.rawShots) : null;
    const values = {
      slug: entry.slug,
      displayName: entry.displayName,
      sourceUrl: entry.sourceUrl,
      scrapedAt: entry.scrapedAt,
      contextMd: entry.contextMd,
      suggestedQuestions: entry.suggestedQuestions,
      tileColor: entry.tileColor,
      language: entry.language,
      desktopShot: desktop?.bytes ?? null,
      desktopShotType: desktop?.contentType ?? null,
      mobileShot: mobile?.bytes ?? null,
      mobileShotType: mobile?.contentType ?? null,
    };
    const [before] = await db.select({ id: siteBusinesses.id }).from(siteBusinesses).where(eq(siteBusinesses.slug, entry.slug));
    const [business] = await db
      .insert(siteBusinesses)
      .values(values)
      .onConflictDoUpdate({ target: siteBusinesses.slug, set: { ...values, updatedAt: new Date() } })
      .returning({ id: siteBusinesses.id });
    const businessId = business!.id;

    // A link only when the business has no live one, or on --new-link.
    let linked = false;
    const [live] = await db
      .select({ id: siteDemoLinks.id })
      .from(siteDemoLinks)
      .where(and(eq(siteDemoLinks.businessId, businessId), isNull(siteDemoLinks.revokedAt), gt(siteDemoLinks.expiresAt, sql`now()`)))
      .limit(1);
    if (!live || options.newLink) {
      const { token, link } = await createDemoLink(db, businessId);
      writeLinkFile(
        options.linkFile,
        `${entry.slug}\t${options.baseUrl.replace(/\/+$/, '')}/s/demo/${token}\texpires ${link.expiresAt.toISOString()}`,
      );
      linked = true;
    }

    const generated = config
      ? await generateSuggestedAnswers(db, businessId, entry, {
          regenerate: options.regenerate ?? false,
          transport: options.transport,
          config,
        })
      : null;
    summary.push({ slug: entry.slug, created: !before, link: linked, generated: generated?.count ?? 0, skipped: generated?.skipped ?? null });
    options.log(
      `${entry.slug}: ${before ? 'updated' : 'created'}; ${entry.language}; ${entry.suggestedQuestions.length} suggested question(s); ` +
        `shots ${desktop ? 'desktop' : '-'} ${mobile ? 'mobile' : '-'}; ` +
        `${linked ? 'new link written to the link file' : 'kept the live link'}` +
        (!generated
          ? ''
          : generated.skipped
            ? `; suggested answers skipped (${generated.skipped})`
            : `; ${generated.count} suggested answers generated` +
              (generated.untranslated ? `, ${generated.untranslated} translation(s) failed (run --backfill-translations)` : '')),
    );
  }
  return summary;
}

type SuggestedAnswerRow = typeof siteSuggestedAnswers.$inferSelect;
type AnswerDeps = { transport?: SiteLlmTransport; config: SiteLlmConfig };
type BusinessText = { displayName: string; contextMd: string };

/** Answers one suggested question like a live message (no caps: this is Karim's run). The row is unchecked. */
async function answerRow(
  business: BusinessText,
  businessId: string,
  position: number,
  question: string,
  businessLanguage: 'en' | 'fr' | undefined,
  deps: AnswerDeps,
) {
  const result = await answerVisitorMessage(
    { businessName: business.displayName, contextMd: business.contextMd, history: [], visitorMessage: question, businessLanguage },
    { transport: deps.transport, config: deps.config },
  );
  return {
    result,
    values: {
      businessId,
      position,
      question,
      answer: result.body,
      status: result.status,
      topic: result.topic,
      decidedBy: result.decidedBy,
      sourcesKept: result.sourcesKept,
      rawOutput: result.rawOutput ?? null,
      model: result.llmCalled ? (result.model ?? deps.config.model) : null,
      generatedAt: new Date(),
      checkedAt: null,
    },
  };
}

/**
 * The other-language row of a position: the question translated from `from` to `to`, then answered like any
 * suggested question. Stored as `to` whatever the model tagged, so each position has exactly one en and one fr row.
 * Null when the translation failed (nothing stored).
 */
async function translatedRow(
  business: BusinessText,
  businessId: string,
  position: number,
  question: string,
  from: DemoLanguage,
  to: DemoLanguage,
  deps: AnswerDeps,
) {
  const translated = await translateSuggestedQuestion(question, from, to, deps);
  if (!translated) return null;
  const { values } = await answerRow(business, businessId, position, translated, to, deps);
  return { ...values, language: to };
}

async function upsertSuggestedAnswer(db: Db, values: typeof siteSuggestedAnswers.$inferInsert) {
  await db
    .insert(siteSuggestedAnswers)
    .values(values)
    .onConflictDoUpdate({
      target: [siteSuggestedAnswers.businessId, siteSuggestedAnswers.position, siteSuggestedAnswers.language],
      set: values,
    });
}

/**
 * @deprecated The demo answers suggested questions live now; this runs only with the import's
 * `generateSuggestedAnswers` (--generate-suggested-answers), for the page deployed before `suggestions`.
 *
 * Pre-generates each suggested question's answer in two rows with the same position: the question as listed, in
 * its own language, and the question translated to the other one (en <-> fr). Same answer function and rules as
 * live messages (no caps: this is Karim's run). New rows are unchecked; only checked rows reach the page. A
 * checked row is kept unless `regenerate`, which also clears its check; a checked translation is kept while the
 * listed question at its position is unchanged. Positions past the end of the list are removed.
 */
export async function generateSuggestedAnswers(
  db: Db,
  businessId: string,
  entry: Pick<RedbotBusiness, 'displayName' | 'contextMd' | 'suggestedQuestions'> & { language?: 'en' | 'fr' },
  options: { regenerate: boolean; transport?: SiteLlmTransport; config: SiteLlmConfig },
): Promise<{ count: number; skipped: string | null; untranslated: number }> {
  const questions = entry.suggestedQuestions;
  await db
    .delete(siteSuggestedAnswers)
    .where(and(eq(siteSuggestedAnswers.businessId, businessId), gte(siteSuggestedAnswers.position, questions.length)));
  if (questions.length === 0) return { count: 0, skipped: 'no suggested questions', untranslated: 0 };
  if (!options.config.apiKey) return { count: 0, skipped: 'SITE_LLM_API_KEY is not set', untranslated: 0 };

  const existing = await db.select().from(siteSuggestedAnswers).where(eq(siteSuggestedAnswers.businessId, businessId));
  const deps = { transport: options.transport, config: options.config };
  let count = 0;
  let untranslated = 0;
  for (const [position, question] of questions.entries()) {
    const atPosition = existing.filter((row) => row.position === position);
    // The listed question's own row (the translation has other text). A different question here: both are stale.
    const listed = (row: SuggestedAnswerRow) => row.question === question && (row.language === 'en' || row.language === 'fr');
    const source = atPosition.find((row) => listed(row) && row.language === entry.language) ?? atPosition.find(listed);

    let sourceLanguage: DemoLanguage;
    let sourceId: string | null = null;
    if (source && source.checkedAt && !options.regenerate) {
      sourceLanguage = source.language as DemoLanguage;
      sourceId = source.id;
    } else {
      const { result, values } = await answerRow(entry, businessId, position, question, entry.language, deps);
      // The question's own language when the model gave none we can use; RedBot's business language breaks ties.
      sourceLanguage = result.language !== 'other' ? result.language : guessLanguage(question) === 'fr' ? 'fr' : (entry.language ?? 'en');
      await upsertSuggestedAnswer(db, { ...values, language: sourceLanguage });
      if (source && source.language === sourceLanguage) sourceId = source.id;
      count += 1;
    }

    const target = otherLanguage(sourceLanguage);
    // Anything else at this position ('other', or a language pair from an older list) goes.
    const strays = atPosition.filter((row) => row.language !== sourceLanguage && row.language !== target).map((row) => row.id);
    if (strays.length > 0) await db.delete(siteSuggestedAnswers).where(inArray(siteSuggestedAnswers.id, strays));

    const translation = atPosition.find((row) => row.language === target);
    const keepTranslation =
      !options.regenerate && source !== undefined && translation !== undefined && translation.id !== source.id && translation.checkedAt !== null;
    if (keepTranslation) continue;
    const values = await translatedRow(entry, businessId, position, question, sourceLanguage, target, deps);
    if (values) {
      await upsertSuggestedAnswer(db, values);
      count += 1;
    } else {
      untranslated += 1;
      // No translation of this question: a row translated from an older question must not stay behind.
      if (translation && translation.id !== sourceId) {
        await db.delete(siteSuggestedAnswers).where(eq(siteSuggestedAnswers.id, translation.id));
      }
    }
  }
  return { count, skipped: null, untranslated };
}

export type TranslationBackfillRow = {
  slug: string;
  position: number;
  from: DemoLanguage;
  language: DemoLanguage;
  outcome: 'planned' | 'generated' | 'failed' | 'exists';
};

/**
 * Adds the missing other-language row for every position that has only an en or only an fr row: the stored
 * question translated, then answered, inserted unchecked so Karim reviews it before it shows. Existing rows are
 * never updated, re-answered or re-checked (insert ... on conflict do nothing), so a second run finds nothing to
 * do and makes no model calls. `dryRun` only lists what it would generate.
 */
export async function backfillSuggestedTranslations(
  db: Db,
  options: { slug?: string; dryRun?: boolean; transport?: SiteLlmTransport; config?: SiteLlmConfig; log?: (line: string) => void },
): Promise<TranslationBackfillRow[]> {
  const config = options.config ?? siteLlmConfig();
  if (!options.dryRun && !config.apiKey) throw new Error('SITE_LLM_API_KEY is not set; nothing was generated.');
  const deps = { transport: options.transport, config };
  const businesses = await db
    .select({ id: siteBusinesses.id, slug: siteBusinesses.slug, displayName: siteBusinesses.displayName, contextMd: siteBusinesses.contextMd })
    .from(siteBusinesses)
    .where(options.slug ? eq(siteBusinesses.slug, options.slug) : undefined)
    .orderBy(siteBusinesses.slug);
  const out: TranslationBackfillRow[] = [];
  for (const business of businesses) {
    const rows = await db
      .select()
      .from(siteSuggestedAnswers)
      .where(eq(siteSuggestedAnswers.businessId, business.id))
      .orderBy(asc(siteSuggestedAnswers.position), asc(siteSuggestedAnswers.language));
    const positions = [...new Set(rows.map((row) => row.position))];
    for (const position of positions) {
      const pair = rows.filter((row) => row.position === position && (row.language === 'en' || row.language === 'fr'));
      if (pair.length !== 1) continue;
      const source = pair[0]!;
      const from = source.language as DemoLanguage;
      const language = otherLanguage(from);
      const row: TranslationBackfillRow = { slug: business.slug, position, from, language, outcome: 'planned' };
      if (!options.dryRun) {
        const values = await translatedRow(business, business.id, position, source.question, from, language, deps);
        if (!values) row.outcome = 'failed';
        else {
          const inserted = await db
            .insert(siteSuggestedAnswers)
            .values(values)
            .onConflictDoNothing({ target: [siteSuggestedAnswers.businessId, siteSuggestedAnswers.position, siteSuggestedAnswers.language] })
            .returning({ id: siteSuggestedAnswers.id });
          row.outcome = inserted.length > 0 ? 'generated' : 'exists';
        }
      }
      options.log?.(`${business.slug} #${position + 1} ${from} -> ${language}: ${row.outcome}`);
      out.push(row);
    }
  }
  return out;
}

export async function listUncheckedSuggestedAnswers(db: Db, slug?: string) {
  return db
    .select({
      id: siteSuggestedAnswers.id,
      slug: siteBusinesses.slug,
      position: siteSuggestedAnswers.position,
      language: siteSuggestedAnswers.language,
      question: siteSuggestedAnswers.question,
      answer: siteSuggestedAnswers.answer,
      status: siteSuggestedAnswers.status,
      decidedBy: siteSuggestedAnswers.decidedBy,
      sourcesKept: siteSuggestedAnswers.sourcesKept,
    })
    .from(siteSuggestedAnswers)
    .innerJoin(siteBusinesses, eq(siteBusinesses.id, siteSuggestedAnswers.businessId))
    .where(and(isNull(siteSuggestedAnswers.checkedAt), slug ? eq(siteBusinesses.slug, slug) : undefined))
    .orderBy(siteBusinesses.slug, siteSuggestedAnswers.position, siteSuggestedAnswers.language);
}

export async function setSuggestedAnswerChecked(db: Db, id: string, checked: boolean): Promise<boolean> {
  const rows = await db
    .update(siteSuggestedAnswers)
    .set({ checkedAt: checked ? new Date() : null })
    .where(eq(siteSuggestedAnswers.id, id))
    .returning({ id: siteSuggestedAnswers.id });
  return rows.length > 0;
}

export async function revokeDemoLinks(db: Db, slug: string): Promise<number> {
  const rows = await db
    .update(siteDemoLinks)
    .set({ revokedAt: new Date() })
    .where(
      and(
        isNull(siteDemoLinks.revokedAt),
        inArray(siteDemoLinks.businessId, db.select({ id: siteBusinesses.id }).from(siteBusinesses).where(eq(siteBusinesses.slug, slug))),
      ),
    )
    .returning({ id: siteDemoLinks.id });
  return rows.length;
}
