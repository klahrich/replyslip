import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as cronRoute } from '@/app/api/cron/wakes/route';
import { POST as answerRequestRoute } from '@/app/api/v1/c/requests/[task_id]/answer/route';
import { PUT as putBrandingRoute } from '@/app/api/v1/agents/[id]/branding/route';
import { GET as listSharesRoute } from '@/app/api/v1/agents/[id]/shares/route';
import { PUT as putReviewModeRoute } from '@/app/api/v1/agents/[id]/review-mode/route';
import { POST as reviewActionRoute } from '@/app/api/v1/reviews/[id]/[action]/route';
import { GET as workspaceTaskRoute } from '@/app/api/v1/tasks/[id]/route';
import { GET as workspaceTasksRoute } from '@/app/api/v1/tasks/route';
import {
  customerUpdateSubject,
  customerUpdateText,
  fromHeader,
  getEmailSender,
  loginCodeText,
  pendingCustomersText,
  reviewNeededText,
  setEmailSenderForTests,
} from '@/lib/email';
import { getDb } from '@/db';
import { rateEvents } from '@/db/schema';
import { CUSTOMER_UPDATE_EMAIL_LIMIT } from '@/lib/constants';
import { flushFirstAgentAlerts } from '@/lib/first-agent-alert';
import { approvedCustomer, directRequest, ORIGIN, owner, type Customer, type Owner } from './customer-fixtures';
import { call, createAgent, createKey, mcpTool, setHerdr } from './helpers';
import { customerUpdates, installInbox } from './inbox';

const base = 'http://localhost/api/v1';
/** Canonical origin first; localhost listed so the test requests pass the Origin check. */
const APP_ORIGIN = 'https://valetto.tech,http://localhost';
const requestUrl = (o: Owner, taskId: string) => `https://valetto.tech/c/${o.agentId}/r/${taskId}`;

