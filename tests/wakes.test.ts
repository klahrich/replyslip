import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { wakes } from '@/db/schema';
import { POST as ack } from '@/app/api/v1/watcher/ack/route';
import { POST as poll } from '@/app/api/v1/watcher/poll/route';
import { POST as createWatcher } from '@/app/api/v1/watcher-keys/route';
import { GET as cron } from '@/app/api/cron/wakes/route';
import { call, createAgent, createKey, mcpTool, setHerdr, setWebhook, signIn, startReceiver } from './helpers';

describe('wakes', () => {
  it('signs webhook calls and retries them from cron', async () => {
    const session = await signIn();
    const receiver = await startReceiver();
    try {
      const from = await createAgent(session.cookie, 'FromBot');
      const to = await createAgent(session.cookie, 'ToBot');
      await setWebhook(session.cookie, to.id, receiver.url, { type: 'hmac', secret: 'hook-secret' });
      await setWebhook(session.cookie, from.id, receiver.url, {
        type: 'headers',
        headers: { 'X-Hook-Token': 'abc' },
      });
      const fromKey = await createKey(session.cookie, from.id);
      const sent = await mcpTool(fromKey, 'send_message', { to: 'ToBot', body: 'CANARY-BODY-message' });
      expect(sent.isError).toBe(false);
      const hit = receiver.hits.at(-1)!;
      expect(hit.raw).not.toContain('CANARY-BODY-message');
      expect(hit.body.notice).toMatch(/check it with your ReplySlip tools/);
      const expected = createHmac('sha256', 'hook-secret').update(hit.raw).digest('hex');
      expect(hit.headers['x-replyslip-signature']).toBe(`sha256=${expected}`);
      expect(hit.headers['x-replyslip-wake-id']).toBe(hit.body.id);
    } finally {
      await receiver.close();
    }

    const deadFrom = await createAgent(session.cookie, 'DeadFrom');
    const deadTo = await createAgent(session.cookie, 'DeadTo');
    await setWebhook(session.cookie, deadTo.id, 'http://127.0.0.1:1/nope', { type: 'bearer', token: 't' });
    const deadKey = await createKey(session.cookie, deadFrom.id);
    await mcpTool(deadKey, 'send_message', { to: 'DeadTo', body: 'hello' });
    const [pending] = await getDb().select().from(wakes).where(eq(wakes.agentId, deadTo.id));
    expect(pending?.status).toBe('pending');
    expect(pending?.attempts).toBe(1);
    expect(pending?.lastError).toBeTruthy();
    await getDb().update(wakes).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(wakes.id, pending!.id));
    const cronRes = await cron(
      new Request('http://localhost/api/cron/wakes', {
        headers: { authorization: 'Bearer test-cron-secret' },
      }),
    );
    expect(cronRes.status).toBe(200);
    const [retried] = await getDb().select().from(wakes).where(eq(wakes.id, pending!.id));
    expect(retried?.attempts).toBe(2);
    expect(retried?.status).toBe('pending');
  });

  it('leases herdr wakes without message content', async () => {
    const session = await signIn();
    const from = await createAgent(session.cookie, 'LocalFrom');
    const to = await createAgent(session.cookie, 'LocalTo');
    await setHerdr(session.cookie, to.id, 'local-to');
    const fromKey = await createKey(session.cookie, from.id);
    await mcpTool(fromKey, 'send_message', { to: 'LocalTo', body: 'CANARY-HERDR-body' });
    const watcher = await call(createWatcher, 'http://localhost/api/v1/watcher-keys', {
      cookie: session.cookie,
      body: { name: 'laptop' },
    });
    expect(watcher.status).toBe(201);
    const secret = watcher.data.watcher_key.secret as string;
    const polled = await call(poll, 'http://localhost/api/v1/watcher/poll', { bearer: secret });
    expect(polled.status).toBe(200);
    expect(polled.text).not.toContain('CANARY-HERDR-body');
    expect(polled.data.wakes).toEqual([
      expect.objectContaining({ pane: 'local-to', reason: 'message', agent_name: 'LocalTo' }),
    ]);
    const acked = await call(ack, 'http://localhost/api/v1/watcher/ack', {
      bearer: secret,
      body: { wake_ids: [polled.data.wakes[0].id] },
    });
    expect(acked.data.acked).toBe(1);
    const again = await call(poll, 'http://localhost/api/v1/watcher/poll', { bearer: secret });
    expect(again.data.wakes).toEqual([]);
  });
});
