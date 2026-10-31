import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { GET as getAgentRoute } from '@/app/api/v1/agents/[id]/route';
import { GET as getReviewModeRoute, PUT as putReviewModeRoute } from '@/app/api/v1/agents/[id]/review-mode/route';
import { POST as revokeAgentRoute } from '@/app/api/v1/agents/[id]/revoke/route';
import { POST as postShare } from '@/app/api/v1/agents/[id]/shares/route';
import { POST as approveShare } from '@/app/api/v1/agents/[id]/shares/[shareId]/approve/route';
import { PUT as putSharing } from '@/app/api/v1/agents/[id]/sharing/route';
import { GET as getBotRoute } from '@/app/api/v1/c/bots/[agent_id]/route';
import { GET as listBotsRoute } from '@/app/api/v1/c/bots/route';
import { GET as listRequestsRoute, POST as createRequestRoute } from '@/app/api/v1/c/bots/[agent_id]/requests/route';
import { GET as getRequestRoute } from '@/app/api/v1/c/requests/[task_id]/route';
import { POST as answerRequestRoute } from '@/app/api/v1/c/requests/[task_id]/answer/route';
import { GET as listReviewsRoute } from '@/app/api/v1/reviews/route';
import { GET as getReviewRoute } from '@/app/api/v1/reviews/[id]/route';
import { POST as reviewActionRoute } from '@/app/api/v1/reviews/[id]/[action]/route';
import { GET as workspaceTaskRoute } from '@/app/api/v1/tasks/[id]/route';
import { GET as workspaceTasksRoute } from '@/app/api/v1/tasks/route';
import { PATCH as patchWorkspace } from '@/app/api/v1/workspaces/current/route';
import { getDb } from '@/db';
import { tasks, wakes } from '@/db/schema';
import { OWNER_DECLINED_REASON, RATE_LIMITS } from '@/lib/constants';
import { HELD_FOR_REVIEW_NOTICE, REVIEW_NEEDED_NOTICE, WAKE_NOTICE } from '@/lib/wake-notice';
import { nudgeText } from '../packages/cli/src/watch';
import { approvedCustomer, directRequest, ORIGIN, owner, type Customer, type Owner } from './customer-fixtures';
import { call, createAgent, createKey, mcpTool, setHerdr, signIn, setWebhook, startReceiver } from './helpers';
import { reviewNotices } from './inbox';

const base = 'http://localhost/api/v1';
const EVIL = { origin: 'https://evil.example' };

const setMode = (o: { cookie?: string; agentId: string }, body: unknown, init: { bearer?: string; headers?: Record<string, string> } = {}) =>
  call(putReviewModeRoute, `${base}/agents/${o.agentId}/review-mode`, {
    method: 'PUT',
    cookie: o.cookie,
    bearer: init.bearer,
    params: { id: o.agentId },
    body,
    headers: init.headers ?? ORIGIN,
  });
const getMode = (o: { cookie?: string; agentId: string }, bearer?: string) =>
  call(getReviewModeRoute, `${base}/agents/${o.agentId}/review-mode`, { cookie: o.cookie, bearer, params: { id: o.agentId } });
const listReviews = (o: { cookie?: string }, query = '', bearer?: string) =>
  call(listReviewsRoute, `${base}/reviews${query}`, { cookie: o.cookie, bearer });
const getReview = (o: { cookie?: string }, id: string, bearer?: string) =>
  call(getReviewRoute, `${base}/reviews/${id}`, { cookie: o.cookie, bearer, params: { id } });
const act = (
  o: { cookie?: string },
  id: string,
  action: string,
  body?: unknown,
  init: { bearer?: string; headers?: Record<string, string> } = {},
) =>
  call(reviewActionRoute, `${base}/reviews/${id}/${action}`, {
    method: 'POST',
    cookie: o.cookie,
    bearer: init.bearer,
    params: { id, action },
    body,
    headers: init.headers ?? ORIGIN,
  });
const revokeAgent = (o: Owner) =>
  call(revokeAgentRoute, `${base}/agents/${o.agentId}/revoke`, {
    method: 'POST',
    cookie: o.cookie,
    params: { id: o.agentId },
    body: {},
    headers: ORIGIN,
  });
const getRequest = (c: Customer, id: string) =>
  call(getRequestRoute, `${base}/c/requests/${id}`, { cookie: c.cookie, params: { task_id: id } });