beforeEach(() => {
  vi.stubEnv('APP_ORIGIN', APP_ORIGIN);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const draftResult = { type: 'object', additionalProperties: false, required: ['headline'], properties: { headline: { type: 'string' } } };

async function brand(o: Owner, displayName: string) {
  const res = await call(putBrandingRoute, `${base}/agents/${o.agentId}/branding`, {
    method: 'PUT',
    cookie: o.cookie,
    params: { id: o.agentId },
    body: { display_name: displayName },
    headers: ORIGIN,
  });
  expect(res.status, res.text).toBe(200);
}

async function reviewFirst(o: Owner) {
  await setHerdr(o.cookie, o.agentId, `pane-${randomUUID().slice(0, 8)}`);
  const res = await call(putReviewModeRoute, `${base}/agents/${o.agentId}/review-mode`, {
    method: 'PUT',
    cookie: o.cookie,
    params: { id: o.agentId },
    body: { review_mode: 'review_first' },
    headers: ORIGIN,
  });
  expect(res.status, res.text).toBe(200);
}

const act = (o: Owner, id: string, action: string, body: Record<string, unknown> = {}) =>
  call(reviewActionRoute, `${base}/reviews/${id}/${action}`, {
    method: 'POST',
    cookie: o.cookie,
    params: { id, action },
    body,
    headers: ORIGIN,
  });

/** Emails sent to this customer, after every after-response task has run. */
async function mailFor(c: Customer) {
  await flushFirstAgentAlerts();
  return customerUpdates.filter((m) => m.to === c.email.toLowerCase());
}

async function setup(name = 'Acme Tables') {
  const o = await owner();
  await brand(o, name);
  const c = await approvedCustomer(o);
  return { o, c };
}

describe('customer update emails', () => {
  it('emails the customer when the bot asks a question, with only the business, title, and link', async () => {
    const { o, c } = await setup();
    const task = await directRequest(o, c, 'CANARY-NOTES');
    expect(await mailFor(c)).toHaveLength(0);
    const asked = await mcpTool(o.agentKey, 'ask', { id: task.id, question: 'CANARY-QUESTION which tone?' });
    expect(asked.isError).toBe(false);
    const sent = await mailFor(c);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      to: c.email.toLowerCase(),
      kind: 'question',
      businessName: 'Acme Tables',
      requestTitle: 'Draft',
      requestUrl: requestUrl(o, task.id),
    });
    const text = customerUpdateText(sent[0]!);
    expect(text).toContain('Your request "Draft" has an update: Acme Tables has a question.');
    expect(text).toContain(`Open your request: https://valetto.tech/c/${o.agentId}/r/${task.id}`);
    expect(text).toContain('Valetto');
    expect(JSON.stringify(sent) + text).not.toMatch(/CANARY/);
    expect(customerUpdateSubject(sent[0]!)).toBe('Valetto: Acme Tables has a question about your request');
  });

  it('emails on a result without the result text, and links on the canonical origin', async () => {
    const { o, c } = await setup();
    const task = await directRequest(o, c);
    vi.stubEnv('APP_ORIGIN', 'https://valetto.tech,https://www.replyslip.com');
    try {
      const done = await mcpTool(o.agentKey, 'complete_task', { id: task.id, result: { headline: 'CANARY-RESULT' } });
      expect(done.isError).toBe(false);
      const sent = await mailFor(c);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ kind: 'result', requestUrl: `https://valetto.tech/c/${o.agentId}/r/${task.id}` });
      const text = customerUpdateText(sent[0]!);
      expect(text).toContain('Your request "Draft" has an update: Your result is ready.');
      expect(text + customerUpdateSubject(sent[0]!)).not.toContain('CANARY-RESULT');
      expect(text).not.toContain('replyslip');
      expect(customerUpdateSubject(sent[0]!)).toBe('Valetto: your result from Acme Tables is ready');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('emails on a failure without the reason, once, and never on a retry', async () => {
    const { o, c } = await setup();
    const task = await directRequest(o, c);
    const failed = await mcpTool(o.agentKey, 'fail_task', { id: task.id, reason: 'CANARY-REASON out of stock' });
    expect(failed.isError).toBe(false);
    const again = await mcpTool(o.agentKey, 'fail_task', { id: task.id, reason: 'CANARY-REASON again' });
    expect(again.isError).toBe(true);
    const late = await mcpTool(o.agentKey, 'complete_task', { id: task.id, result: { headline: 'late' } });
    expect(late.isError).toBe(true);
    const sent = await mailFor(c);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.kind).toBe('failure');
    const text = customerUpdateText(sent[0]!);
    expect(text).toContain('Acme Tables closed this request without a result.');
    expect(text).not.toContain('CANARY');
  });

  it('emails once per new question, not for the customer answer, then once for the result', async () => {
    const { o, c } = await setup();
    const task = await directRequest(o, c);
    expect((await mcpTool(o.agentKey, 'ask', { id: task.id, question: 'First?' })).isError).toBe(false);
    const answered = await call(answerRequestRoute, `${base}/c/requests/${task.id}/answer`, {
      cookie: c.cookie,
      params: { task_id: task.id },
      body: { answer: 'Bold.' },
      headers: ORIGIN,
    });
    expect(answered.status, answered.text).toBe(200);
    expect((await mailFor(c)).map((m) => m.kind)).toEqual(['question']);
    expect((await mcpTool(o.agentKey, 'ask', { id: task.id, question: 'Second?' })).isError).toBe(false);
    expect((await mcpTool(o.agentKey, 'complete_task', { id: task.id, result: { headline: 'ok' } })).isError).toBe(false);
    expect((await mailFor(c)).map((m) => m.kind)).toEqual(['question', 'question', 'result']);
  });

  it('sends nothing while an answer is held under review_first, then one email on release', async () => {
    const o = await owner();
    await brand(o, 'Acme Tables');
    await reviewFirst(o);
    const c = await approvedCustomer(o);
    const task = await directRequest(o, c);
    expect(task.status).toBe('in_review');
    expect((await act(o, task.id, 'approve')).status).toBe(200);
    const done = await mcpTool(o.agentKey, 'complete_task', { id: task.id, result: { headline: 'CANARY-HELD' } });
    expect(done.isError).toBe(false);
    expect(done.payload.task.status).toBe('awaiting_release');
    expect(await mailFor(c)).toHaveLength(0);

    const released = await act(o, task.id, 'release');
    expect(released.status, released.text).toBe(200);
    const replay = await act(o, task.id, 'release');
    expect(replay.status).not.toBe(200);
    const sent = await mailFor(c);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.kind).toBe('result');
    expect(JSON.stringify(sent) + customerUpdateText(sent[0]!)).not.toContain('CANARY-HELD');
  });

  it('holds a question until release, and emails a decline as a failure', async () => {
    const o = await owner();
    await reviewFirst(o);
    const c = await approvedCustomer(o);
    const asking = await directRequest(o, c);
    await act(o, asking.id, 'approve');
    await mcpTool(o.agentKey, 'ask', { id: asking.id, question: 'CANARY-Q' });
    expect(await mailFor(c)).toHaveLength(0);
    expect((await act(o, asking.id, 'release')).status).toBe(200);
    expect((await mailFor(c)).map((m) => m.kind)).toEqual(['question']);

    const declined = await directRequest(o, c);
    expect((await act(o, declined.id, 'decline')).status).toBe(200);
    const sent = await mailFor(c);
    expect(sent.map((m) => m.kind)).toEqual(['question', 'failure']);
    expect(sent[1]!.requestUrl).toContain(declined.id);
  });

  it('never emails for an agent-to-agent task', async () => {
    const o = await owner();
    const helper = await createAgent(o.cookie, 'Helper');
    const helperKey = await createKey(o.cookie, helper.id);
    const before = customerUpdates.length;
    const created = await mcpTool(helperKey, 'create_task', {
      to: 'Grok',
      title: 'Internal',
      description: 'Return a headline.',
      result_schema: draftResult,
    });
    expect(created.isError).toBe(false);
    const id = created.payload.task.id as string;
    await mcpTool(o.agentKey, 'ask', { id, question: 'Which?' });
    await mcpTool(helperKey, 'answer', { id, answer: 'Any.' }).catch(() => null);
    await mcpTool(o.agentKey, 'fail_task', { id, reason: 'no' });
    await flushFirstAgentAlerts();
    expect(customerUpdates.length).toBe(before);
  });

  it('a failing email does not fail the request', async () => {
    const { o, c } = await setup();
    const task = await directRequest(o, c);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const real = getEmailSender();
    setEmailSenderForTests({
      ...real,
      sendLoginCode: real.sendLoginCode.bind(real),
      async sendCustomerUpdate() {
        throw new Error('provider down');
      },
    });
    try {
      const done = await mcpTool(o.agentKey, 'complete_task', { id: task.id, result: { headline: 'ok' } });
      expect(done.isError).toBe(false);
      expect(done.payload.task.status).toBe('done');
      await flushFirstAgentAlerts();
      expect(error).toHaveBeenCalledWith(expect.stringContaining('customer update notice failed'));
      expect(String(error.mock.calls.at(-1)?.[0])).not.toContain(c.email.toLowerCase());
    } finally {
      error.mockRestore();
      installInbox();
    }
  });
});

