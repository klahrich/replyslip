/** Static example code for the landing page, kept as HTML so whitespace and highlighting match the draft. */

export const FRAMES = [
  `<code translate="no"><span class="c">// builder asks reviewer</span>
<span class="k">create_task</span>({
  to: <span class="s">"reviewer"</span>,
  title: <span class="s">"Review the signup migration"</span>,
  description: <span class="s">"Read migrations/0042_signup.sql.
    Approve it or list what must change."</span>,
  result_schema: {
    type: <span class="s">"object"</span>,
    required: [<span class="s">"verdict"</span>, <span class="s">"issues"</span>],
    additionalProperties: false,
    properties: {
      verdict: { enum: [<span class="s">"approve"</span>, <span class="s">"request_changes"</span>] },
      issues: { type: <span class="s">"array"</span>, items: { type: <span class="s">"string"</span> } }
    }
  }
})

<span class="ok">→ { id: "task_7Kq2", status: "open" }</span>
<span class="c">  reviewer is woken</span></code>`,
  `<code translate="no"><span class="c">// reviewer answers, first try</span>
<span class="k">complete_task</span>({
  id: <span class="s">"task_7Kq2"</span>,
  result: {
    verdict: <span class="s">"looks fine"</span>,
    notes: <span class="s">"one nit in the index name"</span>
  }
})

<span class="e">error: result does not match result_schema
  /verdict  must be one of "approve", "request_changes"
  /         must have required property "issues"
  /notes    must NOT have additional properties</span>
<span class="c">  Nothing saved. builder not woken.</span></code>`,
  `<code translate="no"><span class="c">// reviewer fixes it and calls again</span>
<span class="k">complete_task</span>({
  id: <span class="s">"task_7Kq2"</span>,
  result: {
    verdict: <span class="s">"request_changes"</span>,
    issues: [
      <span class="s">"users.email loses its NOT NULL constraint"</span>
    ]
  }
})

<span class="ok">→ { id: "task_7Kq2", status: "done" }</span>
<span class="c">  Result saved. builder is woken and reads it
  with get_task("task_7Kq2").</span></code>`,
];

export type ToolCard = { sig: string; by: string; text: string; code: string };

/** Seven of the eight tools (whoami and the docs/API.md order live in app/(site)/tool-list.ts), grouped by side. */
export const TOOL_GROUPS: { title: string; tools: string[] }[] = [
  { title: 'The sender hands off', tools: ['create_task'] },
  { title: 'The receiving agent answers', tools: ['complete_task', 'ask', 'fail_task'] },
  { title: 'Either side reads and talks', tools: ['get_task', 'send_message', 'list_tasks'] },
];

export const TOOLS: ToolCard[] = [
  {
    sig: 'create_task(to, title, description, result_schema)',
    by: 'Sender',
    text: 'Opens a task for one named agent, with the shape of the answer.',
    code: '→ { id: "task_7Kq2", status: "open" }',
  },
  {
    sig: 'complete_task(id, result)',
    by: 'Receiving agent only',
    text: 'Checks the result against the schema, saves it, and marks the task done.',
    code: '→ { status: "done" }\n<span class="c">or the validation errors</span>',
  },
  {
    sig: 'ask(id, question)',
    by: 'Receiving agent only',
    text: 'Moves the task to needs_info and wakes the sender, who reads the question with get_task.',
    code: 'ask("task_9Rw1",\n  "0.4 or 0.4.1? Both tags exist.")',
  },
  {
    sig: 'fail_task(id, reason)',
    by: 'Receiving agent only',
    text: 'Closes the task as failed and gives the sender the reason.',
    code: 'fail_task("task_3Mz8",\n  "No write access to deploy/")',
  },
  {
    sig: 'get_task(id)',
    by: 'Sender or receiver',
    text: 'Returns the task, its full description and its thread messages.',
    code: '→ { title, description, status,\n    result, messages: [ … ] }',
  },
  {
    sig: 'send_message(to, body, task_id?)',
    by: 'Any agent',
    text: 'Plain messages. A progress update carries the task_id so it lands in the task’s thread.',
    code: 'send_message("builder",\n  "Halfway through the diff",\n  "task_7Kq2")',
  },
  {
    sig: 'list_tasks(status?, role?)',
    by: 'Any agent',
    text: 'Lists your tasks. Filter by status, and by sent, received or any.',
    code: 'list_tasks({ status: "open",\n  role: "received" })',
  },
];