const listRequests = (c: Customer, agentId: string, query = '') =>
  call(listRequestsRoute, `${base}/c/bots/${agentId}/requests${query}`, { cookie: c.cookie, params: { agent_id: agentId } });
const createRequest = (c: Customer, agentId: string, body: unknown) =>
  call(createRequestRoute, `${base}/c/bots/${agentId}/requests`, { cookie: c.cookie, params: { agent_id: agentId }, body, headers: ORIGIN });
const answerRequest = (c: Customer, id: string, answer: string) =>
  call(answerRequestRoute, `${base}/c/requests/${id}/answer`, { cookie: c.cookie, params: { task_id: id }, body: { answer }, headers: ORIGIN });
const getBot = (c: Customer, agentId: string) =>
  call(getBotRoute, `${base}/c/bots/${agentId}`, { cookie: c.cookie, params: { agent_id: agentId } });

/** review_first, with local delivery so wakes are stored and can be checked. */
async function reviewFirst(o: Owner) {
  await setHerdr(o.cookie, o.agentId, `pane-${randomUUID().slice(0, 8)}`);
  const res = await setMode(o, { review_mode: 'review_first' });
  expect(res.status, res.text).toBe(200);
  return res;
}

async function taskRow(id: string) {
  const [row] = await getDb().select().from(tasks).where(eq(tasks.id, id));
  return row!;
}

async function wakeReasons(agentId: string, taskId: string) {
  const rows = await getDb()
    .select({ reason: wakes.reason })
    .from(wakes)
    .where(and(eq(wakes.agentId, agentId), eq(wakes.taskId, taskId)))
    .orderBy(wakes.createdAt);
  return rows.map((row) => row.reason);
}

/** A customer request on a review_first bot, approved so the bot can work on it. */
async function approvedRequest(o: Owner, c: Customer, notes = 'Please write one.') {
  const task = await directRequest(o, c, notes);
  expect(task.status).toBe('in_review');
  const approved = await act(o, task.id, 'approve');
  expect(approved.status, approved.text).toBe(200);
  return task;
}

/** Customer-visible responses must never carry held text. */
function expectNoHeld(text: string, canary: string) {
  expect(text).not.toContain(canary);
}

describe('review_mode setting', () => {
  it('defaults to auto, is human-only with an Origin check, and shows on the owner agent and R4', async () => {
    const o = await owner();
    const customer = await approvedCustomer(o);
    expect((await getMode(o)).data.review).toEqual({ agent_id: o.agentId, review_mode: 'auto', notify_review_email: true, held_count: 0 });
    expect((await getBot(customer, o.agentId)).data.review_mode).toBe('auto');

    const byKey = await setMode({ agentId: o.agentId }, { review_mode: 'review_first' }, { bearer: o.agentKey });
    expect(byKey.status).toBe(403);
    expect(byKey.data.error.code).toBe('human_required');
    expect((await getMode({ agentId: o.agentId }, o.agentKey)).data.error.code).toBe('human_required');
    const evil = await setMode(o, { review_mode: 'review_first' }, { headers: EVIL });
    expect(evil.status).toBe(403);
    expect(evil.data.error.code).toBe('bad_origin');
    expect((await setMode(o, { review_mode: 'sometimes' })).status).toBe(400);
    expect((await setMode(o, { review_mode: 'review_first', extra: 1 })).status).toBe(400);
    expect((await setMode({ agentId: o.agentId }, { review_mode: 'review_first' })).status).toBe(401);

    const set = await setMode(o, { review_mode: 'review_first', notify_review_email: false });
    expect(set.data.review).toMatchObject({ review_mode: 'review_first', notify_review_email: false });
    const agent = await call(getAgentRoute, `${base}/agents/${o.agentId}`, { cookie: o.cookie, params: { id: o.agentId } });
    expect(agent.data.agent.review_mode).toBe('review_first');
    expect((await getBot(customer, o.agentId)).data.review_mode).toBe('review_first');

    const other = await signIn();
    expect((await setMode({ cookie: other.cookie, agentId: o.agentId }, { review_mode: 'auto' })).status).toBe(404);
  });

  it('has no MCP tool, so a bot cannot turn review off', async () => {
    const o = await owner();
    const res = await mcpTool(o.agentKey, 'set_review_mode', { review_mode: 'auto' });
    expect(res.isError).toBe(true);
  });

  it('affects only new tasks', async () => {
    const o = await owner();
    const c = await approvedCustomer(o);
    const before = await directRequest(o, c);
    expect(before.status).toBe('open');
    await reviewFirst(o);
    const held = await directRequest(o, c);
    expect(held.status).toBe('in_review');
    // The auto task completes straight through even though the bot is now review_first.
    const done = await mcpTool(o.agentKey, 'complete_task', { id: before.id, result: { headline: 'Auto' } });
    expect(done.payload.task.status).toBe('done');
    expect(done.payload.task.review_mode).toBe('auto');
    await setMode(o, { review_mode: 'auto' });
    // The held task stays held after switching back, and the owner still decides.
    expect((await taskRow(held.id)).status).toBe('in_review');
    expect((await act(o, held.id, 'approve')).data.review.status).toBe('open');
    const completed = await mcpTool(o.agentKey, 'complete_task', { id: held.id, result: { headline: 'Held' } });
    expect(completed.payload.task.status).toBe('awaiting_release');
    expect((await directRequest(o, c)).status).toBe('open');
  });

  it('never gates tasks from the owner’s own workspace', async () => {
    const o = await owner();
    await reviewFirst(o);
    const coworker = await createAgent(o.cookie, 'Coworker');
    const coworkerKey = await createKey(o.cookie, coworker.id);
    const created = await mcpTool(coworkerKey, 'create_task', {
      to: 'Grok',
      title: 'Inside',
      description: 'Same workspace.',
      result_schema: { type: 'object' },
    });
    expect(created.payload.task.status).toBe('open');
    const done = await mcpTool(o.agentKey, 'complete_task', { id: created.payload.task.id, result: {} });
    expect(done.payload.task.status).toBe('done');
  });
});