describe('customer update emails: limits, origin, and review steps', () => {
  it('sends nothing and logs without the address when APP_ORIGIN is unset; never a bare path', async () => {
    const { o, c } = await setup();
    const task = await directRequest(o, c);
    vi.stubEnv('APP_ORIGIN', '');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const done = await mcpTool(o.agentKey, 'complete_task', { id: task.id, result: { headline: 'ok' } });
    expect(done.isError).toBe(false);
    expect(await mailFor(c)).toHaveLength(0);
    const logged = error.mock.calls.map((call) => String(call[0])).filter((line) => line.includes('customer update notice skipped'));
    expect(logged).toHaveLength(1);
    expect(logged[0]).not.toContain(c.email.toLowerCase());
    expect(customerUpdates.some((m) => !m.requestUrl.startsWith('https://'))).toBe(false);
  });

  it(`caps a customer at ${CUSTOMER_UPDATE_EMAIL_LIMIT.limit} an hour and logs the drop without the address`, async () => {
    const { o, c } = await setup();
    const key = c.user.id as string;
    await getDb()
      .insert(rateEvents)
      .values(Array.from({ length: CUSTOMER_UPDATE_EMAIL_LIMIT.limit - 1 }, () => ({ kind: CUSTOMER_UPDATE_EMAIL_LIMIT.kind, email: key, ip: null })));
    const last = await directRequest(o, c);
    const over = await directRequest(o, c);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await mcpTool(o.agentKey, 'fail_task', { id: last.id, reason: 'no' })).isError).toBe(false);
    expect((await mcpTool(o.agentKey, 'fail_task', { id: over.id, reason: 'no' })).isError).toBe(false);
    const sent = await mailFor(c);
    expect(sent.map((m) => m.requestUrl)).toEqual([requestUrl(o, last.id)]);
    const dropped = warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes('customer update notice dropped'));
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toContain(over.id);
    expect(dropped[0]).not.toContain(c.email.toLowerCase());
  });

  it('the daily cron prunes cap rows older than a day, not newer ones', async () => {
    const key = randomUUID();
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await getDb().insert(rateEvents).values([
      { kind: CUSTOMER_UPDATE_EMAIL_LIMIT.kind, email: key, ip: null, createdAt: old },
      { kind: CUSTOMER_UPDATE_EMAIL_LIMIT.kind, email: key, ip: null },
    ]);
    const res = await cronRoute(new Request('http://localhost/api/cron/wakes', { headers: { authorization: 'Bearer test-cron-secret' } }));
    expect(res.status).toBe(200);
    expect((await res.json()).customer_email_events_pruned).toBeGreaterThanOrEqual(1);
    const left = await getDb()
      .select()
      .from(rateEvents)
      .where(and(eq(rateEvents.kind, CUSTOMER_UPDATE_EMAIL_LIMIT.kind), eq(rateEvents.email, key)));
    expect(left).toHaveLength(1);
  });

  it('emails a new question on a request already waiting on one, but not a replayed identical ask', async () => {
    const { o, c } = await setup();
    const task = await directRequest(o, c);
    expect((await mcpTool(o.agentKey, 'ask', { id: task.id, question: 'Which tone?' })).isError).toBe(false);
    expect((await mcpTool(o.agentKey, 'ask', { id: task.id, question: 'Which tone?' })).isError).toBe(false);
    expect((await mcpTool(o.agentKey, 'ask', { id: task.id, question: 'And which length?' })).isError).toBe(false);
    expect((await mailFor(c)).map((m) => m.kind)).toEqual(['question', 'question']);
  });

  it('emails each released question on the same request under review_first', async () => {
    const o = await owner();
    await reviewFirst(o);
    const c = await approvedCustomer(o);
    const task = await directRequest(o, c);
    await act(o, task.id, 'approve');
    await mcpTool(o.agentKey, 'ask', { id: task.id, question: 'CANARY first?' });
    expect((await act(o, task.id, 'release')).status).toBe(200);
    // A second question while the first is still unanswered, held and then released.
    expect((await mcpTool(o.agentKey, 'ask', { id: task.id, question: 'CANARY second?' })).isError).toBe(false);
    expect(await mailFor(c)).toHaveLength(1);
    expect((await act(o, task.id, 'release')).status).toBe(200);
    const sent = await mailFor(c);
    expect(sent.map((m) => m.kind)).toEqual(['question', 'question']);
    expect(JSON.stringify(sent)).not.toContain('CANARY');
  });

  it('sends nothing on send back, then one email when the redone answer is released', async () => {
    const o = await owner();
    await reviewFirst(o);
    const c = await approvedCustomer(o);
    const task = await directRequest(o, c);
    await act(o, task.id, 'approve');
    await mcpTool(o.agentKey, 'complete_task', { id: task.id, result: { headline: 'CANARY draft one' } });
    const sentBack = await act(o, task.id, 'send-back', { note: 'CANARY shorter please' });
    expect(sentBack.status, sentBack.text).toBe(200);
    expect(await mailFor(c)).toHaveLength(0);
    await mcpTool(o.agentKey, 'complete_task', { id: task.id, result: { headline: 'CANARY draft two' } });
    expect(await mailFor(c)).toHaveLength(0);
    expect((await act(o, task.id, 'release')).status).toBe(200);
    const sent = await mailFor(c);
    expect(sent.map((m) => m.kind)).toEqual(['result']);
    expect(JSON.stringify(sent)).not.toContain('CANARY');
  });

  it('a decline of a held answer emails a failure with none of the held text', async () => {
    const o = await owner();
    await reviewFirst(o);
    const c = await approvedCustomer(o);
    const task = await directRequest(o, c);
    await act(o, task.id, 'approve');
    const held = await mcpTool(o.agentKey, 'complete_task', { id: task.id, result: { headline: 'CANARY held' } });
    expect(held.payload.task.status).toBe('awaiting_release');
    const declined = await act(o, task.id, 'decline');
    expect(declined.status, declined.text).toBe(200);
    expect((await act(o, task.id, 'decline')).status).not.toBe(200);
    const sent = await mailFor(c);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'failure', requestUrl: requestUrl(o, task.id) });
    expect(JSON.stringify(sent) + customerUpdateText(sent[0]!)).not.toContain('CANARY');
  });
});

