import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { GET as listAgentsRoute } from '@/app/api/v1/agents/route';
import { PUT as putAccess } from '@/app/api/v1/agents/[id]/customer-access/route';
import { GET as listInvitesRoute, POST as postInvite } from '@/app/api/v1/agents/[id]/invites/route';
import { PATCH as patchInvite } from '@/app/api/v1/agents/[id]/invites/[inviteId]/route';
import { POST as revokeInviteRoute } from '@/app/api/v1/agents/[id]/invites/[inviteId]/revoke/route';
import { POST as rotateRoute } from '@/app/api/v1/agents/[id]/invites/[inviteId]/rotate/route';
import { POST as postOffer } from '@/app/api/v1/agents/[id]/offers/route';
import { GET as listSharesRoute } from '@/app/api/v1/agents/[id]/shares/route';
import { POST as approveShare } from '@/app/api/v1/agents/[id]/shares/[shareId]/approve/route';
import { POST as revokeShare } from '@/app/api/v1/agents/[id]/shares/[shareId]/revoke/route';
import { PUT as putSharing } from '@/app/api/v1/agents/[id]/sharing/route';
import { GET as resolveLink } from '@/app/api/v1/c/links/[token]/route';
import { POST as acceptLink } from '@/app/api/v1/c/links/[token]/accept/route';
import { PATCH as patchWorkspace } from '@/app/api/v1/workspaces/current/route';
import { getDb } from '@/db';
import { agents, agentShares, workspaces } from '@/db/schema';
import { MAX_PENDING_PER_BOT, PENDING_REQUEST_TTL_DAYS } from '@/lib/constants';
import { cleanupExpiredCustomerRequests } from '@/lib/customer-invites';
import { flushFirstAgentAlerts } from '@/lib/first-agent-alert';
import { setGuestWorkspaceLimitForTests } from '@/lib/plans';
import { createTask } from '@/lib/tasks';
import { call, createAgent, createKey, emailAddress, mcpListTools, mcpTool, signIn } from './helpers';
import { pendingNotices } from './inbox';

const offerSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['headline'],
  properties: { headline: { type: 'string' } },
};

type Owner = { cookie: string; handle: string; agentId: string; agentKey: string; email: string };
type Customer = Awaited<ReturnType<typeof signIn>>;

async function addOffer(o: { cookie: string; agentId: string }, name: string) {
  const res = await call(postOffer, `http://localhost/api/v1/agents/${o.agentId}/offers`, {
    cookie: o.cookie,
    params: { id: o.agentId },
    body: { name, description: `Do a ${name}.`, result_schema: offerSchema },
  });
  expect(res.status).toBe(201);
}

/** Signed-in owner with a handle and a shared agent named Grok offering draft and review. */
async function owner(): Promise<Owner> {
  const session = await signIn();
  const handle = `o${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  await call(patchWorkspace, 'http://localhost/api/v1/workspaces/current', {
    method: 'PATCH',
    cookie: session.cookie,
    body: { handle },
  });
  const agent = await createAgent(session.cookie, 'Grok');
  const o = { cookie: session.cookie, agentId: agent.id };
  await addOffer(o, 'draft');
  await addOffer(o, 'review');
  const shared = await call(putSharing, `http://localhost/api/v1/agents/${agent.id}/sharing`, {
    method: 'PUT',
    cookie: session.cookie,
    params: { id: agent.id },
    body: { shared: true },
  });
  expect(shared.status).toBe(200);
  const agentKey = await createKey(session.cookie, agent.id);
  return { cookie: session.cookie, handle, agentId: agent.id, agentKey, email: session.email };
}

async function createLink(o: Owner, body: Record<string, unknown>) {
  const res = await call(postInvite, `http://localhost/api/v1/agents/${o.agentId}/invites`, {
    cookie: o.cookie,
    params: { id: o.agentId },
    body,
  });
  expect(res.status).toBe(201);
  return res.data as { invite: any; token: string; url: string };
}

async function setAccess(o: Owner, body: Record<string, unknown>) {
  const res = await call(putAccess, `http://localhost/api/v1/agents/${o.agentId}/customer-access`, {
    method: 'PUT',
    cookie: o.cookie,
    params: { id: o.agentId },
    body,
  });
  expect(res.status).toBe(200);
  return res.data.customer_access;
}

