import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST as postOffer } from '@/app/api/v1/agents/[id]/offers/route';
import { GET as listInvitesRoute, POST as postInvite } from '@/app/api/v1/agents/[id]/invites/route';
import { POST as revokeInviteRoute } from '@/app/api/v1/agents/[id]/invites/[inviteId]/revoke/route';
import { GET as listSharesRoute } from '@/app/api/v1/agents/[id]/shares/route';
import { POST as approveShare } from '@/app/api/v1/agents/[id]/shares/[shareId]/approve/route';
import { PUT as putSharing } from '@/app/api/v1/agents/[id]/sharing/route';
import { POST as requestCode } from '@/app/api/v1/auth/request-code/route';
import { POST as verifyCode } from '@/app/api/v1/auth/verify-code/route';
import { GET as claimPreview } from '@/app/api/v1/claims/preview/route';
import { GET as invitePreview } from '@/app/api/v1/invites/preview/route';
import { POST as redeemRoute } from '@/app/api/v1/invites/redeem/route';
import { PATCH as patchWorkspace } from '@/app/api/v1/workspaces/current/route';
import { getDb } from '@/db';
import { agentInvites, agentKeys, agentShares, agents, workspaces } from '@/db/schema';
import { ACCESS_REVOKED_REASON, INVITE_WORKSPACE_IDLE_DAYS } from '@/lib/constants';
import { cleanupUnclaimedInviteWorkspaces } from '@/lib/invites';
import { setGuestWorkspaceLimitForTests } from '@/lib/plans';
import { call, createAgent, createKey, emailAddress, mcpListTools, mcpTool, signIn, startReceiver } from './helpers';
import { latestCode } from './inbox';

const offerSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['headline'],
  properties: { headline: { type: 'string' } },
};

function handleName(prefix: string): string {
  return `${prefix}${randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

type Owner = { cookie: string; handle: string; agentId: string; agentKey: string; userId: string };

/** Signed-in owner with a handle, a shared agent named Grok, and offers draft and review. */
async function owner(): Promise<Owner> {
  const session = await signIn();
  const handle = handleName('o');
  const named = await call(patchWorkspace, 'http://localhost/api/v1/workspaces/current', {
    method: 'PATCH',
    cookie: session.cookie,
    body: { handle },
  });
  expect(named.status).toBe(200);
  const agent = await createAgent(session.cookie, 'Grok');
  for (const name of ['draft', 'review']) {
    const res = await call(postOffer, `http://localhost/api/v1/agents/${agent.id}/offers`, {
      cookie: session.cookie,
      params: { id: agent.id },
      body: { name, description: `Do a ${name}.`, result_schema: offerSchema },
    });
    expect(res.status).toBe(201);
  }
  const shared = await call(putSharing, `http://localhost/api/v1/agents/${agent.id}/sharing`, {
    method: 'PUT',
    cookie: session.cookie,
    params: { id: agent.id },
    body: { shared: true },
  });
  expect(shared.status).toBe(200);
  const agentKey = await createKey(session.cookie, agent.id);
  return { cookie: session.cookie, handle, agentId: agent.id, agentKey, userId: session.user.id };
}

async function createInvite(o: Owner, body: Record<string, unknown> = {}) {
  const res = await call(postInvite, `http://localhost/api/v1/agents/${o.agentId}/invites`, {
    cookie: o.cookie,
    params: { id: o.agentId },
    body: { kind: 'agent', offers: ['draft'], approve_on_redeem: true, ...body },
  });
  expect(res.status).toBe(201);
  return res.data as { invite: any; token: string; url: string; agent_prompt: string };
}

