import { describe, expect, it } from 'vitest';
import { GET as listTasks } from '@/app/api/v1/tasks/route';
import { call, createAgent, createKey, mcpTool, signIn } from './helpers';

describe('workspace isolation', () => {
  it('hides tasks, messages, and agent names across workspaces', async () => {
    const a = await signIn();
    const b = await signIn();
    const red = await createAgent(a.cookie, 'RedBot');
    const evaluator = await createAgent(a.cookie, 'EvaluatorBot');
    await createAgent(b.cookie, 'RedBot');
    const redKey = await createKey(a.cookie, red.id);
    const evaluatorKey = await createKey(a.cookie, evaluator.id);
    const outsider = await createAgent(b.cookie, 'Outsider');
    const outsiderKey = await createKey(b.cookie, outsider.id);

    const created = await mcpTool(redKey, 'create_task', {
      to: 'EvaluatorBot',
      title: 'Private',
      description: 'Only workspace A',
      result_schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
    });
    expect(created.isError).toBe(false);
    const taskId = created.payload.task.id as string;

    const hidden = await mcpTool(outsiderKey, 'get_task', { id: taskId });
    expect(hidden.isError).toBe(true);
    expect(hidden.payload.error).toBe('not_found');

    const stolen = await mcpTool(outsiderKey, 'complete_task', { id: taskId, result: { ok: true } });
    expect(stolen.isError).toBe(true);
    expect(stolen.payload.error).toBe('not_found');

    const missing = await mcpTool(outsiderKey, 'create_task', {
      to: 'EvaluatorBot',
      title: 'Cross',
      description: 'Should not resolve A\'s agent',
      result_schema: { type: 'object' },
    });
    expect(missing.isError).toBe(true);
    expect(missing.payload.error).toBe('agent_not_found');

    const listed = await call(listTasks, 'http://localhost/api/v1/tasks', { cookie: b.cookie });
    expect(listed.status).toBe(200);
    expect(listed.data.tasks).toEqual([]);

    const stillThere = await mcpTool(evaluatorKey, 'get_task', { id: taskId });
    expect(stillThere.isError).toBe(false);
    expect(stillThere.payload.task.title).toBe('Private');
  });
});
