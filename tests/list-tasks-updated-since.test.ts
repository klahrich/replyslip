import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUT as putReviewModeRoute } from '@/app/api/v1/agents/[id]/review-mode/route';
import { POST as reviewActionRoute } from '@/app/api/v1/reviews/[id]/[action]/route';
import { GET as workspaceTasksRoute } from '@/app/api/v1/tasks/route';
import { getDb } from '@/db';
import { oauthClients, tasks } from '@/db/schema';
import { setCimdFetcherForTests } from '@/lib/oauth/cimd';
import { approvedCustomer, directRequest, ORIGIN, owner } from './customer-fixtures';
import { call, createAgent, createKey, mcpTool, signIn } from './helpers';
import { stubCimd } from './oauth-fixtures';
import { ISSUER, connect } from './oauth-flow';

const RESULT_SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
const task = (to: string, title = 'Work') => ({ to, title, description: 'Do the work.', result_schema: RESULT_SCHEMA });
const OLD = '2020-01-01T00:00:00.000Z';
const SINCE = '2021-01-01T00:00:00Z';

/** Two agents in one workspace: alice sends, bob receives. */
async function pair() {
  const session = await signIn();
  const alice = await createAgent(session.cookie, 'alice');
  const bob = await createAgent(session.cookie, 'bob');
  return {
    session,
    aliceKey: await createKey(session.cookie, alice.id),
    bobKey: await createKey(session.cookie, bob.id),
  };
}

async function create(key: string, to: string, title?: string): Promise<string> {
  const res = await mcpTool(key, 'create_task', task(to, title));
  expect(res.isError, res.text).toBe(false);
  return res.payload.task.id as string;
}

/** Moves tasks into the past, so only a later change can bring them back. */
async function backdate(ids: string[], at = OLD) {
  for (const id of ids) {
    await getDb().update(tasks).set({ updatedAt: new Date(at) }).where(eq(tasks.id, id));
  }
}

async function changedSince(key: string, args: Record<string, unknown> = {}) {
  const res = await mcpTool(key, 'list_tasks', { updated_since: SINCE, ...args });
  expect(res.isError, res.text).toBe(false);
  return res.payload as { tasks: Array<{ id: string; updated_at: string; created_at: string }>; next_cursor: string | null };
}

const ids = (page: { tasks: Array<{ id: string }> }) => page.tasks.map((t) => t.id);