function randomIp(): string {
  return `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
}

async function redeemNew(token: string, extra: Record<string, unknown> = {}, ip = randomIp()) {
  return call(redeemRoute, 'http://localhost/api/v1/invites/redeem', {
    body: { invite: token, name: 'CustomerBot', ...extra },
    headers: { 'x-forwarded-for': ip },
  });
}

// Anonymous agent guests ship behind VALETTO_AGENT_GUESTS=1; these tests run with it on unless they say otherwise.
beforeEach(() => {
  process.env.VALETTO_AGENT_GUESTS = '1';
});

afterEach(() => {
  setGuestWorkspaceLimitForTests(null);
  delete process.env.VALETTO_AGENT_GUESTS;
});

describe('agent invite links ignore CUSTOMER_ORIGIN', () => {
  afterEach(() => {
    delete process.env.APP_ORIGIN;
    delete process.env.CUSTOMER_ORIGIN;
  });

  it('agent invite url, prompt, and redeem URLs use the canonical origin', async () => {
    process.env.APP_ORIGIN = 'https://app.example.test,https://valetto.example.test';
    process.env.CUSTOMER_ORIGIN = 'https://valetto.example.test';
    const o = await owner();
    const made = await createInvite(o);
    expect(made.url).toBe(`https://app.example.test/i#${made.token}`);
    expect(made.agent_prompt).toContain('https://app.example.test/skill.md');
    expect(made.agent_prompt).not.toContain('valetto.example.test');
    const redeemed = await redeemNew(made.token);
    expect(redeemed.status).toBe(201);
    expect(redeemed.data.mcp.url).toBe('https://app.example.test/api/mcp');
    expect(redeemed.data.docs.skill).toBe('https://app.example.test/skill.md');
    expect(redeemed.data.workspace.claim_url.startsWith('https://app.example.test/claim#')).toBe(true);
  });
});