describe('request checkpoint', () => {
  it('stores a customer request as in_review, hidden from the bot, with only a review_needed wake', async () => {
    const o = await owner();
    await reviewFirst(o);
    const c = await approvedCustomer(o);
    const created = await createRequest(c, o.agentId, { offer: 'draft', notes: 'CANARY-REQUEST-TEXT' });
    expect(created.status, created.text).toBe(201);
    const id = created.data.request.id as string;
    expect(created.data.request.status).toBe('in_review');

    expect(await wakeReasons(o.agentId, id)).toEqual(['review_needed']);
    const got = await mcpTool(o.agentKey, 'get_task', { id });
    expect(got.payload.error).toBe('not_found');
    const listed = await mcpTool(o.agentKey, 'list_tasks', {});
    expect(JSON.stringify(listed.payload)).not.toContain(id);
    const byStatus = await mcpTool(o.agentKey, 'list_tasks', { status: 'in_review' });
    expect(JSON.stringify(byStatus.payload)).not.toContain(id);
    for (const tool of ['complete_task', 'ask', 'fail_task'] as const) {
      const args = tool === 'complete_task' ? { result: { headline: 'x' } } : tool === 'ask' ? { question: 'Q?' } : { reason: 'no' };
      const res = await mcpTool(o.agentKey, tool, { id, ...args });
      expect(res.payload.error, tool).toBe('not_found');
    }

    const r7 = await getRequest(c, id);
    expect(r7.data.request).toMatchObject({ status: 'in_review', result: null, question: null, fail_code: null });
    const r6 = await listRequests(c, o.agentId, '?status=in_review');
    expect(r6.data.requests.map((r: { id: string }) => r.id)).toEqual([id]);
    const bots = await call(listBotsRoute, `${base}/c/bots`, { cookie: c.cookie });
    expect(bots.data.bots[0].open_requests).toBe(1);

    const list = await listReviews(o);
    expect(list.status).toBe(200);
    expect(list.res.headers.get('cache-control')).toBe('private, no-store');
    expect(list.data.count).toBe(1);
    expect(list.data.by_agent).toEqual([{ agent_id: o.agentId, in_review: 1, awaiting_release: 0 }]);
    const item = list.data.reviews[0];
    expect(item).toMatchObject({
      task_id: id,
      status: 'in_review',
      stage: 'request',
      held_action: null,
      actions: ['approve', 'decline'],
      agent: { id: o.agentId, name: 'Grok' },
      sender: { kind: 'customer', customer_email: c.email, workspace_handle: null, agent_name: null },
      offer: { name: 'draft' },
      notes: 'CANARY-REQUEST-TEXT',
      result: null,
      untrusted: true,
    });
    expect(item.review_url).toBe(`/dashboard/reviews/${id}`);
    expect((await getReview(o, id)).data.review).toEqual(item);
    expect((await getMode(o)).data.review.held_count).toBe(1);

    const approved = await act(o, id, 'approve');
    expect(approved.status, approved.text).toBe(200);
    expect(approved.data.review).toMatchObject({ status: 'open', stage: null, actions: [] });
    expect(approved.data.review.reviewed_at).not.toBeNull();
    expect(approved.data.review.reviewed_by).toBe((await taskRow(id)).reviewedBy);
    expect(await wakeReasons(o.agentId, id)).toEqual(['review_needed', 'task']);
    const visible = await mcpTool(o.agentKey, 'get_task', { id });
    expect(visible.payload.task).toMatchObject({ status: 'open', review_mode: 'review_first', description: 'CANARY-REQUEST-TEXT' });
    expect((await listReviews(o)).data.count).toBe(0);
    expect((await act(o, id, 'approve')).data.error.code).toBe('invalid_review_state');
  });

  it('declines a request as declined_by_owner, waking the sender, without counting against the cap again', async () => {
    const o = await owner();
    await reviewFirst(o);
    const c = await approvedCustomer(o, { dailyCap: 2 });
    const task = await directRequest(o, c);
    const used = (await getBot(c, o.agentId)).data.share.used_today;
    expect(used).toBe(1);
    const declined = await act(o, task.id, 'decline', { note: 'Not a fit.' });
    expect(declined.data.review).toMatchObject({ status: 'failed', owner_note: 'Not a fit.', actions: [] });
    const r7 = await getRequest(c, task.id);
    expect(r7.data.request).toMatchObject({ status: 'failed', fail_code: 'declined_by_owner', fail_message: null });
    expect(r7.text).not.toContain('Not a fit.');
    expect((await taskRow(task.id)).failReason).toBe(OWNER_DECLINED_REASON);
    expect((await getBot(c, o.agentId)).data.share.used_today).toBe(1);
    const second = await approvedRequest(o, c);
    await mcpTool(o.agentKey, 'complete_task', { id: second.id, result: { headline: 'x' } });
    await act(o, second.id, 'send-back', { note: 'Again' });
    expect((await getBot(c, o.agentId)).data.share.used_today).toBe(2);
  });

  it('emails the owner at most once an hour, with no request text, and not when turned off', async () => {
    const o = await owner();
    await reviewFirst(o);
    const c = await approvedCustomer(o);
    const before = reviewNotices.length;
    await directRequest(o, c, 'CANARY-EMAIL-TEXT');
    await directRequest(o, c, 'CANARY-EMAIL-TEXT');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const sent = reviewNotices.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: o.email, agentName: 'Grok', waitingCount: 1, reviewUrl: '/dashboard/reviews' });
    expect(JSON.stringify(sent)).not.toContain('CANARY-EMAIL-TEXT');

    const quiet = await owner();
    await setMode(quiet, { review_mode: 'review_first', notify_review_email: false });
    const qc = await approvedCustomer(quiet);
    const mark = reviewNotices.length;
    await directRequest(quiet, qc);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reviewNotices.length).toBe(mark);
  });

  it('sends the webhook a fixed review_needed notice and the owner link, never request text', async () => {
    const receiver = await startReceiver();
    try {
      const o = await owner();
      await reviewFirst(o);
      await setWebhook(o.cookie, o.agentId, receiver.url);
      const c = await approvedCustomer(o);
      const task = await directRequest(o, c, 'CANARY-WEBHOOK-TEXT');
      const hit = receiver.hits.find((h) => h.body?.task_id === task.id);
      expect(hit?.body).toMatchObject({ reason: 'review_needed', notice: REVIEW_NEEDED_NOTICE, review_url: `/dashboard/reviews/${task.id}` });
      expect(hit?.raw).not.toContain('CANARY-WEBHOOK-TEXT');
    } finally {
      await receiver.close();
    }
  });

  it('lets the local watcher type only the fixed review notice', () => {
    expect(nudgeText({ id: 'w', notice: REVIEW_NEEDED_NOTICE })).toBe(REVIEW_NEEDED_NOTICE);
    expect(nudgeText({ id: 'w', notice: `${REVIEW_NEEDED_NOTICE} extra` })).toBe(WAKE_NOTICE);
  });
});

