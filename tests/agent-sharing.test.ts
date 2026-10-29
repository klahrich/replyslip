import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { POST as postOffer } from '@/app/api/v1/agents/[id]/offers/route';
import { POST as postShare } from '@/app/api/v1/agents/[id]/shares/route';
import { PATCH as patchShare } from '@/app/api/v1/agents/[id]/shares/[shareId]/route';
import { POST as approveShare } from '@/app/api/v1/agents/[id]/shares/[shareId]/approve/route';
import { POST as revokeShare } from '@/app/api/v1/agents/[id]/shares/[shareId]/revoke/route';
import { PUT as putSharing } from '@/app/api/v1/agents/[id]/sharing/route';
import { PATCH as patchWorkspace } from '@/app/api/v1/workspaces/current/route';
import { getDb } from '@/db';
import { tasks, workspaces } from '@/db/schema';
import { ACCESS_REVOKED_REASON, DEFAULT_SHARE_DAILY_CAP } from '@/lib/constants';
import { FREE_GUEST_WORKSPACES, setGuestWorkspaceLimitForTests, usePlanLimitsForTests, workspacePlanUsage } from '@/lib/plans';
import { CROSS_WORKSPACE_TASK_NOTICE, GUEST_WAKE_NOTICE } from '@/lib/wake-notice';
import { call, createAgent, createKey, mcpListTools, mcpTool, setWebhook, signIn, startReceiver } from './helpers';

const offerSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['headline'],
  properties: { headline: { type: 'string' } },
};

function handleName(prefix: string): string {
  return `${prefix}${randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

async function setHandle(cookie: string, handle: string) {
  const res = await call(patchWorkspace, 'http://localhost/api/v1/workspaces/current', {
    method: 'PATCH',
    cookie,
    body: { handle },
  });
  expect(res.status).toBe(200);
  return res.data.workspace as { id: string; handle: string };
}

async function addOffer(cookie: string, agentId: string, name = 'draft') {
  const res = await call(postOffer, `http://localhost/api/v1/agents/${agentId}/offers`, {
    cookie,
    params: { id: agentId },
    body: { name, description: 'Draft the requested page.', result_schema: offerSchema },
  });
  expect(res.status).toBe(201);
  return res.data.offer as { id: string; name: string; result_schema: typeof offerSchema };
}

async function grant(
  ownerCookie: string,
  agentId: string,
  guestHandle: string,
  offerName: string,
  dailyCap?: number,
) {
  const invited = await call(postShare, `http://localhost/api/v1/agents/${agentId}/shares`, {
    cookie: ownerCookie,
    params: { id: agentId },
    body: { guest_handle: guestHandle, offers: [offerName], ...(dailyCap !== undefined ? { daily_cap: dailyCap } : {}) },
  });
  expect(invited.status).toBe(201);
  const share = invited.data.share as { id: string; status: string; daily_cap: number };
  expect(share.status).toBe('pending');
  expect(share.daily_cap).toBe(dailyCap ?? DEFAULT_SHARE_DAILY_CAP);
  const approved = await call(approveShare, `http://localhost/api/v1/agents/${agentId}/shares/${share.id}/approve`, {
    method: 'POST',
    cookie: ownerCookie,
    params: { id: agentId, shareId: share.id },
  });
  expect(approved.status).toBe(200);
  expect(approved.data.share.status).toBe('approved');
  return share;
}

afterEach(() => {
  usePlanLimitsForTests(null);
});

