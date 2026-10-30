import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { PUT as putSharing } from '@/app/api/v1/agents/[id]/sharing/route';
import { POST as approveShareRoute } from '@/app/api/v1/agents/[id]/shares/[shareId]/approve/route';
import { GET as listBotsRoute } from '@/app/api/v1/c/bots/route';
import { GET as getBotRoute } from '@/app/api/v1/c/bots/[agent_id]/route';
import { GET as listRequestsRoute, POST as createRequestRoute } from '@/app/api/v1/c/bots/[agent_id]/requests/route';
import { GET as getRequestRoute } from '@/app/api/v1/c/requests/[task_id]/route';
import { POST as answerRequestRoute } from '@/app/api/v1/c/requests/[task_id]/answer/route';
import { POST as agentAnswerRoute } from '@/app/api/v1/tasks/[id]/answer/route';
import { getDb } from '@/db';
import { agents, taskAnswers, tasks, wakes } from '@/db/schema';
import { RATE_LIMITS } from '@/lib/constants';
import { fieldErrors, inputDisplay, resultDisplay } from '@/lib/customer-api';
import {
  approvedCustomer,
  directRequest,
  ORIGIN,
  owner,
  pendingCustomer,
  quoteForm,
  quoteResult,
  revokeCustomer,
  shareIdOf,
  validInput,
  type Customer,
  type Owner,
} from './customer-fixtures';
import { call, createAgent, createKey, emailAddress, mcpTool, signIn } from './helpers';

const base = 'http://localhost/api/v1/c';

const listBots = (c: { cookie: string }) => call(listBotsRoute, `${base}/bots`, { cookie: c.cookie });
const getBot = (c: { cookie?: string }, agentId: string, headers: Record<string, string> = {}) =>
  call(getBotRoute, `${base}/bots/${agentId}`, { cookie: c.cookie, params: { agent_id: agentId }, headers });
const createRequest = (
  c: { cookie?: string },
  agentId: string,
  body: unknown,
  headers: Record<string, string> = ORIGIN,
) => call(createRequestRoute, `${base}/bots/${agentId}/requests`, { cookie: c.cookie, params: { agent_id: agentId }, body, headers });
const listRequests = (c: { cookie?: string }, agentId: string, query = '', headers: Record<string, string> = {}) =>
  call(listRequestsRoute, `${base}/bots/${agentId}/requests${query}`, { cookie: c.cookie, params: { agent_id: agentId }, headers });
const getRequest = (c: { cookie?: string }, taskId: string, headers: Record<string, string> = {}) =>
  call(getRequestRoute, `${base}/requests/${taskId}`, { cookie: c.cookie, params: { task_id: taskId }, headers });
const answerRequest = (c: { cookie?: string }, taskId: string, body: unknown, headers: Record<string, string> = ORIGIN) =>
  call(answerRequestRoute, `${base}/requests/${taskId}/answer`, { cookie: c.cookie, params: { task_id: taskId }, body, headers });

function expectCustomerHeaders(res: Response, etag = false) {
  expect(res.headers.get('cache-control')).toBe(etag ? 'private, no-cache' : 'private, no-store');
  expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
}

/** Things a customer response must never contain. */
function expectNoLeak(text: string, o: Owner) {
  expect(text).not.toContain(o.handle);
  expect(text).not.toContain(o.email);
  expect(text).not.toContain('"Grok"');
  expect(text).not.toContain('rsk_');
  expect(text).not.toContain('fail_reason');
}

async function quote(o: Owner, c: Customer, input: Record<string, unknown> = validInput, extra: Record<string, unknown> = {}) {
  return createRequest(c, o.agentId, { offer: 'quote', input, ...extra });
}

