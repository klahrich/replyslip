import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { rateEvents } from '@/db/schema';
import { GET as me } from '@/app/api/v1/auth/me/route';
import { POST as logout } from '@/app/api/v1/auth/logout/route';
import { POST as requestCode } from '@/app/api/v1/auth/request-code/route';
import { POST as verifyCode } from '@/app/api/v1/auth/verify-code/route';
import { PATCH as renameWorkspace } from '@/app/api/v1/workspaces/current/route';
import { GET as listAgents } from '@/app/api/v1/agents/route';
import { GET as listTasks } from '@/app/api/v1/tasks/route';
import { POST as mcp } from '@/app/api/mcp/route';
import { GET as cron } from '@/app/api/cron/wakes/route';
import { REQUEST_CODE_MESSAGE } from '@/lib/auth';
import { RATE_LIMITS } from '@/lib/constants';
import { call, emailAddress, expireLatestCode, signIn } from './helpers';
import { inbox, latestCode } from './inbox';

describe('passwordless auth', () => {
  it('requests a code without revealing whether the email exists, then verifies it', async () => {
    const email = emailAddress('new');
    const first = await call(requestCode, 'http://localhost/api/v1/auth/request-code', { body: { email } });
    const again = await call(requestCode, 'http://localhost/api/v1/auth/request-code', {
      body: { email: email.toUpperCase() },
    });
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(first.data).toEqual({ ok: true, message: REQUEST_CODE_MESSAGE });
    expect(again.data).toEqual(first.data);
    expect(first.text).not.toMatch(/\d{6}/);
    expect(inbox.filter((message) => message.to === email)).toHaveLength(2);

    const verified = await call(verifyCode, 'http://localhost/api/v1/auth/verify-code', {
      body: { email, code: latestCode(email) },
    });
    expect(verified.status).toBe(200);
    expect(verified.cookie).toMatch(/^replyslip_session=/);
    expect(verified.res.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    expect(verified.res.headers.get('set-cookie')).toMatch(/Secure/i);
    expect(verified.res.headers.get('set-cookie')).toMatch(/SameSite=Lax/i);
    expect(verified.data.user.email).toBe(email);
    expect(verified.data.user.email_verified_at).toBeTruthy();
    expect(verified.data.workspace.id).toBeTruthy();

    const who = await call(me, 'http://localhost/api/v1/auth/me', { cookie: verified.cookie! });
    expect(who.status).toBe(200);
    expect(who.data.workspace.id).toBe(verified.data.workspace.id);

    const againUser = await signIn(email);
    expect(againUser.workspace.id).toBe(verified.data.workspace.id);
  });

  it('rejects a wrong code, then still accepts the right one', async () => {
    const email = emailAddress('wrong');
    await call(requestCode, 'http://localhost/api/v1/auth/request-code', { body: { email } });
    const wrong = await call(verifyCode, 'http://localhost/api/v1/auth/verify-code', {
      body: { email, code: '000000' },
    });
    expect(wrong.status).toBe(401);
    expect(wrong.data.error.code).toBe('invalid_code');
    const ok = await call(verifyCode, 'http://localhost/api/v1/auth/verify-code', {
      body: { email, code: latestCode(email) },
    });
    expect(ok.status).toBe(200);
  });

  it('rejects an expired code', async () => {
    const email = emailAddress('expired');
    await call(requestCode, 'http://localhost/api/v1/auth/request-code', { body: { email } });
    const code = latestCode(email);
    await expireLatestCode(email);
    const expired = await call(verifyCode, 'http://localhost/api/v1/auth/verify-code', {
      body: { email, code },
    });
    expect(expired.status).toBe(401);
    expect(expired.data.error.code).toBe('expired_code');
  });

  it('kills a code after the attempt limit', async () => {
    const email = emailAddress('attempts');
    await call(requestCode, 'http://localhost/api/v1/auth/request-code', { body: { email } });
    const code = latestCode(email);
    for (let i = 0; i < 4; i += 1) {
      const wrong = await call(verifyCode, 'http://localhost/api/v1/auth/verify-code', {
        body: { email, code: '111111' },
      });
      expect(wrong.data.error.code).toBe('invalid_code');
    }
    const lastWrong = await call(verifyCode, 'http://localhost/api/v1/auth/verify-code', {
      body: { email, code: '111111' },
    });
    expect(lastWrong.data.error.code).toBe('code_exhausted');
    const correct = await call(verifyCode, 'http://localhost/api/v1/auth/verify-code', {
      body: { email, code },
    });
    expect(correct.status).toBe(401);
    expect(correct.data.error.code).toBe('code_exhausted');
  });

  it('rejects a reused code', async () => {
    const email = emailAddress('reuse');
    await call(requestCode, 'http://localhost/api/v1/auth/request-code', { body: { email } });
    const code = latestCode(email);
    const first = await call(verifyCode, 'http://localhost/api/v1/auth/verify-code', { body: { email, code } });
    expect(first.status).toBe(200);
    const second = await call(verifyCode, 'http://localhost/api/v1/auth/verify-code', { body: { email, code } });
    expect(second.status).toBe(401);
    expect(second.data.error.code).toBe('code_already_used');
  });

  it('returns 429 when the email is over the limit and does not count the blocked attempt', async () => {
    const email = emailAddress('limit');
    for (let i = 0; i < RATE_LIMITS.requestCode.email; i += 1) {
      const res = await call(requestCode, 'http://localhost/api/v1/auth/request-code', { body: { email } });
      expect(res.status).toBe(200);
      expect(res.data).toEqual({ ok: true, message: REQUEST_CODE_MESSAGE });
    }
    const sent = inbox.filter((message) => message.to === email).length;
    const blocked = await call(requestCode, 'http://localhost/api/v1/auth/request-code', { body: { email } });
    expect(blocked.status).toBe(429);
    expect(blocked.data.error.code).toBe('rate_limited');
    expect(blocked.data.error.retry_after_seconds).toBeGreaterThan(0);
    expect(blocked.data.error.retry_after_seconds).toBeLessThanOrEqual(RATE_LIMITS.requestCode.windowMs / 1000);
    expect(blocked.res.headers.get('retry-after')).toBe(String(blocked.data.error.retry_after_seconds));
    expect(inbox.filter((message) => message.to === email)).toHaveLength(sent);

    const counted = await getDb()
      .select()
      .from(rateEvents)
      .where(eq(rateEvents.email, email));
    expect(counted).toHaveLength(RATE_LIMITS.requestCode.email);

    await getDb().delete(rateEvents).where(eq(rateEvents.id, counted[0]!.id));
    const after = await call(requestCode, 'http://localhost/api/v1/auth/request-code', { body: { email } });
    expect(after.status).toBe(200);
    expect(inbox.filter((message) => message.to === email)).toHaveLength(sent + 1);
  });

  it('returns the same 429 for a new email once the IP limit is reached, without counting the blocked try', async () => {
    for (let i = 0; i < RATE_LIMITS.requestCode.ip; i += 1) {
      const res = await call(requestCode, 'http://localhost/api/v1/auth/request-code', {
        body: { email: emailAddress(`ip-${i}`) },
        headers: { 'x-forwarded-for': '203.0.113.10' },
      });
      expect(res.status).toBe(200);
    }
    const fresh = emailAddress('ip-blocked');
    const known = emailAddress('ip-known');
    await call(requestCode, 'http://localhost/api/v1/auth/request-code', { body: { email: known } });
    const blockedFresh = await call(requestCode, 'http://localhost/api/v1/auth/request-code', {
      body: { email: fresh },
      headers: { 'x-forwarded-for': '203.0.113.10' },
    });
    const blockedKnown = await call(requestCode, 'http://localhost/api/v1/auth/request-code', {
      body: { email: known },
      headers: { 'x-forwarded-for': '203.0.113.10' },
    });
    expect(blockedFresh.status).toBe(429);
    expect(blockedKnown.status).toBe(429);
    expect(blockedFresh.data.error.code).toBe('rate_limited');
    expect(blockedKnown.data.error.code).toBe('rate_limited');
    expect(blockedFresh.data.error.message).toBe(blockedKnown.data.error.message);
    expect(inbox.some((message) => message.to === fresh)).toBe(false);

    const ipRows = await getDb().select().from(rateEvents).where(eq(rateEvents.ip, '203.0.113.10'));
    expect(ipRows).toHaveLength(RATE_LIMITS.requestCode.ip);
  });

  it('renames the signed-in workspace and rejects a bad name', async () => {
    const session = await signIn();
    const renamed = await call(renameWorkspace, 'http://localhost/api/v1/workspaces/current', {
      method: 'PATCH',
      cookie: session.cookie,
      body: { name: '  Meal planning  ' },
    });
    expect(renamed.status).toBe(200);
    expect(renamed.data.workspace).toEqual({
      id: session.workspace.id,
      name: 'Meal planning',
      created_at: session.workspace.created_at,
    });
    const who = await call(me, 'http://localhost/api/v1/auth/me', { cookie: session.cookie });
    expect(who.data.workspace.name).toBe('Meal planning');

    const blank = await call(renameWorkspace, 'http://localhost/api/v1/workspaces/current', {
      method: 'PATCH',
      cookie: session.cookie,
      body: { name: '   ' },
    });
    expect(blank.status).toBe(400);
    expect(blank.data.error.code).toBe('validation_error');
    const tooLong = await call(renameWorkspace, 'http://localhost/api/v1/workspaces/current', {
      method: 'PATCH',
      cookie: session.cookie,
      body: { name: 'a'.repeat(81) },
    });
    expect(tooLong.status).toBe(400);
    const exact = await call(renameWorkspace, 'http://localhost/api/v1/workspaces/current', {
      method: 'PATCH',
      cookie: session.cookie,
      body: { name: 'b'.repeat(80) },
    });
    expect(exact.status).toBe(200);
    expect(exact.data.workspace.name).toBe('b'.repeat(80));
    const signedOut = await call(renameWorkspace, 'http://localhost/api/v1/workspaces/current', {
      method: 'PATCH',
      body: { name: 'Nope' },
    });
    expect(signedOut.status).toBe(401);
  });

  it('requires auth on human, MCP, and cron routes', async () => {
    expect((await call(me, 'http://localhost/api/v1/auth/me')).status).toBe(401);
    expect((await call(listAgents, 'http://localhost/api/v1/agents')).status).toBe(401);
    expect((await call(listTasks, 'http://localhost/api/v1/tasks')).status).toBe(401);
    const mcpRes = await mcp(
      new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      }),
    );
    expect(mcpRes.status).toBe(401);
    const cronRes = await cron(new Request('http://localhost/api/cron/wakes'));
    expect(cronRes.status).toBe(401);
  });

  it('logs out', async () => {
    const session = await signIn();
    const done = await call(logout, 'http://localhost/api/v1/auth/logout', { cookie: session.cookie });
    expect(done.status).toBe(200);
    const who = await call(me, 'http://localhost/api/v1/auth/me', { cookie: session.cookie });
    expect(who.status).toBe(401);
  });
});