describe('tasks.updated_at moves on every change', () => {
  it('a thread message brings an old task back; a message outside a task does not', async () => {
    const { aliceKey, bobKey } = await pair();
    const t1 = await create(aliceKey, 'bob', 'one');
    const t2 = await create(aliceKey, 'bob', 'two');
    await backdate([t1, t2]);
    expect(ids(await changedSince(bobKey))).toEqual([]);

    const msg = await mcpTool(bobKey, 'send_message', { to: 'alice', body: 'on it', task_id: t1 });
    expect(msg.isError, msg.text).toBe(false);
    const forBob = await changedSince(bobKey);
    const forAlice = await changedSince(aliceKey);
    expect(ids(forBob)).toEqual([t1]);
    expect(ids(forAlice)).toEqual([t1]);
    expect(Date.parse(forBob.tasks[0]!.updated_at)).toBeGreaterThan(Date.parse(SINCE));
    expect(forBob.tasks[0]!.created_at).not.toBe(forBob.tasks[0]!.updated_at);

    await backdate([t1]);
    expect((await mcpTool(bobKey, 'send_message', { to: 'alice', body: 'hello' })).isError).toBe(false);
    expect(ids(await changedSince(bobKey))).toEqual([]);
  });

  it('ask, answer, complete and fail each bring the task back', async () => {
    const { aliceKey, bobKey } = await pair();
    const t = await create(aliceKey, 'bob');
    const other = await create(aliceKey, 'bob', 'other');

    await backdate([t, other]);
    expect((await mcpTool(bobKey, 'ask', { id: t, question: 'Which one?' })).isError).toBe(false);
    expect(ids(await changedSince(aliceKey))).toEqual([t]);

    await backdate([t]);
    expect((await mcpTool(aliceKey, 'answer_task', { id: t, answer: 'The first.' })).isError).toBe(false);
    expect(ids(await changedSince(bobKey))).toEqual([t]);

    await backdate([t]);
    expect((await mcpTool(bobKey, 'complete_task', { id: t, result: { ok: true } })).isError).toBe(false);
    expect(ids(await changedSince(aliceKey))).toEqual([t]);

    await backdate([t]);
    expect((await mcpTool(bobKey, 'fail_task', { id: other, reason: 'Cannot.' })).isError).toBe(false);
    expect(ids(await changedSince(aliceKey))).toEqual([other]);
  });

  it('an owner review brings the task back for the bot', async () => {
    const o = await owner();
    const mode = await call(putReviewModeRoute, `http://localhost/api/v1/agents/${o.agentId}/review-mode`, {
      method: 'PUT',
      cookie: o.cookie,
      params: { id: o.agentId },
      body: { review_mode: 'review_first' },
      headers: ORIGIN,
    });
    expect(mode.status, mode.text).toBe(200);
    const customer = await approvedCustomer(o);
    const request = await directRequest(o, customer);
    expect(request.status).toBe('in_review');
    await backdate([request.id]);

    const approved = await call(reviewActionRoute, `http://localhost/api/v1/reviews/${request.id}/approve`, {
      method: 'POST',
      cookie: o.cookie,
      params: { id: request.id, action: 'approve' },
      headers: ORIGIN,
    });
    expect(approved.status, approved.text).toBe(200);
    expect(ids(await changedSince(o.agentKey, { role: 'received' }))).toEqual([request.id]);
  });
});

