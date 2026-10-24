import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const DATABASE_URL = 'postgres://replyslip:replyslip@127.0.0.1:5432/replyslip_test';

export default async function setup(): Promise<void> {
  const sql = postgres(DATABASE_URL, { max: 1 });
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: './drizzle' });
  await sql.end();
}