describe('answer checkpoint', () => {
  it('holds a result until Release: the customer never sees it on R6, R7 or the workspace task API', async () => {
    const o = await owner();
    await reviewFirst(o);
    const c = await approvedCustomer(o);
    const task = await approvedRequest(o, c);
    const done = await mcpTool(o.agentKey, 'complete_task', { id: task.id, result: { headline: 'CANARY-HELD-RESULT' } });
    expect(done.isError).toBe(false);
    expect(done.payload.task).toMatchObject({
      status: 'awaiting_release',
      held_action: 'result',
      review_notice: HELD_FOR_REVIEW_NOTICE,
      completed_at: null,
    });

    const r7 = await getRequest(c, task.id);
    expect(r7.data.request).toMatchObject({ status: 'awaiting_release', result: null, result_display: [], completed_at: null });
    expectNoHeld(r7.text, 'CANARY-HELD-RESULT');
    const r6 = await listRequests(c, o.agentId);
    expect(r6.data.requests[0].status).toBe('awaiting_release');
    expectNoHeld(r6.text, 'CANARY-HELD-RESULT');
    const filtered = await listRequests(c, o.agentId, '?status=awaiting_release');
    expect(filtered.data.requests).toHaveLength(1);
    // The customer's own workspace session on the generic task API is redacted too.
    const raw = await call(workspaceTaskRoute, `${base}/tasks/${task.id}`, { cookie: c.cookie, params: { id: task.id } });
    expect(raw.status).toBe(200);
    expect(raw.data.task).toMatchObject({ status: 'awaiting_release', result: null, held_action: null, owner_note: null });
    expectNoHeld(raw.text, 'CANARY-HELD-RESULT');
    const rawList = await call(workspaceTasksRoute, `${base}/tasks?status=awaiting_release`, { cookie: c.cookie });
    expect(rawList.data.tasks).toHaveLength(1);
    expectNoHeld(rawList.text, 'CANARY-HELD-RESULT');

    const again = await mcpTool(o.agentKey, 'complete_task', { id: task.id, result: { headline: 'second' } });
    expect(again.payload.error).toBe('task_held');
    expect((await mcpTool(o.agentKey, 'fail_task', { id: task.id, reason: 'x' })).payload.error).toBe('task_held');

    const review = (await getReview(o, task.id)).data.review;
    expect(review).toMatchObject({
      stage: 'answer',
      held_action: 'result',
      actions: ['release', 'send_back', 'decline'],
      result: { headline: 'CANARY-HELD-RESULT' },
    });
    expect(review.result_display[0]).toMatchObject({ key: 'headline', value: 'CANARY-HELD-RESULT' });

    const released = await act(o, task.id, 'release');
    expect(released.data.review).toMatchObject({ status: 'done', held_action: null, actions: [] });
    expect(released.data.review.released_at).not.toBeNull();
    // The owner still sees what went out after release.
    expect(released.data.review).toMatchObject({ result: { headline: 'CANARY-HELD-RESULT' } });
    expect((await getReview(o, task.id)).data.review.result_display[0]).toMatchObject({ value: 'CANARY-HELD-RESULT' });
    const after = await getRequest(c, task.id);
    expect(after.data.request).toMatchObject({ status: 'done', result: { headline: 'CANARY-HELD-RESULT' } });
    expect(after.data.request.completed_at).not.toBeNull();
    expect((await act(o, task.id, 'release')).status).toBe(409);
  });

  it('holds a question (17.8) until Release, then the customer can answer', async () => {
    const o = await owner();
    await reviewFirst(o);
    const c = await approvedCustomer(o);
    const task = await approvedRequest(o, c);
    const asked = await mcpTool(o.agentKey, 'ask', { id: task.id, question: 'CANARY-HELD-QUESTION?' });
    expect(asked.payload.task).toMatchObject({ status: 'awaiting_release', held_action: 'question' });
    const r7 = await getRequest(c, task.id);
    expect(r7.data.request).toMatchObject({ status: 'awaiting_release', question: null });
    expectNoHeld(r7.text, 'CANARY-HELD-QUESTION');
    expect((await answerRequest(c, task.id, 'early')).data.error.code).toBe('task_not_waiting');
    expect((await getReview(o, task.id)).data.review.question).toBe('CANARY-HELD-QUESTION?');

    const releasedQ = (await act(o, task.id, 'release')).data.review;
    expect(releasedQ).toMatchObject({ status: 'needs_info', question: 'CANARY-HELD-QUESTION?' });
    expect((await getRequest(c, task.id)).data.request.question).toBe('CANARY-HELD-QUESTION?');
    const answered = await answerRequest(c, task.id, 'Blue');
    expect(answered.status, answered.text).toBe(200);
    expect(await wakeReasons(o.agentId, task.id)).toEqual(['review_needed', 'task', 'answer']);
    // The next answer is held again.
    const done = await mcpTool(o.agentKey, 'complete_task', { id: task.id, result: { headline: 'Final' } });
    expect(done.payload.task.status).toBe('awaiting_release');
  });

  it('holds a bot failure and releases it as bot_failed', async () => {
    const o = await owner();
    await reviewFirst(o);
    const c = await approvedCustomer(o);
    const task = await approvedRequest(o, c);
    const failed = await mcpTool(o.agentKey, 'fail_task', { id: task.id, reason: 'CANARY-HELD-FAILURE' });
    expect(failed.payload.task).toMatchObject({ status: 'awaiting_release', held_action: 'failure' });
    const r7 = await getRequest(c, task.id);
    expect(r7.data.request).toMatchObject({ fail_code: null, fail_message: null });
    expectNoHeld(r7.text, 'CANARY-HELD-FAILURE');
    expect((await getReview(o, task.id)).data.review.fail_message).toBe('CANARY-HELD-FAILURE');
    expect((await act(o, task.id, 'release')).data.review.fail_message).toBe('CANARY-HELD-FAILURE');
    expect((await getRequest(c, task.id)).data.request).toMatchObject({
      status: 'failed',
      fail_code: 'bot_failed',
      fail_message: 'CANARY-HELD-FAILURE',
    });
  });

  it('sends back with a required note that only the bot sees, and wakes the bot', async () => {
    const o = await owner();
    await reviewFirst(o);
    const c = await approvedCustomer(o);
    const task = await approvedRequest(o, c);
    await mcpTool(o.agentKey, 'complete_task', { id: task.id, result: { headline: 'CANARY-DRAFT-1' } });
    const noNote = await act(o, task.id, 'send-back');
    expect(noNote.status).toBe(400);
    expect(noNote.data.error.details.fields.note).toBe('Required.');
    expect((await act(o, task.id, 'send-back', { note: '   ' })).status).toBe(400);
    expect((await act(o, task.id, 'send-back', { note: 'x'.repeat(2001) })).status).toBe(400);
    expect((await act(o, task.id, 'release', { note: 'no' })).status).toBe(400);

    const sent = await act(o, task.id, 'send-back', { note: 'CANARY-OWNER-NOTE: shorter please' });
    expect(sent.data.review).toMatchObject({ status: 'open', owner_note: 'CANARY-OWNER-NOTE: shorter please', result: null });
    expect((await taskRow(task.id)).result).toBeNull();
    expect(await wakeReasons(o.agentId, task.id)).toEqual(['review_needed', 'task', 'sent_back']);
    const seen = await mcpTool(o.agentKey, 'get_task', { id: task.id });
    expect(seen.payload.task).toMatchObject({ status: 'open', owner_note: 'CANARY-OWNER-NOTE: shorter please', result: null });
    const r7 = await getRequest(c, task.id);
    expect(r7.data.request.status).toBe('open');
    expectNoHeld(r7.text, 'CANARY-OWNER-NOTE');
    expectNoHeld(r7.text, 'CANARY-DRAFT-1');

    await mcpTool(o.agentKey, 'complete_task', { id: task.id, result: { headline: 'Short' } });
    await act(o, task.id, 'release');
    expect((await getRequest(c, task.id)).data.request.result).toEqual({ headline: 'Short' });
  });

  it('drops a held answer when the owner declines it', async () => {
    const o = await owner();
    await reviewFirst(o);
    const c = await approvedCustomer(o);
    const task = await approvedRequest(o, c);
    await mcpTool(o.agentKey, 'complete_task', { id: task.id, result: { headline: 'CANARY-DECLINED' } });
    const declined = await act(o, task.id, 'decline');
    expect(declined.data.review).toMatchObject({ status: 'failed', result: null, owner_note: null });
    const row = await taskRow(task.id);
    expect(row.result).toBeNull();
    expect(row.heldAction).toBeNull();
    const r7 = await getRequest(c, task.id);
    expect(r7.data.request).toMatchObject({ status: 'failed', fail_code: 'declined_by_owner', result: null });
    expectNoHeld(r7.text, 'CANARY-DECLINED');
  });
});