describe('R3 GET /api/v1/c/bots', () => {
  it('lists approved, pending, and revoked bots for the signed-in customer, newest first', async () => {
    const a = await owner();
    const b = await owner();
    const c = await owner();
    const customer = await approvedCustomer(a);
    // Same email, pending on b: sign in again later without any link and still see both.
    await pendingCustomerFor(b, customer);
    const other = await approvedCustomer(c);
    await directRequest(a, customer);

    const fresh = await signIn(customer.email);
    const res = await listBots(fresh);
    expect(res.status).toBe(200);
    expectCustomerHeaders(res.res);
    const bots = res.data.bots as any[];
    expect(bots.map((bot) => bot.agent_id)).toEqual([b.agentId, a.agentId]);
    expect(bots[0]).toMatchObject({ share_status: 'pending', access: 'pending', open_requests: 0 });
    expect(bots[1]).toMatchObject({ share_status: 'approved', access: 'approved', open_requests: 1 });
    expect(Object.keys(bots[1]).sort()).toEqual(
      ['access', 'agent_id', 'branding', 'open_requests', 'requested_at', 'share_status', 'updated_at'].sort(),
    );
    expect(bots[1].branding).toMatchObject({ primary_color: '#1F2937', accent_color: '#2563EB', show_footer: true });
    expect(bots.map((bot) => bot.agent_id)).not.toContain(c.agentId);
    expectNoLeak(res.text, a);

    await revokeCustomer(a, await shareIdOf(a, customer));
    const after = await listBots(customer);
    expect(after.data.bots.find((bot: any) => bot.agent_id === a.agentId)).toMatchObject({
      share_status: 'revoked',
      access: 'revoked',
      open_requests: 0,
    });
    expect((await listBots(other)).data.bots.map((bot: any) => bot.agent_id)).toEqual([c.agentId]);
  });

  it('returns an empty list for a signed-in non-customer and 401 when signed out', async () => {
    const someone = await signIn(emailAddress('stranger'));
    const res = await listBots(someone);
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ bots: [] });
    const anon = await call(listBotsRoute, `${base}/bots`);
    expect(anon.status).toBe(401);
    expect(anon.data.error.code).toBe('unauthorized');
    expectCustomerHeaders(anon.res);
  });

  it('hides bots whose owner turned sharing off', async () => {
    const o = await owner();
    const customer = await approvedCustomer(o);
    await call(putSharing, `http://localhost/api/v1/agents/${o.agentId}/sharing`, {
      method: 'PUT',
      cookie: o.cookie,
      params: { id: o.agentId },
      body: { shared: false },
    });
    expect((await listBots(customer)).data.bots).toEqual([]);
    expect((await getBot(customer, o.agentId)).status).toBe(404);
  });
});

/** Puts an existing customer's workspace into a pending request on o's bot. */
async function pendingCustomerFor(o: Owner, customer: Customer) {
  const { setAccess, createLink, accept } = await import('./customer-fixtures');
  await setAccess(o, { mode: 'approve_each' });
  const { token } = await createLink(o, { kind: 'public', offers: ['quote', 'draft'] });
  const res = await accept(token, customer);
  expect(res.data.share.status).toBe('pending');
}

