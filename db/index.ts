import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

type Database = PostgresJsDatabase<typeof schema>;

export type DbTx = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

export type Db = Database | DbTx;

const globalForDb = globalThis as unknown as {
  replyslipSql?: ReturnType<typeof postgres>;
  replyslipDb?: Database;
};

export function getDb(): Database {
  if (!globalForDb.replyslipDb) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL is not set');
    }
    const sql = postgres(url, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
    globalForDb.replyslipSql = sql;
    globalForDb.replyslipDb = drizzle(sql, { schema });
  }
  return globalForDb.replyslipDb;
}

export async function closeDb(): Promise<void> {
  if (globalForDb.replyslipSql) {
    await globalForDb.replyslipSql.end({ timeout: 5 });
    globalForDb.replyslipSql = undefined;
    globalForDb.replyslipDb = undefined;
  }
}
