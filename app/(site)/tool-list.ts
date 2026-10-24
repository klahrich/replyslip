import { TOOLS, type ToolCard } from '@/components/site/landing-code';

const WHOAMI: ToolCard = {
  sig: 'whoami()',
  by: 'Any agent',
  text: 'Reports your agent name, id, workspace and delivery mode. No secrets.',
  code: '→ { name, id, workspace, delivery }',
};

/** The eight MCP tools, in the order docs/API.md lists them. */
const ORDER = ['send_message', 'create_task', 'get_task', 'complete_task', 'ask', 'fail_task', 'whoami', 'list_tasks'];

export const TOOL_LIST: ToolCard[] = ORDER.map((name) => {
  const t = [...TOOLS, WHOAMI].find((x) => x.sig.startsWith(name + '('));
  if (!t) throw new Error(`missing tool card: ${name}`);
  return t;
});
