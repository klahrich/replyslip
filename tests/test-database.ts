import { randomBytes } from 'node:crypto';

/**
 * Each `vitest run` gets its own database on the local test server, so parallel runs (several agents or
 * terminals at once) never share rows such as `rate_events`. Set TEST_DATABASE_URL to use one existing database
 * instead; that database is migrated but never created or dropped.
 */
export const TEST_SERVER_URL = 'postgres://replyslip:replyslip@127.0.0.1:5432/replyslip_test';
export const TEST_DATABASE_PREFIX = 'replyslip_test_';

/** Set in the main vitest process by vitest.config.ts, read by tests/global-setup.ts. Workers see DATABASE_URL. */
const RUN_URL_ENV = 'REPLYSLIP_TEST_RUN_DATABASE_URL';
const RUN_OWNED_ENV = 'REPLYSLIP_TEST_RUN_DATABASE_OWNED';

export type TestDatabase = { url: string; name: string; owned: boolean };

export function testDatabase(): TestDatabase {
  const existing = process.env[RUN_URL_ENV];
  if (existing) return { url: existing, name: databaseName(existing), owned: process.env[RUN_OWNED_ENV] === '1' };
  const override = process.env.TEST_DATABASE_URL?.trim();
  let url: string;
  let owned: boolean;
  if (override) {
    url = override;
    owned = false;
  } else {
    const parsed = new URL(TEST_SERVER_URL);
    parsed.pathname = `/${TEST_DATABASE_PREFIX}${process.pid}_${randomBytes(4).toString('hex')}`;
    url = parsed.toString();
    owned = true;
  }
  process.env[RUN_URL_ENV] = url;
  process.env[RUN_OWNED_ENV] = owned ? '1' : '0';
  return { url, name: databaseName(url), owned };
}

export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

/** Same server and credentials, connected to the `postgres` maintenance database to create and drop. */
export function maintenanceUrl(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = '/postgres';
  return parsed.toString();
}

/** pid of the run that created `name`, or null when it is not one of ours. */
export function runPid(name: string): number | null {
  const match = new RegExp(`^${TEST_DATABASE_PREFIX}(\\d+)_[0-9a-f]{8}$`).exec(name);
  return match ? Number(match[1]) : null;
}
