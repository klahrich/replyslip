import { describe, expect, it } from 'vitest';
import { POST as revokeAgent } from '@/app/api/v1/agents/[id]/revoke/route';
import { POST as createWatcher } from '@/app/api/v1/watcher-keys/route';
import { POST as poll } from '@/app/api/v1/watcher/poll/route';
import { call, createAgent, createKey, mcpListTools, mcpTool, setHerdr, setWebhook, signIn } from './helpers';

const ENTRY_KEYS = ['created_at', 'delivery', 'description', 'id', 'name', 'shared', 'you'];

describe('list_agents MCP tool', () => {
  it('lists active agents in the caller workspace only, sorted by name, with no secrets', async () => {
    const owner = await signIn();
    const zed = await createAgent(owner.cookie, 'zed', 'Reviews diffs');
    const alpha = await createAgent(owner.cookie, 'Alpha');
    const hook = await createAgent(owner.cookie, 'HookBot', 'Runs on a server');
    const pane = await createAgent(owner.cookie, 'PaneBot');
    const gone = await createAgent(owner.cookie, 'GoneBot');
    await setWebhook(owner.cookie, hook.id, 'https://hooks.example.com/secret-path/replyslip?token=abc', {
      type: 'bearer',
      token: 'super-secret-bearer-token',
    });
    await setHerdr(owner.cookie, pane.id, 'pane-bot-secret-pane');
    const revoked = await call(revokeAgent, `http://localhost/api/v1/agents/${gone.id}/revoke`, {
      method: 'POST',
      cookie: owner.cookie,
      params: { id: gone.id },
    });
    expect(revoked.status).toBe(200);

    const other = await signIn();
    const outsider = await createAgent(other.cookie, 'Outsider');
    const outsiderKey = await createKey(other.cookie, outsider.id);

    const zedKey = await createKey(owner.cookie, zed.id);
    const listed = await mcpTool(zedKey, 'list_agents', {});
    expect(listed.isError).toBe(false);
    const agents = listed.payload.agents as Record<string, unknown>[];

    expect(agents.map((agent) => agent.name)).toEqual(['Alpha', 'HookBot', 'PaneBot', 'zed']);
    expect(agents.find((agent) => agent.name === 'GoneBot')).toBeUndefined();
    expect(agents.find((agent) => agent.name === 'Outsider')).toBeUndefined();

    expect(agents.filter((agent) => agent.you)).toEqual([expect.objectContaining({ name: 'zed', id: zed.id })]);
    expect(agents.find((agent) => agent.name === 'Alpha')).toEqual({
      id: alpha.id,
      name: 'Alpha',
      description: null,
      delivery: 'none',
      shared: false,
      created_at: expect.any(String),
      you: false,
    });
    expect(agents.find((agent) => agent.name === 'zed')).toMatchObject({ description: 'Reviews diffs', delivery: 'none' });
    expect(agents.find((agent) => agent.name === 'HookBot')).toMatchObject({ delivery: 'webhook', description: 'Runs on a server' });
    expect(agents.find((agent) => agent.name === 'PaneBot')).toMatchObject({ delivery: 'local', watcher_online: false });

    for (const agent of agents) {
      const allowed = agent.delivery === 'local' ? [...ENTRY_KEYS, 'watcher_online'].sort() : ENTRY_KEYS;
      expect(Object.keys(agent).sort()).toEqual(allowed);
    }
    for (const leak of [
      'hooks.example.com',
      'secret-path',
      'token=abc',
      'super-secret-bearer-token',
      'pane-bot-secret-pane',
      'rsk_',
      owner.email,
      owner.workspace.id,
      other.workspace.id,
      outsider.id,
      'Outsider',
      'GoneBot',
    ]) {
      expect(listed.text).not.toContain(leak);
    }

    const outsiderView = await mcpTool(outsiderKey, 'list_agents', {});
    expect(outsiderView.isError).toBe(false);
    expect(outsiderView.payload.agents).toEqual([
      expect.objectContaining({ id: outsider.id, name: 'Outsider', you: true, delivery: 'none' }),
    ]);
  });

  it('reports watcher_online for local agents from the workspace watcher', async () => {
    const owner = await signIn();
    const pane = await createAgent(owner.cookie, 'PaneBot');
    await setHerdr(owner.cookie, pane.id, 'pane-bot');
    const created = await call(createWatcher, 'http://localhost/api/v1/watcher-keys', {
      cookie: owner.cookie,
      body: { name: 'laptop' },
    });
    expect(created.status).toBe(201);
    const polled = await call(poll, 'http://localhost/api/v1/watcher/poll', { bearer: created.data.watcher_key.secret });
    expect(polled.status).toBe(200);

    const key = await createKey(owner.cookie, pane.id);
    const listed = await mcpTool(key, 'list_agents', {});
    expect(listed.payload.agents).toEqual([expect.objectContaining({ name: 'PaneBot', delivery: 'local', watcher_online: true, you: true })]);
    expect(listed.text).not.toContain('pane-bot');
    expect(listed.text).not.toContain('laptop');
  });

  it('is registered with no arguments', async () => {
    const owner = await signIn();
    const agent = await createAgent(owner.cookie, 'Solo');
    const tools = await mcpListTools(await createKey(owner.cookie, agent.id));
    const tool = tools.find((item) => item.name === 'list_agents');
    expect(tool).toBeDefined();
    expect(Object.keys(tool?.inputSchema?.properties ?? {})).toEqual([]);
  });
});
