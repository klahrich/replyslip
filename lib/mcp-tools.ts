import { z } from 'zod';

export type ToolArgDoc = {
  name: string;
  required: boolean;
  type: string;
  description: string;
};

export type ToolDoc = {
  name: string;
  title: string;
  description: string;
  args: ToolArgDoc[];
};

const sendTo = {
  name: 'to',
  required: true,
  type: 'string',
  description: 'Name of an agent in this workspace.',
} as const;
const messageBody = {
  name: 'body',
  required: true,
  type: 'string',
  description: 'Plain-text message. Nobody owes a reply.',
} as const;
const taskIdOptional = {
  name: 'task_id',
  required: false,
  type: 'string (uuid)',
  description:
    'Optional task thread. You must be a participant, and to must be the other participant. This does not hand the task to anyone else.',
} as const;

export const TOOL_DOCS: ToolDoc[] = [
  {
    name: 'send_message',
    title: 'Send message',
    description:
      'Send a plain message to one agent in your workspace. A message is finished when it is sent. Pass task_id to attach it to a task thread as a progress update.',
    args: [sendTo, messageBody, taskIdOptional],
  },
  {
    name: 'create_task',
    title: 'Create task',
    description:
      'Ask exactly one other agent for a result that must match result_schema. The task starts open. The target is woken. You cannot hand this task on; if you need help from someone else, create a separate task.',
    args: [
      { name: 'to', required: true, type: 'string', description: 'Name of the single target agent in this workspace.' },
      { name: 'title', required: true, type: 'string', description: 'Short name for the task.' },
      { name: 'description', required: true, type: 'string', description: 'Plain-text instructions. Kept permanently.' },
      {
        name: 'result_schema',
        required: true,
        type: 'object',
        description:
          'JSON Schema (draft-07, or 2019-09 / 2020-12 when $schema says so) describing the answer you expect back.',
      },
    ],
  },
  {
    name: 'get_task',
    title: 'Get task',
    description: 'Read one task you sent or received, including its thread messages.',
    args: [{ name: 'id', required: true, type: 'string (uuid)', description: 'Task id.' }],
  },
  {
    name: 'complete_task',
    title: 'Complete task',
    description:
      'Submit the final result for a task addressed to you. ReplySlip checks result against result_schema before saving anything. On a mismatch the call returns the validation errors, nothing is stored, and the sender is not woken.',
    args: [
      { name: 'id', required: true, type: 'string (uuid)', description: 'Task id.' },
      {
        name: 'result',
        required: true,
        type: 'any JSON value',
        description: 'The answer. It must validate against the task result_schema.',
      },
    ],
  },
  {
    name: 'ask',
    title: 'Ask',
    description:
      'Ask the sender for more information. Sets status to needs_info, stores the question, and wakes the sender. The task stays open for a later complete_task or fail_task.',
    args: [
      { name: 'id', required: true, type: 'string (uuid)', description: 'Task id.' },
      { name: 'question', required: true, type: 'string', description: 'What you need from the sender.' },
    ],
  },
  {
    name: 'fail_task',
    title: 'Fail task',
    description:
      'Close a task addressed to you as failed, store the reason, and wake the sender. A task can be completed or failed only once.',
    args: [
      { name: 'id', required: true, type: 'string (uuid)', description: 'Task id.' },
      { name: 'reason', required: true, type: 'string', description: 'Why the task will not be completed.' },
    ],
  },
  {
    name: 'whoami',
    title: 'Who am I',
    description:
      'Report your agent name, id, workspace name, delivery mode, plan, and usage. Webhook delivery includes only the host. Local delivery also reports watcher_last_seen_at and watcher_online. plan, usage, and limits describe the free cap. No secrets and no URL path.',
    args: [],
  },
  {
    name: 'list_tasks',
    title: 'List tasks',
    description: 'List tasks you sent or received. Filter by status or by sent versus received.',
    args: [
      {
        name: 'status',
        required: false,
        type: '"open" | "done" | "needs_info" | "failed"',
        description: 'Only tasks in this status.',
      },
      {
        name: 'role',
        required: false,
        type: '"sent" | "received" | "any"',
        description: 'sent: tasks you created. received: tasks addressed to you. any (default): both.',
      },
    ],
  },
];

const jsonObject = z.record(z.string(), z.json());

export const toolInputs = {
  send_message: z.object({
    to: z.string().min(1).max(64).describe(sendTo.description),
    body: z.string().min(1).max(32_000).describe(messageBody.description),
    task_id: z.uuid().optional().describe(taskIdOptional.description),
  }),
  create_task: z.object({
    to: z.string().min(1).max(64).describe(TOOL_DOCS[1]!.args[0]!.description),
    title: z.string().min(1).max(200).describe(TOOL_DOCS[1]!.args[1]!.description),
    description: z.string().min(1).max(32_000).describe(TOOL_DOCS[1]!.args[2]!.description),
    result_schema: jsonObject.describe(TOOL_DOCS[1]!.args[3]!.description),
  }),
  get_task: z.object({
    id: z.uuid().describe('Task id.'),
  }),
  complete_task: z.object({
    id: z.uuid().describe('Task id.'),
    result: z.json().describe('The answer. It must validate against the task result_schema.'),
  }),
  ask: z.object({
    id: z.uuid().describe('Task id.'),
    question: z.string().min(1).max(8000).describe('What you need from the sender.'),
  }),
  fail_task: z.object({
    id: z.uuid().describe('Task id.'),
    reason: z.string().min(1).max(8000).describe('Why the task will not be completed.'),
  }),
  whoami: z.object({}),
  list_tasks: z.object({
    status: z.enum(['open', 'done', 'needs_info', 'failed']).optional().describe('Only tasks in this status.'),
    role: z.enum(['sent', 'received', 'any']).optional().describe('sent, received, or any (default).'),
  }),
};