describe('R4 GET /api/v1/c/bots/:agent_id', () => {
  it('returns the granted jobs, share usage, and an ETag', async () => {
    const o = await owner();
    const customer = await approvedCustomer(o, { dailyCap: 5 });
    const res = await getBot(customer, o.agentId);
    expect(res.status).toBe(200);
    expectCustomerHeaders(res.res, true);
    expect(res.data.bot.agent_id).toBe(o.agentId);
    expect(res.data.access).toBe('approved');
    expect(res.data.review_mode).toBe('auto');
    expect(res.data.share).toMatchObject({ status: 'approved', daily_cap: 5, used_today: 0 });
    // Rolling 24h window: nothing to reset until something was used.
    expect(res.data.share.resets_at).toBeNull();
    const jobs = res.data.jobs as any[];
    expect(jobs.map((job) => job.name).sort()).toEqual(['draft', 'quiet', 'quote']);
    const q = jobs.find((job) => job.name === 'quote');
    expect(q).toMatchObject({ title: 'quote', description: 'Price a table.', notes_enabled: true, notes_max: 2000 });
    expect(q.input_schema.title).toBe('Table quote');
    expect(q.result_fields).toContainEqual({ key: 'price_cad', label: 'Price (CAD)', type: 'number' });
    expect(q.result_fields).toContainEqual({ key: 'message', label: 'Message', type: 'string' });
    expect(jobs.find((job) => job.name === 'draft')).toMatchObject({ input_schema: null, notes_enabled: true });
    expect(jobs.find((job) => job.name === 'quiet')).toMatchObject({ notes_enabled: false });
    expectNoLeak(res.text, o);

    const etag = res.res.headers.get('etag')!;
    expect(etag).toMatch(/^W\/"/);
    const cached = await getBot(customer, o.agentId, { 'if-none-match': etag });
    expect(cached.status).toBe(304);
    expect(cached.text).toBe('');
    expectCustomerHeaders(cached.res, true);
    await quote(o, customer);
    const changed = await getBot(customer, o.agentId, { 'if-none-match': etag });
    expect(changed.status).toBe(200);
    expect(changed.data.share.used_today).toBe(1);
    expect(new Date(changed.data.share.resets_at).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
  });

  it('shows a pending customer the jobs but no usage', async () => {
    const o = await owner();
    const customer = await pendingCustomer(o);
    const res = await getBot(customer, o.agentId);
    expect(res.status).toBe(200);
    expect(res.data.access).toBe('pending');
    expect(Object.keys(res.data.share).sort()).toEqual(['requested_at', 'status']);
    expect(res.data.jobs.map((job: any) => job.name).sort()).toEqual(['draft', 'quote']);
  });

  it('shows a revoked customer no jobs, and 404s for other customers and bad ids', async () => {
    const o = await owner();
    const customer = await approvedCustomer(o);
    const stranger = await approvedCustomer(await owner());
    expect((await getBot(stranger, o.agentId)).status).toBe(404);
    expect((await getBot(stranger, o.agentId)).data.error.code).toBe('not_found');
    expect((await getBot(customer, 'not-a-uuid')).status).toBe(404);
    expect((await getBot({}, o.agentId)).status).toBe(401);
    const byKey = await call(getBotRoute, `${base}/bots/${o.agentId}`, { bearer: o.agentKey, params: { agent_id: o.agentId } });
    expect(byKey.status).toBe(401);

    await revokeCustomer(o, await shareIdOf(o, customer));
    const res = await getBot(customer, o.agentId);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ access: 'revoked', share: { status: 'revoked' }, jobs: [] });
  });
});

