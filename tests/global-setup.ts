import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { TEST_DATABASE_PREFIX, maintenanceUrl, runPid, testDatabase } from './test-database';

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function isLocalHost(url: string): boolean {
  const host = new URL(url).hostname;
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}

async function withMaintenance<T>(url: string, fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(maintenanceUrl(url), { max: 1, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

/** Drop databases left by runs that were killed before teardown (their pid is gone). Local server only. */
async function sweepStale(sql: postgres.Sql, current: string): Promise<void> {
  const rows = await sql<{ datname: string }[]>`
    select datname from pg_database where datname like ${`${TEST_DATABASE_PREFIX}%`}
  `;
  for (const { datname } of rows) {
    const pid = runPid(datname);
    if (datname === current || pid === null || processAlive(pid)) continue;
    // No FORCE: a database somebody is still connected to stays.
    await sql.unsafe(`drop database if exists ${quoteIdent(datname)}`).catch(() => {});
  }
}

async function dropDatabase(url: string, name: string): Promise<void> {
  await withMaintenance(url, (sql) => sql.unsafe(`drop database if exists ${quoteIdent(name)} with (force)`));
}

export default async function setup(): Promise<() => Promise<void>> {
  const db = testDatabase();
  if (db.owned) {
    await withMaintenance(db.url, async (sql) => {
      if (isLocalHost(db.url)) await sweepStale(sql, db.name);
      await sql.unsafe(`create database ${quoteIdent(db.name)}`);
    });
  }

  let dropped = false;
  const drop = async () => {
    if (!db.owned || dropped) return;
    dropped = true;
    await dropDatabase(db.url, db.name);
  };
  const onSignal = (signal: NodeJS.Signals) => {
    void drop().finally(() => process.kill(process.pid, signal));
  };

  try {
    const sql = postgres(db.url, { max: 1, onnotice: () => {} });
    try {
      await migrate(drizzle(sql), { migrationsFolder: './drizzle' });
    } finally {
      await sql.end();
    }
  } catch (err) {
    await drop().catch(() => {});
    throw err;
  }

  if (db.owned) {
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  }

  return async () => {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    await drop();
  };
}
