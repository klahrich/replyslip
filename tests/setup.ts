import { afterAll, beforeEach } from 'vitest';
import { closeDb, getDb } from '@/db';
import { rateEvents } from '@/db/schema';
import { setEmailSenderForTests } from '@/lib/email';
import { installInbox } from './inbox';

beforeEach(async () => {
  installInbox();
  await getDb().delete(rateEvents);
});

afterAll(async () => {
  setEmailSenderForTests(null);
  await closeDb();
});