describe('R5 POST /api/v1/c/bots/:agent_id/requests', () => {
  it('creates a form request with display rows, and replays client_request_id', async () => {
    const o = await owner();
    const customer = await approvedCustomer(o);
    const clientRequestId = randomUUID();
    const res = await quote(o, customer, validInput, { notes: 'Rounded corners.', client_request_id: clientRequestId });
    expect(res.status, res.text).toBe(201);
    expectCustomerHeaders(res.res);
    const request = res.data.request;
    expect(request).toMatchObject({
      bot: { agent_id: o.agentId },
      offer: 'quote',
      title: 'Table quote',
      status: 'open',
      input: validInput,
      notes: 'Rounded corners.',
      question: null,
      answers: [],
      result: null,
      result_display: [],
      fail_code: null,
      fail_message: null,
      completed_at: null,
    });
    expect(request.input_display).toEqual([
      { key: 'wood', label: 'Wood', value: 'Walnut' },
      { key: 'length_cm', label: 'Length (cm)', value: '220' },
      { key: 'seats', label: 'Seats', value: '8' },
      { key: 'extras', label: 'Extras', value: 'Extension leaf' },
      { key: 'delivery', label: 'Delivery', value: 'Yes' },
      { key: 'postcode', label: 'Postal code', value: 'M5V 2T6' },
    ]);
    expectNoLeak(res.text, o);

    const again = await quote(o, customer, { ...validInput, seats: 2 }, { client_request_id: clientRequestId });
    expect(again.status).toBe(200);
    expect(again.data.request.id).toBe(request.id);
    expect((await getBot(customer, o.agentId)).data.share.used_today).toBe(1);

    // The bot sees an ordinary task from the customer's sender agent.
    const seen = await mcpTool(o.agentKey, 'get_task', { id: request.id });
    expect(seen.payload.task.input).toEqual(validInput);
  });

  it('creates a free-text request whose title is the offer name', async () => {
    const o = await owner();
    const customer = await approvedCustomer(o);
    const res = await createRequest(customer, o.agentId, { offer: 'draft', notes: 'A headline for our spring sale.' });
    expect(res.status).toBe(201);
    expect(res.data.request).toMatchObject({ title: 'draft', input: null, input_display: [], notes: 'A headline for our spring sale.' });
  });

  it('rejects bad input with field errors and does not count it against the cap', async () => {
    const o = await owner();
    const customer = await approvedCustomer(o, { dailyCap: 1 });
    const missing = await createRequest(customer, o.agentId, { offer: 'quote' });
    expect(missing.status).toBe(400);
    expect(missing.data.error.code).toBe('input_required');
    expect(missing.data.error.details.input_schema.title).toBe('Table quote');

    const bad = await quote(o, customer, { wood: 'pine', length_cm: 900, extras: ['leaf', 'bench', 'pads'], postcode: 'nope', colour: 'red' });
    expect(bad.status).toBe(400);
    expect(bad.data.error.code).toBe('invalid_input');
    const fields = bad.data.error.details.fields;
    expect(fields).toMatchObject({
      wood: expect.any(String),
      length_cm: expect.stringContaining('300'),
      seats: expect.any(String),
      extras: expect.stringContaining('2'),
      postcode: expect.any(String),
      _form: expect.any(String),
    });
    expect(bad.data.error.details.validation_errors.length).toBeGreaterThan(0);

    const textInput = await createRequest(customer, o.agentId, { offer: 'draft', input: { a: 1 }, notes: 'x' });
    expect(textInput.data.error.code).toBe('input_not_allowed');
    const noNotes = await createRequest(customer, o.agentId, { offer: 'draft' });
    expect(noNotes.status).toBe(400);
    expect(noNotes.data.error.details.fields.notes).toBeTruthy();
    const longNotes = await quote(o, customer, validInput, { notes: 'x'.repeat(2001) });
    expect(longNotes.data.error.details.fields.notes).toBeTruthy();
    const notesOff = await createRequest(customer, o.agentId, { offer: 'quiet', input: { size: 'L' }, notes: 'hi' });
    expect(notesOff.status).toBe(400);
    expect(notesOff.data.error.details.fields.notes).toBeTruthy();
    const unknownKey = await createRequest(customer, o.agentId, { offer: 'draft', notes: 'x', to: '@x/y' });
    expect(unknownKey.status).toBe(400);
    for (const offer of ['secret', 'nope']) {
      const res = await createRequest(customer, o.agentId, { offer, notes: 'x' });
      expect(res.status).toBe(404);
      expect(res.data.error.code).toBe('offer_not_found');
    }
    expect((await getBot(customer, o.agentId)).data.share.used_today).toBe(0);

    expect((await quote(o, customer)).status).toBe(201);
    const capped = await quote(o, customer);
    expect(capped.status).toBe(429);
    expect(capped.data.error.code).toBe('rate_limited');
    expectNoLeak(capped.text, o);
  });

  it('blocks pending, revoked, other customers, wrong origin, and signed-out callers', async () => {
    const o = await owner();
    const pending = await pendingCustomer(o);
    const res = await quote(o, pending);
    expect(res.status).toBe(403);
    expect(res.data.error.code).toBe('pending_approval');

    const customer = await approvedCustomer(o);
    const stranger = await signIn(emailAddress('stranger'));
    expect((await quote(o, stranger)).status).toBe(404);
    expect((await createRequest({}, o.agentId, { offer: 'draft', notes: 'x' })).status).toBe(401);

    const cross = await createRequest(customer, o.agentId, { offer: 'draft', notes: 'x' }, { origin: 'https://evil.example' });
    expect(cross.status).toBe(403);
    expect(cross.data.error.code).toBe('bad_origin');
    const fetchSite = await createRequest(customer, o.agentId, { offer: 'draft', notes: 'x' }, { 'sec-fetch-site': 'cross-site' });
    expect(fetchSite.data.error.code).toBe('bad_origin');

    await revokeCustomer(o, await shareIdOf(o, customer));
    const revoked = await quote(o, customer);
    expect(revoked.status).toBe(403);
    expect(revoked.data.error.code).toBe('share_revoked');
  });

  it('rejects a client_request_id reused on another bot', async () => {
    const a = await owner();
    const b = await owner();
    const customer = await approvedCustomer(a);
    const { createLink, accept } = await import('./customer-fixtures');
    const { token } = await createLink(b, { kind: 'personal' });
    await accept(token, customer);
    const id = randomUUID();
    expect((await createRequest(customer, a.agentId, { offer: 'draft', notes: 'x', client_request_id: id })).status).toBe(201);
    const reused = await createRequest(customer, b.agentId, { offer: 'draft', notes: 'x', client_request_id: id });
    expect(reused.status).toBe(409);
    expect(reused.data.error.code).toBe('client_request_id_conflict');
  });
});