function ip(): string {
  return `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
}

async function resolve(token: string, cookie?: string) {
  return call(resolveLink, `http://localhost/api/v1/c/links/${token}`, {
    cookie,
    params: { token },
    headers: { 'x-forwarded-for': ip() },
  });
}

async function accept(token: string, customer: Customer, headers: Record<string, string> = { origin: 'http://localhost' }) {
  return call(acceptLink, `http://localhost/api/v1/c/links/${token}/accept`, {
    cookie: customer.cookie,
    params: { token },
    body: {},
    headers,
  });
}

async function shares(o: Owner) {
  const res = await call(listSharesRoute, `http://localhost/api/v1/agents/${o.agentId}/shares`, {
    cookie: o.cookie,
    params: { id: o.agentId },
  });
  return res.data.shares as any[];
}

async function senderOf(customer: Customer) {
  const [sender] = await getDb()
    .select()
    .from(agents)
    .where(and(eq(agents.workspaceId, customer.workspace.id), eq(agents.role, 'customer_sender')));
  return sender!;
}

async function customerTask(o: Owner, customer: Customer) {
  const sender = await senderOf(customer);
  return createTask(
    { workspaceId: customer.workspace.id, agentId: sender.id, agentName: sender.name, keyId: randomUUID() },
    { to: `@${o.handle}/Grok`, offer: 'draft', title: 'Headline', description: 'Write one.' },
  );
}

afterEach(() => {
  setGuestWorkspaceLimitForTests(null);
});

