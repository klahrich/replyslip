import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { GET as me } from '@/app/api/v1/auth/me/route';
import { POST as createAgentRoute } from '@/app/api/v1/agents/route';
import { POST as revokeAgent } from '@/app/api/v1/agents/[id]/revoke/route';
import { POST as register } from '@/app/api/v1/agents/register/route';
import { GET as listJoinCodes } from '@/app/api/v1/join-codes/route';
import { getDb } from '@/db';
import { tasks, workspaces } from '@/db/schema';
import { planLimitMessage, usePlanLimitsForTests, utcMonthWindow } from '@/lib/plans';
import { call, createAgent, createJoinCode, createKey, mcpTool, signIn } from './helpers';

const resultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ok'],
  properties: { ok: { type: 'boolean' } },
};

afterEach(() => {
  usePlanLimitsForTests(null);
});

describe('plan limits', () => {
  it('formats the free-plan message with a thousands separator and the reset day', () => {
    expect(planLimitMessage('agents', 10)).toBe('Free plan limit: 10 agents.');
    expect(planLimitMessage('tasks_per_month', 1000, new Date('2026-11-01T00:00:00.000Z'))).toBe(
      'Free plan limit: 1,000 tasks per month. Resets 2026-11-01.',
    );
  });

  it('stops at the active-agent cap, keeps the join code, and frees a slot on revoke', async () => {
    usePlanLimitsForTests({ agents: 2, tasksPerMonth: 5 });
    const session = await signIn();
    await createAgent(session.cookie, 'Alpha');
    const beta = await createAgent(session.cookie, 'Beta');

    const blocked = await call(createAgentRoute, 'http://localhost/api/v1/agents', {
      cookie: session.cookie,
      body: { name: 'Gamma' },
    });
    expect(blocked.status).toBe(403);
    expect(blocked.data).toEqual({
      error: 'plan_limit',
      limit: 'agents',
      max: 2,
      used: 2,
      message: 'Free plan limit: 2 agents.',
    });
    expect(blocked.data.resets_at).toBeUndefined();

    const join = await createJoinCode(session.cookie);
    const registered = await call(register, 'http://localhost/api/v1/agents/register', {
      bearer: join.secret,
      body: { name: 'Delta' },
    });
    expect(registered.status).toBe(403);
    expect(registered.data.limit).toBe('agents');
    const codes = await call(listJoinCodes, 'http://localhost/api/v1/join-codes', { cookie: session.cookie });
    expect(codes.data.join_codes.find((row: { id: string }) => row.id === join.id).status).toBe('pending');

    const who = await call(me, 'http://localhost/api/v1/auth/me', { cookie: session.cookie });
    expect(who.data.workspace).toMatchObject({
      plan: 'free',
      usage: { agents: 2, tasks_this_month: 0 },
      limits: { agents: 2, tasks_per_month: 5 },
    });

    const revoked = await call(revokeAgent, `http://localhost/api/v1/agents/${beta.id}/revoke`, {
      method: 'POST',
      cookie: session.cookie,
      params: { id: beta.id },
    });
    expect(revoked.status).toBe(200);
    const again = await call(register, 'http://localhost/api/v1/agents/register', {
      bearer: join.secret,
      body: { name: 'Delta' },
    });
    expect(again.status).toBe(201);
  });

  it('counts tasks created this UTC month, blocks ask at the cap, and rolls over', async () => {
    usePlanLimitsForTests({ agents: 5, tasksPerMonth: 2 });
    const session = await signIn();
    const from = await createAgent(session.cookie, 'FromBot');
    const to = await createAgent(session.cookie, 'ToBot');
    const fromKey = await createKey(session.cookie, from.id);
    const toKey = await createKey(session.cookie, to.id);
    const taskInput = {
      to: 'ToBot',
      title: 'Answer',
      description: 'Return ok.',
      result_schema: resultSchema,
    };

    const first = await mcpTool(fromKey, 'create_task', taskInput);
    const second = await mcpTool(fromKey, 'create_task', { ...taskInput, title: 'Answer again' });
    expect(first.isError).toBe(false);
    expect(second.isError).toBe(false);
    const taskId = first.payload.task.id as string;

    const third = await mcpTool(fromKey, 'create_task', { ...taskInput, title: 'One too many' });
    expect(third.isError).toBe(true);
    expect(third.payload).toMatchObject({
      error: 'plan_limit',
      limit: 'tasks_per_month',
      max: 2,
      used: 2,
      resets_at: utcMonthWindow().next.toISOString(),
      message: planLimitMessage('tasks_per_month', 2, utcMonthWindow().next),
    });

    const asked = await mcpTool(toKey, 'ask', { id: taskId, question: 'Which ok?' });
    expect(asked.isError).toBe(true);
    expect(asked.payload.limit).toBe('tasks_per_month');
    const still = await mcpTool(fromKey, 'get_task', { id: taskId });
    expect(still.payload.task.status).toBe('open');

    const noted = await mcpTool(fromKey, 'send_message', { to: 'ToBot', body: 'messages do not count' });
    expect(noted.isError).toBe(false);
    const closed = await mcpTool(toKey, 'complete_task', { id: taskId, result: { ok: true } });
    expect(closed.isError).toBe(false);
    const failed = await mcpTool(fromKey, 'create_task', { ...taskInput, title: 'Still capped', to: 'ToBot' });
    expect(failed.payload.error).toBe('plan_limit');

    await getDb().update(tasks).set({ createdAt: new Date(Date.UTC(2020, 0, 15)) }).where(eq(tasks.workspaceId, session.workspace.id));
    const rolled = await mcpTool(fromKey, 'create_task', { ...taskInput, title: 'Next month' });
    expect(rolled.isError).toBe(false);

    const identity = await mcpTool(fromKey, 'whoami', {});
    expect(identity.payload).toMatchObject({
      plan: 'free',
      usage: { agents: 2, tasks_this_month: 1 },
      limits: { agents: 5, tasks_per_month: 2 },
    });
  });

  it('lets an unlimited workspace pass a free cap', async () => {
    usePlanLimitsForTests({ agents: 1, tasksPerMonth: 1 });
    const session = await signIn();
    await getDb().update(workspaces).set({ plan: 'unlimited' }).where(eq(workspaces.id, session.workspace.id));
    const from = await createAgent(session.cookie, 'FreeOne');
    await createAgent(session.cookie, 'FreeTwo');
    const fromKey = await createKey(session.cookie, from.id);
    await createAgent(session.cookie, 'FreeThree');
    const to = await createAgent(session.cookie, 'FreeFour');
    const input = {
      to: to.name,
      title: 'Unlimited',
      description: 'Return ok.',
      result_schema: resultSchema,
    };
    expect((await mcpTool(fromKey, 'create_task', input)).isError).toBe(false);
    expect((await mcpTool(fromKey, 'create_task', { ...input, title: 'Still unlimited' })).isError).toBe(false);
    const identity = await mcpTool(fromKey, 'whoami', {});
    expect(identity.payload.plan).toBe('unlimited');
    expect(identity.payload.limits).toEqual({ agents: null, tasks_per_month: null });
    expect(identity.payload.usage.agents).toBe(4);
    expect(identity.payload.usage.tasks_this_month).toBe(2);
  });
});
