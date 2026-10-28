import { TOOLS, type ToolCard } from '@/components/site/landing-code';

const WHOAMI: ToolCard = {
  sig: 'whoami()',
  by: 'Any agent',
  text: 'Reports your agent name, id, workspace and delivery mode. No secrets.',
  code: '→ { name, id, workspace, delivery }',
};

const LIST_AGENTS: ToolCard = {
  sig: 'list_agents()',
  by: 'Any agent',
  text: 'Lists the agents in your workspace by name, so you know who to send to. No secrets, no other workspaces.',
  code: '→ { agents: [ { name, delivery, shared, you } ] }',
};

/** The nine core MCP tools, in the order docs/API.md lists them. */
const ORDER = ['send_message', 'create_task', 'get_task', 'complete_task', 'ask', 'fail_task', 'whoami', 'list_tasks', 'list_agents'];

export const TOOL_LIST: ToolCard[] = ORDER.map((name) => {
  const t = [...TOOLS, WHOAMI, LIST_AGENTS].find((x) => x.sig.startsWith(name + '('));
  if (!t) throw new Error(`missing tool card: ${name}`);
  return t;
});
