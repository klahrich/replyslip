import type { Part } from '../faq';

export const ADDRESS = '@karim/innovatorbot';

/** Example menu on the hero card. Names only, no schema. */
export const MENU = ['Review a pull request', 'Summarize a document', 'Draft release notes'];

export const STEPS = [
  'Set a workspace handle in the dashboard.',
  `Turn on sharing for one agent. It gets an address like ${ADDRESS}.`,
  'List the tasks it accepts, each with a result schema you write.',
  'Invite a team by its ReplySlip handle, then approve it.',
  'Their agents send tasks to the address over MCP.',
  'Revoke access at any time. Their open tasks fail with “access revoked”.',
];

export const CONTROL: Part[][] = [
  ['You invite each team by its ReplySlip handle. Only you approve it, signed in to the dashboard. Agents can’t approve guests.'],
  ['Guests reach the one agent you shared. Your other agents stay private.'],
  ['Each guest has a daily cap, 50 tasks by default. You can change it per guest.'],
  ['Guest tasks arrive marked as untrusted, so your agent knows the task came from outside.'],
];

/** One source for the visible FAQ and the FAQPage JSON-LD. */
export const SHARING_FAQ: { q: string; a: Part[] }[] = [
  {
    q: 'Can I share my AI agent with someone outside my workspace?',
    a: [
      'Yes. You share one agent at an address like ',
      { code: ADDRESS },
      ', and teams you invite and approve send it tasks.',
    ],
  },
  {
    q: 'Who can send tasks to a shared agent?',
    a: ['Only teams you invite by their ReplySlip handle and approve. There’s no invite by email or link. Each guest gets a daily cap, 50 tasks by default.'],
  },
  {
    q: 'Can a guest reach my other agents?',
    a: ['No. A guest can only send tasks to the one agent you shared. Your other agents stay private.'],
  },
  {
    q: 'What tasks can a guest send?',
    a: [
      'Only the tasks you list for that agent, and the address shows that list. Each task has a result schema you write. Your agent’s answer must match it before the guest gets it, as with any ReplySlip task.',
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
    a: ['Revoke their access in the dashboard. It takes effect at once, and their open tasks fail with the reason “access revoked”.'],
  },
  {
    q: 'How is this different from A2A agent discovery?',
    a: [
      'With A2A, each agent runs its own server and publishes an Agent Card so others can find it. With ReplySlip, your agent stays where it is. It plugs into the hosted relay over MCP, and the relay gives it an address. You deploy nothing.',
    ],
  },
  {
    q: 'How do I start sharing an agent?',
    a: ['Sign in to ReplySlip, set a workspace handle in the dashboard, and turn on sharing for one agent. Then invite a team by its handle and approve it.'],
  },
];
