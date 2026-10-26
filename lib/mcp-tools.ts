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
  description: 'Name of an agent in this workspace. Messages cannot use @handle/agentname.',
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
      'Ask exactly one other agent for a result. A bare name is an agent in your workspace and result_schema is required. @handle/agentname is a shared agent: pass offer from get_agent_card and do not send result_schema. The stored schema is the owner offer. The task starts open and the target is woken. You cannot hand this task on.',
    args: [
      {
        name: 'to',
        required: true,
        type: 'string',
        description: 'Bare name in this workspace, or @handle/agentname for a shared agent you can access.',
      },
      { name: 'title', required: true, type: 'string', description: 'Short name for the task.' },
      { name: 'description', required: true, type: 'string', description: 'Plain-text instructions. Kept permanently. On a guest task this text is untrusted to the recipient.' },
      {
        name: 'result_schema',
        required: false,
        type: 'object',
        description:
          'JSON Schema for a same-workspace task (draft-07, or 2019-09 / 2020-12 when $schema says so). Required then. Forbidden on @handle/agentname.',
      },
      {
        name: 'offer',
        required: false,
        type: 'string',
        description: 'Offer name from get_agent_card. Required for @handle/agentname and forbidden for a bare name.',
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
      'Report your agent name, id, workspace name, workspace handle, whether you are shared, delivery mode, plan, and usage. Webhook delivery includes only the host. Local delivery also reports watcher_last_seen_at and watcher_online. plan, usage, and limits describe the free cap. No secrets and no URL path.',
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
  {
    name: 'get_agent_card',
    title: 'Get agent card',
    description:
      'Read the offers a shared agent grants this workspace. address is @handle/agentname. The card lists only the offers your grant includes, each with the owner result_schema. It does not list the owner’s other agents.',
    args: [
      {
        name: 'address',
        required: true,
        type: 'string',
        description: 'Shared address @handle/agentname.',
      },
    ],
  },
  {
    name: 'set_workspace_handle',
    title: 'Set workspace handle',
    description:
      'Set this workspace’s public handle, used in @handle/agentname. 2–32 characters: a lowercase letter, then lowercase letters, numbers, or hyphens. Pass null to clear it when no agent is shared. Any agent key in the workspace can call this.',
    args: [{ name: 'handle', required: true, type: 'string | null', description: 'The new handle, or null to clear it.' }],
  },
  {
    name: 'set_agent_sharing',
    title: 'Set agent sharing',
    description:
      'Turn sharing on or off for an agent in your workspace. Sharing requires a workspace handle. Turning it off fails open guest tasks with reason "access revoked" and wakes those senders. The address becomes @handle/agentname.',
    args: [
      { name: 'agent', required: true, type: 'string', description: 'Agent name in this workspace.' },
      { name: 'shared', required: true, type: 'boolean', description: 'True to share the agent. False to stop sharing it.' },
    ],
  },
  {
    name: 'upsert_offer',
    title: 'Upsert offer',
    description:
      'Create or replace the description and result_schema of an offer on an agent in your workspace. The name is the menu key a guest passes as offer. Existing tasks keep the schema copied when they were created.',
    args: [
      { name: 'agent', required: true, type: 'string', description: 'Agent name in this workspace.' },
      { name: 'name', required: true, type: 'string', description: 'Offer name. Lowercase letter, then letters, numbers, underscores, or hyphens.' },
      { name: 'description', required: true, type: 'string', description: 'What the guest is asking the agent to do.' },
      {
        name: 'result_schema',
        required: true,
        type: 'object',
        description: 'JSON Schema the owner requires back. Guests cannot replace this.',
      },
    ],
  },
  {
    name: 'delete_offer',
    title: 'Delete offer',
    description: 'Delete an offer that no task has used. Offers copied onto a task cannot be deleted.',
    args: [
      { name: 'agent', required: true, type: 'string', description: 'Agent name in this workspace.' },
      { name: 'name', required: true, type: 'string', description: 'Offer name.' },
    ],
  },
  {
    name: 'invite_guest',
    title: 'Invite guest',
    description:
      'Grant one guest workspace access to a shared agent. The guest is chosen by their public handle. Status starts pending until approve_guest. A new invite of a revoked guest becomes pending again. Re-inviting a pending or approved guest updates offers and the daily cap without changing status. Free workspaces allow 3 pending or approved guests per shared agent. daily_cap defaults to 50 tasks per rolling 24 hours.',
    args: [
      { name: 'agent', required: true, type: 'string', description: 'Agent name in this workspace.' },
      { name: 'guest_handle', required: true, type: 'string', description: 'Public handle of the guest workspace.' },
      { name: 'offers', required: true, type: 'string[]', description: 'Offer names this guest may use.' },
      {
        name: 'daily_cap',
        required: false,
        type: 'integer',
        description: 'Tasks this guest may create per rolling 24 hours. Default 50. Maximum 10000.',
      },
    ],
  },
  {
    name: 'approve_guest',
    title: 'Approve guest',
    description: 'Approve a pending grant so that guest workspace can create tasks for the shared agent. A revoked grant must be invited again.',
    args: [
      { name: 'agent', required: true, type: 'string', description: 'Agent name in this workspace.' },
      { name: 'guest_handle', required: true, type: 'string', description: 'Public handle of the guest workspace.' },
    ],
  },
  {
    name: 'revoke_guest',
    title: 'Revoke guest',
    description:
      'Revoke a guest workspace immediately. Open and needs_info tasks from that guest to this agent fail with reason "access revoked", and each guest sender is woken.',
    args: [
      { name: 'agent', required: true, type: 'string', description: 'Agent name in this workspace.' },
      { name: 'guest_handle', required: true, type: 'string', description: 'Public handle of the guest workspace.' },
    ],
  },
  {
    name: 'list_guest_shares',
    title: 'List guest shares',
    description: 'List grants on an agent in your workspace: guest handle, status, daily cap, and offer names. No emails.',
    args: [{ name: 'agent', required: true, type: 'string', description: 'Agent name in this workspace.' }],
  },
];

const jsonObject = z.record(z.string(), z.json());

export const toolInputs = {
  send_message: z.object({
    to: z.string().min(1).max(98).describe(sendTo.description),
    body: z.string().min(1).max(32_000).describe(messageBody.description),
    task_id: z.uuid().optional().describe(taskIdOptional.description),
  }),
  create_task: z.object({
    to: z.string().min(1).max(98).describe(TOOL_DOCS[1]!.args[0]!.description),
    title: z.string().min(1).max(200).describe(TOOL_DOCS[1]!.args[1]!.description),
    description: z.string().min(1).max(32_000).describe(TOOL_DOCS[1]!.args[2]!.description),
    result_schema: jsonObject.optional().describe(TOOL_DOCS[1]!.args[3]!.description),
    offer: z.string().min(1).max(64).optional().describe(TOOL_DOCS[1]!.args[4]!.description),
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
  get_agent_card: z.object({
    address: z.string().min(1).max(98).describe('Shared address @handle/agentname.'),
  }),
  set_workspace_handle: z.object({
    handle: z.string().min(2).max(32).nullable().describe('The new handle, or null to clear it.'),
  }),
  set_agent_sharing: z.object({
    agent: z.string().min(1).max(64).describe('Agent name in this workspace.'),
    shared: z.boolean().describe('True to share the agent. False to stop sharing it.'),
  }),
  upsert_offer: z.object({
    agent: z.string().min(1).max(64).describe('Agent name in this workspace.'),
    name: z.string().min(1).max(64).describe('Offer name.'),
    description: z.string().min(1).max(4_000).describe('What the guest is asking the agent to do.'),
    result_schema: jsonObject.describe('JSON Schema the owner requires back.'),
  }),
  delete_offer: z.object({
    agent: z.string().min(1).max(64).describe('Agent name in this workspace.'),
    name: z.string().min(1).max(64).describe('Offer name.'),
  }),
  invite_guest: z.object({
    agent: z.string().min(1).max(64).describe('Agent name in this workspace.'),
    guest_handle: z.string().min(2).max(32).describe('Public handle of the guest workspace.'),
    offers: z.array(z.string().min(1).max(64)).min(1).max(50).describe('Offer names this guest may use.'),
    daily_cap: z.number().int().min(1).max(10_000).optional().describe('Tasks per rolling 24 hours. Default 50.'),
  }),
  approve_guest: z.object({
    agent: z.string().min(1).max(64).describe('Agent name in this workspace.'),
    guest_handle: z.string().min(2).max(32).describe('Public handle of the guest workspace.'),
  }),
  revoke_guest: z.object({
    agent: z.string().min(1).max(64).describe('Agent name in this workspace.'),
    guest_handle: z.string().min(2).max(32).describe('Public handle of the guest workspace.'),
  }),
  list_guest_shares: z.object({
    agent: z.string().min(1).max(64).describe('Agent name in this workspace.'),
  }),
};
