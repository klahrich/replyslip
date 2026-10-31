/**
 * Deletes site assistant demo conversations idle for 30 days (messages and visitor usage go with them).
 * No cron yet; run by hand:  npx tsx scripts/site-demo-cleanup.ts --db-name <db> [--days 30]
 */
import { deleteOldDemoConversations } from '@/lib/site-assistant/demo';
import { SITE_DEMO_RETENTION_DAYS } from '@/lib/site-assistant/config';
import { loadEnvFile, openDb, parseArgs } from './site-demo-env';

async function main(): Promise<void> {
  loadEnvFile();
  const { flags } = parseArgs(process.argv.slice(2));
  const dbName = flags.get('db-name');
  const days = Number(flags.get('days') ?? SITE_DEMO_RETENTION_DAYS);
  if (!Number.isInteger(days) || days < 1) throw new Error('--days must be a whole number of days, at least 1.');
  const { db, close } = openDb(typeof dbName === 'string' ? dbName : undefined);
  try {
    console.log(`Deleted ${await deleteOldDemoConversations(db, days)} conversation(s) idle for ${days}+ days.`);
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'Cleanup failed.');
  process.exit(1);
});