describe('customer links: resolve and accept', () => {
  it('resolves a link signed out with branding, access mode, and next step only, never cached', async () => {
    const o = await owner();
    const { token, url } = await createLink(o, { kind: 'personal', label: 'Initech' });
    expect(token.startsWith('rsl_')).toBe(true);
    expect(url).toBe(`http://localhost/i/${token}`);

    const out = await resolve(token);
    expect(out.status).toBe(200);
    expect(out.res.headers.get('cache-control')).toBe('private, no-store');
    expect(out.res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(out.data.next).toBe('sign_in');
    expect(out.data.viewer).toEqual({ signed_in: false });
    expect(out.data.access_mode).toBe('open_link');
    expect(out.data.bot.branding.display_name).toBe('Grok');
    // Trimmed: no offers, handle, owner email, label, or use counts in a link that gets forwarded.
    for (const leak of ['draft', 'review', o.handle, o.email, 'Initech', 'uses']) expect(out.text).not.toContain(leak);

    const unknown = await resolve('rsl_nope');
    expect(unknown.status).toBe(404);
    expect(unknown.res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('accepts a personal link once, hides the sender agent, and refuses a second customer', async () => {
    const o = await owner();
    const { token } = await createLink(o, { kind: 'personal' });
    const customer = await signIn(emailAddress('cust'));
    expect((await resolve(token, customer.cookie)).data.next).toBe('accept');

    const ok = await accept(token, customer);
    expect(ok.status).toBe(200);
    expect(ok.res.headers.get('cache-control')).toBe('private, no-store');
    expect(ok.data).toMatchObject({ share: { status: 'approved' }, bot: { agent_id: o.agentId }, next: 'open_bot' });
    expect((await accept(token, customer)).data.share.status).toBe('approved');
    expect((await resolve(token, customer.cookie)).data.next).toBe('open_bot');

    const [share] = await shares(o);
    expect(share).toMatchObject({ source: 'customer', status: 'approved', daily_cap: 20, customer_email: customer.email });
    expect(share.offers.map((x: { name: string }) => x.name).sort()).toEqual(['draft', 'review']);

    const sender = await senderOf(customer);
    expect(sender.name).toBe('valetto');
    const listed = await call(listAgentsRoute, 'http://localhost/api/v1/agents', { cookie: customer.cookie });
    expect(JSON.stringify(listed.data)).not.toContain('valetto');

    const other = await signIn(emailAddress('late'));
    const used = await accept(token, other);
    expect(used.status).toBe(410);
    expect(used.data.error.code).toBe('invite_used_up');
  });

  it('binds a personal link to its email', async () => {
    const o = await owner();
    const bound = emailAddress('bound');
    const { token } = await createLink(o, { kind: 'personal', email: bound.toUpperCase() });
    const wrong = await accept(token, await signIn(emailAddress('wrong')));
    expect(wrong.status).toBe(403);
    expect(wrong.data.error.code).toBe('invite_email_mismatch');
    expect((await accept(token, await signIn(bound))).data.share.status).toBe('approved');
  });

  it('checks Origin on accept and needs a session cookie, not an agent key', async () => {
    const o = await owner();
    const { token } = await createLink(o, { kind: 'personal' });
    const customer = await signIn(emailAddress('csrf'));
    const evil = await accept(token, customer, { origin: 'https://evil.example' });
    expect(evil.status).toBe(403);
    expect(evil.data.error.code).toBe('bad_origin');
    const crossSite = await accept(token, customer, { 'sec-fetch-site': 'cross-site' });
    expect(crossSite.status).toBe(403);

    const guest = await signIn();
    const bot = await createAgent(guest.cookie, 'Helper');
    const key = await createKey(guest.cookie, bot.id);
    const byKey = await call(acceptLink, `http://localhost/api/v1/c/links/${token}/accept`, {
      bearer: key,
      params: { token },
      body: {},
    });
    expect(byKey.status).toBe(401);
    expect((await shares(o))).toHaveLength(0);
  });
});

describe('customer links: public link and access mode', () => {
  it('queues approve_each requests, emails the owner at most once an hour, and approves', async () => {
    const o = await owner();
    const { token } = await createLink(o, { kind: 'public' });
    expect((await resolve(token)).data.access_mode).toBe('approve_each');
    pendingNotices.length = 0;

    const a = await signIn(emailAddress('pa'));
    const b = await signIn(emailAddress('pb'));
    const first = await accept(token, a);
    expect(first.data).toMatchObject({ share: { status: 'pending' }, next: 'wait' });
    expect((await accept(token, b)).data.share.status).toBe('pending');
    await flushFirstAgentAlerts();
    expect(pendingNotices).toHaveLength(1);
    expect(pendingNotices[0]).toMatchObject({ agentName: 'Grok', pendingCount: 1 });
    expect(JSON.stringify(pendingNotices[0])).not.toContain(a.email);

    expect((await resolve(token, a.cookie)).data.next).toBe('wait');
    const pending = (await shares(o)).find((s) => s.customer_email === a.email);
    const approved = await call(approveShare, `http://localhost/api/v1/agents/${o.agentId}/shares/${pending.id}/approve`, {
      method: 'POST',
      cookie: o.cookie,
      params: { id: o.agentId, shareId: pending.id },
    });
    expect(approved.status).toBe(200);
    expect((await resolve(token, a.cookie)).data.next).toBe('open_bot');
  });

  it('lets open_link and pre-approved emails straight in', async () => {
    const o = await owner();
    const { token } = await createLink(o, { kind: 'public' });
    const vip = emailAddress('vip');
    const access = await setAccess(o, { preapproved_emails: [vip.toUpperCase()] });
    expect(access.preapproved_emails).toEqual([vip]);
    expect((await accept(token, await signIn(vip))).data.share.status).toBe('approved');
    expect((await accept(token, await signIn(emailAddress('np')))).data.share.status).toBe('pending');
    await setAccess(o, { mode: 'open_link' });
    expect((await resolve(token)).data.access_mode).toBe('open_link');
    expect((await accept(token, await signIn(emailAddress('open')))).data.share.status).toBe('approved');
  });

  it('keeps one public link per bot, and a reset link stops working like an unknown one', async () => {
    const o = await owner();
    const { token, invite } = await createLink(o, { kind: 'public' });
    const dup = await call(postInvite, `http://localhost/api/v1/agents/${o.agentId}/invites`, {
      cookie: o.cookie,
      params: { id: o.agentId },
      body: { kind: 'public' },
    });
    expect(dup.status).toBe(409);
    expect(dup.data.error.code).toBe('public_link_exists');

    const customer = await signIn(emailAddress('keep'));
    await setAccess(o, { mode: 'open_link' });
    expect((await accept(token, customer)).data.share.status).toBe('approved');

    const rotated = await call(rotateRoute, `http://localhost/api/v1/agents/${o.agentId}/invites/${invite.id}/rotate`, {
      method: 'POST',
      cookie: o.cookie,
      params: { id: o.agentId, inviteId: invite.id },
    });
    expect(rotated.status).toBe(200);
    expect(rotated.data.token).not.toBe(token);
    const old = await resolve(token);
    const unknown = await resolve('rsl_neverexisted');
    expect(old.status).toBe(404);
    expect(old.data.error.message).toContain("This link doesn't work anymore");
    expect(old.data).toEqual(unknown.data);
    expect((await resolve(rotated.data.token)).status).toBe(200);
    // Existing customers keep their access after a reset.
    expect((await shares(o))[0].status).toBe('approved');

    await call(revokeInviteRoute, `http://localhost/api/v1/agents/${o.agentId}/invites/${invite.id}/revoke`, {
      method: 'POST',
      cookie: o.cookie,
      params: { id: o.agentId, inviteId: invite.id },
    });
    const revoked = await resolve(rotated.data.token);
    expect(revoked.status).toBe(404);
    expect(revoked.data).toEqual(unknown.data);
  });

  it('never lets a revoked customer back, by any link', async () => {
    const o = await owner();
    const { token } = await createLink(o, { kind: 'personal' });
    const customer = await signIn(emailAddress('gone'));
    await accept(token, customer);
    const [share] = await shares(o);
    const revoked = await call(revokeShare, `http://localhost/api/v1/agents/${o.agentId}/shares/${share.id}/revoke`, {
      method: 'POST',
      cookie: o.cookie,
      params: { id: o.agentId, shareId: share.id },
    });
    expect(revoked.status).toBe(200);
    expect((await resolve(token, customer.cookie)).data.next).toBe('blocked');

    const fresh = await createLink(o, { kind: 'public' });
    await setAccess(o, { mode: 'open_link' });
    const again = await accept(fresh.token, customer);
    expect(again.status).toBe(403);
    expect(again.data.error.code).toBe('share_revoked');
  });
});

describe('customer links: limits', () => {
  it('caps approved customers per bot, on accept and on approve, with the error in the envelope', async () => {
    setGuestWorkspaceLimitForTests(1);
    const o = await owner();
    const { token } = await createLink(o, { kind: 'public' });
    // Pending requests do not hold a slot.
    const waiting = await accept(token, await signIn(emailAddress('w1')));
    expect(waiting.data.share.status).toBe('pending');
    await setAccess(o, { mode: 'open_link' });
    expect((await accept(token, await signIn(emailAddress('in')))).data.share.status).toBe('approved');
    const full = await accept(token, await signIn(emailAddress('full')));
    expect(full.status).toBe(403);
    expect(full.data.error.code).toBe('plan_limit');
    expect(full.data.error.details.error).toBe('plan_limit');

    const pending = (await shares(o)).find((s) => s.status === 'pending');
    const approve = await call(approveShare, `http://localhost/api/v1/agents/${o.agentId}/shares/${pending.id}/approve`, {
      method: 'POST',
      cookie: o.cookie,
      params: { id: o.agentId, shareId: pending.id },
    });
    expect(approve.status).toBe(403);
    expect(approve.data.error).toBe('plan_limit');
  });

  it('refuses new requests when 50 are waiting, and expires requests after 14 days', async () => {
    const o = await owner();
    const { token } = await createLink(o, { kind: 'public' });
    const db = getDb();
    const guests = await db
      .insert(workspaces)
      .values(Array.from({ length: MAX_PENDING_PER_BOT }, (_, i) => ({ name: `Pending ${i}` })))
      .returning({ id: workspaces.id });
    await db
      .insert(agentShares)
      .values(guests.map((g) => ({ agentId: o.agentId, guestWorkspaceId: g.id, status: 'pending', source: 'customer' })));
    const full = await accept(token, await signIn(emailAddress('q')));
    expect(full.status).toBe(429);
    expect(full.data.error.code).toBe('pending_queue_full');

    await db
      .update(agentShares)
      .set({ createdAt: new Date(Date.now() - (PENDING_REQUEST_TTL_DAYS + 1) * 24 * 60 * 60 * 1000) })
      .where(eq(agentShares.agentId, o.agentId));
    expect((await cleanupExpiredCustomerRequests()).deleted).toBeGreaterThanOrEqual(MAX_PENDING_PER_BOT);
    expect((await accept(token, await signIn(emailAddress('q2')))).data.share.status).toBe('pending');
  });

  it('applies the per-customer and per-bot daily task caps', async () => {
    const o = await owner();
    await setAccess(o, { mode: 'open_link', customer_daily_cap: 3 });
    const { token } = await createLink(o, { kind: 'public', daily_cap: 2 });
    const a = await signIn(emailAddress('ta'));
    const b = await signIn(emailAddress('tb'));
    await accept(token, a);
    await accept(token, b);
    await customerTask(o, a);
    await customerTask(o, a);
    await expect(customerTask(o, a)).rejects.toMatchObject({ status: 429, details: { scope: 'share' } });
    await customerTask(o, b);
    await expect(customerTask(o, b)).rejects.toMatchObject({ status: 429, details: { scope: 'bot', daily_cap: 3 } });
  });

  it('grants offers added later to all-offers customers only', async () => {
    const o = await owner();
    const all = await createLink(o, { kind: 'personal' });
    const some = await createLink(o, { kind: 'personal', offers: ['draft'] });
    const a = await signIn(emailAddress('all'));
    const b = await signIn(emailAddress('some'));
    await accept(all.token, a);
    await accept(some.token, b);
    await addOffer(o, 'summarize');
    const list = await shares(o);
    const names = (email: string) => list.find((s) => s.customer_email === email).offers.map((x: any) => x.name).sort();
    expect(names(a.email)).toEqual(['draft', 'review', 'summarize']);
    expect(names(b.email)).toEqual(['draft']);
  });
});

describe('customer links: owner routes', () => {
  it('refuses agent keys on every owner write and has no MCP owner invite tools', async () => {
    const o = await owner();
    const made = await createLink(o, { kind: 'public' });
    const base = `http://localhost/api/v1/agents/${o.agentId}`;
    const byKey = [
      await call(postInvite, `${base}/invites`, { bearer: o.agentKey, params: { id: o.agentId }, body: { kind: 'personal' } }),
      await call(putAccess, `${base}/customer-access`, {
        method: 'PUT',
        bearer: o.agentKey,
        params: { id: o.agentId },
        body: { mode: 'open_link' },
      }),
      await call(rotateRoute, `${base}/invites/${made.invite.id}/rotate`, {
        method: 'POST',
        bearer: o.agentKey,
        params: { id: o.agentId, inviteId: made.invite.id },
      }),
      await call(patchInvite, `${base}/invites/${made.invite.id}`, {
        method: 'PATCH',
        bearer: o.agentKey,
        params: { id: o.agentId, inviteId: made.invite.id },
        body: { label: 'x' },
      }),
      await call(revokeInviteRoute, `${base}/invites/${made.invite.id}/revoke`, {
        method: 'POST',
        bearer: o.agentKey,
        params: { id: o.agentId, inviteId: made.invite.id },
      }),
    ];
    for (const res of byKey) {
      expect(res.status).toBe(403);
      expect(res.data.error.code).toBe('human_required');
    }
    const names = (await mcpListTools(o.agentKey)).map((tool) => tool.name);
    for (const name of ['create_invite', 'list_invites', 'revoke_invite']) expect(names).not.toContain(name);
  });

  it('shows customer emails to the signed-in owner only, never to an agent tool', async () => {
    const o = await owner();
    const { token } = await createLink(o, { kind: 'personal' });
    const customer = await signIn(emailAddress('private'));
    await accept(token, customer);
    expect((await shares(o))[0].customer_email).toBe(customer.email);
    const viaMcp = await mcpTool(o.agentKey, 'list_guest_shares', { agent: 'Grok' });
    expect(viaMcp.isError).toBe(false);
    expect(viaMcp.payload.shares[0].source).toBe('customer');
    expect(JSON.stringify(viaMcp.payload)).not.toContain(customer.email);
  });

  it('lists customer links without tokens and hides agent invites while the flag is off', async () => {
    const o = await owner();
    const made = await createLink(o, { kind: 'personal', label: 'Acme' });
    const listed = await call(listInvitesRoute, `http://localhost/api/v1/agents/${o.agentId}/invites`, {
      cookie: o.cookie,
      params: { id: o.agentId },
    });
    expect(listed.status).toBe(200);
    expect(listed.text).not.toContain(made.token);
    expect(listed.data.invites[0]).toMatchObject({ kind: 'personal', label: 'Acme', all_offers: true, max_uses: 1 });
    expect(listed.data.agent_guests_enabled).toBe(false);
    expect(listed.data.agent_invites).toEqual([]);
    expect(listed.data.customer_access).toMatchObject({ mode: 'approve_each', customer_daily_cap: 300 });
    const agentInvite = await call(postInvite, `http://localhost/api/v1/agents/${o.agentId}/invites`, {
      cookie: o.cookie,
      params: { id: o.agentId },
      body: { kind: 'agent', offers: ['draft'] },
    });
    expect(agentInvite.status).toBe(404);
  });
});