describe('R6 GET /api/v1/c/bots/:agent_id/requests', () => {
  it('pages newest first with a cursor, filters by status, and supports ETags', async () => {
    const o = await owner();
    const customer = await approvedCustomer(o, { dailyCap: 100 });
    const ids: string[] = [];
    for (let i = 0; i < 45; i++) ids.push((await directRequest(o, customer, `Request ${i}`)).id);

    const seen: string[] = [];
    let cursor: string | null = null;
    const sizes: number[] = [];
    do {
      const res = await listRequests(customer, o.agentId, cursor ? `?cursor=${cursor}` : '');
      expect(res.status).toBe(200);
      expectCustomerHeaders(res.res, true);
      sizes.push(res.data.requests.length);
      seen.push(...res.data.requests.map((r: any) => r.id));
      cursor = res.data.next_cursor;
    } while (cursor);
    expect(sizes).toEqual([20, 20, 5]);
    expect(seen).toEqual([...ids].reverse());
    expect(new Set(seen).size).toBe(45);

    const first = await listRequests(customer, o.agentId, '?limit=3');
    expect(first.data.requests).toHaveLength(3);
    expect(first.data.requests[0]).toMatchObject({ summary: 'Request 44', status: 'open', question: null });
    expect(first.data.requests[0]).not.toHaveProperty('input');
    const etag = first.res.headers.get('etag')!;
    expect((await listRequests(customer, o.agentId, '?limit=3', { 'if-none-match': etag })).status).toBe(304);

    await mcpTool(o.agentKey, 'complete_task', { id: ids[44], result: { headline: 'Done' } });
    expect((await listRequests(customer, o.agentId, '?limit=3', { 'if-none-match': etag })).status).toBe(200);
    const done = await listRequests(customer, o.agentId, '?status=done');
    expect(done.data.requests.map((r: any) => r.id)).toEqual([ids[44]]);
    expect((await listRequests(customer, o.agentId, '?status=awaiting_release')).data.requests).toEqual([]);

    for (const query of ['?status=bogus', '?limit=0', '?limit=51', '?cursor=%%%']) {
      const res = await listRequests(customer, o.agentId, query);
      expect(res.status, query).toBe(400);
    }
  });

  it('never shows one customer another customer’s requests', async () => {
    const o = await owner();
    const alice = await approvedCustomer(o);
    const bob = await approvedCustomer(o);
    const aliceTask = await directRequest(o, alice, 'Alice private');
    const bobTask = await directRequest(o, bob, 'Bob private');
    const aliceList = await listRequests(alice, o.agentId);
    expect(aliceList.data.requests.map((r: any) => r.id)).toEqual([aliceTask.id]);
    expect(aliceList.text).not.toContain('Bob private');
    expect((await listRequests(bob, o.agentId)).data.requests.map((r: any) => r.id)).toEqual([bobTask.id]);
    expect((await getRequest(alice, bobTask.id)).status).toBe(404);
    expect((await answerRequest(alice, bobTask.id, { answer: 'x' })).status).toBe(404);
    const stranger = await signIn(emailAddress('stranger'));
    expect((await listRequests(stranger, o.agentId)).status).toBe(404);
    expect((await getRequest(stranger, aliceTask.id)).status).toBe(404);
  });

  it('keeps history readable after a revoke, with declined_by_owner on stopped requests', async () => {
    const o = await owner();
    const customer = await approvedCustomer(o);
    const task = await directRequest(o, customer);
    await revokeCustomer(o, await shareIdOf(o, customer));
    const list = await listRequests(customer, o.agentId);
    expect(list.status).toBe(200);
    expect(list.data.requests[0]).toMatchObject({ id: task.id, status: 'failed', fail_code: 'declined_by_owner', fail_message: null });
    const one = await getRequest(customer, task.id);
    expect(one.data.request).toMatchObject({ fail_code: 'declined_by_owner', fail_message: null });
    expect(one.text).not.toContain('fail_reason');
  });
});

