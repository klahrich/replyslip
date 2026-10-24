import { describe, expect, it } from 'vitest';
import { GET as me } from '@/app/api/v1/auth/me/route';
import { POST as logout } from '@/app/api/v1/auth/logout/route';
import { POST as requestCode } from '@/app/api/v1/auth/request-code/route';
import { POST as verifyCode } from '@/app/api/v1/auth/verify-code/route';
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

  it('stops sending codes after the per-email limit but still returns the generic 200', async () => {
    const email = emailAddress('limit');
    for (let i = 0; i < RATE_LIMITS.requestCode.email; i += 1) {
      const res = await call(requestCode, 'http://localhost/api/v1/auth/request-code', { body: { email } });
      expect(res.status).toBe(200);
    }
    const sent = inbox.filter((message) => message.to === email).length;
    const blocked = await call(requestCode, 'http://localhost/api/v1/auth/request-code', { body: { email } });
    expect(blocked.status).toBe(200);
    expect(blocked.data.message).toBe(REQUEST_CODE_MESSAGE);
    expect(inbox.filter((message) => message.to === email)).toHaveLength(sent);
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