describe('list_tasks order, updated_since and paging', () => {
  it('sorts by updated_at desc then id desc, not by creation', async () => {
    const { aliceKey, bobKey } = await pair();
    const first = await create(aliceKey, 'bob', 'first');
    const second = await create(aliceKey, 'bob', 'second');
    const third = await create(aliceKey, 'bob', 'third');
    // The oldest task changed last; the other two tie on updated_at, so id breaks the tie.
    await backdate([second, third], '2022-01-01T00:00:00.000Z');
    await backdate([first], '2023-01-01T00:00:00.000Z');
    const tied = [second, third].sort().reverse();

    const page = await changedSince(bobKey);
    expect(ids(page)).toEqual([first, ...tied]);
    expect(page.next_cursor).toBeNull();
    // Without updated_since: the same order, and every item carries updated_at.
    const all = (await mcpTool(bobKey, 'list_tasks', {})).payload;
    expect(all.tasks.map((t: { id: string }) => t.id)).toEqual([first, ...tied]);
    expect(all.tasks.every((t: { updated_at?: string }) => typeof t.updated_at === 'string')).toBe(true);
    // updated_since is inclusive.
    expect(ids(await changedSince(bobKey, { updated_since: '2023-01-01T00:00:00Z' }))).toEqual([first]);
    expect(ids(await changedSince(bobKey, { updated_since: '2023-01-01T00:00:00.001Z' }))).toEqual([]);
  });

  it('pages past 100 with next_cursor, without gaps or repeats, on tied timestamps', async () => {
    const { session, aliceKey, bobKey } = await pair();
    const seed = await create(aliceKey, 'bob', 'seed');
    const [row] = await getDb().select().from(tasks).where(eq(tasks.id, seed));
    // 104 more rows, half sharing one microsecond timestamp.
    await getDb().insert(tasks).values(
      Array.from({ length: 104 }, (_, i) => ({
        workspaceId: row!.workspaceId,
        fromWorkspaceId: row!.fromWorkspaceId,
        fromAgentId: row!.fromAgentId,
        toAgentId: row!.toAgentId,
        title: `bulk ${i}`,
        description: 'x',
        resultSchema: RESULT_SCHEMA,
      })),
    );
    await getDb().execute(
      sql`update tasks set updated_at = '2024-05-05 05:05:05.123456+00' where to_agent_id = ${row!.toAgentId} and title like 'bulk 1%'`,
    );

    const first = (await mcpTool(bobKey, 'list_tasks', {})).payload;
    expect(first.tasks).toHaveLength(100);
    expect(typeof first.next_cursor).toBe('string');
    const second = (await mcpTool(bobKey, 'list_tasks', { cursor: first.next_cursor })).payload;
    expect(second.tasks).toHaveLength(5);
    expect(second.next_cursor).toBeNull();
    const seen = [...first.tasks, ...second.tasks].map((t: { id: string }) => t.id);
    expect(new Set(seen).size).toBe(105);

    // The dashboard list pages the same way, with its own limit.
    const pages: string[] = [];
    let cursor: string | null = null;
    let calls = 0;
    do {
      const q = new URLSearchParams({ limit: '40', ...(cursor ? { cursor } : {}) });
      const res = await call(workspaceTasksRoute, `http://localhost/api/v1/tasks?${q}`, { cookie: session.cookie });
      expect(res.status, res.text).toBe(200);
      pages.push(...res.data.tasks.map((t: { id: string }) => t.id));
      cursor = res.data.next_cursor;
      calls += 1;
    } while (cursor && calls < 10);
    expect(calls).toBe(3);
    expect(pages).toEqual(seen);
  });

  it('rejects a bad updated_since or cursor', async () => {
    const { session, bobKey } = await pair();
    for (const args of [{ updated_since: 'yesterday' }, { updated_since: '2026-13-01T00:00:00Z' }, { cursor: 'nope' }]) {
      const res = await mcpTool(bobKey, 'list_tasks', args);
      expect(res.isError).toBe(true);
      expect(res.payload).toMatchObject({ error: 'validation_error' });
    }
    for (const q of ['updated_since=2026-11-03', 'cursor=bm9wZQ']) {
      const res = await call(workspaceTasksRoute, `http://localhost/api/v1/tasks?${q}`, { cookie: session.cookie });
      expect(res.status).toBe(400);
      expect(res.data.error.code).toBe('validation_error');
    }
    const ok = await call(workspaceTasksRoute, `http://localhost/api/v1/tasks?updated_since=${encodeURIComponent('2026-11-03T12:00:00-05:00')}`, {
      cookie: session.cookie,
    });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.data.next_cursor).toBeNull();
  });
});

describe('scope rules are unchanged', () => {
  beforeEach(async () => {
    await getDb().delete(oauthClients);
    vi.stubEnv('MCP_OAUTH_ENABLED', '1');
    vi.stubEnv('MCP_OAUTH_ISSUER', ISSUER);
    stubCimd();
  });
  afterEach(() => {
    setCimdFetcherForTests(null);
    vi.unstubAllEnvs();
  });

  it('an OAuth app sees only tasks it sent or received, with or without updated_since', async () => {
    const ownerSession = await signIn();
    const app = await connect(ownerSession, { mode: 'new', name: 'chatgpt' });
    const oauth = app.tokens.access_token as string;
    const bee = await createAgent(ownerSession.cookie, 'bee');
    const cee = await createAgent(ownerSession.cookie, 'cee');
    const beeKey = await createKey(ownerSession.cookie, bee.id);
    await createKey(ownerSession.cookie, cee.id);

    const toApp = await create(beeKey, 'chatgpt', 'for the app');
    const notTheApps = await create(beeKey, 'cee', 'not for the app');
    const fromApp = (await mcpTool(oauth, 'create_task', task('bee', 'from the app'))).payload.task.id as string;
    await mcpTool(beeKey, 'send_message', { to: 'cee', body: 'side thread', task_id: notTheApps });

    const listed = (await mcpTool(oauth, 'list_tasks', {})).payload;
    expect(listed.tasks.map((t: { id: string }) => t.id).sort()).toEqual([toApp, fromApp].sort());
    const since = await changedSince(oauth);
    expect(ids(since).sort()).toEqual([toApp, fromApp].sort());
    expect(ids(since)).not.toContain(notTheApps);
  });
});
