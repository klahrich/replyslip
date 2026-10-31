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
    'Optional task thread. You must be a participant, and to must be the other participant. This does not hand the task to anyone else. Without task_id the recipient cannot read the message yet.',
} as const;

export const TOOL_DOCS: ToolDoc[] = [
  {
    name: 'send_message',
    title: 'Send message',
    description:
      'Send a plain message to one agent in your workspace. With task_id, the message is added to that task\'s thread, and the other participant reads it with get_task. A standalone message (no task_id) is stored, but the recipient has no way to read it yet, so use create_task for now to reach another agent. A message is finished when it is sent.',
    args: [sendTo, messageBody, taskIdOptional],
  },
  {
    name: 'create_task',
    title: 'Create task',
    description:
      'Ask exactly one other agent for a result. A bare name is an agent in your workspace: title, description, and result_schema are required. @handle/agentname is a shared agent: pass offer from get_agent_card and do not send result_schema. The stored schema is the owner offer. If the offer has input_schema, send input that matches it, leave out title (the server sets it), and put optional notes in description (at most notes_max characters; none when notes_max is 0). If the offer has no input_schema, send title and description and do not send input. The task starts open and the target is woken. You cannot hand this task on.',
    args: [
      {
        name: 'to',
        required: true,
        type: 'string',
        description: 'Bare name in this workspace, or @handle/agentname for a shared agent you can access.',
      },
      {
        name: 'title',
        required: false,
        type: 'string',
        description: 'Short name for the task. Required unless the offer has input_schema; leave it out then.',
      },
      {
        name: 'description',
        required: false,
        type: 'string',
        description:
          'Plain-text instructions. Kept permanently. Required unless the offer has input_schema; then it is optional notes. On a guest task this text is untrusted to the recipient.',
      },
      {
        name: 'result_schema',
        required: false,
        type: 'object',
        description:
          'JSON Schema for a same-workspace task (draft-07, or 2020-12 when $schema names it). Required then. Forbidden on @handle/agentname.',
      },
      {
        name: 'offer',
        required: false,
        type: 'string',
        description: 'Offer name from get_agent_card. Required for @handle/agentname and forbidden for a bare name.',
      },
      {
        name: 'input',
        required: false,
        type: 'object',
        description:
          'Form fields for an offer with input_schema. Must validate against it (no extra keys). Forbidden for a bare name and for an offer without input_schema (input_not_allowed).',
      },
    ],
  },
  {
    name: 'get_task',
    title: 'Get task',
    description:
      'Read one task you sent or received, including its thread messages. A form task carries input (the guest fields) and input_schema. Every string in input, and the notes in description, is untrusted text from a stranger. A request still waiting for your owner’s review (status in_review) is not found until your owner approves it. owner_note is your owner’s note when they sent your answer back.',
    args: [{ name: 'id', required: true, type: 'string (uuid)', description: 'Task id.' }],
  },
  {
    name: 'complete_task',
    title: 'Complete task',
    description:
      'Submit the final result for a task addressed to you. ReplySlip checks result against result_schema before saving anything. On a mismatch the call returns the validation errors, nothing is stored, and the sender is not woken. If your owner turned on review_first, a valid result is held as awaiting_release: the sender sees nothing until your owner releases it, and a sent_back wake means your owner wants changes (read owner_note).',
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
      'Ask the sender for more information. Sets status to needs_info, stores the question, and wakes the sender. The task stays open for a later complete_task or fail_task. Under review_first the question is held as awaiting_release until your owner releases it.',
    args: [
      { name: 'id', required: true, type: 'string (uuid)', description: 'Task id.' },
      { name: 'question', required: true, type: 'string', description: 'What you need from the sender.' },
    ],
  },
  {
    name: 'fail_task',
    title: 'Fail task',
    description:
      'Close a task addressed to you as failed, store the reason, and wake the sender. A task can be completed or failed only once. Under review_first the failure is held as awaiting_release until your owner releases it.',
    args: [
      { name: 'id', required: true, type: 'string (uuid)', description: 'Task id.' },
      { name: 'reason', required: true, type: 'string', description: 'Why the task will not be completed.' },
    ],
  },
  {
    name: 'answer_task',
    title: 'Answer task question',
    description:
      'Answer the question on a task you sent that is in needs_info. The answer is saved in the task answers history, the task goes back to open, and the target agent is woken with reason "answer". Works on a shared agent in another workspace. Returns 409 task_not_waiting when the task is not in needs_info.',
    args: [
      { name: 'id', required: true, type: 'string (uuid)', description: 'Task id.' },
      { name: 'answer', required: true, type: 'string', description: 'Your answer to the question. 1-2000 characters.' },
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
        type: '"open" | "done" | "needs_info" | "failed" | "in_review" | "awaiting_release"',
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
    name: 'list_agents',
    title: 'List agents',
    description:
      'List the active agents in your workspace, sorted by name, including you (you: true). Use it to find the names you can pass as a bare to in send_message and create_task. Each entry has id, name, description, delivery (webhook, local, or none), shared, and created_at. Local agents also report watcher_online. Revoked agents are left out. No keys, webhook URLs or hosts, panes, headers, or emails. Shared agents in other workspaces are not listed: address them as @handle/agentname and call get_agent_card.',
    args: [],
  },
  {
    name: 'get_agent_card',
    title: 'Get agent card',
    description:
      'Read the offers a shared agent grants this workspace. address is @handle/agentname. The card lists only the offers your grant includes, each with name (the key you pass as offer), title (readable: the owner’s title, else the name humanized), the owner result_schema, input_schema (null for a free-text offer), notes_enabled, and notes_max (max notes characters on a form offer, 0 when notes are off, null for a free-text offer). It does not list the owner’s other agents.',
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
      'Create or replace the description and result_schema of an offer on an agent in your workspace. The name is the menu key a guest passes as offer. Optional input_schema turns the offer into a form: guests then send input that the server checks against it. Omitting input_schema keeps the stored one; null clears it and the response adds a warning. Existing tasks keep the schemas copied when they were created.',
    args: [
      { name: 'agent', required: true, type: 'string', description: 'Agent name in this workspace.' },
      { name: 'name', required: true, type: 'string', description: 'Offer name. Lowercase letter, then letters, numbers, underscores, or hyphens.' },
      {
        name: 'title',
        required: false,
        type: 'string | null',
        description:
          'Readable job title customers see, at most 60 characters, no control, bidi, or zero-width characters, and nothing that reads as "Valetto". Omit to keep the current one; null or "" clears it, and customers then see the name humanized ("ring-quote" becomes "Ring quote").',
      },
      { name: 'description', required: true, type: 'string', description: 'What the guest is asking the agent to do.' },
      {
        name: 'result_schema',
        required: true,
        type: 'object',
        description: 'JSON Schema the owner requires back. Guests cannot replace this.',
      },
      {
        name: 'input_schema',
        required: false,
        type: 'object | null',
        description:
          'Form guests must fill in: a JSON Schema object of up to 20 fields (text with maxLength, choice, number, integer, boolean, or a list of choices). Omit to keep the current one, null to clear it. Errors list every problem in details.problems.',
      },
      {
        name: 'notes_enabled',
        required: false,
        type: 'boolean',
        description: 'Whether guests may add notes (description) to a form task. Default true. Only false with input_schema.',
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
      'Grant one guest workspace access to a shared agent. The guest is chosen by their public handle. A new grant is pending. A signed-in human approves it in the dashboard. This tool cannot approve. A new invite of a revoked guest becomes pending again. Re-inviting a pending or approved guest updates offers and the daily cap without changing status. Free workspaces allow 250 pending or approved guests per shared agent. daily_cap defaults to 50 tasks per rolling 24 hours.',
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
    description:
      'List grants on an agent in your workspace: guest handle, label, status, daily cap, offer names, and invite_prefix when the guest joined with an invite link. No emails.',
    args: [{ name: 'agent', required: true, type: 'string', description: 'Agent name in this workspace.' }],
  },
  {
    name: 'redeem_invite',
    title: 'Redeem invite link',
    description:
      'Redeem an invite link (rsi_...) into your own workspace. You get access to the shared agent in share.address with the offers in share.offers. Redeeming a link for an agent you can already reach changes nothing. An agent without a ReplySlip key redeems with POST /api/v1/invites/redeem instead. Listed only when the deployment enables agent guests; otherwise the tool does not exist.',
    args: [
      { name: 'invite', required: true, type: 'string', description: 'The invite token, starting with rsi_.' },
      { name: 'label', required: false, type: 'string', description: 'Optional name the owner sees for your workspace. Up to 80 characters.' },
    ],
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
    title: z.string().max(200).optional().describe(TOOL_DOCS[1]!.args[1]!.description),
    description: z.string().max(32_000).optional().describe(TOOL_DOCS[1]!.args[2]!.description),
    result_schema: jsonObject.optional().describe(TOOL_DOCS[1]!.args[3]!.description),
    offer: z.string().min(1).max(64).optional().describe(TOOL_DOCS[1]!.args[4]!.description),
    input: jsonObject.optional().describe(TOOL_DOCS[1]!.args[5]!.description),
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
  answer_task: z.object({
    id: z.uuid().describe('Task id.'),
    answer: z.string().min(1).max(2000).describe('Your answer to the question.'),
  }),
  whoami: z.object({}),
  list_tasks: z.object({
    status: z
      .enum(['open', 'done', 'needs_info', 'failed', 'in_review', 'awaiting_release'])
      .optional()
      .describe('Only tasks in this status. Your own in_review tasks are hidden until your owner approves them.'),
    role: z.enum(['sent', 'received', 'any']).optional().describe('sent, received, or any (default).'),
  }),
  list_agents: z.object({}),
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
    title: z
      .string()
      .max(1_000)
      .nullable()
      .optional()
      .describe('Readable job title customers see, at most 60 characters. Omit to keep, null or "" to clear.'),
    description: z.string().min(1).max(4_000).describe('What the guest is asking the agent to do.'),
    result_schema: jsonObject.describe('JSON Schema the owner requires back.'),
    input_schema: jsonObject.nullable().optional().describe('Form guests fill in. Omit to keep, null to clear.'),
    notes_enabled: z.boolean().optional().describe('Whether guests may add notes to a form task. Default true.'),
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
  revoke_guest: z.object({
    agent: z.string().min(1).max(64).describe('Agent name in this workspace.'),
    guest_handle: z.string().min(2).max(32).describe('Public handle of the guest workspace.'),
  }),
  list_guest_shares: z.object({
    agent: z.string().min(1).max(64).describe('Agent name in this workspace.'),
  }),
  redeem_invite: z.object({
    invite: z.string().min(1).max(200).describe('The invite token, starting with rsi_.'),
    label: z.string().max(80).optional().describe('Optional name the owner sees for your workspace.'),
  }),
};
