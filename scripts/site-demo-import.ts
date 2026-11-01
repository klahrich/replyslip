/**
 * Site assistant demo (story 0b): load RedBot's businesses and revoke links.
 *
 *   npx tsx scripts/site-demo-import.ts --db-name <db> --context-dir <dir> [--shots-dir <dir>] [--new-link]
 *       [--raw-shots] [--link-file <path>] [--only <slug,slug>]
 *   npx tsx scripts/site-demo-import.ts --db-name <db> --revoke-links <slug>
 *
 * DATABASE_URL comes from the environment (or .env); --db-name must match its database. Demo URLs are appended to
 * --link-file (default ~/.valetto-site-demo-links.txt, mode 600) and never printed. Base URL: SITE_DEMO_BASE_URL,
 * default https://valetto.tech.
 *
 * The import loads context, suggested questions, language and screenshots, and makes no model calls: the demo
 * answers a tapped suggested question live, like a typed one.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { importRedbotBusinesses, loadRedbotBusinesses, revokeDemoLinks } from '@/lib/site-assistant/import';
import { loadEnvFile, openDb, parseArgs } from './site-demo-env';

/** Stored-answer flags, removed now that the demo answers suggested questions live. Refused, not ignored. */
const REMOVED_FLAGS = ['generate-suggested-answers', 'regenerate', 'list-unchecked', 'check', 'uncheck', 'backfill-translations'];

async function main(): Promise<void> {
  loadEnvFile();
  const { flags } = parseArgs(process.argv.slice(2));
  const removed = REMOVED_FLAGS.filter((flag) => flags.has(flag));
  if (removed.length > 0) {
    throw new Error(`--${removed.join(', --')}: removed. Suggested questions are answered live; nothing is stored to review.`);
  }
  const str = (key: string) => (typeof flags.get(key) === 'string' ? (flags.get(key) as string) : undefined);
  const { db, close } = openDb(str('db-name'));
  try {
    const revoke = str('revoke-links');
    if (revoke) {
      console.log(`${revoke}: ${await revokeDemoLinks(db, revoke)} link(s) revoked`);
      return;
    }

    const contextDir = str('context-dir');
    if (!contextDir) throw new Error('Pass --context-dir <dir> (RedBot context files).');
    let businesses = loadRedbotBusinesses(contextDir, str('shots-dir'));
    const only = str('only')?.split(',').map((slug) => slug.trim());
    if (only) businesses = businesses.filter((business) => only.includes(business.slug));
    if (businesses.length === 0) throw new Error('No businesses found.');
    const linkFile = str('link-file') ?? join(homedir(), '.valetto-site-demo-links.txt');
    await importRedbotBusinesses(db, businesses, {
      rawShots: flags.has('raw-shots'),
      newLink: flags.has('new-link'),
      linkFile,
      baseUrl: process.env.SITE_DEMO_BASE_URL?.trim() || 'https://valetto.tech',
      log: (line) => console.log(line),
    });
    console.log(`Done: ${businesses.length} business(es). Demo URLs (if any new) are in the link file, mode 600.`);
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'Import failed.');
  process.exit(1);
});