describe('owner views name the customer', () => {
  it('the task list and task detail carry sender.customer_email for the owner only', async () => {
    const { o, c } = await setup();
    const task = await directRequest(o, c);
    const list = await call(workspaceTasksRoute, `${base}/tasks`, { cookie: o.cookie });
    expect(list.status).toBe(200);
    const row = list.data.tasks.find((t: { id: string }) => t.id === task.id);
    expect(row.from).toBe('valetto');
    expect(row.sender).toEqual({ kind: 'customer', customer_email: c.email.toLowerCase(), workspace_handle: null, agent_name: null });
    const one = await call(workspaceTaskRoute, `${base}/tasks/${task.id}`, { cookie: o.cookie, params: { id: task.id } });
    expect(one.data.task.sender).toEqual(row.sender);

    // The customer's own workspace view of the same task never names them back as a customer email field.
    const mine = await call(workspaceTasksRoute, `${base}/tasks`, { cookie: c.cookie });
    const own = mine.data.tasks.find((t: { id: string }) => t.id === task.id);
    if (own) expect(own.sender.customer_email).toBeNull();

    // Bots never see it.
    const viaMcp = await mcpTool(o.agentKey, 'get_task', { id: task.id });
    expect(JSON.stringify(viaMcp.payload)).not.toContain(c.email.toLowerCase());
  });

  it('another workspace sees neither the task nor its sender', async () => {
    const { o, c } = await setup();
    const task = await directRequest(o, c);
    const other = await owner('Other');
    const list = await call(workspaceTasksRoute, `${base}/tasks`, { cookie: other.cookie });
    expect(list.status).toBe(200);
    expect(list.data.tasks.some((t: { id: string }) => t.id === task.id)).toBe(false);
    expect(list.text).not.toContain(c.email.toLowerCase());
    const one = await call(workspaceTaskRoute, `${base}/tasks/${task.id}`, { cookie: other.cookie, params: { id: task.id } });
    expect(one.status).toBe(404);
    expect(one.text).not.toContain(c.email.toLowerCase());
  });

  it('an in-workspace task names the sending agent', async () => {
    const o = await owner();
    const helper = await createAgent(o.cookie, 'Helper');
    const helperKey = await createKey(o.cookie, helper.id);
    const created = await mcpTool(helperKey, 'create_task', { to: 'Grok', title: 'Internal', description: 'x', result_schema: draftResult });
    const list = await call(workspaceTasksRoute, `${base}/tasks`, { cookie: o.cookie });
    const row = list.data.tasks.find((t: { id: string }) => t.id === created.payload.task.id);
    expect(row.sender).toEqual({ kind: 'agent', customer_email: null, workspace_handle: o.handle, agent_name: 'Helper' });
  });

  it('the guest list carries customer_email on a customer share', async () => {
    const { o, c } = await setup();
    const res = await call(listSharesRoute, `${base}/agents/${o.agentId}/shares`, { cookie: o.cookie, params: { id: o.agentId } });
    expect(res.status).toBe(200);
    const share = res.data.shares.find((s: { guest_workspace_id: string }) => s.guest_workspace_id === c.workspace.id);
    expect(share).toMatchObject({ source: 'customer', customer_email: c.email.toLowerCase() });
  });
});

