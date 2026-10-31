import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterEach, describe, expect, it } from 'vitest';
import { GET as listAgentsRoute } from '@/app/api/v1/agents/route';
import { GET as getAccess, PUT as putAccess } from '@/app/api/v1/agents/[id]/customer-access/route';
import { GET as listInvitesRoute, POST as postInvite } from '@/app/api/v1/agents/[id]/invites/route';
import { PATCH as patchInvite } from '@/app/api/v1/agents/[id]/invites/[inviteId]/route';
import { POST as revokeInviteRoute } from '@/app/api/v1/agents/[id]/invites/[inviteId]/revoke/route';
import { POST as rotateRoute } from '@/app/api/v1/agents/[id]/invites/[inviteId]/rotate/route';
import { POST as postOffer } from '@/app/api/v1/agents/[id]/offers/route';
import { GET as listSharesRoute, POST as inviteGuestRoute } from '@/app/api/v1/agents/[id]/shares/route';
import { POST as approveShare } from '@/app/api/v1/agents/[id]/shares/[shareId]/approve/route';
import { POST as restoreShare } from '@/app/api/v1/agents/[id]/shares/[shareId]/restore/route';
import { POST as revokeShare } from '@/app/api/v1/agents/[id]/shares/[shareId]/revoke/route';
import { PUT as putSharing } from '@/app/api/v1/agents/[id]/sharing/route';
import { GET as resolveLink } from '@/app/api/v1/c/links/[token]/route';
import { POST as acceptLink } from '@/app/api/v1/c/links/[token]/accept/route';
import { PATCH as patchWorkspace } from '@/app/api/v1/workspaces/current/route';
import { getDb } from '@/db';
import { agentBranding, agents, agentShares, customerInvites, workspaces } from '@/db/schema';
import { MAX_PENDING_PER_BOT, PENDING_REQUEST_TTL_DAYS } from '@/lib/constants';
import { sha256 } from '@/lib/crypto';
import { cleanupExpiredCustomerRequests } from '@/lib/customer-invites';
import { flushFirstAgentAlerts } from '@/lib/first-agent-alert';
import { FREE_CUSTOMERS_PER_BOT, setGuestWorkspaceLimitForTests } from '@/lib/plans';
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
    // The token rides in the fragment, so it never reaches a server log.
    expect(url).toBe(`http://localhost/i#${token}`);

    const out = await resolve(token);
    expect(out.status).toBe(200);
    expect(out.res.headers.get('cache-control')).toBe('private, no-store');
    expect(out.res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(out.data.next).toBe('sign_in');
    expect(out.data.viewer).toEqual({ signed_in: false });
    expect(out.data.access_mode).toBe('open_link');
    expect(out.res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    // Exact allowlist: anything new in R1 must be added here on purpose, because a public link gets forwarded.
    expect(Object.keys(out.data).sort()).toEqual(['access_mode', 'bot', 'link', 'next', 'viewer']);
    expect(Object.keys(out.data.link).sort()).toEqual(['email_bound', 'expires_at', 'kind']);
    expect(Object.keys(out.data.bot).sort()).toEqual(['agent_id', 'branding']);
    expect(Object.keys(out.data.bot.branding).sort()).toEqual([
      'accent_color',
      'accent_foreground',
      'display_name',
      'logo_height',
      'logo_url',
      'logo_width',
      'on_primary',
      'primary_color',
      'primary_foreground',
      'primary_on_white_ok',
      'show_footer',
    ]);
    // Never the agent's name, and never the default workspace name made from the owner's email.
    expect(out.data.bot.branding.display_name).toBe('This business');
    for (const leak of ['draft', 'review', 'Grok', o.handle, o.email, o.email.split('@')[0], 'Initech', 'uses']) {
      expect(out.text).not.toContain(leak);
    }
    await call(patchWorkspace, 'http://localhost/api/v1/workspaces/current', {
      method: 'PATCH',
      cookie: o.cookie,
      body: { name: 'Acme Studio' },
    });
    expect((await resolve(token)).data.bot.branding.display_name).toBe('Acme Studio');

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

  it('a used-up link still says who sent it: public branding only, on resolve and on accept', async () => {
    const o = await owner();
    const { token } = await createLink(o, { kind: 'personal', label: 'Initech' });
    expect((await accept(token, await signIn(emailAddress('first')))).status).toBe(200);
    const sha = 'ab'.repeat(32);
    const blobHost = 'https://store1.public.blob.vercel-storage.com';
    // A logo uploaded before uploads moved to a random folder: the real path names the agent.
    const legacyPath = `branding/${o.agentId}/${sha}-Xy12AbCd.webp`;
    await getDb().insert(agentBranding).values({
      agentId: o.agentId,
      displayName: 'Acme Tables',
      logoBlobPath: legacyPath,
      logoUrl: `${blobHost}/${legacyPath}`,
      logoWidth: 200,
      logoHeight: 80,
      logoSha256: sha,
    });

    const late = await signIn(emailAddress('late'));
    const deadLink = async () => [await resolve(token), await resolve(token, late.cookie), await accept(token, late)];
    const expectNoLeak = (res: { text: string }) => {
      for (const leak of [o.agentId, 'draft', 'review', 'Grok', o.handle, o.email, 'Initech']) {
        expect(res.text).not.toContain(leak);
      }
    };
    for (const res of await deadLink()) {
      expect(res.status).toBe(410);
      expect(res.data.error.code).toBe('invite_used_up');
      expect(Object.keys(res.data.error.details)).toEqual(['bot']);
      expect(Object.keys(res.data.error.details.bot)).toEqual(['branding']);
      // The legacy URL would name the agent, so the logo is left out rather than shown.
      expect(res.data.error.details.bot.branding).toMatchObject({
        display_name: 'Acme Tables',
        logo_url: null,
        logo_width: null,
        logo_height: null,
        show_footer: true,
      });
      expectNoLeak(res);
    }

    // A logo uploaded now sits in a random folder, so the same responses show it.
    const freshPath = `branding/${'0f'.repeat(16)}/${sha}-Xy12AbCd.webp`;
    await getDb()
      .update(agentBranding)
      .set({ logoBlobPath: freshPath, logoUrl: `${blobHost}/${freshPath}` })
      .where(eq(agentBranding.agentId, o.agentId));
    for (const res of await deadLink()) {
      expect(res.status).toBe(410);
      expect(res.data.error.details.bot.branding).toMatchObject({
        logo_url: `${blobHost}/${freshPath}`,
        logo_width: 200,
        logo_height: 80,
      });
      expectNoLeak(res);
    }
  });

  it('the public link preview never puts the agent id in the logo URL', async () => {
    const o = await owner();
    const { token } = await createLink(o, { kind: 'personal' });
    const legacyPath = `branding/${o.agentId}/${'cd'.repeat(32)}-Qw34ErTy.webp`;
    await getDb().insert(agentBranding).values({
      agentId: o.agentId,
      logoBlobPath: legacyPath,
      logoUrl: `https://store1.public.blob.vercel-storage.com/${legacyPath}`,
      logoWidth: 120,
      logoHeight: 120,
    });
    const out = await resolve(token);
    expect(out.status).toBe(200);
    expect(out.data.bot.branding).toMatchObject({ logo_url: null, logo_width: null, logo_height: null });
    // R1 still names the bot in bot.agent_id (the page needs it to open the bot); the logo URL must not add it again.
    expect(out.text.split(o.agentId)).toHaveLength(2);
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
    await accept(made.token, await signIn(emailAddress('keyed')));
    const [share] = await shares(o);
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
      await call(listInvitesRoute, `${base}/invites`, { bearer: o.agentKey, params: { id: o.agentId } }),
      await call(getAccess, `${base}/customer-access`, { bearer: o.agentKey, params: { id: o.agentId } }),
      ...(await Promise.all(
        [approveShare, revokeShare, restoreShare].map((route) =>
          call(route, `${base}/shares/${share.id}/x`, { method: 'POST', bearer: o.agentKey, params: { id: o.agentId, shareId: share.id } }),
        ),
      )),
    ];
    expect(byKey).toHaveLength(10);
    for (const res of byKey) {
      expect(res.status).toBe(403);
      expect(res.data.error.code).toBe('human_required');
    }
    // Nothing changed: the request is still pending and the link still works.
    expect((await shares(o))[0].status).toBe('pending');
    expect((await resolve(made.token)).status).toBe(200);
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

// ---------------------------------------------------------------------------
// Second-review fixes: lock order, revoke durability, restore, Origin, real caps.
// ---------------------------------------------------------------------------

/**
 * A second database connection, so a test can hold row locks while the app (one pooled connection)
 * runs a real request against them.
 */
async function withSecondConnection<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Holds row locks on a second connection: `before` takes them, then the app request starts and blocks on
 * them, then `after` finishes the concurrent write and commits. Returns the app request's result.
 */
async function raceAgainst<R>(
  before: (tx: postgres.TransactionSql) => Promise<unknown>,
  start: () => Promise<R>,
  after: (tx: postgres.TransactionSql) => Promise<unknown>,
): Promise<R> {
  return withSecondConnection(async (sql) => {
    let pending: Promise<R> | undefined;
    await sql.begin(async (tx) => {
      await before(tx);
      pending = start();
      await waitForLockWaiter(tx);
      await after(tx);
    });
    return pending!;
  });
}

/** Resolves once some backend is waiting on a row lock. */
async function waitForLockWaiter(sql: postgres.TransactionSql) {
  for (let i = 0; i < 200; i += 1) {
    const [row] = await sql`select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()`;
    if (row && row.n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('no backend ever waited on the lock');
}

async function inviteRow(id: string) {
  const [row] = await getDb().select().from(customerInvites).where(eq(customerInvites.id, id));
  return row!;
}

describe('customer links: concurrency (spec 13.8 #18)', () => {
  it('an accept racing a rotate waits on the agent lock, then fails like an unknown link, with no deadlock', async () => {
    const o = await owner();
    await setAccess(o, { mode: 'open_link' });
    const { token, invite } = await createLink(o, { kind: 'public' });
    const customer = await signIn(emailAddress('race'));
    const next = `rsl_${randomUUID().replace(/-/g, '')}`;
    // Rotate's lock order: the agent, then the invite (lockOwnerAgent, then lockInvite). Before the fix,
    // accept locked the invite first and this deadlocked.
    const outcome = await raceAgainst(
      (tx) => tx`select id from agents where id = ${o.agentId} for update`,
      () => accept(token, customer),
      async (tx) => {
        await tx`select id from customer_invites where id = ${invite.id} for update`;
        await tx`update customer_invites set token_hash = ${sha256(next)}, token_prefix = 'rsl_x', rotated_at = now() where id = ${invite.id}`;
      },
    );
    expect(outcome.status).toBe(404);
    expect(outcome.data.error.code).toBe('invite_not_found');
    expect(await shares(o)).toHaveLength(0);
    expect((await inviteRow(invite.id)).uses).toBe(0);
  });

  it('an accept racing a revoke waits, then fails, and never leaves a share behind', async () => {
    const o = await owner();
    await setAccess(o, { mode: 'open_link' });
    const { token, invite } = await createLink(o, { kind: 'public' });
    const customer = await signIn(emailAddress('race2'));
    const outcome = await raceAgainst(
      (tx) => tx`select id from agents where id = ${o.agentId} for update`,
      () => accept(token, customer),
      async (tx) => {
        await tx`select id from customer_invites where id = ${invite.id} for update`;
        await tx`update customer_invites set revoked_at = now() where id = ${invite.id}`;
      },
    );
    expect(outcome.status).toBe(404);
    expect(await shares(o)).toHaveLength(0);
  });

  it('real rotate, revoke, and accept requests interleaved all finish without a 500', async () => {
    const o = await owner();
    await setAccess(o, { mode: 'open_link' });
    const { token, invite } = await createLink(o, { kind: 'public' });
    const customers = await Promise.all([1, 2, 3].map((i) => signIn(emailAddress(`mix${i}`))));
    const base = `http://localhost/api/v1/agents/${o.agentId}/invites/${invite.id}`;
    const results = await Promise.all([
      accept(token, customers[0]!),
      call(rotateRoute, `${base}/rotate`, { method: 'POST', cookie: o.cookie, params: { id: o.agentId, inviteId: invite.id } }),
      accept(token, customers[1]!),
      call(revokeInviteRoute, `${base}/revoke`, { method: 'POST', cookie: o.cookie, params: { id: o.agentId, inviteId: invite.id } }),
      accept(token, customers[2]!),
    ]);
    for (const r of results) expect(r.status).toBeLessThan(500);
    const approved = results.filter((r, i) => i % 2 === 0 && r.status === 200).length;
    expect(await shares(o)).toHaveLength(approved);
    expect((await inviteRow(invite.id)).uses).toBe(approved);
  });

  it('holds the real free cap of 250 customers per bot when two accepts race for the last slot', async () => {
    const o = await owner();
    await setAccess(o, { mode: 'open_link' });
    const { token } = await createLink(o, { kind: 'public' });
    const db = getDb();
    const seeded = await db
      .insert(workspaces)
      .values(Array.from({ length: FREE_CUSTOMERS_PER_BOT - 2 }, (_, i) => ({ name: `Customer ${i}` })))
      .returning({ id: workspaces.id });
    await db
      .insert(agentShares)
      .values(seeded.map((g) => ({ agentId: o.agentId, guestWorkspaceId: g.id, status: 'approved', source: 'customer' })));
    // 248 seeded + this one = 249: one slot left.
    expect((await accept(token, await signIn(emailAddress('c249')))).data.share.status).toBe('approved');

    const [rival] = await db.insert(workspaces).values({ name: 'Rival' }).returning({ id: workspaces.id });
    const late = await signIn(emailAddress('c251'));
    // A concurrent accept takes the 250th slot under the agent lock; this one waits, then sees the cap.
    const outcome = await raceAgainst(
      (tx) => tx`select id from agents where id = ${o.agentId} for update`,
      () => accept(token, late),
      (tx) => tx`insert into agent_shares (agent_id, guest_workspace_id, status, source) values (${o.agentId}, ${rival!.id}, 'approved', 'customer')`,
    );
    expect(outcome.status).toBe(403);
    expect(outcome.data.error.code).toBe('plan_limit');
    const all = await shares(o);
    expect(all.filter((s) => s.status === 'approved')).toHaveLength(FREE_CUSTOMERS_PER_BOT);
    // Pending requests still queue at the cap; approving one is refused.
    await setAccess(o, { mode: 'approve_each' });
    const asked = await accept(token, await signIn(emailAddress('c252')));
    expect(asked.data.share.status).toBe('pending');
    const pending = (await shares(o)).find((s) => s.status === 'pending');
    const approve = await call(approveShare, `http://localhost/api/v1/agents/${o.agentId}/shares/${pending.id}/approve`, {
      method: 'POST',
      cookie: o.cookie,
      params: { id: o.agentId, shareId: pending.id },
    });
    expect(approve.status).toBe(403);
  });
});

async function revokeShareOf(o: Owner, shareId: string) {
  const res = await call(revokeShare, `http://localhost/api/v1/agents/${o.agentId}/shares/${shareId}/revoke`, {
    method: 'POST',
    cookie: o.cookie,
    params: { id: o.agentId, shareId },
  });
  expect(res.status).toBe(200);
}

async function restoreShareOf(o: Owner, shareId: string) {
  return call(restoreShare, `http://localhost/api/v1/agents/${o.agentId}/shares/${shareId}/restore`, {
    method: 'POST',
    cookie: o.cookie,
    params: { id: o.agentId, shareId },
  });
}

async function ageShares(o: Owner) {
  await getDb()
    .update(agentShares)
    .set({ createdAt: new Date(Date.now() - (PENDING_REQUEST_TTL_DAYS + 1) * 24 * 60 * 60 * 1000) })
    .where(eq(agentShares.agentId, o.agentId));
}

describe('customer links: revoke, deny, re-invite, restore', () => {
  it('a denied customer cannot ask again through any link', async () => {
    const o = await owner();
    const { token } = await createLink(o, { kind: 'public' });
    const customer = await signIn(emailAddress('denied'));
    expect((await accept(token, customer)).data.share.status).toBe('pending');
    const [share] = await shares(o);
    await revokeShareOf(o, share.id);
    const again = await accept(token, customer);
    expect(again.status).toBe(403);
    expect(again.data.error.code).toBe('share_revoked');
    expect((await resolve(token, customer.cookie)).data.next).toBe('blocked');
    // The 14-day cleanup never deletes a denied request: the row is what keeps them out.
    await ageShares(o);
    await cleanupExpiredCustomerRequests();
    expect((await shares(o))[0].status).toBe('revoked');
    await setAccess(o, { mode: 'open_link' });
    expect((await accept(token, customer)).status).toBe(403);
  });

  it('re-inviting a revoked customer by handle makes a handle grant the cron cannot wipe', async () => {
    const o = await owner();
    const { token } = await createLink(o, { kind: 'public' });
    await setAccess(o, { mode: 'open_link' });
    const customer = await signIn(emailAddress('reinv'));
    await accept(token, customer);
    const [share] = await shares(o);
    await revokeShareOf(o, share.id);

    const handle = `c${randomUUID().replace(/-/g, '').slice(0, 10)}`;
    await call(patchWorkspace, 'http://localhost/api/v1/workspaces/current', { method: 'PATCH', cookie: customer.cookie, body: { handle } });
    const invited = await call(inviteGuestRoute, `http://localhost/api/v1/agents/${o.agentId}/shares`, {
      cookie: o.cookie,
      params: { id: o.agentId },
      body: { guest_handle: handle, offers: ['draft'] },
    });
    expect(invited.status).toBe(201);
    expect(invited.data.share).toMatchObject({ status: 'pending', source: 'handle' });

    // Old bug: still source=customer, so 14 days later the cron deleted it and open_link let them back in.
    await ageShares(o);
    await cleanupExpiredCustomerRequests();
    expect((await shares(o))[0]).toMatchObject({ id: share.id, status: 'pending', source: 'handle' });
    // Even forced back to customer, a share that was ever revoked survives the cron.
    await getDb().update(agentShares).set({ source: 'customer' }).where(eq(agentShares.id, share.id));
    await cleanupExpiredCustomerRequests();
    expect(await shares(o)).toHaveLength(1);
    await getDb().update(agentShares).set({ source: 'handle' }).where(eq(agentShares.id, share.id));

    // The link does not approve it; only the owner does.
    expect((await accept(token, customer)).data.share.status).toBe('pending');
    const approved = await call(approveShare, `http://localhost/api/v1/agents/${o.agentId}/shares/${share.id}/approve`, {
      method: 'POST',
      cookie: o.cookie,
      params: { id: o.agentId, shareId: share.id },
    });
    expect(approved.status).toBe(200);
    expect((await customerTask(o, customer)).status).toBe('open');
  });

  it('restores a revoked customer from the owner session only, with live all-offers grants', async () => {
    const o = await owner();
    const { token } = await createLink(o, { kind: 'personal' });
    const customer = await signIn(emailAddress('restore'));
    await accept(token, customer);
    const [share] = await shares(o);
    await revokeShareOf(o, share.id);
    await expect(customerTask(o, customer)).rejects.toMatchObject({ status: 403, code: 'share_revoked' });
    await addOffer(o, 'summarize');

    const notYet = await call(restoreShare, `http://localhost/api/v1/agents/${o.agentId}/shares/${share.id}/restore`, {
      method: 'POST',
      bearer: o.agentKey,
      params: { id: o.agentId, shareId: share.id },
    });
    expect(notYet.status).toBe(403);
    expect(notYet.data.error.code).toBe('human_required');

    const restored = await restoreShareOf(o, share.id);
    expect(restored.status).toBe(200);
    expect(restored.data.share).toMatchObject({ status: 'approved', source: 'customer' });
    expect(restored.data.share.offers.map((x: { name: string }) => x.name).sort()).toEqual(['draft', 'review', 'summarize']);
    expect((await customerTask(o, customer)).status).toBe('open');
    expect((await resolve(token, customer.cookie)).data.next).toBe('open_bot');

    const twice = await restoreShareOf(o, share.id);
    expect(twice.status).toBe(409);
    expect(twice.data.error.code).toBe('share_not_revoked');
  });

  it('restore takes a guest slot and refuses non-customer guests', async () => {
    setGuestWorkspaceLimitForTests(1);
    const o = await owner();
    await setAccess(o, { mode: 'open_link' });
    const { token } = await createLink(o, { kind: 'public' });
    const a = await signIn(emailAddress('ra'));
    await accept(token, a);
    const [first] = await shares(o);
    await revokeShareOf(o, first.id);
    await accept(token, await signIn(emailAddress('rb')));
    const full = await restoreShareOf(o, first.id);
    expect(full.status).toBe(403);
    expect(full.data.error).toBe('plan_limit');

    setGuestWorkspaceLimitForTests(null);
    const guest = await signIn();
    const handle = `g${randomUUID().replace(/-/g, '').slice(0, 10)}`;
    await call(patchWorkspace, 'http://localhost/api/v1/workspaces/current', { method: 'PATCH', cookie: guest.cookie, body: { handle } });
    const invited = await call(inviteGuestRoute, `http://localhost/api/v1/agents/${o.agentId}/shares`, {
      cookie: o.cookie,
      params: { id: o.agentId },
      body: { guest_handle: handle, offers: ['draft'] },
    });
    await revokeShareOf(o, invited.data.share.id);
    const notCustomer = await restoreShareOf(o, invited.data.share.id);
    expect(notCustomer.status).toBe(409);
    expect(notCustomer.data.error.code).toBe('not_customer_share');
  });
});

describe('customer links: Origin check on accept', () => {
  const saved = process.env.APP_ORIGIN;
  afterEach(() => {
    if (saved === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = saved;
  });

  it('refuses null, prefix, and subdomain Origins', async () => {
    delete process.env.APP_ORIGIN;
    const o = await owner();
    const { token } = await createLink(o, { kind: 'personal' });
    const customer = await signIn(emailAddress('orig'));
    for (const origin of ['null', '', 'http://localhost.evil.example', 'http://evil.localhost', 'http://sub.localhost', 'https://localhost', 'http://localhost:3001']) {
      const res = await accept(token, customer, { origin });
      expect(res.status, origin).toBe(403);
      expect(res.data.error.code).toBe('bad_origin');
    }
    expect((await accept(token, customer, { origin: 'http://localhost' })).status).toBe(200);
  });

  it('with APP_ORIGIN set, trusts only it and ignores X-Forwarded-Host', async () => {
    process.env.APP_ORIGIN = 'https://app.example.test/';
    const o = await owner();
    const { token } = await createLink(o, { kind: 'personal' });
    const customer = await signIn(emailAddress('xfh'));
    const spoofed = await accept(token, customer, { origin: 'http://evil.example', 'x-forwarded-host': 'evil.example' });
    expect(spoofed.status).toBe(403);
    expect(spoofed.data.error.code).toBe('bad_origin');
    const spoofedHttps = await accept(token, customer, {
      origin: 'https://evil.example',
      'x-forwarded-host': 'evil.example',
      'x-forwarded-proto': 'https',
    });
    expect(spoofedHttps.status).toBe(403);
    // The request's own Host is no longer enough either.
    expect((await accept(token, customer, { origin: 'http://localhost' })).status).toBe(403);
    expect(await shares(o)).toHaveLength(0);
    expect((await accept(token, customer, { origin: 'https://app.example.test' })).status).toBe(200);
  });

  it('with an APP_ORIGIN list, accepts any entry and rejects the rest', async () => {
    process.env.APP_ORIGIN = ' https://app.example.test/ , https://www.app.example.test,,https://valetto.example.test ';
    const o = await owner();
    const { token } = await createLink(o, { kind: 'personal' });
    const customer = await signIn(emailAddress('list'));
    for (const origin of ['http://localhost', 'https://evil.example', 'https://sub.valetto.example.test', 'https://valetto.example.test/']) {
      const res = await accept(token, customer, { origin, 'x-forwarded-host': 'evil.example' });
      expect(res.status, origin).toBe(403);
      expect(res.data.error.code).toBe('bad_origin');
    }
    expect(await shares(o)).toHaveLength(0);
    expect((await accept(token, customer, { origin: 'https://valetto.example.test' })).status).toBe(200);
  });
});

describe('customer links: absolute URLs use the canonical origin', () => {
  const saved = process.env.APP_ORIGIN;
  afterEach(() => {
    if (saved === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = saved;
  });

  it('uses the first APP_ORIGIN entry, not the request host', async () => {
    process.env.APP_ORIGIN = 'https://app.example.test/, https://valetto.example.test';
    const o = await owner();
    const { url, token } = await createLink(o, { kind: 'personal' });
    expect(url.startsWith('https://app.example.test/')).toBe(true);
    expect(url).toContain(token);
  });

  it('uses the request origin when APP_ORIGIN is unset', async () => {
    delete process.env.APP_ORIGIN;
    const o = await owner();
    const { url } = await createLink(o, { kind: 'personal' });
    expect(url.startsWith('http://localhost/')).toBe(true);
  });
});
