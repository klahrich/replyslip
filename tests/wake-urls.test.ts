import { describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { rateEvents, wakeUrls, wakes } from '@/db/schema';
import { GET as pollRoute } from '@/app/api/v1/wake/[token]/route';
import { GET as listRoute, POST as issueRoute } from '@/app/api/v1/agents/[id]/wake-urls/route';
import { POST as rotateRoute } from '@/app/api/v1/agents/[id]/wake-urls/[wakeUrlId]/rotate/route';
import { POST as revokeRoute } from '@/app/api/v1/agents/[id]/wake-urls/[wakeUrlId]/revoke/route';
import { keyedHash, sha256 } from '@/lib/crypto';
import { enqueueWake } from '@/lib/wakes';
import { WAKE_POLL_LIMITS, issueWakeUrl, revokeWakeUrl, rotateWakeUrl, type WakeSubject } from '@/lib/wake-urls';
import { call, createAgent, createKey, mcpTool, signIn } from './helpers';

const schema = { type: 'object', additionalProperties: false, required: ['score'], properties: { score: { type: 'number' } } };

function tokenOf(url: string): string {
  return url.slice(url.lastIndexOf('/') + 1);
}

/** Each poll from its own made-up IP unless one is given, so the per-IP limit never trips by accident. */
let ipCounter = 0;
async function poll(token: string, init: { ip?: string; ifNoneMatch?: string; query?: string } = {}) {
  ipCounter += 1;
  const headers: Record<string, string> = { 'x-forwarded-for': init.ip ?? `198.51.100.${ipCounter % 250}-${ipCounter}` };
  if (init.ifNoneMatch) headers['if-none-match'] = init.ifNoneMatch;
  return call(pollRoute, `http://localhost/api/v1/wake/${token}${init.query ?? ''}`, { headers, params: { token } });
}

async function setup() {
  const session = await signIn();
  const sender = await createAgent(session.cookie, 'WakeSender');
  const target = await createAgent(session.cookie, 'WakeTarget');
  const other = await createAgent(session.cookie, 'WakeOther');
  const senderKey = await createKey(session.cookie, sender.id);
  const subject: WakeSubject = { kind: 'agent', workspaceId: session.workspace.id, agentId: target.id };
  const issued = await issueWakeUrl(subject, 'https://valetto.example');
  return { session, sender, target, other, senderKey, subject, issued, token: tokenOf(issued.url) };
}

async function sendTask(key: string, to: string) {
  const created = await mcpTool(key, 'create_task', { to, title: 'Made-up task', description: 'CANARY-wake-desc', result_schema: schema });
  expect(created.isError).toBe(false);
  return created.payload.task.id as string;
}

describe('wake URLs', () => {
  it('round-trips a hashed token to an opaque id with nothing else in the body', async () => {
    const { issued, token, target } = await setup();
    expect(issued.url).toBe(`https://valetto.example/api/v1/wake/${token}`);
    expect(token.startsWith('rwu_')).toBe(true);
    // 32 random bytes in base64url: 256 bits, well over 128.
    expect(token.length).toBeGreaterThanOrEqual(4 + 43);
    const [row] = await getDb().select().from(wakeUrls).where(eq(wakeUrls.id, issued.row.id));
    expect(row?.tokenHash).toBe(sha256(token));
    expect(JSON.stringify(row)).not.toContain(token);

    const res = await poll(token);
    expect(res.status).toBe(200);
    expect(Object.keys(res.data)).toEqual(['id']);
    expect(res.data.id).toMatch(/^[0-9a-f]{32}$/);
    expect(res.text).not.toContain(target.id);
    expect(res.res.headers.get('cache-control')).toBe('private, max-age=10');
    expect(res.res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(res.res.headers.get('etag')).toBe(`"${res.data.id}"`);
  });

  it('keeps the id stable without new activity and answers 304 to a matching If-None-Match', async () => {
    const { token } = await setup();
    const first = await poll(token);
    const second = await poll(token);
    const withQuery = await poll(token, { query: '?since=1&debug=1' });
    expect(second.data.id).toBe(first.data.id);
    expect(withQuery.data.id).toBe(first.data.id);
    const cached = await poll(token, { ifNoneMatch: first.res.headers.get('etag')! });
    expect(cached.status).toBe(304);
    expect(cached.text).toBe('');
    const star = await poll(token, { ifNoneMatch: '*' });
    expect(star.status).toBe(304);
    expect(star.text).toBe('');
    expect(star.res.headers.get('etag')).toBe(first.res.headers.get('etag'));
    expect((await poll(token, { ifNoneMatch: '"stale", W/"other"' })).status).toBe(200);
  });

  it('changes the id when a wake row with an older timestamp commits late', async () => {
    const { token, subject } = await setup();
    const db = getDb();
    await db.insert(wakes).values({ workspaceId: subject.workspaceId, agentId: subject.agentId, reason: 'test', status: 'cancelled' });
    const before = (await poll(token)).data.id;
    // A row stamped a minute before the newest one, as from a transaction that started earlier and committed later.
    await db.execute(sql`
      insert into wakes (workspace_id, agent_id, reason, status, created_at)
      select workspace_id, agent_id, 'test', 'cancelled', created_at - interval '1 minute'
      from wakes where agent_id = ${subject.agentId} order by created_at desc limit 1
    `);
    expect((await poll(token)).data.id).not.toBe(before);
  });

  it('changes the id on a new task or message for the agent, never to a raw task id', async () => {
    const { token, senderKey } = await setup();
    const before = (await poll(token)).data.id;
    const taskId = await sendTask(senderKey, 'WakeTarget');
    const afterTask = await poll(token);
    expect(afterTask.data.id).not.toBe(before);
    expect(afterTask.text).not.toContain(taskId);
    expect(afterTask.text).not.toContain(taskId.replace(/-/g, ''));
    expect(afterTask.text).not.toContain('CANARY');
    expect((await poll(token)).data.id).toBe(afterTask.data.id);

    const sent = await mcpTool(senderKey, 'send_message', { to: 'WakeTarget', body: 'hello' });
    expect(sent.isError).toBe(false);
    const afterMessage = (await poll(token)).data.id;
    expect(afterMessage).not.toBe(afterTask.data.id);
  });

  it("does not change on other agents' tasks, in the same workspace or another one", async () => {
    const { token, senderKey } = await setup();
    const before = (await poll(token)).data.id;
    await sendTask(senderKey, 'WakeOther');
    const sent = await mcpTool(senderKey, 'send_message', { to: 'WakeOther', body: 'not for the target' });
    expect(sent.isError).toBe(false);
    const elsewhere = await signIn();
    // Same agent name in another workspace: its tasks never touch this URL.
    await createAgent(elsewhere.cookie, 'WakeTarget');
    const elsewhereKey = await createKey(elsewhere.cookie, (await createAgent(elsewhere.cookie, 'ElsewhereSender')).id);
    await sendTask(elsewhereKey, 'WakeTarget');
    expect((await poll(token)).data.id).toBe(before);
  });

  it('gives each agent its own token and id', async () => {
    const { subject, other, token, session } = await setup();
    const second = await issueWakeUrl({ ...subject, agentId: other.id }, 'https://valetto.example');
    expect(tokenOf(second.url)).not.toBe(token);
    expect((await poll(tokenOf(second.url))).data.id).not.toBe((await poll(token)).data.id);
    // One active URL per agent.
    await expect(issueWakeUrl(subject, 'https://valetto.example')).rejects.toMatchObject({ status: 409, code: 'wake_url_exists' });
    expect(session.workspace.id).toBe(subject.workspaceId);
  });

  it('answers revoked, rotated-away and unknown tokens with the same 404', async () => {
    const { subject, issued, token } = await setup();
    const unknown = await poll(`rwu_${'A'.repeat(43)}`);
    expect(unknown.status).toBe(404);

    const rotated = await rotateWakeUrl(subject, issued.row.id, 'https://valetto.example');
    const old = await poll(token);
    expect(old.status).toBe(404);
    const fresh = await poll(tokenOf(rotated.url));
    expect(fresh.status).toBe(200);

    await revokeWakeUrl(subject, rotated.row.id);
    const revoked = await poll(tokenOf(rotated.url));
    for (const res of [old, revoked]) {
      expect(res.status).toBe(404);
      expect(res.text).toBe(unknown.text);
      expect([...res.res.headers.entries()].sort()).toEqual([...unknown.res.headers.entries()].sort());
    }
  });

  it('404s once the agent itself is revoked', async () => {
    const { session, target, token } = await setup();
    const { POST: revokeAgentRoute } = await import('@/app/api/v1/agents/[id]/revoke/route');
    const res = await call(revokeAgentRoute, `http://localhost/api/v1/agents/${target.id}/revoke`, {
      method: 'POST',
      cookie: session.cookie,
      params: { id: target.id },
    });
    expect(res.status).toBe(200);
    expect((await poll(token)).status).toBe(404);
  });

  it('rate limits each token on its own row and writes no rate_events row for a good poll', async () => {
    const { token, issued } = await setup();
    const db = getDb();
    const countEvents = async () => (await db.select().from(rateEvents).where(eq(rateEvents.kind, 'wakeMiss'))).length;
    const missesBefore = await countEvents();
    const ip = '203.0.113.10';
    for (let i = 0; i < 5; i += 1) expect((await poll(token, { ip })).status).toBe(200);
    expect(await countEvents()).toBe(missesBefore);
    const [row] = await db.select().from(wakeUrls).where(eq(wakeUrls.id, issued.row.id));
    expect(row?.pollCount).toBe(5);
    expect(row?.lastUsedAt).not.toBeNull();

    await db.update(wakeUrls).set({ pollCount: WAKE_POLL_LIMITS.perToken }).where(eq(wakeUrls.id, issued.row.id));
    const limited = await poll(token, { ip });
    expect(limited.status).toBe(429);
    const retryAfter = Number(limited.res.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(WAKE_POLL_LIMITS.windowSeconds);
    expect(limited.res.headers.get('cache-control')).toBe('no-store');

    // A new window starts the count again.
    await db
      .update(wakeUrls)
      .set({ pollWindowStartedAt: new Date(Date.now() - (WAKE_POLL_LIMITS.windowSeconds + 1) * 1000) })
      .where(eq(wakeUrls.id, issued.row.id));
    expect((await poll(token, { ip })).status).toBe(200);
    const [reset] = await db.select().from(wakeUrls).where(eq(wakeUrls.id, issued.row.id));
    expect(reset?.pollCount).toBe(1);
  });

  it('limits misses per IP but never good polls from a busy IP', async () => {
    const { token } = await setup();
    const db = getDb();
    const platformIp = '203.0.113.77';
    const ipKey = keyedHash('wake_url_ip', platformIp).slice(0, 40);
    const unknown = `rwu_${'B'.repeat(43)}`;
    // Many good polls from one platform address are fine: there is no per-IP cap on them.
    const many = await setup();
    for (const t of [token, many.token, token, many.token]) expect((await poll(t, { ip: platformIp })).status).toBe(200);

    // Each miss is recorded against the IP; at the cap, further misses from it get 429.
    expect((await poll(unknown, { ip: platformIp })).status).toBe(404);
    const recorded = await db.select().from(rateEvents).where(and(eq(rateEvents.kind, 'wakeMiss'), eq(rateEvents.ip, ipKey)));
    expect(recorded).toHaveLength(1);
    await db
      .insert(rateEvents)
      .values(Array.from({ length: WAKE_POLL_LIMITS.missesPerIp - 1 }, () => ({ kind: 'wakeMiss', ip: ipKey })));
    const limited = await poll(unknown, { ip: platformIp });
    expect(limited.status).toBe(429);
    expect(Number(limited.res.headers.get('retry-after'))).toBeGreaterThan(0);
    // The same IP still gets answers for real tokens, and other IPs still get the plain 404.
    expect((await poll(token, { ip: platformIp })).status).toBe(200);
    expect((await poll(unknown)).status).toBe(404);
  });

  it('writes a marker row for a delivery-none agent only while it has an active wake URL', async () => {
    const session = await signIn();
    const agent = await createAgent(session.cookie, 'NoneAgent');
    const subject: WakeSubject = { kind: 'agent', workspaceId: session.workspace.id, agentId: agent.id };
    const db = getDb();
    const rowsFor = async () => (await db.select().from(wakes).where(eq(wakes.agentId, agent.id))).length;
    const insert = (tx = db) => enqueueWake(tx, { workspaceId: subject.workspaceId, agentId: agent.id, reason: 'test' });

    expect(await insert()).toBeNull();
    expect(await rowsFor()).toBe(0);

    const issued = await issueWakeUrl(subject, 'https://valetto.example');
    expect(await insert()).toBeNull();
    const rows = await db.select().from(wakes).where(eq(wakes.agentId, agent.id));
    expect(rows.map((row) => row.status)).toEqual(['cancelled']);

    await revokeWakeUrl(subject, issued.row.id);
    expect(await insert()).toBeNull();
    expect(await rowsFor()).toBe(1);

    // Before migration 0019 the table is missing: enqueueWake reads that as "no URL" and the caller's transaction
    // carries on. Simulated by dropping the table inside a transaction that is then rolled back.
    const rollback = new Error('rollback');
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`drop table wake_urls`);
        expect(await insert(tx as unknown as typeof db)).toBeNull();
        await tx.execute(sql`select 1`);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(await rowsFor()).toBe(1);
  });

  it('issues and rotates for the owner session only, lists and revokes for the owner or the agent key, and shows the URL once', async () => {
    const session = await signIn();
    const agent = await createAgent(session.cookie, 'MuseBot');
    const otherAgent = await createAgent(session.cookie, 'NotMuse');
    const base = `http://localhost/api/v1/agents/${agent.id}/wake-urls`;
    const params = { id: agent.id };

    expect((await call(issueRoute, base, { method: 'POST', params })).status).toBe(401);
    const otherKey = await createKey(session.cookie, otherAgent.id);
    expect((await call(listRoute, base, { params, bearer: otherKey })).status).toBe(404);
    // Issuing mints a secret, so it takes the owner's session: no agent key, not even the agent's own.
    const ownKey = await createKey(session.cookie, agent.id);
    for (const bearer of [otherKey, ownKey]) {
      const res = await call(issueRoute, base, { method: 'POST', params, bearer });
      expect(res.status).toBe(403);
      expect(res.data.error.code).toBe('human_required');
    }
    const stranger = await signIn();
    expect((await call(issueRoute, base, { method: 'POST', params, cookie: stranger.cookie })).status).toBe(404);
    expect((await call(issueRoute, base, { method: 'POST', params, bearer: 'rsoa_made_up' })).status).toBe(403);

    const issued = await call(issueRoute, base, { method: 'POST', params, cookie: session.cookie });
    expect(issued.status).toBe(201);
    const url = issued.data.wake_url.url as string;
    expect(url).toMatch(/\/api\/v1\/wake\/rwu_[A-Za-z0-9_-]{43}$/);
    expect(issued.res.headers.get('cache-control')).toBe('private, no-store');
    expect((await call(issueRoute, base, { method: 'POST', params, cookie: session.cookie })).status).toBe(409);
    expect((await poll(tokenOf(url))).status).toBe(200);

    const listed = await call(listRoute, base, { params, cookie: session.cookie });
    expect(listed.status).toBe(200);
    expect(listed.data.wake_urls).toHaveLength(1);
    expect(listed.data.wake_urls[0].prefix).toBe(tokenOf(url).slice(0, 12));
    expect(listed.text).not.toContain(tokenOf(url));
    expect(listed.data.wake_urls[0]).not.toHaveProperty('url');
    // The agent's own key may list (prefixes only).
    const listedByKey = await call(listRoute, base, { params, bearer: ownKey });
    expect(listedByKey.status).toBe(200);
    expect(listedByKey.text).not.toContain(tokenOf(url));

    // Rotating mints a secret too: session only.
    const wakeUrlId = issued.data.wake_url.id as string;
    const rotateByKey = await call(rotateRoute, `${base}/${wakeUrlId}/rotate`, {
      method: 'POST',
      params: { id: agent.id, wakeUrlId },
      bearer: ownKey,
    });
    expect(rotateByKey.status).toBe(403);
    expect((await poll(tokenOf(url))).status).toBe(200);
    const rotated = await call(rotateRoute, `${base}/${wakeUrlId}/rotate`, {
      method: 'POST',
      params: { id: agent.id, wakeUrlId },
      cookie: session.cookie,
    });
    expect(rotated.status).toBe(200);
    expect(rotated.data.revoked.status).toBe('revoked');
    const newUrl = rotated.data.wake_url.url as string;
    expect(newUrl).not.toBe(url);
    expect((await poll(tokenOf(url))).status).toBe(404);
    expect((await poll(tokenOf(newUrl))).status).toBe(200);
    const again = await call(rotateRoute, `${base}/${wakeUrlId}/rotate`, {
      method: 'POST',
      params: { id: agent.id, wakeUrlId },
      cookie: session.cookie,
    });
    expect(again.status).toBe(409);

    const newId = rotated.data.wake_url.id as string;
    // Another agent's key cannot revoke it.
    const revokeByOther = await call(revokeRoute, `${base}/${newId}/revoke`, {
      method: 'POST',
      params: { id: agent.id, wakeUrlId: newId },
      bearer: otherKey,
    });
    expect(revokeByOther.status).toBe(404);
    // The agent's own key may revoke: it only takes access away.
    const revoked = await call(revokeRoute, `${base}/${newId}/revoke`, {
      method: 'POST',
      params: { id: agent.id, wakeUrlId: newId },
      bearer: ownKey,
    });
    expect(revoked.status).toBe(200);
    expect(revoked.data.wake_url.status).toBe('revoked');
    expect(revoked.text).not.toContain(tokenOf(newUrl));
    expect((await poll(tokenOf(newUrl))).status).toBe(404);
    // After a revoke the agent may be given a fresh URL.
    expect((await call(issueRoute, base, { method: 'POST', params, cookie: session.cookie })).status).toBe(201);
  });
});