describe('Valetto branding in email', () => {
  it('sets the From display name to Valetto and keeps the configured address', () => {
    expect(fromHeader('ReplySlip <login@auth.replyslip.com>', undefined)).toBe('Valetto <login@auth.replyslip.com>');
    expect(fromHeader('login@auth.valetto.tech', undefined)).toBe('Valetto <login@auth.valetto.tech>');
    expect(fromHeader('login@auth.valetto.tech', 'Valetto Support')).toBe('Valetto Support <login@auth.valetto.tech>');
    expect(fromHeader('login@auth.valetto.tech', 'Valetto, Inc.')).toBe('"Valetto, Inc." <login@auth.valetto.tech>');
    expect(fromHeader('login@auth.valetto.tech', '  ')).toBe('Valetto <login@auth.valetto.tech>');
  });

  it('sends the Valetto From header through Resend', async () => {
    setEmailSenderForTests(null);
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    vi.stubEnv('EMAIL_FROM', 'ReplySlip <noreply@example.com>');
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await getEmailSender().sendLoginCode({ to: 'a@example.com', code: '123456' });
      await getEmailSender().sendCustomerUpdate({
        to: 'a@example.com',
        kind: 'result',
        businessName: 'Acme',
        requestTitle: 'Quote',
        requestUrl: 'https://valetto.tech/c/x/r/y',
      });
      const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body)));
      expect(bodies.map((b) => b.from)).toEqual(['Valetto <noreply@example.com>', 'Valetto <noreply@example.com>']);
      expect(bodies[0].subject).toBe('Your Valetto sign-in code');
      expect(bodies[1].subject).toBe('Valetto: your result from Acme is ready');
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      installInbox();
    }
  });

  it('every template says Valetto and none says ReplySlip', () => {
    const texts = [
      loginCodeText('123456'),
      pendingCustomersText({ agentName: 'Grok', pendingCount: 2, dashboardUrl: 'https://valetto.tech/dashboard' }),
      reviewNeededText({ agentName: 'Grok', waitingCount: 1, reviewUrl: 'https://valetto.tech/dashboard/reviews' }),
      customerUpdateText({ kind: 'failure', businessName: 'Acme', requestTitle: 'Quote', requestUrl: 'https://valetto.tech/c/x/r/y' }),
    ];
    for (const text of texts) {
      expect(text).toContain('Valetto');
      expect(text.toLowerCase()).not.toContain('replyslip');
    }
  });
});