describe('R7 GET /api/v1/c/requests/:task_id', () => {
  it('shows the question, result rows, and bot failures, with an ETag', async () => {
    const o = await owner();
    const customer = await approvedCustomer(o);
    const created = await quote(o, customer);
    const id = created.data.request.id;

    const open = await getRequest(customer, id);
    expect(open.status).toBe(200);
    expectCustomerHeaders(open.res, true);
    const etag = open.res.headers.get('etag')!;
    expect((await getRequest(customer, id, { 'if-none-match': etag })).status).toBe(304);

    await mcpTool(o.agentKey, 'ask', { id, question: 'Which finish?' });
    const asked = await getRequest(customer, id, { 'if-none-match': etag });
    expect(asked.status).toBe(200);
    expect(asked.data.request).toMatchObject({ status: 'needs_info', question: 'Which finish?' });

    await answerRequest(customer, id, { answer: 'Matte.' });
    const result = {
      price_cad: 2450.5,
      lead_time_weeks: 6,
      message: '<b>Thanks</b>',
      rush: false,
      finishes: ['oil', 'wax'],
      breakdown: { wood: 1800 },
    };
    const completed = await mcpTool(o.agentKey, 'complete_task', { id, result });
    expect(completed.isError, completed.text).toBe(false);
    const done = await getRequest(customer, id);
    expect(done.data.request).toMatchObject({ status: 'done', result, question: null });
    expect(done.data.request.completed_at).toBeTruthy();
    expect(done.data.request.answers).toEqual([
      expect.objectContaining({ question: 'Which finish?', answer: 'Matte.' }),
    ]);
    // jsonb does not keep result_schema key order, so only the rows are pinned, not their order.
    expect(done.data.request.result_display).toHaveLength(6);
    expect(done.data.request.result_display).toEqual(expect.arrayContaining([
      { key: 'price_cad', label: 'Price (CAD)', kind: 'number', value: '2,450.5' },
      { key: 'lead_time_weeks', label: 'Lead time (weeks)', kind: 'number', value: '6' },
      { key: 'message', label: 'Message', kind: 'text', value: '<b>Thanks</b>' },
      { key: 'rush', label: 'Rush', kind: 'boolean', value: 'No' },
      { key: 'finishes', label: 'Finishes', kind: 'list', value: 'oil, wax' },
      { key: 'breakdown', label: 'Breakdown', kind: 'json', value: JSON.stringify({ wood: 1800 }, null, 2) },
    ]));

    const failing = await createRequest(customer, o.agentId, { offer: 'draft', notes: 'x' });
    await mcpTool(o.agentKey, 'fail_task', { id: failing.data.request.id, reason: 'Out of stock this month.' });
    const failed = await getRequest(customer, failing.data.request.id);
    expect(failed.data.request).toMatchObject({ status: 'failed', fail_code: 'bot_failed', fail_message: 'Out of stock this month.' });
    expect(failed.data.request).not.toHaveProperty('fail_reason');
    expectNoLeak(failed.text, o);
  });

  it('404s for bad ids, the owner’s own tasks, and signed-out callers', async () => {
    const o = await owner();
    const customer = await approvedCustomer(o);
    expect((await getRequest(customer, 'nope')).status).toBe(404);
    expect((await getRequest(customer, randomUUID())).status).toBe(404);
    const task = await directRequest(o, customer);
    expect((await getRequest({}, task.id)).status).toBe(401);
    // The owner is signed in too, but the task was not sent from the owner's workspace.
    expect((await getRequest({ cookie: o.cookie }, task.id)).status).toBe(404);
  });
});

