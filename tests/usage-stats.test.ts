import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { GET as statsRoute } from '@/app/api/admin/stats/route';
import { POST as requestCode } from '@/app/api/v1/auth/request-code/route';
import { POST as verifyCode } from '@/app/api/v1/auth/verify-code/route';
import { POST as createAgentRoute } from '@/app/api/v1/agents/route';
import { POST as registerRoute } from '@/app/api/v1/agents/register/route';
import { getDb } from '@/db';
import { messages, tasks, users } from '@/db/schema';
import { firstAgentAlertText, setEmailSenderForTests } from '@/lib/email';
import {
  flushFirstAgentAlerts,
  publicDeliveryMode,
  setFirstAgentAlertSchedulerForTests,
} from '@/lib/first-agent-alert';
import { call, createAgent, createJoinCode, emailAddress, signIn } from './helpers';
import { alerts, inbox, latestCode } from './inbox';

const KEY = 'test-stats-key';
const savedEnv = {
  STATS_API_KEY: process.env.STATS_API_KEY,
  STATS_EXCLUDE_WORKSPACE_IDS: process.env.STATS_EXCLUDE_WORKSPACE_IDS,
  ALERT_EMAIL: process.env.ALERT_EMAIL,
};

afterEach(() => {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function stats(days?: number, bearer?: string) {
  const query = days === undefined ? '' : `?days=${days}`;
  return call(statsRoute, `http://localhost/api/admin/stats${query}`, {
    method: 'GET',
    bearer,
  });
}

async function signInWithSource(source: string | null, email = emailAddress('owner')) {
  const requested = await call(requestCode, 'http://localhost/api/v1/auth/request-code', {
    body: { email, source },
  });
  expect(requested.status).toBe(200);
  const verified = await call(verifyCode, 'http://localhost/api/v1/auth/verify-code', {
    body: { email, code: latestCode(email) },
  });
  expect(verified.status).toBe(200);
  return { email, cookie: verified.cookie!, user: verified.data.user, workspace: verified.data.workspace };
}

describe('signup source', () => {
  it('stores a trimmed source only on the first request-code', async () => {
    const email = emailAddress('source');
    const padded = `  ${'landing'.padEnd(210, 'x')}  `;
    const first = await call(requestCode, 'http://localhost/api/v1/auth/request-code', {
      body: { email, source: padded },
    });
    expect(first.status).toBe(200);
    const [created] = await getDb().select().from(users).where(eq(users.email, email.toLowerCase()));
    expect(created?.signupSource).toBe(padded.trim().slice(0, 200));
    expect(created?.signupSource).toHaveLength(200);

    const again = await call(requestCode, 'http://localhost/api/v1/auth/request-code', {
      body: { email, source: 'replaced' },
    });
    expect(again.status).toBe(200);
    const [still] = await getDb().select().from(users).where(eq(users.email, email.toLowerCase()));
    expect(still?.signupSource).toBe(created?.signupSource);

    const blank = emailAddress('blank');
    await call(requestCode, 'http://localhost/api/v1/auth/request-code', {
      body: { email: blank, source: '   ' },
    });
    const [empty] = await getDb().select().from(users).where(eq(users.email, blank.toLowerCase()));
    expect(empty?.signupSource).toBeNull();

    const session = await signInWithSource('landing-hero');
    expect(JSON.stringify(session.user)).not.toContain('landing-hero');
    expect(JSON.stringify(session.user)).not.toContain('signup_source');
  });
});

async function requestWith(body: Record<string, unknown>) {
  const res = await call(requestCode, 'http://localhost/api/v1/auth/request-code', { body });
  expect(res.status).toBe(200);
  return res;
}

async function wantsSharingOf(email: string) {
  const [row] = await getDb().select().from(users).where(eq(users.email, email.toLowerCase()));
  return row?.wantsSharing;
}

describe('wants_sharing', () => {
  it('records true for a new user, defaults to false otherwise', async () => {
    const yes = emailAddress('share-new');
    await requestWith({ email: yes, wants_sharing: true });
    expect(await wantsSharingOf(yes)).toBe(true);

    const no = emailAddress('share-none');
    await requestWith({ email: no });
    expect(await wantsSharingOf(no)).toBe(false);
  });

  it('records true for an existing user and never flips it back', async () => {
    const email = emailAddress('share-later');
    await requestWith({ email, wants_sharing: false });
    expect(await wantsSharingOf(email)).toBe(false);

    await requestWith({ email, wants_sharing: true });
    expect(await wantsSharingOf(email)).toBe(true);

    await requestWith({ email, wants_sharing: false });
    await requestWith({ email });
    expect(await wantsSharingOf(email)).toBe(true);
  });

  it('ignores values that are not boolean true', async () => {
    for (const value of ['true', 1, 'yes', null, {}, []]) {
      const email = emailAddress('share-odd');
      await requestWith({ email, wants_sharing: value });
      expect(await wantsSharingOf(email)).toBe(false);
    }
  });

  it('is counted in admin stats for outside users only, and not returned to the user', async () => {
    process.env.STATS_API_KEY = KEY;
    delete process.env.STATS_EXCLUDE_WORKSPACE_IDS;
    const before = await stats(1, KEY);
    expect(typeof before.data.wants_sharing).toBe('number');

    const email = emailAddress('share-stats');
    await requestWith({ email, wants_sharing: true });
    const verified = await call(verifyCode, 'http://localhost/api/v1/auth/verify-code', {
      body: { email, code: latestCode(email) },
    });
    expect(verified.status).toBe(200);
    expect(JSON.stringify(verified.data.user)).not.toContain('sharing');

    const mid = await stats(1, KEY);
    expect(mid.data.wants_sharing).toBe(before.data.wants_sharing + 1);

    process.env.STATS_EXCLUDE_WORKSPACE_IDS = verified.data.workspace.id;
    const after = await stats(1, KEY);
    expect(after.data.wants_sharing).toBe(before.data.wants_sharing);
  });
});

describe('admin stats', () => {
  it('is 404 until the key is set, then 401 for a bad key', async () => {
    delete process.env.STATS_API_KEY;
    const hidden = await stats(undefined, 'anything');
    expect(hidden.status).toBe(404);
    expect(hidden.data).toEqual({ error: { code: 'not_found', message: 'Not found.' } });
    expect(hidden.res.headers.get('x-robots-tag')).toBe('noindex');
    expect(hidden.res.headers.get('cache-control')).toBe('no-store');

    process.env.STATS_API_KEY = KEY;
    const missing = await stats();
    expect(missing.status).toBe(401);
    const wrong = await stats(14, 'nope');
    expect(wrong.status).toBe(401);
    expect(wrong.data).toEqual({ error: { code: 'unauthorized', message: 'Unauthorized.' } });
    expect(wrong.res.headers.get('x-robots-tag')).toBe('noindex');
    expect(wrong.res.headers.get('cache-control')).toBe('no-store');

    const badDays = await stats(91, KEY);
    expect(badDays.status).toBe(400);
    expect(badDays.res.headers.get('cache-control')).toBe('no-store');

    const ok = await stats(undefined, KEY);
    expect(ok.status).toBe(200);
    expect(ok.data.days).toBe(14);
    expect(ok.data.series).toHaveLength(14);
    expect(ok.res.headers.get('x-robots-tag')).toBe('noindex');
    expect(ok.res.headers.get('cache-control')).toBe('no-store');

    const wide = await stats(90, KEY);
    expect(wide.status).toBe(200);
    expect(wide.data.series).toHaveLength(90);
  });

  it('counts outside usage, drops excluded workspaces, and returns no personal data', async () => {
    process.env.STATS_API_KEY = KEY;
    delete process.env.STATS_EXCLUDE_WORKSPACE_IDS;
    const before = await stats(1, KEY);
    expect(before.status).toBe(200);

    const marker = `zzsecret${randomUUID().replace(/-/g, '')}`;
    const session = await signInWithSource('landing-hero', `${marker}@example.com`);
    const alpha = await createAgent(session.cookie, 'AlphaBot');
    const beta = await createAgent(session.cookie, 'BetaBot');
    const now = new Date();
    await getDb().insert(tasks).values([
      {
        workspaceId: session.workspace.id,
        fromAgentId: alpha.id,
        toAgentId: beta.id,
        title: `${marker}-title`,
        description: `${marker}-description`,
        resultSchema: { type: 'object' },
        status: 'done',
        completedAt: now,
        createdAt: now,
      },
      {
        workspaceId: session.workspace.id,
        fromAgentId: beta.id,
        toAgentId: alpha.id,
        title: `${marker}-failed-title`,
        description: `${marker}-failed-description`,
        resultSchema: { type: 'object' },
        status: 'failed',
        failReason: `${marker}-reason`,
        completedAt: now,
        createdAt: now,
      },
    ]);
    await getDb().insert(messages).values({
      workspaceId: session.workspace.id,
      fromAgentId: alpha.id,
      toAgentId: beta.id,
      body: `${marker}-body`,
      createdAt: now,
    });

    const mid = await stats(1, KEY);
    expect(mid.status).toBe(200);
    expect(mid.data.totals.signups).toBe(before.data.totals.signups + 1);
    expect(mid.data.totals.workspaces).toBe(before.data.totals.workspaces + 1);
    expect(mid.data.totals.agents_registered).toBe(before.data.totals.agents_registered + 2);
    expect(mid.data.totals.active_agents).toBe(before.data.totals.active_agents + 2);
    expect(mid.data.totals.tasks_created).toBe(before.data.totals.tasks_created + 2);
    expect(mid.data.totals.tasks_completed).toBe(before.data.totals.tasks_completed + 1);
    expect(mid.data.totals.tasks_failed).toBe(before.data.totals.tasks_failed + 1);
    expect(mid.data.totals.messages_sent).toBe(before.data.totals.messages_sent + 1);
    expect(mid.data.totals.signups_by_source['landing-hero']).toBe(
      (before.data.totals.signups_by_source['landing-hero'] ?? 0) + 1,
    );
    const today = mid.data.series[mid.data.series.length - 1];
    expect(today.signups_by_source['landing-hero']).toBeGreaterThan(0);

    const excluded = await signInWithSource('excluded-source', `other-${marker}@example.com`);
    const hiddenA = await createAgent(excluded.cookie, 'HiddenBot');
    const hiddenB = await createAgent(excluded.cookie, 'HiddenTwo');
    await getDb().insert(messages).values({
      workspaceId: excluded.workspace.id,
      fromAgentId: hiddenA.id,
      toAgentId: hiddenB.id,
      body: `${marker}-hidden-body`,
    });

    process.env.STATS_EXCLUDE_WORKSPACE_IDS = ` not-a-uuid , ${excluded.workspace.id.toUpperCase()} `;
    const after = await stats(1, KEY);
    expect(after.data.totals.signups).toBe(mid.data.totals.signups);
    expect(after.data.totals.workspaces).toBe(mid.data.totals.workspaces);
    expect(after.data.totals.agents_registered).toBe(mid.data.totals.agents_registered);
    expect(after.data.totals.active_agents).toBe(mid.data.totals.active_agents);
    expect(after.data.totals.messages_sent).toBe(mid.data.totals.messages_sent);
    expect(after.data.totals.signups_by_source['excluded-source'] ?? 0).toBe(
      mid.data.totals.signups_by_source['excluded-source'] ?? 0,
    );

    const text = after.text.toLowerCase();
    expect(text).not.toContain(marker);
    expect(text).not.toContain(session.email.toLowerCase());
    expect(text).not.toContain(session.workspace.id);
    expect(text).not.toContain(alpha.id);
    expect(text).not.toContain('@');
    expect(JSON.stringify(after.data)).not.toMatch(/"id"/);
  });
});

describe('first-agent alert', () => {
  it('defers the alert to the scheduler on both registration paths', async () => {
    process.env.ALERT_EMAIL = 'ops@example.com';
    const tasks: Array<() => Promise<void>> = [];
    setFirstAgentAlertSchedulerForTests((task) => {
      tasks.push(task);
    });

    const session = await signInWithSource('sched-source');
    const created = await call(createAgentRoute, 'http://localhost/api/v1/agents', {
      cookie: session.cookie,
      body: { name: 'ScheduledBot' },
    });
    expect(created.status).toBe(201);
    expect(alerts).toHaveLength(0);
    expect(tasks).toHaveLength(1);
    await tasks[0]!();
    expect(alerts.map((alert) => alert.agentName)).toEqual(['ScheduledBot']);

    const join = await createJoinCode(session.cookie);
    const second = await call(registerRoute, 'http://localhost/api/v1/agents/register', {
      bearer: join.secret,
      body: { name: 'LaterBot' },
    });
    expect(second.status).toBe(201);
    expect(tasks).toHaveLength(1);

    const hookSession = await signInWithSource('sched-hook');
    const hookJoin = await createJoinCode(hookSession.cookie);
    const hooked = await call(registerRoute, 'http://localhost/api/v1/agents/register', {
      bearer: hookJoin.secret,
      body: {
        name: 'ScheduledHook',
        webhook: { url: 'https://example.com/hooks/replyslip', auth: { type: 'none' } },
      },
    });
    expect(hooked.status).toBe(201);
    expect(alerts).toHaveLength(1);
    expect(tasks).toHaveLength(2);
    await tasks[1]!();
    expect(alerts[1]?.deliveryMode).toBe('webhook');
    expect(alerts[1]?.agentName).toBe('ScheduledHook');
  });

  it('maps herdr onto local', () => {
    expect(publicDeliveryMode('webhook')).toBe('webhook');
    expect(publicDeliveryMode('local')).toBe('local');
    expect(publicDeliveryMode('herdr')).toBe('local');
    expect(publicDeliveryMode('none')).toBe('none');
  });

  it('alerts once for the first agent, skips excluded workspaces, and ignores a send failure', async () => {
    delete process.env.ALERT_EMAIL;
    delete process.env.STATS_EXCLUDE_WORKSPACE_IDS;
    const quiet = await signInWithSource('quiet-source');
    await createAgent(quiet.cookie, 'QuietBot');
    await flushFirstAgentAlerts();
    expect(alerts).toHaveLength(0);

    process.env.ALERT_EMAIL = 'ops@example.com';
    const session = await signInWithSource('landing-hero');
    const first = await call(createAgentRoute, 'http://localhost/api/v1/agents', {
      cookie: session.cookie,
      body: { name: 'FirstBot' },
    });
    const second = await call(createAgentRoute, 'http://localhost/api/v1/agents', {
      cookie: session.cookie,
      body: { name: 'SecondBot' },
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    await flushFirstAgentAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      to: 'ops@example.com',
      workspaceName: session.workspace.name,
      ownerEmail: session.email.toLowerCase(),
      agentName: 'FirstBot',
      deliveryMode: 'none',
      signupSource: 'landing-hero',
    });
    expect(firstAgentAlertText(alerts[0]!).toString()).toContain(`Time (UTC): ${alerts[0]!.createdAt.toISOString()}`);
    expect(firstAgentAlertText(alerts[0]!)).toContain('Delivery: none');
    expect(firstAgentAlertText(alerts[0]!)).toContain('Signup source: landing-hero');

    alerts.length = 0;
    const [racedA, racedB] = await Promise.all([
      call(createAgentRoute, 'http://localhost/api/v1/agents', {
        cookie: session.cookie,
        body: { name: 'RaceA' },
      }),
      call(createAgentRoute, 'http://localhost/api/v1/agents', {
        cookie: session.cookie,
        body: { name: 'RaceB' },
      }),
    ]);
    expect(racedA.status).toBe(201);
    expect(racedB.status).toBe(201);
    await flushFirstAgentAlerts();
    expect(alerts).toHaveLength(0);

    const fresh = await signIn();
    alerts.length = 0;
    const [parallelA, parallelB] = await Promise.all([
      call(createAgentRoute, 'http://localhost/api/v1/agents', {
        cookie: fresh.cookie,
        body: { name: 'ParallelA' },
      }),
      call(createAgentRoute, 'http://localhost/api/v1/agents', {
        cookie: fresh.cookie,
        body: { name: 'ParallelB' },
      }),
    ]);
    expect(parallelA.status).toBe(201);
    expect(parallelB.status).toBe(201);
    await flushFirstAgentAlerts();
    expect(alerts).toHaveLength(1);

    const join = await createJoinCode(fresh.cookie);
    alerts.length = 0;
    const registered = await call(registerRoute, 'http://localhost/api/v1/agents/register', {
      bearer: join.secret,
      body: {
        name: 'HookBot',
        webhook: { url: 'https://example.com/hooks/replyslip', auth: { type: 'none' } },
      },
    });
    expect(registered.status).toBe(201);
    await flushFirstAgentAlerts();
    expect(alerts).toHaveLength(0);

    const hookSession = await signInWithSource('hook-source');
    const hookJoin = await createJoinCode(hookSession.cookie);
    alerts.length = 0;
    const hooked = await call(registerRoute, 'http://localhost/api/v1/agents/register', {
      bearer: hookJoin.secret,
      body: {
        name: 'FirstHook',
        webhook: { url: 'https://example.com/hooks/replyslip', auth: { type: 'none' } },
      },
    });
    expect(hooked.status).toBe(201);
    await flushFirstAgentAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.deliveryMode).toBe('webhook');
    expect(firstAgentAlertText(alerts[0]!)).toContain('Delivery: webhook');

    const excluded = await signInWithSource('excluded-source');
    process.env.STATS_EXCLUDE_WORKSPACE_IDS = excluded.workspace.id;
    alerts.length = 0;
    const hidden = await call(createAgentRoute, 'http://localhost/api/v1/agents', {
      cookie: excluded.cookie,
      body: { name: 'HiddenBot' },
    });
    expect(hidden.status).toBe(201);
    await flushFirstAgentAlerts();
    expect(alerts).toHaveLength(0);

    const noisy = await signIn();
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    };
    setEmailSenderForTests({
      async sendLoginCode(message) {
        inbox.push(message);
      },
      async sendFirstAgentAlert(message) {
        alerts.push(message);
        throw new Error('smtp down');
      },
    });
    try {
      alerts.length = 0;
      const created = await call(createAgentRoute, 'http://localhost/api/v1/agents', {
        cookie: noisy.cookie,
        body: { name: 'StillSaved' },
      });
      expect(created.status).toBe(201);
      await flushFirstAgentAlerts();
      expect(alerts).toHaveLength(1);
      expect(errors.some((line) => line.includes('first-agent alert failed: smtp down'))).toBe(true);
      expect(errors.join('\n')).not.toContain(noisy.email.toLowerCase());
    } finally {
      console.error = original;
    }
  });
});
