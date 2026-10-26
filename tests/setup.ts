import { afterAll, beforeEach } from 'vitest';
import { closeDb, getDb } from '@/db';
import { rateEvents } from '@/db/schema';
import { setEmailSenderForTests } from '@/lib/email';
import { setFirstAgentAlertSchedulerForTests } from '@/lib/first-agent-alert';
import { installInbox } from './inbox';

beforeEach(async () => {
  installInbox();
  await getDb().delete(rateEvents);
});

afterAll(async () => {
  setEmailSenderForTests(null);
  setFirstAgentAlertSchedulerForTests(null);
  await closeDb();
});