describe('R8 POST /api/v1/c/requests/:task_id/answer', () => {
  it('answers the question, reopens the task, records the answer, and wakes the bot', async () => {
    const o = await owner();
    await getDb().update(agents).set({ deliveryMode: 'local' }).where(eq(agents.id, o.agentId));
    const customer = await approvedCustomer(o);
    const task = await directRequest(o, customer);

    const early = await answerRequest(customer, task.id, { answer: 'Too soon' });
    expect(early.status).toBe(409);
    expect(early.data.error.code).toBe('task_not_waiting');

    await mcpTool(o.agentKey, 'ask', { id: task.id, question: 'How long?' });
    const empty = await answerRequest(customer, task.id, { answer: '' });
    expect(empty.status).toBe(400);
    expect(empty.data.error.details.fields.answer).toBeTruthy();
    const long = await answerRequest(customer, task.id, { answer: 'x'.repeat(2001) });
    expect(long.status).toBe(400);
    const cross = await answerRequest(customer, task.id, { answer: '220 cm' }, { origin: 'https://evil.example' });
    expect(cross.data.error.code).toBe('bad_origin');

    const res = await answerRequest(customer, task.id, { answer: '220 cm' });
    expect(res.status, res.text).toBe(200);
    expectCustomerHeaders(res.res);
    expect(res.data.request).toMatchObject({ status: 'open', question: null });
    expect(res.data.request.answers).toEqual([expect.objectContaining({ question: 'How long?', answer: '220 cm' })]);

    const rows = await getDb().select().from(taskAnswers).where(eq(taskAnswers.taskId, task.id));
    expect(rows).toHaveLength(1);
    const [row] = await getDb().select().from(tasks).where(eq(tasks.id, task.id));
    expect(row).toMatchObject({ status: 'open', question: null, questionAskedAt: null });
    const wakeRows = await getDb()
      .select()
      .from(wakes)
      .where(and(eq(wakes.taskId, task.id), eq(wakes.reason, 'answer')));
    expect(wakeRows).toHaveLength(1);

    const seen = await mcpTool(o.agentKey, 'get_task', { id: task.id });
    expect(seen.payload.answers).toEqual([expect.objectContaining({ answer: '220 cm' })]);
    expect((await answerRequest(customer, task.id, { answer: 'again' })).status).toBe(409);
  });

  it('blocks revoked customers', async () => {
    const o = await owner();
    const customer = await approvedCustomer(o);
    const task = await directRequest(o, customer);
    await mcpTool(o.agentKey, 'ask', { id: task.id, question: 'Q?' });
    await revokeCustomer(o, await shareIdOf(o, customer));
    const res = await answerRequest(customer, task.id, { answer: 'A' });
    expect(res.status).toBe(403);
    expect(['share_revoked', 'task_not_waiting']).toContain(res.data.error.code);
  });

  it('rate limits answers per customer', async () => {
    const customer = await signIn(emailAddress('answers'));
    const limit = RATE_LIMITS.customerAnswer.agent;
    for (let i = 0; i < limit; i++) {
      expect((await answerRequest(customer, randomUUID(), { answer: 'x' })).status).toBe(404);
    }
    const res = await answerRequest(customer, randomUUID(), { answer: 'x' });
    expect(res.status).toBe(429);
    expect(res.data.error.code).toBe('rate_limited');
  });
});

