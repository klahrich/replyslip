import { describe, expect, it } from 'vitest';
import { createAgent, createKey, mcpTool, setWebhook, signIn, startReceiver } from './helpers';

const pageSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'subhead', 'sections'],
  properties: {
    headline: { type: 'string' },
    subhead: { type: 'string' },
    sections: { type: 'array', items: { type: 'string' } },
  },
};

const evaluationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'verdict', 'landing_page'],
  properties: {
    score: { type: 'number' },
    verdict: { type: 'string' },
    landing_page: pageSchema,
  },
};

describe('three-agent chain', () => {
  it('validates every result, rejects a bad one, and wakes each agent by webhook', async () => {
    const session = await signIn();
    const receiver = await startReceiver();
    try {
      const red = await createAgent(session.cookie, 'RedBot');
      const evaluator = await createAgent(session.cookie, 'EvaluatorBot');
      const landing = await createAgent(session.cookie, 'LandingBot');
      for (const agent of [red, evaluator, landing]) {
        await setWebhook(session.cookie, agent.id, receiver.url);
      }
      const redKey = await createKey(session.cookie, red.id);
      const evaluatorKey = await createKey(session.cookie, evaluator.id);
      const landingKey = await createKey(session.cookie, landing.id);

      const idea = await mcpTool(redKey, 'create_task', {
        to: 'EvaluatorBot',
        title: 'Evaluate the meal-planning idea',
        description: 'A weekly meal-planning app for busy parents. Return a score, verdict, and landing page.',
        result_schema: evaluationSchema,
      });
      expect(idea.isError).toBe(false);
      expect(receiver.hits.at(-1)?.body).toMatchObject({ agent: 'EvaluatorBot', reason: 'task' });

      const draft = await mcpTool(evaluatorKey, 'create_task', {
        to: 'LandingBot',
        title: 'Draft the landing page',
        description: 'Parents need weeknight meals decided for them.',
        result_schema: pageSchema,
      });
      expect(draft.isError).toBe(false);
      const draftId = draft.payload.task.id as string;
      expect(receiver.hits.at(-1)?.body).toMatchObject({ agent: 'LandingBot', reason: 'task' });

      const before = receiver.hits.length;
      const invalid = await mcpTool(landingKey, 'complete_task', {
        id: draftId,
        result: { headline: 'CANARY-RESULT-page' },
      });
      expect(invalid.isError).toBe(true);
      expect(invalid.payload.error).toBe('result_schema_mismatch');
      expect(invalid.payload.details.validation_errors.length).toBeGreaterThan(0);
      expect(receiver.hits).toHaveLength(before);
      const unchanged = await mcpTool(evaluatorKey, 'get_task', { id: draftId });
      expect(unchanged.payload.task.status).toBe('open');
      expect(unchanged.payload.task.result).toBeNull();

      const page = {
        headline: 'CANARY-RESULT-page',
        subhead: 'A week of meals without the weeknight scramble',
        sections: ['Plan', 'Shop', 'Cook'],
      };
      const fixed = await mcpTool(landingKey, 'complete_task', { id: draftId, result: page });
      expect(fixed.isError).toBe(false);
      expect(fixed.payload.task.status).toBe('done');
      expect(receiver.hits.at(-1)?.body).toMatchObject({ agent: 'EvaluatorBot', reason: 'result' });
      expect(receiver.hits.at(-1)?.raw).not.toContain('CANARY-RESULT-page');

      const finished = await mcpTool(evaluatorKey, 'complete_task', {
        id: idea.payload.task.id,
        result: {
          score: 8,
          verdict: 'Worth a landing page',
          landing_page: page,
        },
      });
      expect(finished.isError).toBe(false);
      expect(finished.payload.task.status).toBe('done');
      expect(receiver.hits.at(-1)?.body).toMatchObject({ agent: 'RedBot', reason: 'result' });
      expect(receiver.hits.at(-1)?.raw).not.toContain('CANARY-RESULT-page');
      expect(receiver.hits.at(-1)?.raw).not.toContain('Worth a landing page');

      const seen = await mcpTool(redKey, 'get_task', { id: idea.payload.task.id });
      expect(seen.payload.task.result.score).toBe(8);
      expect(seen.payload.task.result.landing_page.headline).toBe('CANARY-RESULT-page');
    } finally {
      await receiver.close();
    }
  });
});
