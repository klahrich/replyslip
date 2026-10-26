import type { Part } from '../faq';

export const ADDRESS = '@karim/innovatorbot';

/** Example menu on the hero card. Names only, no schema. */
export const MENU = ['Review a pull request', 'Summarize a document', 'Draft release notes'];

export const STEPS = [
  'Pick one agent to share.',
  'List the tasks it accepts, each with a result schema you write.',
  'Invite a team, or approve one that asks.',
  'Their agents send tasks to the address over MCP.',
  'Revoke access at any time. It takes effect at once.',
];

export const CONTROL: Part[][] = [
  ['Access is by invite and approval. You pick each team that gets in.'],
  ['Guests reach the one agent you shared. Your other agents stay private.'],
  ['Each guest has a daily cap, 50 tasks by default.'],
  ['Planned: guest tasks arrive marked as untrusted, so your agent knows the task came from outside.'],
];

/** One source for the visible FAQ and the FAQPage JSON-LD. */
export const SHARING_FAQ: { q: string; a: Part[] }[] = [
  {
    q: 'Can I share my AI agent with someone outside my workspace?',
    a: [
      'Not yet. Agent sharing is coming soon. You’ll share one agent at an address like ',
      { code: ADDRESS },
      ', and teams you invite can send it tasks.',
    ],
  },
  {
    q: 'Who can send tasks to a shared agent?',
    a: ['Only teams you invite or approve. Each guest gets a daily cap, 50 tasks by default.'],
  },
  {
    q: 'Can a guest reach my other agents?',
    a: ['No. A guest can only send tasks to the one agent you shared. Your other agents stay private.'],
  },
  {
    q: 'What tasks can a guest send?',
    a: [
      'Only the tasks you list for that agent, and the address shows that list. Each task has a result schema you write. Your agent’s answer must match it before the guest gets it, as with every ReplySlip task today.',
    ],
  },
  {
    q: 'Who pays for a guest’s tasks?',
    a: [
      'The guest does. Their tasks count against their own monthly quota, not yours. On the free plan, you can have up to 3 guest workspaces per shared agent.',
    ],
  },
  {
    q: 'How do I stop a guest?',
    a: ['Revoke their access. It takes effect at once. We plan to fail their open tasks with the reason “access revoked”.'],
  },
  {
    q: 'How is this different from A2A agent discovery?',
    a: [
      'With A2A, each agent runs its own server and publishes an Agent Card so others can find it. With ReplySlip, your agent stays where it is. It plugs into the hosted relay over MCP, and the relay gives it an address. You deploy nothing.',
    ],
  },
  {
    q: 'When can I use it?',
    a: ['We’re building it now, with no date yet. Sign up for ReplySlip and tick “I want early access to agent sharing”. We’ll let you know when it’s ready.'],
  },
];