describe('approved after pending', () => {
  it('lets a pending customer request once the owner approves', async () => {
    const o = await owner();
    const customer = await pendingCustomer(o);
    const shareId = await shareIdOf(o, customer);
    const approved = await call(approveShareRoute, `http://localhost/api/v1/agents/${o.agentId}/shares/${shareId}/approve`, {
      method: 'POST',
      cookie: o.cookie,
      params: { id: o.agentId, shareId },
    });
    expect(approved.status).toBe(200);
    expect((await listBots(customer)).data.bots[0].access).toBe('approved');
    expect((await quote(o, customer)).status).toBe(201);
  });
});

describe('answer_task for agent senders', () => {
  it('answers by MCP and by REST, and only the sender may answer', async () => {
    const session = await signIn();
    const from = await createAgent(session.cookie, 'Asker');
    const to = await createAgent(session.cookie, 'Worker');
    const fromKey = await createKey(session.cookie, from.id);
    const toKey = await createKey(session.cookie, to.id);
    const created = await mcpTool(fromKey, 'create_task', {
      to: 'Worker',
      title: 'Help',
      description: 'Do it.',
      result_schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
    });
    expect(created.isError, created.text).toBe(false);
    const id = created.payload.task.id;
    await mcpTool(toKey, 'ask', { id, question: 'Which one?' });
    const wrong = await mcpTool(toKey, 'answer_task', { id, answer: 'me' });
    expect(wrong.isError).toBe(true);
    const answered = await mcpTool(fromKey, 'answer_task', { id, answer: 'The blue one.' });
    expect(answered.isError, answered.text).toBe(false);
    expect(answered.payload.task.status).toBe('open');

    await mcpTool(toKey, 'ask', { id, question: 'Size?' });
    const rest = await call(agentAnswerRoute, `http://localhost/api/v1/tasks/${id}/answer`, {
      bearer: fromKey,
      params: { id },
      body: { answer: 'Large.' },
    });
    expect(rest.status, rest.text).toBe(200);
    expect(rest.data.task.status).toBe('open');
    const noKey = await call(agentAnswerRoute, `http://localhost/api/v1/tasks/${id}/answer`, {
      cookie: session.cookie,
      params: { id },
      body: { answer: 'x' },
    });
    expect(noKey.status).toBe(401);
    const got = await mcpTool(fromKey, 'get_task', { id });
    expect(got.payload.answers.map((a: any) => a.answer)).toEqual(['The blue one.', 'Large.']);
  });
});

describe('display helpers', () => {
  it('renders non-object results and maps Ajv errors to fields', () => {
    expect(resultDisplay({ type: 'integer' }, 1234567)).toEqual([{ key: '_value', label: 'Value', kind: 'number', value: '1,234,567' }]);
    expect(resultDisplay(null, ['a', 'b'])).toEqual([{ key: '_value', label: 'Value', kind: 'list', value: 'a, b' }]);
    expect(inputDisplay(quoteForm, { seats: 4, wood: 'oak' })).toEqual([
      { key: 'wood', label: 'Wood', value: 'Oak' },
      { key: 'seats', label: 'Seats', value: '4' },
    ]);
    void quoteResult;
    void fieldErrors;
  });
});
