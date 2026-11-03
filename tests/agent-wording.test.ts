import { describe, expect, it } from 'vitest';
import {
  MCP_URL,
  MUSE_CLIENT_ID,
  MUSE_WAKE_NOTE,
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

  it('the rules say the id changes for messages and answers too, then list_tasks and get_task', () => {
    const rules = WAKE_RULES.join('\n');
    expect(rules).toMatch(/new task or message/);
    expect(rules).toMatch(/answer/);
    expect(rules).toContain(`call list_tasks on ${MCP_URL}, then get_task`);
  });

  it('the Muse client ID on the guide is the pinned one', () => {
    expect(OAUTH_PINNED_CLIENT_IDS).toContain(MUSE_CLIENT_ID);
  });
});
