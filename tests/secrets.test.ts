import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { agents, wakes } from '@/db/schema';
import { GET as listAgentsRoute } from '@/app/api/v1/agents/route';
import { GET as getAgentRoute } from '@/app/api/v1/agents/[id]/route';
import { GET as getDelivery, PUT as putDelivery } from '@/app/api/v1/agents/[id]/delivery/route';
import { POST as testWake } from '@/app/api/v1/agents/[id]/test-wake/route';
import { GET as getWake } from '@/app/api/v1/agents/[id]/wakes/[wakeId]/route';
import { POST as ack } from '@/app/api/v1/watcher/ack/route';
import { POST as poll } from '@/app/api/v1/watcher/poll/route';
import { POST as createWatcher } from '@/app/api/v1/watcher-keys/route';
import { call, createAgent, createKey, mcpTool, signIn } from './helpers';

const TOKEN = 'CANARY-TOKEN-9abC';
const HEADER_VALUE = 'header-secret-VALUE';

function listen(status: number, body = ''): Promise<{ url: string; hits: { authorization?: string; body: string }[]; close: () => Promise<void> }> {
  const hits: { authorization?: string; body: string }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      hits.push({
        authorization: req.headers.authorization,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      res.writeHead(status, { 'content-type': 'text/plain' });
      res.end(body);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/hooks/secretpathABCD`,
        hits,
        close: () =>
          new Promise((done, reject) => {
            server.close((err) => (err ? reject(err) : done()));
          }),
      });
    });
  });
}

function assertMasked(text: string): void {
  expect(text).not.toContain(TOKEN);
  expect(text).not.toContain('CANARY-TOKEN');
  expect(text).not.toContain(HEADER_VALUE);
  expect(text).not.toContain('header-secret');
  expect(text).not.toContain('/hooks/secretpathABCD');
  expect(text).not.toContain('secretpath');
  expect(text).not.toMatch(/v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
}

describe('write-only delivery secrets', () => {
  it('masks secrets, keeps them on partial PUT, and requires a secret when auth type changes', async () => {
    const session = await signIn();
    const receiver = await listen(204);
    try {
      const agent = await createAgent(session.cookie, 'SecretBot');
      const put = await call(putDelivery, `http://localhost/api/v1/agents/${agent.id}/delivery`, {
        method: 'PUT',
        cookie: session.cookie,
        params: { id: agent.id },
        body: {
          mode: 'webhook',
          url: receiver.url,
          auth: { type: 'bearer', token: TOKEN },
        },
      });
      expect(put.status).toBe(200);
      assertMasked(put.text);
      expect(put.data.agent.delivery).toMatchObject({
        mode: 'webhook',
        url: receiver.url.replace(/\/hooks\/secretpathABCD$/, ''),
        url_set: true,
        url_path_last4: 'ABCD',
        auth_type: 'bearer',
        token: { set: true, last4: '9abC' },
        secret: { set: false, last4: null },
      });

      const headersPut = await call(putDelivery, `http://localhost/api/v1/agents/${agent.id}/delivery`, {
        method: 'PUT',
        cookie: session.cookie,
        params: { id: agent.id },
        body: {
          mode: 'webhook',
          auth: { type: 'headers', headers: { 'X-Api-Key': HEADER_VALUE } },
        },
      });
      expect(headersPut.status).toBe(200);
      assertMasked(headersPut.text);
      expect(headersPut.data.agent.delivery.headers).toEqual([
        { name: 'X-Api-Key', value: { set: true, last4: 'ALUE' } },
      ]);

      const backToBearer = await call(putDelivery, `http://localhost/api/v1/agents/${agent.id}/delivery`, {
        method: 'PUT',
        cookie: session.cookie,
        params: { id: agent.id },
        body: { mode: 'webhook', auth: { type: 'bearer', token: TOKEN } },
      });
      expect(backToBearer.status).toBe(200);

      const kept = await call(putDelivery, `http://localhost/api/v1/agents/${agent.id}/delivery`, {
        method: 'PUT',
        cookie: session.cookie,
        params: { id: agent.id },
        body: { mode: 'webhook', auth: { type: 'bearer' } },
      });
      expect(kept.status).toBe(200);
      expect(kept.data.agent.delivery.token).toEqual({ set: true, last4: '9abC' });

      const [row] = await getDb()
        .select({ cipher: agents.webhookSecretCiphertext })
        .from(agents)
        .where(eq(agents.id, agent.id));
      const reads = await Promise.all([
        call(getDelivery, `http://localhost/api/v1/agents/${agent.id}/delivery`, {
          method: 'GET',
          cookie: session.cookie,
          params: { id: agent.id },
        }),
        call(getAgentRoute, `http://localhost/api/v1/agents/${agent.id}`, {
          method: 'GET',
          cookie: session.cookie,
          params: { id: agent.id },
        }),
        call(listAgentsRoute, 'http://localhost/api/v1/agents', { method: 'GET', cookie: session.cookie }),
      ]);
      for (const res of reads) {
        expect(res.status).toBe(200);
        assertMasked(res.text);
        if (row?.cipher) expect(res.text).not.toContain(row.cipher);
      }
      expect(reads[0]?.data.delivery.token).toEqual({ set: true, last4: '9abC' });

      const sent = await call(testWake, `http://localhost/api/v1/agents/${agent.id}/test-wake`, {
        method: 'POST',
        cookie: session.cookie,
        params: { id: agent.id },
      });
      expect(sent.status).toBe(200);
      expect(sent.data).toMatchObject({ ok: true, status_code: 204 });
      assertMasked(sent.text);
      expect(receiver.hits.at(-1)?.authorization).toBe(`Bearer ${TOKEN}`);
      expect(receiver.hits.at(-1)?.body).toContain('"reason":"test"');
      expect(receiver.hits.at(-1)?.body).not.toContain(TOKEN);

      const switched = await call(putDelivery, `http://localhost/api/v1/agents/${agent.id}/delivery`, {
        method: 'PUT',
        cookie: session.cookie,
        params: { id: agent.id },
        body: { mode: 'webhook', auth: { type: 'hmac' } },
      });
      expect(switched.status).toBe(400);
      expect(switched.data.error.code).toBe('secret_required');

      const empty = await call(putDelivery, `http://localhost/api/v1/agents/${agent.id}/delivery`, {
        method: 'PUT',
        cookie: session.cookie,
        params: { id: agent.id },
        body: { mode: 'webhook', auth: { type: 'bearer', token: '' } },
      });
      expect(empty.status).toBe(400);
      const nulled = await call(putDelivery, `http://localhost/api/v1/agents/${agent.id}/delivery`, {
        method: 'PUT',
        cookie: session.cookie,
        params: { id: agent.id },
        body: { mode: 'webhook', auth: { type: 'bearer', token: null } },
      });
      expect(nulled.status).toBe(400);

      const cleared = await call(putDelivery, `http://localhost/api/v1/agents/${agent.id}/delivery`, {
        method: 'PUT',
        cookie: session.cookie,
        params: { id: agent.id },
        body: { mode: 'webhook', auth: { type: 'none', token: null } },
      });
      expect(cleared.status).toBe(200);
      expect(cleared.data.agent.delivery.token).toEqual({ set: false, last4: null });
      expect(cleared.data.agent.delivery.auth_type).toBe('none');

      const missing = await call(putDelivery, `http://localhost/api/v1/agents/${agent.id}/delivery`, {
        method: 'PUT',
        cookie: session.cookie,
        params: { id: agent.id },
        body: { mode: 'webhook', auth: { type: 'bearer' } },
      });
      expect(missing.status).toBe(400);
      expect(missing.data.error.code).toBe('secret_required');
    } finally {
      await receiver.close();
    }
  });

  it('reports webhook failure without the response body and leaves a local test wake pending until ack', async () => {
    const session = await signIn();
    const failing = await listen(401, TOKEN);
    try {
      const agent = await createAgent(session.cookie, 'FailBot');
      await call(putDelivery, `http://localhost/api/v1/agents/${agent.id}/delivery`, {
        method: 'PUT',
        cookie: session.cookie,
        params: { id: agent.id },
        body: { mode: 'webhook', url: failing.url, auth: { type: 'none' } },
      });
      const failed = await call(testWake, `http://localhost/api/v1/agents/${agent.id}/test-wake`, {
        method: 'POST',
        cookie: session.cookie,
        params: { id: agent.id },
      });
      expect(failed.status).toBe(200);
      expect(failed.data.ok).toBe(false);
      expect(failed.data.error).toBe('http 401');
      expect(failed.data.status_code).toBe(401);
      expect(failed.text).not.toContain(TOKEN);
      expect(String(failed.data.error).length).toBeLessThanOrEqual(200);
      const [pending] = await getDb().select().from(wakes).where(eq(wakes.id, failed.data.wake_id));
      expect(pending?.status).toBe('pending');
      expect(pending?.reason).toBe('test');
      expect(pending?.taskId).toBeNull();
    } finally {
      await failing.close();
    }

    const quiet = await createAgent(session.cookie, 'QuietBot');
    const none = await call(testWake, `http://localhost/api/v1/agents/${quiet.id}/test-wake`, {
      method: 'POST',
      cookie: session.cookie,
      params: { id: quiet.id },
    });
    expect(none.status).toBe(400);
    expect(none.data.error.code).toBe('delivery_none');
    const noneRows = await getDb().select().from(wakes).where(eq(wakes.agentId, quiet.id));
    expect(noneRows).toHaveLength(0);

    const local = await createAgent(session.cookie, 'PaneBot');
    await call(putDelivery, `http://localhost/api/v1/agents/${local.id}/delivery`, {
      method: 'PUT',
      cookie: session.cookie,
      params: { id: local.id },
      body: { mode: 'local', driver: 'herdr', target: 'pane-bot' },
    });
    const pendingWake = await call(testWake, `http://localhost/api/v1/agents/${local.id}/test-wake`, {
      method: 'POST',
      cookie: session.cookie,
      params: { id: local.id },
    });
    expect(pendingWake.status).toBe(200);
    expect(pendingWake.data).toEqual({ ok: true, pending: true, wake_id: pendingWake.data.wake_id });
    const watcher = await call(createWatcher, 'http://localhost/api/v1/watcher-keys', {
      cookie: session.cookie,
      body: { name: 'desk' },
    });
    const polled = await call(poll, 'http://localhost/api/v1/watcher/poll', { bearer: watcher.data.watcher_key.secret });
    expect(polled.data.wakes.map((wake: { id: string }) => wake.id)).toContain(pendingWake.data.wake_id);
    const acked = await call(ack, 'http://localhost/api/v1/watcher/ack', {
      bearer: watcher.data.watcher_key.secret,
      body: { wake_ids: [pendingWake.data.wake_id] },
    });
    expect(acked.status).toBe(200);
    const status = await call(getWake, `http://localhost/api/v1/agents/${local.id}/wakes/${pendingWake.data.wake_id}`, {
      method: 'GET',
      cookie: session.cookie,
      params: { id: local.id, wakeId: pendingWake.data.wake_id },
    });
    expect(status.status).toBe(200);
    expect(status.data.wake.status).toBe('delivered');
    expect(status.data.wake.reason).toBe('test');

    const listed = await call(listAgentsRoute, 'http://localhost/api/v1/agents', { method: 'GET', cookie: session.cookie });
    const row = listed.data.agents.find((item: { id: string }) => item.id === local.id);
    expect(row.last_delivered_at).toEqual(expect.any(String));
    expect(row.last_error === null || typeof row.last_error === 'string').toBe(true);
  });

  it('rate limits test wakes per agent and whoami hides the webhook path', async () => {
    const session = await signIn();
    const agent = await createAgent(session.cookie, 'LimitBot');
    await call(putDelivery, `http://localhost/api/v1/agents/${agent.id}/delivery`, {
      method: 'PUT',
      cookie: session.cookie,
      params: { id: agent.id },
      body: { mode: 'local', driver: 'herdr', target: 'limit-bot' },
    });
    for (let i = 0; i < 10; i += 1) {
      const res = await call(testWake, `http://localhost/api/v1/agents/${agent.id}/test-wake`, {
        method: 'POST',
        cookie: session.cookie,
        params: { id: agent.id },
      });
      expect(res.status).toBe(200);
    }
    const limited = await call(testWake, `http://localhost/api/v1/agents/${agent.id}/test-wake`, {
      method: 'POST',
      cookie: session.cookie,
      params: { id: agent.id },
    });
    expect(limited.status).toBe(429);
    expect(limited.data.error.code).toBe('rate_limited');
    const rows = await getDb().select().from(wakes).where(eq(wakes.agentId, agent.id));
    expect(rows).toHaveLength(10);

    const receiver = await listen(204);
    try {
      const hook = await createAgent(session.cookie, 'WhoBot');
      await call(putDelivery, `http://localhost/api/v1/agents/${hook.id}/delivery`, {
        method: 'PUT',
        cookie: session.cookie,
        params: { id: hook.id },
        body: { mode: 'webhook', url: receiver.url, auth: { type: 'bearer', token: TOKEN } },
      });
      const key = await createKey(session.cookie, hook.id);
      const who = await mcpTool(key, 'whoami', {});
      expect(who.isError).toBe(false);
      expect(who.payload).toMatchObject({
        name: 'WhoBot',
        id: hook.id,
        delivery: { mode: 'webhook', host: new URL(receiver.url).host },
      });
      expect(who.payload.workspace_name).toEqual(expect.any(String));
      expect(who.text).not.toContain(TOKEN);
      expect(who.text).not.toContain('secretpath');
      expect(who.payload.delivery).not.toHaveProperty('url');
    } finally {
      await receiver.close();
    }
  });
});
