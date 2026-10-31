/**
 * Site assistant demo (story 0b): load RedBot's businesses, review the suggested answers, revoke links.
 *
 *   npx tsx scripts/site-demo-import.ts --db-name <db> --context-dir <dir> [--shots-dir <dir>] [--new-link]
 *       [--regenerate] [--raw-shots] [--link-file <path>] [--only <slug,slug>]
 *   npx tsx scripts/site-demo-import.ts --db-name <db> --list-unchecked [--slug <slug>]
 *   npx tsx scripts/site-demo-import.ts --db-name <db> --check <id> [--check <id> ...] | --uncheck <id>
 *   npx tsx scripts/site-demo-import.ts --db-name <db> --revoke-links <slug>
 *
 * DATABASE_URL comes from the environment (or .env); --db-name must match its database. Demo URLs are appended to
 * --link-file (default ~/.valetto-site-demo-links.txt, mode 600) and never printed. Base URL: SITE_DEMO_BASE_URL,
 * default https://valetto.tech. Without SITE_LLM_API_KEY the suggested answers are skipped, and the run says so.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  importRedbotBusinesses,
  listUncheckedSuggestedAnswers,
  loadRedbotBusinesses,
  revokeDemoLinks,
  setSuggestedAnswerChecked,
} from '@/lib/site-assistant/import';
import { loadEnvFile, openDb, parseArgs } from './site-demo-env';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idsFor(argv: string[], flag: string): string[] {
  const ids: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === `--${flag}` && argv[i + 1]) ids.push(...argv[i + 1]!.split(','));
    else if (argv[i]!.startsWith(`--${flag}=`)) ids.push(...argv[i]!.slice(flag.length + 3).split(','));
  }
  return ids.map((id) => id.trim()).filter(Boolean);
}

async function main(): Promise<void> {
  loadEnvFile();
  const argv = process.argv.slice(2);
  const { flags } = parseArgs(argv);
  const str = (key: string) => (typeof flags.get(key) === 'string' ? (flags.get(key) as string) : undefined);
  const { db, close } = openDb(str('db-name'));
  try {
    if (flags.has('list-unchecked')) {
      const rows = await listUncheckedSuggestedAnswers(db, str('slug'));
      if (rows.length === 0) console.log('No unchecked suggested answers.');
      for (const row of rows) {
        console.log(`\n[${row.id}] ${row.slug} #${row.position + 1} (${row.status}, ${row.decidedBy})`);
        console.log(`Q: ${row.question}`);
        console.log(`A: ${row.answer}`);
        for (const source of row.sourcesKept) console.log(`   source: "${source}"`);
      }
      return;
    }
    const check = idsFor(argv, 'check');
    const uncheck = idsFor(argv, 'uncheck');
    if (check.length > 0 || uncheck.length > 0) {
      for (const [ids, checked] of [[check, true], [uncheck, false]] as const) {
        for (const id of ids) {
          if (!UUID.test(id)) throw new Error(`Not an id: ${id}`);
          const ok = await setSuggestedAnswerChecked(db, id, checked);
          console.log(`${id}: ${ok ? (checked ? 'checked' : 'unchecked') : 'not found'}`);
        }
      }
      return;
    }
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
      regenerate: flags.has('regenerate'),
      linkFile,
      baseUrl: process.env.SITE_DEMO_BASE_URL?.trim() || 'https://valetto.tech',
      log: (line) => console.log(line),
    });
    console.log(`Done: ${businesses.length} business(es). Demo URLs (if any new) are in the link file, mode 600.`);
    console.log('Next: --list-unchecked, then --check <id> for each answer you approve.');
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'Import failed.');
  process.exit(1);
});
