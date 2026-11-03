import { describe, expect, it } from 'vitest';
import {
  MCP_URL,
  MUSE_CLIENT_ID,
  MUSE_WAKE_NOTE,
  TEST_WAKE_RULE,
  WAKE_RULES,
  wakeInstructions,
} from '@/components/site/valetto/agentConstants';
import { OAUTH_PINNED_CLIENT_IDS } from '@/lib/oauth/constants';

describe('shared agent wording', () => {
  it('the dashboard wake instructions and the Meta Muse note use the same rule lines', () => {
    const rules = WAKE_RULES.join('\n');
    expect(wakeInstructions(null)).toContain(rules);
    expect(wakeInstructions('https://valetto.tech/api/v1/wake/x')).toContain(rules);
    expect(MUSE_WAKE_NOTE).toContain(rules);
  });

  it('the rules say the id changes for messages, answers and reviews, then list_tasks and get_task', () => {
    const rules = WAKE_RULES.join('\n');
    expect(rules).toMatch(/new task or message/);
    expect(rules).toMatch(/answer/);
    expect(rules).toMatch(/owner review/);
    expect(rules).toContain(`call list_tasks on ${MCP_URL}, then get_task for each task it returns`);
    expect(rules).toMatch(/next_cursor/);
  });

  it('the first list_tasks call leaves out updated_since; later ones overlap by about a minute', () => {
    const rules = WAKE_RULES.join('\n');
    expect(rules).toMatch(/Leave out updated_since the first time/);
    expect(rules).toMatch(/newest updated_at you've seen, minus about a minute/);
  });

  it('a review or a message outside a task can change the id with nothing new to list', () => {
    expect(WAKE_RULES.join('\n')).toContain(
      'If nothing new shows up, a request may be waiting for my review, or someone may have sent a message outside a task. No tool can read those messages yet.',
    );
  });

  it('test wakes are only in the dashboard text, never in the note for Muse', () => {
    expect(WAKE_RULES.join('\n')).not.toMatch(/test wake/i);
    expect(MUSE_WAKE_NOTE).not.toMatch(/test wake/i);
    expect(wakeInstructions(null)).toContain(TEST_WAKE_RULE);
    expect(wakeInstructions(null).split('\n').at(-1)).toBe(TEST_WAKE_RULE);
  });

  it('the Muse client ID on the guide is the pinned one', () => {
    expect(OAUTH_PINNED_CLIENT_IDS).toContain(MUSE_CLIENT_ID);
  });
});
