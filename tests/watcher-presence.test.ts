import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { GET as getAgent } from '@/app/api/v1/agents/[id]/route';
import { GET as listAgents } from '@/app/api/v1/agents/route';
import { POST as ack } from '@/app/api/v1/watcher/ack/route';
import { POST as poll } from '@/app/api/v1/watcher/poll/route';
import { POST as revokeWatcher } from '@/app/api/v1/watcher-keys/[id]/revoke/route';
import { GET as listWatcherKeys, POST as createWatcher } from '@/app/api/v1/watcher-keys/route';
import { getDb } from '@/db';
import { watcherKeys } from '@/db/schema';
import { watcherPresence } from '@/lib/agents';
import { WATCHER_ONLINE_MS } from '@/lib/constants';
import { call, createAgent, createKey, mcpTool, setHerdr, setWebhook, signIn } from './helpers';

describe('watcher last_seen', () => {
  it('treats the 30s boundary as online only for local delivery', () => {
    const seen = new Date(1_000);
    expect(watcherPresence({ deliveryMode: 'local' }, seen, 1_000 + WATCHER_ONLINE_MS).watcher_online).toBe(true);
    expect(watcherPresence({ deliveryMode: 'herdr' }, seen, 1_000 + WATCHER_ONLINE_MS + 1).watcher_online).toBe(false);
    expect(watcherPresence({ deliveryMode: 'local' }, null, 2_000)).toEqual({
      watcher_last_seen_at: null,
      watcher_online: false,
    });
    expect(watcherPresence({ deliveryMode: 'webhook' }, seen, 1_000)).toEqual({
      watcher_last_seen_at: null,
      watcher_online: false,
    });
    expect(watcherPresence({ deliveryMode: 'none' }, seen, 1_000).watcher_online).toBe(false);
  });

  it('records last_seen on poll, shares it across local agents, and ignores agent keys', async () => {
    const session = await signIn();
    const local = await createAgent(session.cookie, 'PaneBot');
    const other = await createAgent(session.cookie, 'OtherPane');
    const hook = await createAgent(session.cookie, 'HookBot');
    await setHerdr(session.cookie, local.id, 'pane-bot');
    await setHerdr(session.cookie, other.id, 'other-pane');
    await setWebhook(session.cookie, hook.id, 'https://example.com/hooks/replyslip');
    const agentKey = await createKey(session.cookie, local.id);

    const created = await call(createWatcher, 'http://localhost/api/v1/watcher-keys', {
      cookie: session.cookie,
      body: { name: 'laptop' },
    });
    expect(created.status).toBe(201);
    const secret = created.data.watcher_key.secret as string;
    const keyId = created.data.watcher_key.id as string;

    const before = await call(listWatcherKeys, 'http://localhost/api/v1/watcher-keys', { cookie: session.cookie });
    expect(before.data.watcher_keys[0].last_seen_at).toBeNull();

    const denied = await call(poll, 'http://localhost/api/v1/watcher/poll', { bearer: agentKey });
    expect(denied.status).toBe(401);
    const deniedAck = await call(ack, 'http://localhost/api/v1/watcher/ack', {
      bearer: agentKey,
      body: { wake_ids: [] },
    });
    expect(deniedAck.status).toBe(401);

    const stamped = new Date('2020-01-01T00:00:00.000Z');
    await getDb().update(watcherKeys).set({ lastSeenAt: stamped }).where(eq(watcherKeys.id, keyId));
    const acked = await call(ack, 'http://localhost/api/v1/watcher/ack', {
      bearer: secret,
      body: { wake_ids: [] },
    });
    expect(acked.status).toBe(200);
    const afterAck = await call(listWatcherKeys, 'http://localhost/api/v1/watcher-keys', { cookie: session.cookie });
    expect(afterAck.data.watcher_keys[0].last_seen_at).toBe(stamped.toISOString());

    const polled = await call(poll, 'http://localhost/api/v1/watcher/poll', { bearer: secret });
    expect(polled.status).toBe(200);
    expect(polled.data.workspace_id).toBe(session.workspace.id);
    const listed = await call(listAgents, 'http://localhost/api/v1/agents', { cookie: session.cookie });
    const byName = new Map(listed.data.agents.map((agent: { name: string }) => [agent.name, agent]));
    const pane = byName.get('PaneBot');
    const sibling = byName.get('OtherPane');
    const webhook = byName.get('HookBot');
    expect(pane.watcher_online).toBe(true);
    expect(pane.watcher_last_seen_at).toEqual(expect.any(String));
    expect(Date.now() - Date.parse(pane.watcher_last_seen_at)).toBeLessThan(WATCHER_ONLINE_MS);
    expect(sibling.watcher_last_seen_at).toBe(pane.watcher_last_seen_at);
    expect(sibling.watcher_online).toBe(true);
    expect(webhook.watcher_last_seen_at).toBeNull();
    expect(webhook.watcher_online).toBe(false);

    const one = await call(getAgent, `http://localhost/api/v1/agents/${local.id}`, {
      cookie: session.cookie,
      params: { id: local.id },
    });
    expect(one.data.agent.watcher_online).toBe(true);

    const who = await mcpTool(agentKey, 'whoami', {});
    expect(who.isError).toBe(false);
    expect(who.payload).toMatchObject({
      name: 'PaneBot',
      delivery: { mode: 'local', driver: 'herdr', target: 'pane-bot' },
      watcher_online: true,
    });
    expect(who.payload.watcher_last_seen_at).toBe(pane.watcher_last_seen_at);

    const keys = await call(listWatcherKeys, 'http://localhost/api/v1/watcher-keys', { cookie: session.cookie });
    expect(keys.data.watcher_keys[0].last_seen_at).toBe(pane.watcher_last_seen_at);

    await getDb()
      .update(watcherKeys)
      .set({ lastSeenAt: new Date(Date.now() - WATCHER_ONLINE_MS - 1_000) })
      .where(eq(watcherKeys.id, keyId));
    const stale = await call(listAgents, 'http://localhost/api/v1/agents', { cookie: session.cookie });
    const stalePane = stale.data.agents.find((agent: { name: string }) => agent.name === 'PaneBot');
    expect(stalePane.watcher_online).toBe(false);
    expect(stalePane.watcher_last_seen_at).toEqual(expect.any(String));

    const revoked = await call(revokeWatcher, `http://localhost/api/v1/watcher-keys/${keyId}/revoke`, {
      method: 'POST',
      cookie: session.cookie,
      params: { id: keyId },
    });
    expect(revoked.status).toBe(200);
    expect(revoked.data.watcher_key.last_seen_at).toEqual(expect.any(String));
    await getDb().update(watcherKeys).set({ lastSeenAt: new Date() }).where(eq(watcherKeys.id, keyId));
    const hidden = await call(listAgents, 'http://localhost/api/v1/agents', { cookie: session.cookie });
    const hiddenPane = hidden.data.agents.find((agent: { name: string }) => agent.name === 'PaneBot');
    expect(hiddenPane.watcher_last_seen_at).toBeNull();
    expect(hiddenPane.watcher_online).toBe(false);

    const quiet = await mcpTool(await createKey(session.cookie, hook.id), 'whoami', {});
    expect(quiet.payload.delivery.mode).toBe('webhook');
    expect(quiet.payload.watcher_online).toBe(false);
    expect(quiet.payload.watcher_last_seen_at).toBeNull();
  });
});