describe('agent sharing', () => {
  it('keeps the decided free-plan numbers', () => {
    expect(FREE_GUEST_WORKSPACES).toBe(250);
    expect(DEFAULT_SHARE_DAILY_CAP).toBe(50);
    expect(ACCESS_REVOKED_REASON).toBe('access revoked');
  });

  it('sends a guest task with the offer schema and hides the rest of the owner workspace', async () => {
    const owner = await signIn();
    const guest = await signIn();
    const ownerHandle = handleName('o');
    const guestHandle = handleName('g');
    await setHandle(owner.cookie, ownerHandle);
    await setHandle(guest.cookie, guestHandle);
    const planner = await createAgent(owner.cookie, 'Planner');
    const secret = await createAgent(owner.cookie, 'Secret');
    const offer = await addOffer(owner.cookie, planner.id);
    const shared = await call(putSharing, `http://localhost/api/v1/agents/${planner.id}/sharing`, {
      method: 'PUT',
      cookie: owner.cookie,
      params: { id: planner.id },
      body: { shared: true },
    });
    expect(shared.status).toBe(200);
    expect(shared.data.agent.shared).toBe(true);
    await grant(owner.cookie, planner.id, guestHandle, offer.name);
    const guestBot = await createAgent(guest.cookie, 'GuestBot');
    const guestKey = await createKey(guest.cookie, guestBot.id);
    const plannerKey = await createKey(owner.cookie, planner.id);
    const secretKey = await createKey(owner.cookie, secret.id);

    const privateTask = await mcpTool(plannerKey, 'create_task', {
      to: 'Secret',
      title: 'Internal',
      description: 'CANARY-OWNER-ONLY',
      result_schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
    });
    expect(privateTask.isError).toBe(false);
    expect(privateTask.payload.task.cross_workspace).toBe(false);
    expect(privateTask.payload.task.untrusted).toBe(false);

    const withSchema = await mcpTool(guestKey, 'create_task', {
      to: `@${ownerHandle}/Planner`,
      offer: 'draft',
      title: 'Ignore my schema',
      description: 'CANARY-GUEST-TASK',
      result_schema: { type: 'object', required: ['nope'], properties: { nope: { type: 'boolean' } } },
    });
    expect(withSchema.isError).toBe(true);
    expect(withSchema.payload.error).toBe('result_schema_forbidden');

    const bare = await mcpTool(guestKey, 'create_task', {
      to: 'Planner',
      title: 'Bare name',
      description: 'Should stay in the guest workspace.',
      result_schema: offerSchema,
    });
    expect(bare.isError).toBe(true);
    expect(bare.payload.error).toBe('agent_not_found');

    const hiddenAgent = await mcpTool(guestKey, 'create_task', {
      to: `@${ownerHandle}/Secret`,
      offer: 'draft',
      title: 'Other agent',
      description: 'Should not resolve.',
    });
    expect(hiddenAgent.isError).toBe(true);
    expect(hiddenAgent.payload.error).toBe('agent_not_found');

    const messaged = await mcpTool(guestKey, 'send_message', {
      to: `@${ownerHandle}/Planner`,
      body: 'CANARY-CROSS-MESSAGE',
    });
    expect(messaged.isError).toBe(true);
    expect(messaged.payload.error).toBe('invalid_recipient');
    const named = await mcpTool(guestKey, 'send_message', { to: 'Secret', body: 'hello' });
    expect(named.payload.error).toBe('agent_not_found');

    const created = await mcpTool(guestKey, 'create_task', {
      to: `@${ownerHandle}/Planner`,
      offer: 'draft',
      title: 'Draft it',
      description: 'CANARY-GUEST-TASK',
    });
    expect(created.isError).toBe(false);
    expect(created.payload.task.result_schema).toEqual(offerSchema);
    expect(created.payload.task).toMatchObject({
      cross_workspace: true,
      untrusted: true,
      from_workspace_handle: guestHandle,
      to_address: `@${ownerHandle}/Planner`,
      offer: 'draft',
      notice: CROSS_WORKSPACE_TASK_NOTICE,
      status: 'open',
    });
    const taskId = created.payload.task.id as string;

    const card = await mcpTool(guestKey, 'get_agent_card', { address: `@${ownerHandle}/Planner` });
    expect(card.isError).toBe(false);
    expect(card.payload.card.offers).toEqual([
      {
        name: 'draft',
        description: 'Draft the requested page.',
        result_schema: offerSchema,
        input_schema: null,
        notes_enabled: true,
        notes_max: null,
      },
    ]);
    expect(created.payload.task.input).toBeNull();
    expect(created.payload.task.input_schema).toBeNull();
    expect(JSON.stringify(card.payload)).not.toContain('Secret');
    expect(JSON.stringify(card.payload)).not.toContain('webhook');

    const seenByGuest = await mcpTool(guestKey, 'get_task', { id: taskId });
    expect(seenByGuest.payload.task.description).toBe('CANARY-GUEST-TASK');
    expect(seenByGuest.payload.task.untrusted).toBe(true);
    const seenByPlanner = await mcpTool(plannerKey, 'get_task', { id: taskId });
    expect(seenByPlanner.payload.task.untrusted).toBe(true);
    expect(seenByPlanner.payload.task.notice).toBe(CROSS_WORKSPACE_TASK_NOTICE);
    const hiddenFromSecret = await mcpTool(secretKey, 'get_task', { id: taskId });
    expect(hiddenFromSecret.payload.error).toBe('not_found');
    const hiddenPrivate = await mcpTool(guestKey, 'get_task', { id: privateTask.payload.task.id });
    expect(hiddenPrivate.payload.error).toBe('not_found');

    const guestList = await mcpTool(guestKey, 'list_tasks', { role: 'sent' });
    expect(guestList.payload.tasks.map((task: { id: string }) => task.id)).toContain(taskId);
    expect(JSON.stringify(guestList.payload)).not.toContain('CANARY-OWNER-ONLY');
    const secretList = await mcpTool(secretKey, 'list_tasks', {});
    expect(JSON.stringify(secretList.payload)).not.toContain('CANARY-GUEST-TASK');
    expect(secretList.payload.tasks.map((task: { title: string }) => task.title)).toContain('Internal');

    const guestClose = await mcpTool(guestKey, 'complete_task', { id: taskId, result: { headline: 'nope' } });
    expect(guestClose.payload.error).toBe('forbidden');
    const mismatch = await mcpTool(plannerKey, 'complete_task', { id: taskId, result: { ok: true } });
    expect(mismatch.payload.error).toBe('result_schema_mismatch');
    const done = await mcpTool(plannerKey, 'complete_task', { id: taskId, result: { headline: 'Dinner' } });
    expect(done.isError).toBe(false);
    expect(done.payload.task.status).toBe('done');
    expect(done.payload.task.result).toEqual({ headline: 'Dinner' });

    const guestUsage = await workspacePlanUsage(guest.workspace.id);
    const ownerUsage = await workspacePlanUsage(owner.workspace.id);
    expect(guestUsage.usage.tasks_this_month).toBe(1);
    expect(ownerUsage.usage.tasks_this_month).toBe(1);
  });

  it('blocks a pending grant, then fails open tasks when access is revoked', async () => {
    const owner = await signIn();
    const guest = await signIn();
    const ownerHandle = handleName('o');
    const guestHandle = handleName('g');
    await setHandle(owner.cookie, ownerHandle);
    await setHandle(guest.cookie, guestHandle);
    const planner = await createAgent(owner.cookie, 'Planner');
    await addOffer(owner.cookie, planner.id);
    await call(putSharing, `http://localhost/api/v1/agents/${planner.id}/sharing`, {
      method: 'PUT',
      cookie: owner.cookie,
      params: { id: planner.id },
      body: { shared: true },
    });
    const invited = await call(postShare, `http://localhost/api/v1/agents/${planner.id}/shares`, {
      cookie: owner.cookie,
      params: { id: planner.id },
      body: { guest_handle: guestHandle, offers: ['draft'] },
    });
    const guestBot = await createAgent(guest.cookie, 'GuestBot');
    const guestKey = await createKey(guest.cookie, guestBot.id);
    const pending = await mcpTool(guestKey, 'create_task', {
      to: `@${ownerHandle}/Planner`,
      offer: 'draft',
      title: 'Too early',
      description: 'Not approved.',
    });
    expect(pending.payload.error).toBe('share_pending');
    const card = await mcpTool(guestKey, 'get_agent_card', { address: `@${ownerHandle}/Planner` });
    expect(card.payload.error).toBe('share_pending');

    const shareId = invited.data.share.id as string;
    const approved = await call(approveShare, `http://localhost/api/v1/agents/${planner.id}/shares/${shareId}/approve`, {
      method: 'POST',
      cookie: owner.cookie,
      params: { id: planner.id, shareId },
    });
    expect(approved.status).toBe(200);
    const receiver = await startReceiver();
    try {
      await setWebhook(guest.cookie, guestBot.id, receiver.url);
      const created = await mcpTool(guestKey, 'create_task', {
        to: `@${ownerHandle}/Planner`,
        offer: 'draft',
        title: 'Live',
        description: 'CANARY-REVOKE-BODY',
      });
      expect(created.isError).toBe(false);
      const revoked = await call(revokeShare, `http://localhost/api/v1/agents/${planner.id}/shares/${shareId}/revoke`, {
        method: 'POST',
        cookie: owner.cookie,
        params: { id: planner.id, shareId },
      });
      expect(revoked.status).toBe(200);
      expect(revoked.data.share.status).toBe('revoked');
      expect(revoked.data.failed_tasks).toBe(1);
      const taskId = created.payload.task.id as string;
      const after = await mcpTool(guestKey, 'get_task', { id: taskId });
      expect(after.payload.task.status).toBe('failed');
      expect(after.payload.task.fail_reason).toBe('access revoked');
      expect(receiver.hits.some((hit) => hit.body?.reason === 'failure' && hit.body?.notice === GUEST_WAKE_NOTICE)).toBe(true);
      expect(receiver.hits.some((hit) => hit.raw.includes('CANARY-REVOKE-BODY'))).toBe(false);
      const again = await mcpTool(guestKey, 'create_task', {
        to: `@${ownerHandle}/Planner`,
        offer: 'draft',
        title: 'After revoke',
        description: 'No.',
      });
      expect(again.payload.error).toBe('share_revoked');
    } finally {
      await receiver.close();
    }
  });

  it('labels the recipient wake as untrusted and stops at the daily cap', async () => {
    const owner = await signIn();
    const guest = await signIn();
    const ownerHandle = handleName('o');
    const guestHandle = handleName('g');
    await setHandle(owner.cookie, ownerHandle);
    await setHandle(guest.cookie, guestHandle);
    const planner = await createAgent(owner.cookie, 'Planner');
    await addOffer(owner.cookie, planner.id);
    await call(putSharing, `http://localhost/api/v1/agents/${planner.id}/sharing`, {
      method: 'PUT',
      cookie: owner.cookie,
      params: { id: planner.id },
      body: { shared: true },
    });
    await grant(owner.cookie, planner.id, guestHandle, 'draft', 1);
    const guestBot = await createAgent(guest.cookie, 'GuestBot');
    const guestKey = await createKey(guest.cookie, guestBot.id);
    const receiver = await startReceiver();
    try {
      await setWebhook(owner.cookie, planner.id, receiver.url);
      const first = await mcpTool(guestKey, 'create_task', {
        to: `@${ownerHandle}/Planner`,
        offer: 'draft',
        title: 'One',
        description: 'CANARY-CAP-BODY',
      });
      expect(first.isError).toBe(false);
      expect(receiver.hits[0]?.body.notice).toBe(GUEST_WAKE_NOTICE);
      expect(receiver.hits[0]?.raw.includes('CANARY-CAP-BODY')).toBe(false);
      const second = await mcpTool(guestKey, 'create_task', {
        to: `@${ownerHandle}/Planner`,
        offer: 'draft',
        title: 'Two',
        description: 'Over the cap.',
      });
      expect(second.isError).toBe(true);
      expect(second.payload.error).toBe('rate_limited');
      const rows = await getDb()
        .select({ id: tasks.id })
        .from(tasks)
        .where(eq(tasks.fromAgentId, guestBot.id));
      expect(rows).toHaveLength(1);
    } finally {
      await receiver.close();
    }
  });

  it('charges the guest monthly quota and not the owner', async () => {
    usePlanLimitsForTests({ agents: 10, tasksPerMonth: 1 });
    const owner = await signIn();
    const guest = await signIn();
    const ownerHandle = handleName('o');
    const guestHandle = handleName('g');
    await setHandle(owner.cookie, ownerHandle);
    await setHandle(guest.cookie, guestHandle);
    const planner = await createAgent(owner.cookie, 'Planner');
    const coworker = await createAgent(owner.cookie, 'Coworker');
    await addOffer(owner.cookie, planner.id);
    await call(putSharing, `http://localhost/api/v1/agents/${planner.id}/sharing`, {
      method: 'PUT',
      cookie: owner.cookie,
      params: { id: planner.id },
      body: { shared: true },
    });
    await grant(owner.cookie, planner.id, guestHandle, 'draft');
    const guestBot = await createAgent(guest.cookie, 'GuestBot');
    const guestKey = await createKey(guest.cookie, guestBot.id);
    const coworkerKey = await createKey(owner.cookie, coworker.id);
    const first = await mcpTool(guestKey, 'create_task', {
      to: `@${ownerHandle}/Planner`,
      offer: 'draft',
      title: 'Counted',
      description: 'Counts for the guest.',
    });
    expect(first.isError).toBe(false);
    expect((await workspacePlanUsage(guest.workspace.id)).usage.tasks_this_month).toBe(1);
    expect((await workspacePlanUsage(owner.workspace.id)).usage.tasks_this_month).toBe(0);
    const blocked = await mcpTool(guestKey, 'create_task', {
      to: `@${ownerHandle}/Planner`,
      offer: 'draft',
      title: 'Over',
      description: 'Guest is at the cap.',
    });
    expect(blocked.payload.error).toBe('plan_limit');
    expect(blocked.payload.limit).toBe('tasks_per_month');
    const ownerTask = await mcpTool(coworkerKey, 'create_task', {
      to: 'Planner',
      title: 'Owner still has a slot',
      description: 'This is the owner workspace.',
      result_schema: { type: 'object' },
    });
    expect(ownerTask.isError).toBe(false);
    expect((await workspacePlanUsage(owner.workspace.id)).usage.tasks_this_month).toBe(1);
    expect((await workspacePlanUsage(guest.workspace.id)).usage.tasks_this_month).toBe(1);
  });

  it('caps guest workspaces on the free plan and lifts that cap when unlimited', async () => {
    setGuestWorkspaceLimitForTests(1);
    const owner = await signIn();
    const firstGuest = await signIn();
    const secondGuest = await signIn();
    await setHandle(owner.cookie, handleName('o'));
    const firstHandle = handleName('a');
    await setHandle(firstGuest.cookie, firstHandle);
    const secondHandle = handleName('b');
    await setHandle(secondGuest.cookie, secondHandle);
    const planner = await createAgent(owner.cookie, 'Planner');
    await addOffer(owner.cookie, planner.id);
    await call(putSharing, `http://localhost/api/v1/agents/${planner.id}/sharing`, {
      method: 'PUT',
      cookie: owner.cookie,
      params: { id: planner.id },
      body: { shared: true },
    });
    const first = await call(postShare, `http://localhost/api/v1/agents/${planner.id}/shares`, {
      cookie: owner.cookie,
      params: { id: planner.id },
      body: { guest_handle: firstHandle, offers: ['draft'] },
    });
    expect(first.status).toBe(201);
    const blocked = await call(postShare, `http://localhost/api/v1/agents/${planner.id}/shares`, {
      cookie: owner.cookie,
      params: { id: planner.id },
      body: { guest_handle: secondHandle, offers: ['draft'] },
    });
    expect(blocked.status).toBe(403);
    expect(blocked.data).toMatchObject({ error: 'plan_limit', limit: 'guest_workspaces', max: 1, used: 1 });

    await getDb().update(workspaces).set({ plan: 'unlimited' }).where(eq(workspaces.id, owner.workspace.id));
    const allowed = await call(postShare, `http://localhost/api/v1/agents/${planner.id}/shares`, {
      cookie: owner.cookie,
      params: { id: planner.id },
      body: { guest_handle: secondHandle, offers: ['draft'] },
    });
    expect(allowed.status).toBe(201);
  });

  it('lets an owner agent manage the grant over MCP', async () => {
    const owner = await signIn();
    const guest = await signIn();
    const ownerHandle = handleName('o');
    const guestHandle = handleName('g');
    const planner = await createAgent(owner.cookie, 'Planner');
    const plannerKey = await createKey(owner.cookie, planner.id);
    const named = await mcpTool(plannerKey, 'set_workspace_handle', { handle: ownerHandle });
    expect(named.isError).toBe(false);
    expect(named.payload.workspace.handle).toBe(ownerHandle);
    await setHandle(guest.cookie, guestHandle);
    const offer = await mcpTool(plannerKey, 'upsert_offer', {
      agent: 'Planner',
      name: 'draft',
      description: 'Draft the requested page.',
      result_schema: offerSchema,
    });
    expect(offer.payload.created).toBe(true);
    const sharing = await mcpTool(plannerKey, 'set_agent_sharing', { agent: 'Planner', shared: true });
    expect(sharing.payload.agent.shared).toBe(true);
    const invited = await mcpTool(plannerKey, 'invite_guest', {
      agent: 'Planner',
      guest_handle: guestHandle,
      offers: ['draft'],
      daily_cap: 3,
      status: 'approved',
    });
    expect(invited.isError).toBe(false);
    expect(invited.payload.share.status).toBe('pending');
    const approved = await call(approveShare, `http://localhost/api/v1/agents/${planner.id}/shares/${invited.payload.share.id}/approve`, {
      method: 'POST',
      cookie: owner.cookie,
      params: { id: planner.id, shareId: invited.payload.share.id },
    });
    expect(approved.status).toBe(200);
    expect(approved.data.share.status).toBe('approved');
    const listed = await mcpTool(plannerKey, 'list_guest_shares', { agent: 'Planner' });
    expect(listed.payload.shares).toHaveLength(1);
    const guestBot = await createAgent(guest.cookie, 'GuestBot');
    const guestKey = await createKey(guest.cookie, guestBot.id);
    const wrongOffer = await mcpTool(guestKey, 'create_task', {
      to: `@${ownerHandle}/Planner`,
      offer: 'missing',
      title: 'No such offer',
      description: 'Nope.',
    });
    expect(wrongOffer.payload.error).toBe('offer_not_found');
    const created = await mcpTool(guestKey, 'create_task', {
      to: `@${ownerHandle}/Planner`,
      offer: 'draft',
      title: 'From MCP',
      description: 'Granted.',
    });
    expect(created.isError).toBe(false);
    expect(created.payload.task.result_schema).toEqual(offerSchema);
    const unshared = await mcpTool(plannerKey, 'set_agent_sharing', { agent: 'Planner', shared: false });
    expect(unshared.payload.agent.shared).toBe(false);
    const after = await mcpTool(guestKey, 'get_task', { id: created.payload.task.id });
    expect(after.payload.task.status).toBe('failed');
    expect(after.payload.task.fail_reason).toBe('access revoked');
    const denied = await mcpTool(guestKey, 'get_agent_card', { address: `@${ownerHandle}/Planner` });
    expect(denied.payload.error).toBe('agent_not_found');
  });

  it('answers a guest the same for an offer outside the grant and an unknown offer', async () => {
    const owner = await signIn();
    const guest = await signIn();
    const ownerHandle = handleName('o');
    const guestHandle = handleName('g');
    await setHandle(owner.cookie, ownerHandle);
    await setHandle(guest.cookie, guestHandle);
    const planner = await createAgent(owner.cookie, 'Planner');
    await addOffer(owner.cookie, planner.id, 'draft');
    await addOffer(owner.cookie, planner.id, 'hidden');
    const shared = await call(putSharing, `http://localhost/api/v1/agents/${planner.id}/sharing`, {
      method: 'PUT',
      cookie: owner.cookie,
      params: { id: planner.id },
      body: { shared: true },
    });
    expect(shared.status).toBe(200);
    await grant(owner.cookie, planner.id, guestHandle, 'draft');
    const guestBot = await createAgent(guest.cookie, 'GuestBot');
    const guestKey = await createKey(guest.cookie, guestBot.id);
    const to = `@${ownerHandle}/Planner`;

    const card = await mcpTool(guestKey, 'get_agent_card', { address: to });
    expect(card.isError).toBe(false);
    expect(card.payload.card.offers.map((o: { name: string }) => o.name)).toEqual(['draft']);

    const attempt = (offer: string) =>
      mcpTool(guestKey, 'create_task', { to, offer, title: 'Probe', description: 'Which offers exist?' });
    const notGranted = await attempt('hidden');
    const unknown = await attempt('nosuch');
    expect(notGranted.isError).toBe(true);
    expect(notGranted.httpStatus).toBe(unknown.httpStatus);
    expect(notGranted.payload.error).toBe('offer_not_found');
    expect(unknown.payload.error).toBe('offer_not_found');
    expect(JSON.stringify(notGranted.payload).replaceAll('hidden', 'OFFER')).toBe(JSON.stringify(unknown.payload).replaceAll('nosuch', 'OFFER'));
    expect(JSON.stringify(notGranted.payload)).not.toMatch(/grant|includ|access/i);

    const ok = await attempt('draft');
    expect(ok.isError).toBe(false);
  });

  it('lets only a signed-in human approve a guest', async () => {
    const owner = await signIn();
    const guest = await signIn();
    const guestHandle = handleName('g');
    await setHandle(guest.cookie, guestHandle);
    const planner = await createAgent(owner.cookie, 'Planner');
    const plannerKey = await createKey(owner.cookie, planner.id);
    await mcpTool(plannerKey, 'set_workspace_handle', { handle: handleName('o') });
    await mcpTool(plannerKey, 'upsert_offer', {
      agent: 'Planner',
      name: 'draft',
      description: 'Draft the requested page.',
      result_schema: offerSchema,
    });
    await mcpTool(plannerKey, 'set_agent_sharing', { agent: 'Planner', shared: true });

    const tools = await mcpListTools(plannerKey);
    expect(tools.map((tool) => tool.name)).not.toContain('approve_guest');
    const missing = await mcpTool(plannerKey, 'approve_guest', { agent: 'Planner', guest_handle: guestHandle });
    expect(missing.isError).toBe(true);

    const invited = await mcpTool(plannerKey, 'invite_guest', {
      agent: 'Planner',
      guest_handle: guestHandle,
      offers: ['draft'],
    });
    expect(invited.isError).toBe(false);
    expect(invited.payload.share.status).toBe('pending');
    const shareId = invited.payload.share.id as string;

    const byKey = await call(approveShare, `http://localhost/api/v1/agents/${planner.id}/shares/${shareId}/approve`, {
      method: 'POST',
      bearer: plannerKey,
      cookie: owner.cookie,
      params: { id: planner.id, shareId },
    });
    expect(byKey.status).toBe(403);
    expect(byKey.data.error.code).toBe('human_required');

    const byKeyOnly = await call(approveShare, `http://localhost/api/v1/agents/${planner.id}/shares/${shareId}/approve`, {
      method: 'POST',
      bearer: plannerKey,
      params: { id: planner.id, shareId },
    });
    expect(byKeyOnly.status).toBe(403);
    expect(byKeyOnly.data.error.code).toBe('human_required');

    const patched = await call(patchShare, `http://localhost/api/v1/agents/${planner.id}/shares/${shareId}`, {
      method: 'PATCH',
      bearer: plannerKey,
      cookie: owner.cookie,
      params: { id: planner.id, shareId },
      body: { status: 'approved', daily_cap: 9 },
    });
    expect(patched.status).toBe(403);
    expect(patched.data.error.code).toBe('human_required');

    const stillPending = await mcpTool(plannerKey, 'list_guest_shares', { agent: 'Planner' });
    expect(stillPending.payload.shares[0].status).toBe('pending');
    expect(stillPending.payload.shares[0].daily_cap).toBe(50);

    const sessionPatch = await call(patchShare, `http://localhost/api/v1/agents/${planner.id}/shares/${shareId}`, {
      method: 'PATCH',
      cookie: owner.cookie,
      params: { id: planner.id, shareId },
      body: { status: 'approved', daily_cap: 9 },
    });
    expect(sessionPatch.status).toBe(200);
    expect(sessionPatch.data.share.status).toBe('pending');
    expect(sessionPatch.data.share.daily_cap).toBe(9);

    const sessionApprove = await call(approveShare, `http://localhost/api/v1/agents/${planner.id}/shares/${shareId}/approve`, {
      method: 'POST',
      cookie: owner.cookie,
      params: { id: planner.id, shareId },
    });
    expect(sessionApprove.status).toBe(200);
    expect(sessionApprove.data.share.status).toBe('approved');
  });
});
