import { describe, expect, it } from 'vitest';
import { createAgent, createKey, mcpTool, signIn, startReceiver, setWebhook } from './helpers';

const scoreSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['score'],
  properties: { score: { type: 'number' } },
};

describe('tasks over MCP', () => {
  it('creates, rejects an invalid result, accepts a valid one, asks, and fails', async () => {
    const session = await signIn();
    const receiver = await startReceiver();
    try {
      const sender = await createAgent(session.cookie, 'Sender');
      const target = await createAgent(session.cookie, 'Target');
      await setWebhook(session.cookie, sender.id, receiver.url);
      await setWebhook(session.cookie, target.id, receiver.url);
      const senderKey = await createKey(session.cookie, sender.id);
      const targetKey = await createKey(session.cookie, target.id);

      const created = await mcpTool(senderKey, 'create_task', {
        to: 'Target',
        title: 'Score the idea',
        description: 'CANARY-DESC-task',
        result_schema: scoreSchema,
      });
      expect(created.isError).toBe(false);
      expect(created.payload.task.status).toBe('open');
      const taskId = created.payload.task.id as string;
      expect(receiver.hits.at(-1)?.body.agent).toBe('Target');
      expect(receiver.hits.at(-1)?.body.reason).toBe('task');
      expect(receiver.hits.at(-1)?.raw).not.toContain('CANARY-DESC-task');

      const denied = await mcpTool(senderKey, 'complete_task', { id: taskId, result: { score: 1 } });
      expect(denied.isError).toBe(true);
      expect(denied.payload.error).toBe('forbidden');

      const beforeInvalid = receiver.hits.length;
      const invalid = await mcpTool(targetKey, 'complete_task', { id: taskId, result: { score: 'high' } });
      expect(invalid.isError).toBe(true);
      expect(invalid.payload.error).toBe('result_schema_mismatch');
      expect(invalid.payload.details.validation_errors.length).toBeGreaterThan(0);
      expect(receiver.hits).toHaveLength(beforeInvalid);
      const stillOpen = await mcpTool(senderKey, 'get_task', { id: taskId });
      expect(stillOpen.payload.task.status).toBe('open');
      expect(stillOpen.payload.task.result).toBeNull();

      const valid = await mcpTool(targetKey, 'complete_task', {
        id: taskId,
        result: { score: 8 },
      });
      expect(valid.isError).toBe(false);
      expect(valid.payload.task.status).toBe('done');
      expect(valid.payload.task.result).toEqual({ score: 8 });
      expect(receiver.hits.at(-1)?.body.agent).toBe('Sender');
      expect(receiver.hits.at(-1)?.body.reason).toBe('result');
      expect(receiver.hits.at(-1)?.body.id).toBe(receiver.hits.at(-1)?.headers['x-replyslip-wake-id']);

      const second = await mcpTool(targetKey, 'complete_task', { id: taskId, result: { score: 9 } });
      expect(second.isError).toBe(true);
      expect(second.payload.error).toBe('task_closed');

      const questionTask = await mcpTool(senderKey, 'create_task', {
        to: 'Target',
        title: 'Need a question',
        description: 'Ask if unsure',
        result_schema: scoreSchema,
      });
      const questionId = questionTask.payload.task.id as string;
      const asked = await mcpTool(targetKey, 'ask', { id: questionId, question: 'CANARY-QUESTION-text' });
      expect(asked.isError).toBe(false);
      expect(asked.payload.task.status).toBe('needs_info');
      expect(asked.payload.task.question).toBe('CANARY-QUESTION-text');
      expect(receiver.hits.at(-1)?.body.reason).toBe('question');
      expect(receiver.hits.at(-1)?.raw).not.toContain('CANARY-QUESTION-text');

      const failedTask = await mcpTool(senderKey, 'create_task', {
        to: 'Target',
        title: 'This will fail',
        description: 'Stop',
        result_schema: scoreSchema,
      });
      const failed = await mcpTool(targetKey, 'fail_task', {
        id: failedTask.payload.task.id,
        reason: 'CANARY-FAIL-text',
      });
      expect(failed.isError).toBe(false);
      expect(failed.payload.task.status).toBe('failed');
      expect(failed.payload.task.fail_reason).toBe('CANARY-FAIL-text');
      expect(receiver.hits.at(-1)?.body.reason).toBe('failure');
      expect(receiver.hits.at(-1)?.raw).not.toContain('CANARY-FAIL-text');

      const askedAfter = await mcpTool(targetKey, 'ask', { id: failed.payload.task.id, question: 'too late' });
      expect(askedAfter.isError).toBe(true);
    } finally {
      await receiver.close();
    }
  });
});
