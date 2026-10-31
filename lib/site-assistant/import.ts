import { appendFileSync, chmodSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { and, eq, gt, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import sharp from 'sharp';
import type { Db } from '@/db';
import { siteBusinesses, siteDemoLinks, siteSuggestedAnswers } from '@/db/schema';
import { answerVisitorMessage } from './answer';
import { siteLlmConfig, type SiteLlmConfig } from './config';
import { parseContextMarkdown } from './context';
import { createDemoLink } from './demo';
import type { SiteLlmTransport } from './llm';
import { guessLanguage, guessPageLanguage } from './keywords';

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

export async function importRedbotBusinesses(db: Db, businesses: RedbotBusiness[], options: ImportOptions) {
  const config = options.config ?? siteLlmConfig();
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

    const generated = await generateSuggestedAnswers(db, businessId, entry, {
      regenerate: options.regenerate ?? false,
      transport: options.transport,
      config,
    });
    summary.push({ slug: entry.slug, created: !before, link: linked, generated: generated.count, skipped: generated.skipped });
    options.log(
      `${entry.slug}: ${before ? 'updated' : 'created'}; shots ${desktop ? 'desktop' : '-'} ${mobile ? 'mobile' : '-'}; ` +
        `${linked ? 'new link written to the link file' : 'kept the live link'}; ` +
        (generated.skipped ? `suggested answers skipped (${generated.skipped})` : `${generated.count} suggested answers generated`),
    );
  }
  return summary;
}

/**
 * Pre-generates an answer for each suggested question with the same answer function and rules as live messages
 * (no caps: this is Karim's run). New rows are unchecked; only checked rows reach the page. Checked rows are kept
 * unless `regenerate`, which also clears their check. Questions no longer in the list are removed.
 */
export async function generateSuggestedAnswers(
  db: Db,
  businessId: string,
  entry: Pick<RedbotBusiness, 'displayName' | 'contextMd' | 'suggestedQuestions'> & { language?: 'en' | 'fr' },
  options: { regenerate: boolean; transport?: SiteLlmTransport; config: SiteLlmConfig },
): Promise<{ count: number; skipped: string | null }> {
  const questions = entry.suggestedQuestions;
  await db
    .delete(siteSuggestedAnswers)
    .where(
      questions.length > 0
        ? and(eq(siteSuggestedAnswers.businessId, businessId), notInArray(siteSuggestedAnswers.question, questions))
        : eq(siteSuggestedAnswers.businessId, businessId),
    );
  if (questions.length === 0) return { count: 0, skipped: 'no suggested questions' };
  if (!options.config.apiKey) return { count: 0, skipped: 'SITE_LLM_API_KEY is not set' };

  const existing = await db
    .select({ question: siteSuggestedAnswers.question, checkedAt: siteSuggestedAnswers.checkedAt })
    .from(siteSuggestedAnswers)
    .where(and(eq(siteSuggestedAnswers.businessId, businessId), inArray(siteSuggestedAnswers.question, questions)));
  const keep = new Set(options.regenerate ? [] : existing.filter((row) => row.checkedAt).map((row) => row.question));

  let count = 0;
  for (const [position, question] of questions.entries()) {
    if (keep.has(question)) {
      await db
        .update(siteSuggestedAnswers)
        .set({ position })
        .where(and(eq(siteSuggestedAnswers.businessId, businessId), eq(siteSuggestedAnswers.question, question)));
      continue;
    }
    const result = await answerVisitorMessage(
      { businessName: entry.displayName, contextMd: entry.contextMd, history: [], visitorMessage: question, businessLanguage: entry.language },
      { transport: options.transport, config: options.config },
    );
    const values = {
      businessId,
      position,
      question,
      answer: result.body,
      status: result.status,
      topic: result.topic,
      // The question's own language when the model gave none we can use; RedBot's business language breaks ties.
      language: result.language !== 'other' ? result.language : guessLanguage(question) === 'fr' ? 'fr' : (entry.language ?? 'en'),
      decidedBy: result.decidedBy,
      sourcesKept: result.sourcesKept,
      rawOutput: result.rawOutput ?? null,
      model: result.llmCalled ? (result.model ?? options.config.model) : null,
      generatedAt: new Date(),
      checkedAt: null,
    };
    await db
      .insert(siteSuggestedAnswers)
      .values(values)
      .onConflictDoUpdate({ target: [siteSuggestedAnswers.businessId, siteSuggestedAnswers.question], set: values });
    count += 1;
  }
  return { count, skipped: null };
}

export async function listUncheckedSuggestedAnswers(db: Db, slug?: string) {
  return db
    .select({
      id: siteSuggestedAnswers.id,
      slug: siteBusinesses.slug,
      position: siteSuggestedAnswers.position,
      question: siteSuggestedAnswers.question,
      answer: siteSuggestedAnswers.answer,
      status: siteSuggestedAnswers.status,
      decidedBy: siteSuggestedAnswers.decidedBy,
      sourcesKept: siteSuggestedAnswers.sourcesKept,
    })
    .from(siteSuggestedAnswers)
    .innerJoin(siteBusinesses, eq(siteBusinesses.id, siteSuggestedAnswers.businessId))
    .where(and(isNull(siteSuggestedAnswers.checkedAt), slug ? eq(siteBusinesses.slug, slug) : undefined))
    .orderBy(siteBusinesses.slug, siteSuggestedAnswers.position);
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