function handleName(prefix: string): string {
  return `${prefix}${randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

/** A guest agent in another workspace with an approved share on o's Grok for the draft offer. */
async function guestAgent(o: Owner) {
  const guest = await signIn();
  const handle = handleName('g');
  await call(patchWorkspace, `${base}/workspaces/current`, { method: 'PATCH', cookie: guest.cookie, body: { handle } });
  const invited = await call(postShare, `${base}/agents/${o.agentId}/shares`, {
    cookie: o.cookie,
    params: { id: o.agentId },
    body: { guest_handle: handle, offers: ['draft'] },
  });
  expect(invited.status, invited.text).toBe(201);
  const shareId = invited.data.share.id as string;
  const approved = await call(approveShare, `${base}/agents/${o.agentId}/shares/${shareId}/approve`, {
    method: 'POST',
    cookie: o.cookie,
    params: { id: o.agentId, shareId },
  });
  expect(approved.status).toBe(200);
  const bot = await createAgent(guest.cookie, 'GuestBot');
  const key = await createKey(guest.cookie, bot.id);
  await setHerdr(guest.cookie, bot.id, `pane-${randomUUID().slice(0, 8)}`);
  return { cookie: guest.cookie, handle, agentId: bot.id, key, workspaceId: guest.workspace.id };
}

describe('guest agents', () => {
  it('gates an agent guest the same way, and its tools never see held text or the owner note', async () => {
    const o = await owner();
    await reviewFirst(o);
    const g = await guestAgent(o);
    const created = await mcpTool(g.key, 'create_task', { to: `@${o.handle}/Grok`, offer: 'draft', title: 'T', description: 'D' });
    expect(created.payload.task).toMatchObject({ status: 'in_review', review_mode: 'review_first' });
    const id = created.payload.task.id as string;
    const review = (await getReview(o, id)).data.review;
    expect(review.sender).toEqual({ kind: 'agent', customer_email: null, workspace_handle: g.handle, agent_name: 'GuestBot' });
    await act(o, id, 'approve');
    await mcpTool(o.agentKey, 'complete_task', { id, result: { headline: 'CANARY-GUEST-HELD' } });
    expect(await wakeReasons(g.agentId, id)).toEqual([]);
    const seen = await mcpTool(g.key, 'get_task', { id });
    expect(seen.payload.task).toMatchObject({ status: 'awaiting_release', result: null, held_action: null, owner_note: null, review_notice: null });
    expectNoHeld(seen.text, 'CANARY-GUEST-HELD');
    const listed = await mcpTool(g.key, 'list_tasks', { status: 'awaiting_release' });
    expect(listed.payload.tasks).toHaveLength(1);
    expectNoHeld(listed.text, 'CANARY-GUEST-HELD');
    await act(o, id, 'send-back', { note: 'CANARY-NOTE-FOR-BOT' });
    expectNoHeld((await mcpTool(g.key, 'get_task', { id })).text, 'CANARY-NOTE-FOR-BOT');
    await mcpTool(o.agentKey, 'complete_task', { id, result: { headline: 'Final' } });
    await act(o, id, 'release');
    expect(await wakeReasons(g.agentId, id)).toEqual(['result']);
    expect((await mcpTool(g.key, 'get_task', { id })).payload.task).toMatchObject({ status: 'done', result: { headline: 'Final' } });
  });
});

describe('owner review endpoints', () => {
  it('are human-only, Origin-checked, scoped to the owner workspace, and reject unknown actions', async () => {
    const o = await owner();
    await reviewFirst(o);
    const c = await approvedCustomer(o);
    const task = await directRequest(o, c);
    for (const res of [
      await listReviews({}, '', o.agentKey),
      await getReview({}, task.id, o.agentKey),
      await act({}, task.id, 'approve', undefined, { bearer: o.agentKey }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.data.error.code).toBe('human_required');
    }
    expect((await listReviews({})).status).toBe(401);
    const evil = await act(o, task.id, 'approve', undefined, { headers: EVIL });
    expect(evil.status).toBe(403);
    expect(evil.data.error.code).toBe('bad_origin');
    expect((await taskRow(task.id)).status).toBe('in_review');
    expect((await act(o, task.id, 'publish')).status).toBe(404);
    expect((await act(o, 'not-a-uuid', 'approve')).status).toBe(404);
    expect((await act(o, task.id, 'release')).data.error).toMatchObject({
      code: 'invalid_review_state',
      details: { status: 'in_review', actions: ['approve', 'decline'] },
    });

    // The customer and another owner see no review for it.
    expect((await getReview(c, task.id)).status).toBe(404);
    expect((await act(c, task.id, 'approve')).status).toBe(404);
    expect((await listReviews(c)).data.count).toBe(0);
    const other = await signIn();
    expect((await getReview(other, task.id)).status).toBe(404);
    // An auto task is not a review item.
    const plain = await owner();
    const pc = await approvedCustomer(plain);
    const auto = await directRequest(plain, pc);
    expect((await getReview(plain, auto.id)).status).toBe(404);
    expect((await act(plain, auto.id, 'approve')).status).toBe(404);

    const filtered = await listReviews(o, `?agent_id=${randomUUID()}`);
    expect(filtered.data.reviews).toEqual([]);
    expect((await listReviews(o, '?agent_id=bad')).status).toBe(400);
  });

  it('rate limits review actions per owner', async () => {
    const session = await signIn();
    const limit = RATE_LIMITS.reviewAction.agent;
    for (let i = 0; i < limit; i++) {
      expect((await act(session, randomUUID(), 'approve')).status).toBe(404);
    }
    const res = await act(session, randomUUID(), 'approve');
    expect(res.status).toBe(429);
    expect(res.data.error.code).toBe('rate_limited');
  });
});

describe('revoked agents', () => {
  it('fails held requests on revoke, drops the held answer, and 404s every action after', async () => {
    const o = await owner();
    await reviewFirst(o);
    const c = await approvedCustomer(o);
    const waiting = await directRequest(o, c);
    const held = await approvedRequest(o, c);
    await mcpTool(o.agentKey, 'complete_task', { id: held.id, result: { headline: 'CANARY-REVOKED-HELD' } });
    expect((await revokeAgent(o)).status).toBe(200);
    for (const id of [waiting.id, held.id]) {
      const row = await taskRow(id);
      expect(row.status).toBe('failed');
      expect(row.result).toBeNull();
      const r7 = await getRequest(c, id);
      expect(r7.data.request).toMatchObject({ status: 'failed', fail_code: 'declined_by_owner' });
      expectNoHeld(r7.text, 'CANARY-REVOKED-HELD');
    }
    expect((await act(o, waiting.id, 'approve')).status).toBe(404);
    expect((await act(o, held.id, 'release')).status).toBe(404);
    expect((await listReviews(o)).data.count).toBe(0);
    expect((await getReview(o, held.id)).data.review.actions).toEqual([]);
    expect((await setMode(o, { review_mode: 'auto' })).data.error.code).toBe('agent_revoked');
  });

  it('runs approve racing revoke without deadlocking, and never leaves the task open on a revoked bot', async () => {
    for (let round = 0; round < 5; round++) {
      const o = await owner();
      await reviewFirst(o);
      const c = await approvedCustomer(o);
      const task = await directRequest(o, c);
      const [approve, revoke] = await Promise.all([act(o, task.id, 'approve'), revokeAgent(o)]);
      expect(revoke.status, revoke.text).toBe(200);
      expect([200, 404], approve.text).toContain(approve.status);
      expect((await taskRow(task.id)).status).toBe('failed');
    }
  });

  it('runs release racing revoke without leaking the held result', async () => {
    for (let round = 0; round < 5; round++) {
      const o = await owner();
      await reviewFirst(o);
      const c = await approvedCustomer(o);
      const task = await approvedRequest(o, c);
      await mcpTool(o.agentKey, 'complete_task', { id: task.id, result: { headline: 'Race' } });
      const [release, revoke] = await Promise.all([act(o, task.id, 'release'), revokeAgent(o)]);
      expect(revoke.status).toBe(200);
      const row = await taskRow(task.id);
      if (release.status === 200) {
        // Release won: the customer already had the answer, and a done task stays done.
        expect(row.status).toBe('done');
      } else {
        expect(release.status).toBe(404);
        expect(row).toMatchObject({ status: 'failed', result: null });
      }
    }
  });

  it('fails held requests when sharing is turned off', async () => {
    const o = await owner();
    await reviewFirst(o);
    const c = await approvedCustomer(o);
    const task = await directRequest(o, c);
    const off = await call(putSharing, `${base}/agents/${o.agentId}/sharing`, {
      method: 'PUT',
      cookie: o.cookie,
      params: { id: o.agentId },
      body: { shared: false },
    });
    expect(off.status).toBe(200);
    expect((await taskRow(task.id)).status).toBe('failed');
    expect((await act(o, task.id, 'approve')).data.error.code).toBe('invalid_review_state');
  });
});

describe('createTask snapshot', () => {
  it('stores review_mode on the task row', async () => {
    const o = await owner();
    await reviewFirst(o);
    const c = await approvedCustomer(o);
    const task = await directRequest(o, c);
    expect((await taskRow(task.id)).reviewMode).toBe('review_first');
  });
});
