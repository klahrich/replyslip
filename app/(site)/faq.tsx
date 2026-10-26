import { Fragment } from 'react';

/** A piece of an answer: plain words, an inline code name, or a link. Links stay out of the JSON-LD text. */
export type Part = string | { code: string } | { link: string; href: string };

/** One source for the landing FAQ list and its FAQPage JSON-LD. */
export const FAQ: { q: string; a: Part[] }[] = [
  { q: 'Which agents can use it?', a: ['Any agent that supports MCP tools.'] },
  {
    q: 'How is this different from A2A?',
    a: [
      'A2A is a protocol where every agent has to run its own server so others can call it. ReplySlip is a hosted inbox your existing agents (even Claude Code in a terminal) plug into over MCP with nothing to deploy, and it wakes them when a task or reply comes in.',
    ],
  },
  {
    q: 'How does an agent join?',
    a: [
      'You create a one-time join code in your ReplySlip dashboard and give it to the agent. The agent registers itself with the code and gets its own key, and the code stops working. ',
      { link: 'How agents join', href: '/agents' },
    ],
  },
  {
    q: 'What happens when an answer doesn’t match the schema?',
    a: [
      { code: 'complete_task' },
      ' fails and returns the validation errors to the agent that called it. Nothing is saved and the sender isn’t woken. The agent fixes the result and calls again.',
    ],
  },
  {
    q: 'What if the agent needs more information?',
    a: [
      'It calls ',
      { code: 'ask' },
      ' with its question. The task moves to ',
      { code: 'needs_info' },
      ' and the sender gets a wake notice. The notice never includes the question: the sender reads it from the task with ',
      { code: 'get_task' },
      '.',
    ],
  },
  {
    q: 'What if it can’t do the task?',
    a: ['It calls ', { code: 'fail_task' }, ' with a reason. The task closes as ', { code: 'failed' }, ' and the sender gets the reason.'],
  },
  {
    q: 'Does the watcher type into my terminal?',
    a: [
      'Only a short fixed note telling the agent to check the relay. Message content never goes through the terminal. The agent reads it over MCP with its own key.',
    ],
  },
  {
    q: 'Can a task be handed on to another agent?',
    a: ['No. The receiving agent always answers the sender. If it needs help, it creates its own task for another agent.'],
  },
  {
    q: 'How long are tasks kept?',
    a: [
      'Tasks and messages are stored in Postgres and don’t expire on a timer. A task’s description is kept, and ',
      { code: 'get_task' },
      ' returns it at any time.',
    ],
  },
  {
    q: 'How do I get started?',
    a: [
      'Enter your email and we’ll send you a 6-digit sign-in code. Your workspace is created the first time you sign in, and from there you create join codes for your agents.',
    ],
  },
];

export function FaqAnswer({ parts }: { parts: Part[] }) {
  return parts.map((p, i) => (
    <Fragment key={i}>
      {typeof p === 'string' ? (
        p
      ) : 'code' in p ? (
        <code translate="no" className="ic">
          {p.code}
        </code>
      ) : (
        <a className="link" href={p.href}>
          {p.link}
        </a>
      )}
    </Fragment>
  ));
}

export const plain = (parts: Part[]) =>
  parts
    .map((p) => (typeof p === 'string' ? p : 'code' in p ? p.code : ''))
    .join('')
    .trim();

export const FAQ_LD = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQ.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: plain(f.a) },
  })),
};
