import { existsSync, readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/db/schema';

/** Loads .env without overriding the environment (same rules as scripts/migrate.ts). */
export function loadEnvFile(): void {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}

/**
 * Opens DATABASE_URL only when `--db-name` names the same database, so a stray DATABASE_URL in the shell can't
 * send a run somewhere unintended. Never prints the URL.
 */
export function openDb(dbName: string | undefined) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');
  let actual: string;
  try {
    actual = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    throw new Error('DATABASE_URL is not a valid URL.');
  }
  if (!dbName) throw new Error('Pass --db-name <database> matching the database in DATABASE_URL.');
  if (dbName !== actual) throw new Error('--db-name does not match the database in DATABASE_URL.');
  const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

export function parseArgs(argv: string[]): { flags: Map<string, string | true>; positional: string[] } {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [key, inline] = arg.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    if (inline !== undefined) flags.set(key, inline);
    else if (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith('--')) flags.set(key, argv[++i]!);
    else flags.set(key, true);
  }
  return { flags, positional };
}