describe('invite links', () => {
  it('creates an invite from the dashboard, pending by default, and returns the link and prompt once', async () => {
    const o = await owner();
    const created = await createInvite(o, { label: 'Initech', daily_cap: 20, approve_on_redeem: undefined });
    expect(created.token.startsWith('rsi_')).toBe(true);
    expect(created.url).toBe(`http://localhost/i#${created.token}`);
    expect(created.agent_prompt).toContain(created.token);
    expect(created.agent_prompt).toContain('/skill.md');
    expect(created.invite).toMatchObject({
      label: 'Initech',
      daily_cap: 20,
      max_uses: 1,
      uses: 0,
      approve_on_redeem: false,
      status: 'active',
      offers: [{ name: 'draft' }],
    });

    const listed = await call(listInvitesRoute, `http://localhost/api/v1/agents/${o.agentId}/invites`, {
      cookie: o.cookie,
      params: { id: o.agentId },
    });
    expect(listed.status).toBe(200);
    expect(listed.text.includes(created.token)).toBe(false);
    expect(listed.data.agent_guests_enabled).toBe(true);
    expect(listed.data.agent_invites[0].prefix).toBe(created.invite.prefix);
  });

  it('refuses an agent key on the REST route, has no MCP owner tools, and leaves default invites pending', async () => {
    const o = await owner();
    const rest = await call(postInvite, `http://localhost/api/v1/agents/${o.agentId}/invites`, {
      bearer: o.agentKey,
      params: { id: o.agentId },
      body: { kind: 'agent', offers: ['draft'] },
    });
    expect(rest.status).toBe(403);
    expect(rest.data.error.code).toBe('human_required');
    const viaMcp = await mcpTool(o.agentKey, 'create_invite', { agent: 'Grok', offers: ['draft'] });
    expect(viaMcp.isError).toBe(true);

    const made = await createInvite(o, { approve_on_redeem: undefined });
    const redeemed = await redeemNew(made.token);
    expect(redeemed.status).toBe(201);
    expect(redeemed.data.share.status).toBe('pending');
    expect(redeemed.data.next_steps).toContain('pending');
    const card = await mcpTool(redeemed.data.api_key, 'get_agent_card', { address: `@${o.handle}/Grok` });
    expect(card.payload.error).toBe('share_pending');

    const shares = await call(listSharesRoute, `http://localhost/api/v1/agents/${o.agentId}/shares`, {
      cookie: o.cookie,
      params: { id: o.agentId },
    });
    const share = shares.data.shares[0];
    expect(share.invite_prefix).toBe(made.invite.prefix);
    expect(share.source).toBe('agent_invite');
    const approved = await call(approveShare, `http://localhost/api/v1/agents/${o.agentId}/shares/${share.id}/approve`, {
      method: 'POST',
      cookie: o.cookie,
      params: { id: o.agentId, shareId: share.id },
    });
    expect(approved.status).toBe(200);
    const after = await mcpTool(redeemed.data.api_key, 'get_agent_card', { address: `@${o.handle}/Grok` });
    expect(after.isError).toBe(false);
  });

  it('validates create input', async () => {
    const o = await owner();
    const bad = async (body: Record<string, unknown>) =>
      call(postInvite, `http://localhost/api/v1/agents/${o.agentId}/invites`, {
        cookie: o.cookie,
        params: { id: o.agentId },
        body,
      });
    expect((await bad({ kind: 'agent', offers: ['nope'] })).data.error.code).toBe('offer_not_found');
    expect((await bad({ kind: 'agent', offers: ['draft'], expires_in_days: 91 })).status).toBe(400);
    expect((await bad({ kind: 'agent', offers: ['draft'], max_uses: 1001 })).status).toBe(400);
    expect((await bad({ offers: ['draft'] })).status).toBe(400);
    await call(putSharing, `http://localhost/api/v1/agents/${o.agentId}/sharing`, {
      method: 'PUT',
      cookie: o.cookie,
      params: { id: o.agentId },
      body: { shared: false },
    });
    expect((await bad({ kind: 'agent', offers: ['draft'] })).data.error.code).toBe('agent_not_shared');
  });

  it('redeems into a new workspace whose key can send guest tasks and get webhook results', async () => {
    const o = await owner();
    const { token } = await createInvite(o, { label: 'Initech', daily_cap: 7 });
    const receiver = await startReceiver();
    try {
      const redeemed = await redeemNew(token, { webhook: { url: receiver.url, auth: { type: 'none' } } });
      expect(redeemed.status).toBe(201);
      expect(redeemed.data.api_key.startsWith('rsk_')).toBe(true);
      expect(redeemed.data.workspace.handle).toMatch(/^g-[a-z2-7]{10}$/);
      expect(redeemed.data.workspace.claim_url).toMatch(/\/claim#rsc_/);
      expect(redeemed.data.share).toMatchObject({
        address: `@${o.handle}/Grok`,
        status: 'approved',
        daily_cap: 7,
        offers: [{ name: 'draft', result_schema: offerSchema }],
      });

      const [ws] = await getDb().select().from(workspaces).where(eq(workspaces.id, redeemed.data.workspace.id));
      expect(ws?.origin).toBe('invite');
      expect(ws?.name).toBe(`Initech (guest of @${o.handle})`);
      const [share] = await getDb().select().from(agentShares).where(eq(agentShares.guestWorkspaceId, ws!.id));
      expect(share?.label).toBe('Initech');

      const key = redeemed.data.api_key as string;
      const ungranted = await mcpTool(key, 'create_task', {
        to: `@${o.handle}/Grok`,
        offer: 'review',
        title: 'x',
        description: 'x',
      });
      expect(ungranted.payload.error).toBe('offer_not_found');
      const task = await mcpTool(key, 'create_task', {
        to: `@${o.handle}/Grok`,
        offer: 'draft',
        title: 'Headline',
        description: 'Write one.',
      });
      expect(task.isError).toBe(false);
      const done = await mcpTool(o.agentKey, 'complete_task', { id: task.payload.task.id, result: { headline: 'Hi' } });
      expect(done.isError).toBe(false);
      expect(receiver.hits.some((hit) => hit.body?.reason === 'result')).toBe(true);
    } finally {
      await receiver.close();
    }

    const again = await redeemNew(token);
    expect(again.status).toBe(410);
    expect(again.data.error.code).toBe('invite_exhausted');
  });

  it('redeems into an existing workspace once, idempotently, and refuses the owner workspace', async () => {
    const o = await owner();
    const { token } = await createInvite(o, { max_uses: 5 });
    const guest = await signIn();
    const bot = await createAgent(guest.cookie, 'Helper');
    const key = await createKey(guest.cookie, bot.id);

    const first = await mcpTool(key, 'redeem_invite', { invite: token, label: 'Acme' });
    expect(first.isError).toBe(false);
    expect(first.payload.created).toBe(true);
    const second = await mcpTool(key, 'redeem_invite', { invite: token });
    expect(second.payload.created).toBe(false);
    const [invite] = await getDb().select().from(agentInvites).where(eq(agentInvites.agentId, o.agentId));
    expect(invite?.uses).toBe(1);

    const rest = await call(redeemRoute, 'http://localhost/api/v1/invites/redeem', {
      bearer: key,
      body: { invite: token, name: 'Nope' },
    });
    expect(rest.status).toBe(400);

    const own = await mcpTool(o.agentKey, 'redeem_invite', { invite: token });
    expect(own.payload.error).toBe('invalid_guest');
  });

  it('reports revoked, expired, unknown, and no-longer-shared invites', async () => {
    const o = await owner();
    const revoked = await createInvite(o);
    await call(revokeInviteRoute, `http://localhost/api/v1/agents/${o.agentId}/invites/${revoked.invite.id}/revoke`, {
      method: 'POST',
      cookie: o.cookie,
      params: { id: o.agentId, inviteId: revoked.invite.id },
    });
    expect((await redeemNew(revoked.token)).data.error.code).toBe('invite_revoked');

    const expired = await createInvite(o);
    await getDb()
      .update(agentInvites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(agentInvites.id, expired.invite.id));
    expect((await redeemNew(expired.token)).data.error.code).toBe('invite_expired');

    const unknown = await redeemNew('rsi_doesnotexist');
    expect(unknown.status).toBe(404);
    expect(unknown.data.error.code).toBe('invite_not_found');

    const live = await createInvite(o);
    await call(putSharing, `http://localhost/api/v1/agents/${o.agentId}/sharing`, {
      method: 'PUT',
      cookie: o.cookie,
      params: { id: o.agentId },
      body: { shared: false },
    });
    expect((await redeemNew(live.token)).data.error.code).toBe('agent_not_shared');
  });

  it('lets exactly one of two concurrent redeems use a single-use invite', async () => {
    const o = await owner();
    const { token } = await createInvite(o);
    const results = await Promise.all([redeemNew(token), redeemNew(token)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 410]);
  });

  it('applies the free guest limit at redeem with wording for the guest', async () => {
    setGuestWorkspaceLimitForTests(1);
    const o = await owner();
    const { token } = await createInvite(o, { max_uses: 3 });
    expect((await redeemNew(token)).status).toBe(201);
    const blocked = await redeemNew(token);
    expect(blocked.status).toBe(403);
    expect(blocked.data.error).toBe('plan_limit');
    expect(blocked.data.message).toContain("owner's plan");
  });

  it('revokes an invite alone, or with every guest who joined with it', async () => {
    const o = await owner();
    const { token, invite } = await createInvite(o, { max_uses: 3 });
    const a = await redeemNew(token);
    const b = await redeemNew(token);
    const task = await mcpTool(a.data.api_key, 'create_task', {
      to: `@${o.handle}/Grok`,
      offer: 'draft',
      title: 'Open',
      description: 'Stays open.',
    });
    expect(task.isError).toBe(false);

    const url = `http://localhost/api/v1/agents/${o.agentId}/invites/${invite.id}/revoke`;
    const alone = await call(revokeInviteRoute, url, { method: 'POST', cookie: o.cookie, params: { id: o.agentId, inviteId: invite.id } });
    expect(alone.status).toBe(200);
    expect(alone.data).toMatchObject({ revoked_shares: 0, failed_tasks: 0 });
    expect(alone.data.invite.status).toBe('revoked');
    expect((await mcpTool(b.data.api_key, 'get_agent_card', { address: `@${o.handle}/Grok` })).isError).toBe(false);

    const all = await call(revokeInviteRoute, url, {
      cookie: o.cookie,
      params: { id: o.agentId, inviteId: invite.id },
      body: { revoke_shares: true },
    });
    expect(all.data).toMatchObject({ revoked_shares: 2, failed_tasks: 1 });
    const failed = await mcpTool(a.data.api_key, 'get_task', { id: task.payload.task.id });
    expect(failed.payload.task.fail_reason).toBe(ACCESS_REVOKED_REASON);
    expect((await mcpTool(b.data.api_key, 'get_agent_card', { address: `@${o.handle}/Grok` })).payload.error).toBe(
      'share_revoked',
    );
  });

  it('keeps unclaimed invite workspaces from sharing or creating invites', async () => {
    const o = await owner();
    const { token } = await createInvite(o);
    const redeemed = await redeemNew(token);
    const key = redeemed.data.api_key as string;
    const share = await mcpTool(key, 'set_agent_sharing', { agent: 'CustomerBot', shared: true });
    expect(share.payload.error).toBe('claim_required');
    const handle = await mcpTool(key, 'set_workspace_handle', { handle: handleName('c') });
    expect(handle.isError).toBe(false);
  });

  it('previews only granted offers and hides every invalid state behind one 404', async () => {
    const o = await owner();
    const { token } = await createInvite(o);
    const ok = await call(invitePreview, 'http://localhost/api/v1/invites/preview', { bearer: token });
    expect(ok.status).toBe(200);
    expect(ok.data.address).toBe(`@${o.handle}/Grok`);
    expect(ok.data.offers.map((offer: { name: string }) => offer.name)).toEqual(['draft']);
    expect(ok.data.uses_left).toBe(1);
    await redeemNew(token);
    const used = await call(invitePreview, 'http://localhost/api/v1/invites/preview', { bearer: token });
    const unknown = await call(invitePreview, 'http://localhost/api/v1/invites/preview', { bearer: 'rsi_nope' });
    expect(used.status).toBe(404);
    expect(used.data).toEqual(unknown.data);
  });

  it('lists redeem_invite but no owner invite tools over MCP', async () => {
    const o = await owner();
    const names = (await mcpListTools(o.agentKey)).map((tool) => tool.name);
    expect(names).toContain('redeem_invite');
    for (const name of ['create_invite', 'list_invites', 'revoke_invite']) expect(names).not.toContain(name);
  });

  it('never lets a revoked guest back in through an invite, in an existing or a fresh workspace', async () => {
    const o = await owner();
    const { token, invite } = await createInvite(o, { max_uses: 10 });
    const guest = await signIn();
    const bot = await createAgent(guest.cookie, 'Helper');
    const key = await createKey(guest.cookie, bot.id);
    expect((await mcpTool(key, 'redeem_invite', { invite: token })).isError).toBe(false);
    const ip = randomIp();
    const fresh = await redeemNew(token, {}, ip);
    expect(fresh.status).toBe(201);

    const shares = await call(listSharesRoute, `http://localhost/api/v1/agents/${o.agentId}/shares`, {
      cookie: o.cookie,
      params: { id: o.agentId },
    });
    expect(shares.data.shares).toHaveLength(2);
    const revoke = await call(revokeInviteRoute, `http://localhost/api/v1/agents/${o.agentId}/invites/${invite.id}/revoke`, {
      cookie: o.cookie,
      params: { id: o.agentId, inviteId: invite.id },
      body: { revoke_shares: true },
    });
    expect(revoke.data.revoked_shares).toBe(2);
    // Revoking the shares revoked the link too, so make a second link: an invite still must not revive the guest.
    const second = await createInvite(o, { max_uses: 10 });
    const again = await mcpTool(key, 'redeem_invite', { invite: second.token });
    expect(again.payload.error).toBe('share_revoked');

    // A fresh workspace from the same source on the same link is refused; the link stays usable for others.
    await getDb().update(agentInvites).set({ revokedAt: null }).where(eq(agentInvites.id, invite.id));
    const sameSource = await redeemNew(token, {}, ip);
    expect(sameSource.status).toBe(403);
    expect(sameSource.data.error.code).toBe('share_revoked');
    expect((await redeemNew(token)).status).toBe(201);
  });

  it('keeps the revoked-source block through workspace cleanup', async () => {
    const o = await owner();
    const { token, invite } = await createInvite(o, { max_uses: 10 });
    const ip = randomIp();
    const fresh = await redeemNew(token, {}, ip);
    await call(revokeInviteRoute, `http://localhost/api/v1/agents/${o.agentId}/invites/${invite.id}/revoke`, {
      cookie: o.cookie,
      params: { id: o.agentId, inviteId: invite.id },
      body: { revoke_shares: true },
    });
    await getDb()
      .update(workspaces)
      .set({ createdAt: new Date(Date.now() - (INVITE_WORKSPACE_IDLE_DAYS + 1) * 24 * 60 * 60 * 1000) })
      .where(eq(workspaces.id, fresh.data.workspace.id));
    await cleanupUnclaimedInviteWorkspaces();
    const kept = await getDb().select().from(workspaces).where(eq(workspaces.id, fresh.data.workspace.id));
    expect(kept).toHaveLength(1);
  });
});

describe('agent guests flag off', () => {
  it('hides create, preview, redeem, and claim behind 404 and reports the flag', async () => {
    const o = await owner();
    const made = await createInvite(o);
    const redeemed = await redeemNew(made.token);
    const claimToken = (redeemed.data.workspace.claim_url as string).split('#')[1]!;
    delete process.env.VALETTO_AGENT_GUESTS;

    const create = await call(postInvite, `http://localhost/api/v1/agents/${o.agentId}/invites`, {
      cookie: o.cookie,
      params: { id: o.agentId },
      body: { kind: 'agent', offers: ['draft'] },
    });
    expect(create.status).toBe(404);
    expect((await call(invitePreview, 'http://localhost/api/v1/invites/preview', { bearer: made.token })).status).toBe(404);
    expect((await redeemNew(made.token)).status).toBe(404);
    expect((await call(claimPreview, 'http://localhost/api/v1/claims/preview', { bearer: claimToken })).status).toBe(404);
    const email = emailAddress('flagoff');
    await call(requestCode, 'http://localhost/api/v1/auth/request-code', { body: { email } });
    const verified = await call(verifyCode, 'http://localhost/api/v1/auth/verify-code', {
      body: { email, code: latestCode(email), claim_token: claimToken },
    });
    expect(verified.status).toBe(404);
    const guest = await signIn();
    const bot = await createAgent(guest.cookie, 'Helper');
    const key = await createKey(guest.cookie, bot.id);
    expect((await mcpListTools(key)).map((tool) => tool.name)).not.toContain('redeem_invite');
    expect((await mcpTool(key, 'redeem_invite', { invite: made.token })).isError).toBe(true);

    const listed = await call(listInvitesRoute, `http://localhost/api/v1/agents/${o.agentId}/invites`, {
      cookie: o.cookie,
      params: { id: o.agentId },
    });
    expect(listed.data.agent_guests_enabled).toBe(false);
    expect(listed.data.agent_invites).toEqual([]);
  });
});

describe('claiming an invite workspace', () => {
  async function claimSetup() {
    const o = await owner();
    const { token } = await createInvite(o);
    const redeemed = await redeemNew(token);
    const claimToken = (redeemed.data.workspace.claim_url as string).split('#')[1]!;
    return { o, redeemed, claimToken };
  }

  async function verifyWithClaim(email: string, claimToken: string) {
    await call(requestCode, 'http://localhost/api/v1/auth/request-code', { body: { email } });
    return call(verifyCode, 'http://localhost/api/v1/auth/verify-code', {
      body: { email, code: latestCode(email), claim_token: claimToken },
    });
  }

  it('attaches a new email to the invite workspace, once', async () => {
    const { redeemed, claimToken } = await claimSetup();
    const preview = await call(claimPreview, 'http://localhost/api/v1/claims/preview', { bearer: claimToken });
    expect(preview.status).toBe(200);
    expect(preview.data.agents).toEqual([{ name: 'CustomerBot' }]);

    const verified = await verifyWithClaim(emailAddress('claimer'), claimToken);
    expect(verified.status).toBe(200);
    expect(verified.data.workspace.id).toBe(redeemed.data.workspace.id);
    const [ws] = await getDb().select().from(workspaces).where(eq(workspaces.id, redeemed.data.workspace.id));
    expect(ws?.claimedAt).not.toBeNull();
    expect(ws?.claimTokenHash).toBeNull();

    const shared = await mcpTool(redeemed.data.api_key, 'set_agent_sharing', { agent: 'CustomerBot', shared: true });
    expect(shared.isError).toBe(false);

    const second = await verifyWithClaim(emailAddress('late'), claimToken);
    expect(second.status).toBe(404);
    expect(second.data.error.code).toBe('claim_not_found');
  });

  it('expires the claim link after 7 days', async () => {
    const { redeemed, claimToken } = await claimSetup();
    const [ws] = await getDb().select().from(workspaces).where(eq(workspaces.id, redeemed.data.workspace.id));
    expect(ws!.claimExpiresAt!.getTime() - Date.now()).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1000);
    await getDb()
      .update(workspaces)
      .set({ claimExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(workspaces.id, redeemed.data.workspace.id));
    expect((await call(claimPreview, 'http://localhost/api/v1/claims/preview', { bearer: claimToken })).status).toBe(404);
    const verified = await verifyWithClaim(emailAddress('expired'), claimToken);
    expect(verified.status).toBe(404);
    expect(verified.data.error.code).toBe('claim_not_found');
  });

  it('refuses an email that already has a workspace without burning the code', async () => {
    const { claimToken } = await claimSetup();
    const existing = await signIn();
    await call(requestCode, 'http://localhost/api/v1/auth/request-code', { body: { email: existing.email } });
    const code = latestCode(existing.email);
    const refused = await call(verifyCode, 'http://localhost/api/v1/auth/verify-code', {
      body: { email: existing.email, code, claim_token: claimToken },
    });
    expect(refused.status).toBe(409);
    expect(refused.data.error.code).toBe('already_in_workspace');
    const plain = await call(verifyCode, 'http://localhost/api/v1/auth/verify-code', { body: { email: existing.email, code } });
    expect(plain.status).toBe(200);
  });
});

describe('cleanup of unclaimed invite workspaces', () => {
  async function aged(token: string, days = INVITE_WORKSPACE_IDLE_DAYS + 1) {
    const redeemed = await redeemNew(token);
    await getDb()
      .update(workspaces)
      .set({ createdAt: new Date(Date.now() - days * 24 * 60 * 60 * 1000) })
      .where(eq(workspaces.id, redeemed.data.workspace.id));
    return redeemed;
  }

  it('deletes idle ones and frees the guest slot, and keeps used, young, or claimed ones', async () => {
    const o = await owner();
    const { token } = await createInvite(o, { max_uses: 10 });
    const idle = await aged(token);
    const used = await aged(token);
    await getDb()
      .update(agentKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(agentKeys.agentId, used.data.agent.id));
    const young = await aged(token, 1);

    await cleanupUnclaimedInviteWorkspaces();

    const exists = async (id: string) => (await getDb().select().from(workspaces).where(eq(workspaces.id, id))).length > 0;
    expect(await exists(idle.data.workspace.id)).toBe(false);
    expect(await exists(used.data.workspace.id)).toBe(true);
    expect(await exists(young.data.workspace.id)).toBe(true);
    const leftover = await getDb().select().from(agents).where(eq(agents.workspaceId, idle.data.workspace.id));
    expect(leftover).toHaveLength(0);
    const shares = await getDb().select().from(agentShares).where(eq(agentShares.agentId, o.agentId));
    expect(shares).toHaveLength(2);
  });
});
