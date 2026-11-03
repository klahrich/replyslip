import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { rateEvents, wakeUrls } from '@/db/schema';
import { GET as pollRoute } from '@/app/api/v1/wake/[token]/route';
import { GET as listRoute, POST as issueRoute } from '@/app/api/v1/agents/[id]/wake-urls/route';
import { POST as rotateRoute } from '@/app/api/v1/agents/[id]/wake-urls/[wakeUrlId]/rotate/route';
import { POST as revokeRoute } from '@/app/api/v1/agents/[id]/wake-urls/[wakeUrlId]/revoke/route';
import { RATE_LIMITS } from '@/lib/constants';
import { keyedHash, sha256 } from '@/lib/crypto';
import { issueWakeUrl, revokeWakeUrl, rotateWakeUrl, type WakeSubject } from '@/lib/wake-urls';
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

  it('rate limits per token and per IP, unknown tokens included', async () => {
    const { token } = await setup();
    const rule = RATE_LIMITS.wakePoll;
    const tokenKey = keyedHash('wake_url_rate', token).slice(0, 40);
    await getDb()
      .insert(rateEvents)
      .values(Array.from({ length: rule.agent }, () => ({ kind: 'wakePoll', email: tokenKey, ip: 'seed' })));
    const limited = await poll(token);
    expect(limited.status).toBe(429);
    expect(Number(limited.res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(limited.res.headers.get('cache-control')).toBe('no-store');

    const ip = '203.0.113.77';
    const ipKey = keyedHash('wake_url_ip', ip).slice(0, 40);
    await getDb()
      .insert(rateEvents)
      .values(Array.from({ length: rule.ip }, () => ({ kind: 'wakePoll', email: 'seed', ip: ipKey })));
    expect((await poll(`rwu_${'B'.repeat(43)}`, { ip })).status).toBe(429);
    expect((await poll(`rwu_${'B'.repeat(43)}`)).status).toBe(404);
  });

  it('lets only the owner issue, list, rotate and revoke, and shows the full URL only at issue and rotate', async () => {
    const session = await signIn();
    const agent = await createAgent(session.cookie, 'MuseBot');
    const otherAgent = await createAgent(session.cookie, 'NotMuse');
    const base = `http://localhost/api/v1/agents/${agent.id}/wake-urls`;
    const params = { id: agent.id };

    expect((await call(issueRoute, base, { method: 'POST', params })).status).toBe(401);
    const otherKey = await createKey(session.cookie, otherAgent.id);
    expect((await call(issueRoute, base, { method: 'POST', params, bearer: otherKey })).status).toBe(404);
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

    // The agent's own rsk_ key may rotate it.
    const ownKey = await createKey(session.cookie, agent.id);
    const wakeUrlId = issued.data.wake_url.id as string;
    const rotated = await call(rotateRoute, `${base}/${wakeUrlId}/rotate`, {
      method: 'POST',
      params: { id: agent.id, wakeUrlId },
      bearer: ownKey,
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
    const revoked = await call(revokeRoute, `${base}/${newId}/revoke`, {
      method: 'POST',
      params: { id: agent.id, wakeUrlId: newId },
      cookie: session.cookie,
    });
    expect(revoked.status).toBe(200);
    expect(revoked.data.wake_url.status).toBe('revoked');
    expect(revoked.text).not.toContain(tokenOf(newUrl));
    expect((await poll(tokenOf(newUrl))).status).toBe(404);
    // After a revoke the agent may be given a fresh URL.
    expect((await call(issueRoute, base, { method: 'POST', params, cookie: session.cookie })).status).toBe(201);
  });
});
