import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { POST as postOffer } from '@/app/api/v1/agents/[id]/offers/route';
import { PATCH as patchOffer } from '@/app/api/v1/agents/[id]/offers/[offerId]/route';
import { POST as postShare } from '@/app/api/v1/agents/[id]/shares/route';
import { POST as approveShare } from '@/app/api/v1/agents/[id]/shares/[shareId]/approve/route';
import { PUT as putSharing } from '@/app/api/v1/agents/[id]/sharing/route';
import { GET as listTasksRoute } from '@/app/api/v1/tasks/route';
import { PATCH as patchWorkspace } from '@/app/api/v1/workspaces/current/route';
import { getDb } from '@/db';
import { agentOffers, tasks, wakes } from '@/db/schema';
import { FORM_NOTES_MAX } from '@/lib/constants';
import { INPUT_SCHEMA_CLEARED_WARNING } from '@/lib/sharing';
import { call, createAgent, createKey, mcpTool, setWebhook, signIn, startReceiver } from './helpers';

const resultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['price'],
  properties: { price: { type: 'number' } },
};

const quoteForm = {
  title: 'Framing quote',
  type: 'object',
  required: ['width_cm', 'material'],
  properties: {
    width_cm: { type: 'integer', title: 'Width (cm)', minimum: 5, maximum: 300 },
    material: { type: 'string', enum: ['oak', 'walnut'] },
    message: { type: 'string', maxLength: 200 },
  },
};

const goodInput = { width_cm: 40, material: 'oak', message: 'CANARY-INPUT-STRING' };

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
}

/** Owner with a shared Planner, a guest with an approved grant, and their keys. */
async function setup(opts: { offers: string[]; grantOffers?: string[]; dailyCap?: number; inputSchema?: unknown }) {
  const owner = await signIn();
  const guest = await signIn();
  const ownerHandle = handleName('o');
  const guestHandle = handleName('g');
  await setHandle(owner.cookie, ownerHandle);
  await setHandle(guest.cookie, guestHandle);
  const planner = await createAgent(owner.cookie, 'Planner');
  const offers: Record<string, any> = {};
  for (const name of opts.offers) {
    const res = await call(postOffer, `http://localhost/api/v1/agents/${planner.id}/offers`, {
      cookie: owner.cookie,
      params: { id: planner.id },
      body: {
        name,
        description: `Offer ${name}.`,
        result_schema: resultSchema,
        ...(name.startsWith('form') ? { input_schema: opts.inputSchema ?? quoteForm } : {}),
      },
    });
    expect(res.status).toBe(201);
    offers[name] = res.data.offer;
  }
  const shared = await call(putSharing, `http://localhost/api/v1/agents/${planner.id}/sharing`, {
    method: 'PUT',
    cookie: owner.cookie,
    params: { id: planner.id },
    body: { shared: true },
  });
  expect(shared.status).toBe(200);
  const invited = await call(postShare, `http://localhost/api/v1/agents/${planner.id}/shares`, {
    cookie: owner.cookie,
    params: { id: planner.id },
    body: {
      guest_handle: guestHandle,
      offers: opts.grantOffers ?? opts.offers,
      ...(opts.dailyCap !== undefined ? { daily_cap: opts.dailyCap } : {}),
    },
  });
  expect(invited.status).toBe(201);
  const shareId = invited.data.share.id as string;
  const approved = await call(approveShare, `http://localhost/api/v1/agents/${planner.id}/shares/${shareId}/approve`, {
    method: 'POST',
    cookie: owner.cookie,
    params: { id: planner.id, shareId },
  });
  expect(approved.status).toBe(200);
  const guestBot = await createAgent(guest.cookie, 'GuestBot');
  const guestKey = await createKey(guest.cookie, guestBot.id);
  const plannerKey = await createKey(owner.cookie, planner.id);
  return { owner, guest, planner, guestBot, guestKey, plannerKey, offers, to: `@${ownerHandle}/Planner` };
}

async function guestTaskCount(guestBotId: string): Promise<number> {
  const rows = await getDb().select({ id: tasks.id }).from(tasks).where(eq(tasks.fromAgentId, guestBotId));
  return rows.length;
}

async function wakeCount(agentId: string): Promise<number> {
  const rows = await getDb()
    .select({ id: wakes.id })
    .from(wakes)
    .where(and(eq(wakes.agentId, agentId), eq(wakes.reason, 'task')));
  return rows.length;
}

describe('offer input_schema', () => {
  it('saves, keeps, and clears input_schema through upsert_offer, and shows it on the card', async () => {
    const s = await setup({ offers: ['draft'] });
    const upsert = (args: Record<string, unknown>) =>
      mcpTool(s.plannerKey, 'upsert_offer', {
        agent: 'Planner',
        name: 'draft',
        description: 'Offer draft.',
        result_schema: resultSchema,
        ...args,
      });

    const set = await upsert({ input_schema: quoteForm });
    expect(set.isError).toBe(false);
    expect(set.payload.created).toBe(false);
    expect(set.payload.warning).toBeUndefined();
    expect(set.payload.offer.input_schema).toMatchObject({
      additionalProperties: false,
      'x-order': ['width_cm', 'material', 'message'],
    });

    const card = await mcpTool(s.guestKey, 'get_agent_card', { address: s.to });
    expect(card.payload.card.offers[0]).toMatchObject({
      name: 'draft',
      input_schema: { title: 'Framing quote', additionalProperties: false },
      notes_enabled: true,
      notes_max: FORM_NOTES_MAX,
    });

    const kept = await upsert({ description: 'Still a form.' });
    expect(kept.payload.offer.input_schema).not.toBeNull();
    expect(kept.payload.warning).toBeUndefined();

    const notesOff = await upsert({ notes_enabled: false });
    expect(notesOff.payload.offer.notes_enabled).toBe(false);
    const cardOff = await mcpTool(s.guestKey, 'get_agent_card', { address: s.to });
    expect(cardOff.payload.card.offers[0].notes_max).toBe(0);

    const clearWhileNotesOff = await upsert({ input_schema: null });
    expect(clearWhileNotesOff.payload.error).toBe('notes_required_without_input_schema');

    const cleared = await upsert({ input_schema: null, notes_enabled: true });
    expect(cleared.isError).toBe(false);
    expect(cleared.payload.offer.input_schema).toBeNull();
    expect(cleared.payload.warning).toBe(INPUT_SCHEMA_CLEARED_WARNING);

    const bad = await upsert({ input_schema: { type: 'object', properties: { a: { type: 'string' } } } });
    expect(bad.payload.error).toBe('invalid_input_schema');
    expect(bad.payload.details.problems).toEqual([expect.objectContaining({ rule: 'string_needs_max_length', path: '/properties/a' })]);

    const created = await mcpTool(s.plannerKey, 'upsert_offer', {
      agent: 'Planner',
      name: 'fresh',
      description: 'New offer.',
      result_schema: resultSchema,
      notes_enabled: false,
    });
    expect(created.payload.error).toBe('notes_required_without_input_schema');
  });

  it('accepts input_schema on REST POST and PATCH and lists every problem', async () => {
    const owner = await signIn();
    const planner = await createAgent(owner.cookie, 'Planner');
    const base = `http://localhost/api/v1/agents/${planner.id}/offers`;
    const bad = await call(postOffer, base, {
      cookie: owner.cookie,
      params: { id: planner.id },
      body: {
        name: 'quote',
        description: 'Quote.',
        result_schema: resultSchema,
        input_schema: { type: 'object', additionalProperties: true, properties: { notes: { type: 'string', maxLength: 5 }, x: { $ref: '#' } } },
      },
    });
    expect(bad.status).toBe(400);
    expect(bad.data.error.code).toBe('invalid_input_schema');
    expect(bad.data.error.details.problems.map((p: { rule: string }) => p.rule).sort()).toEqual([
      'additional_properties_must_be_false',
      'bad_property_name',
      'property_type_not_allowed',
    ]);

    const ok = await call(postOffer, base, {
      cookie: owner.cookie,
      params: { id: planner.id },
      body: { name: 'quote', description: 'Quote.', result_schema: resultSchema, input_schema: quoteForm, notes_enabled: false },
    });
    expect(ok.status).toBe(201);
    expect(ok.data.offer.notes_enabled).toBe(false);
    expect(ok.data.offer.input_schema.additionalProperties).toBe(false);
    const offerId = ok.data.offer.id as string;
    const patch = (body: unknown) =>
      call(patchOffer, `${base}/${offerId}`, { method: 'PATCH', cookie: owner.cookie, params: { id: planner.id, offerId }, body });

    const onlyNotes = await patch({ notes_enabled: true });
    expect(onlyNotes.status).toBe(200);
    expect(onlyNotes.data.offer.notes_enabled).toBe(true);
    expect(onlyNotes.data.warning).toBeUndefined();

    const patchedBad = await patch({ input_schema: { type: 'object', properties: { a: { type: 'string', maxLength: 5000 } } } });
    expect(patchedBad.status).toBe(400);
    expect(patchedBad.data.error.details.problems[0].rule).toBe('max_length_too_large');

    const cleared = await patch({ input_schema: null });
    expect(cleared.status).toBe(200);
    expect(cleared.data.offer.input_schema).toBeNull();
    expect(cleared.data.warning).toBe(INPUT_SCHEMA_CLEARED_WARNING);
    const clearedAgain = await patch({ input_schema: null });
    expect(clearedAgain.data.warning).toBeUndefined();

    const notesOffNoForm = await patch({ notes_enabled: false });
    expect(notesOffNoForm.status).toBe(400);
    expect(notesOffNoForm.data.error.code).toBe('notes_required_without_input_schema');

    const empty = await patch({});
    expect(empty.status).toBe(400);
    expect(empty.data.error.code).toBe('validation_error');
  });

  it('creates a form task with the server title, checked input, and an unchanged wake', async () => {
    const s = await setup({ offers: ['form'] });
    const receiver = await startReceiver();
    try {
      await setWebhook(s.owner.cookie, s.planner.id, receiver.url);
      const created = await mcpTool(s.guestKey, 'create_task', { to: s.to, offer: 'form', input: goodInput });
      expect(created.isError).toBe(false);
      const task = created.payload.task;
      expect(task.title).toBe('Framing quote');
      expect(task.description).toBe('');
      expect(task.input).toEqual(goodInput);
      expect(task.input_schema).toEqual(s.offers.form.input_schema);
      expect(task.untrusted).toBe(true);
      expect(receiver.hits).toHaveLength(1);
      expect(receiver.hits[0]!.body.task_id ?? receiver.hits[0]!.raw).toBeTruthy();
      expect(receiver.hits[0]!.raw).not.toContain('CANARY-INPUT-STRING');
      expect(receiver.hits[0]!.raw).not.toContain('width_cm');

      const withNotes = await mcpTool(s.guestKey, 'create_task', {
        to: s.to,
        offer: 'form',
        input: { width_cm: 10, material: 'walnut' },
        description: 'CANARY-NOTES',
      });
      expect(withNotes.payload.task.description).toBe('CANARY-NOTES');
      expect(receiver.hits.some((hit) => hit.raw.includes('CANARY-NOTES'))).toBe(false);
    } finally {
      await receiver.close();
    }
  });

  it('falls back to the offer name when the form has no title', async () => {
    const untitled: Record<string, unknown> = { ...quoteForm };
    delete untitled.title;
    const s = await setup({ offers: ['form_untitled'], inputSchema: untitled });
    const created = await mcpTool(s.guestKey, 'create_task', { to: s.to, offer: 'form_untitled', input: goodInput });
    expect(created.isError).toBe(false);
    expect(created.payload.task.title).toBe('form_untitled');
  });

  it('rejects bad form tasks without writing, waking, or using the daily cap', async () => {
    const s = await setup({ offers: ['form'], dailyCap: 1 });
    const attempts: [Record<string, unknown>, string][] = [
      [{}, 'input_required'],
      [{ input: { width_cm: '40', material: 'gold', extra: 1 } }, 'invalid_input'],
      [{ input: goodInput, title: 'My own title' }, 'validation_error'],
      [{ input: goodInput, description: 'x'.repeat(FORM_NOTES_MAX + 1) }, 'validation_error'],
    ];
    for (const [args, code] of attempts) {
      const res = await mcpTool(s.guestKey, 'create_task', { to: s.to, offer: 'form', ...args });
      expect(res.isError).toBe(true);
      expect(res.payload.error).toBe(code);
      if (code === 'input_required') expect(res.payload.details.input_schema).toEqual(s.offers.form.input_schema);
      if (code === 'invalid_input') {
        const paths = res.payload.details.validation_errors.map((e: { instancePath: string; keyword: string }) => `${e.instancePath}:${e.keyword}`);
        expect(paths).toEqual(expect.arrayContaining(['/width_cm:type', '/material:enum', ':additionalProperties']));
      }
    }
    expect(await guestTaskCount(s.guestBot.id)).toBe(0);
    expect(await wakeCount(s.planner.id)).toBe(0);
    const ok = await mcpTool(s.guestKey, 'create_task', { to: s.to, offer: 'form', input: goodInput, description: 'x'.repeat(FORM_NOTES_MAX) });
    expect(ok.isError).toBe(false);
    const capped = await mcpTool(s.guestKey, 'create_task', { to: s.to, offer: 'form', input: goodInput });
    expect(capped.payload.error).toBe('rate_limited');
  });

  it('refuses notes when the owner turned them off', async () => {
    const s = await setup({ offers: ['form'] });
    await mcpTool(s.plannerKey, 'upsert_offer', {
      agent: 'Planner',
      name: 'form',
      description: 'Offer form.',
      result_schema: resultSchema,
      notes_enabled: false,
    });
    const withNotes = await mcpTool(s.guestKey, 'create_task', { to: s.to, offer: 'form', input: goodInput, description: 'hi' });
    expect(withNotes.payload.error).toBe('validation_error');
    const without = await mcpTool(s.guestKey, 'create_task', { to: s.to, offer: 'form', input: goodInput });
    expect(without.isError).toBe(false);
    expect(without.payload.task.description).toBe('');
  });

  it('answers an ungranted form offer with offer_not_found, never invalid_input', async () => {
    const s = await setup({ offers: ['draft', 'form'], grantOffers: ['draft'] });
    const hidden = await mcpTool(s.guestKey, 'create_task', { to: s.to, offer: 'form', input: { nope: true } });
    const unknown = await mcpTool(s.guestKey, 'create_task', { to: s.to, offer: 'nosuch', input: { nope: true } });
    expect(hidden.payload.error).toBe('offer_not_found');
    expect(JSON.stringify(hidden.payload).replaceAll('form', 'OFFER')).toBe(JSON.stringify(unknown.payload).replaceAll('nosuch', 'OFFER'));
  });

  it('rejects input on a free-text offer and on a bare name', async () => {
    const s = await setup({ offers: ['draft'] });
    const freeText = await mcpTool(s.guestKey, 'create_task', {
      to: s.to,
      offer: 'draft',
      title: 'T',
      description: 'D',
      input: { a: 1 },
    });
    expect(freeText.payload.error).toBe('input_not_allowed');
    const noTitle = await mcpTool(s.guestKey, 'create_task', { to: s.to, offer: 'draft', description: 'D' });
    expect(noTitle.payload.error).toBe('validation_error');
    const fine = await mcpTool(s.guestKey, 'create_task', { to: s.to, offer: 'draft', title: 'T', description: 'D' });
    expect(fine.isError).toBe(false);
    expect(fine.payload.task.input).toBeNull();

    await createAgent(s.guest.cookie, 'Helper');
    const bare = await mcpTool(s.guestKey, 'create_task', {
      to: 'Helper',
      title: 'T',
      description: 'D',
      result_schema: resultSchema,
      input: { a: 1 },
    });
    expect(bare.payload.error).toBe('input_not_allowed');
    const bareNoDescription = await mcpTool(s.guestKey, 'create_task', { to: 'Helper', title: 'T', result_schema: resultSchema });
    expect(bareNoDescription.payload.error).toBe('validation_error');
  });

  it('keeps the copied form on open tasks when the owner edits it, and shows input everywhere', async () => {
    const s = await setup({ offers: ['form'] });
    const first = await mcpTool(s.guestKey, 'create_task', { to: s.to, offer: 'form', input: goodInput });
    const taskId = first.payload.task.id as string;
    const edited = {
      type: 'object',
      required: ['height_cm'],
      properties: { height_cm: { type: 'integer', minimum: 1 } },
    };
    const upserted = await mcpTool(s.plannerKey, 'upsert_offer', {
      agent: 'Planner',
      name: 'form',
      description: 'Offer form.',
      result_schema: resultSchema,
      input_schema: edited,
    });
    expect(upserted.isError).toBe(false);

    const ownerView = await mcpTool(s.plannerKey, 'get_task', { id: taskId });
    expect(ownerView.payload.task.input).toEqual(goodInput);
    expect(ownerView.payload.task.input_schema).toEqual(s.offers.form.input_schema);
    const guestView = await mcpTool(s.guestKey, 'get_task', { id: taskId });
    expect(guestView.payload.task.input).toEqual(goodInput);

    const old = await mcpTool(s.guestKey, 'create_task', { to: s.to, offer: 'form', input: goodInput });
    expect(old.payload.error).toBe('invalid_input');
    const next = await mcpTool(s.guestKey, 'create_task', { to: s.to, offer: 'form', input: { height_cm: 3 } });
    expect(next.isError).toBe(false);
    expect(next.payload.task.title).toBe('form');
    expect(next.payload.task.input_schema).toEqual(upserted.payload.offer.input_schema);

    const guestList = await mcpTool(s.guestKey, 'list_tasks', { role: 'sent' });
    const listed = guestList.payload.tasks.find((t: { id: string }) => t.id === taskId);
    expect(listed.input).toEqual(goodInput);
    const ownerList = await mcpTool(s.plannerKey, 'list_tasks', { role: 'received' });
    expect(ownerList.payload.tasks.find((t: { id: string }) => t.id === taskId).input).toEqual(goodInput);
    const dashboard = await call(listTasksRoute, 'http://localhost/api/v1/tasks', { cookie: s.owner.cookie });
    expect(dashboard.status).toBe(200);
    expect(dashboard.data.tasks.find((t: { id: string }) => t.id === taskId).input).toEqual(goodInput);
  });

  it('enforces the input pair and notes checks in the database', async () => {
    const s = await setup({ offers: ['draft', 'form'] });
    const created = await mcpTool(s.guestKey, 'create_task', { to: s.to, offer: 'draft', title: 'T', description: 'D' });
    const taskId = created.payload.task.id as string;
    await expect(getDb().update(tasks).set({ input: { a: 1 } }).where(eq(tasks.id, taskId))).rejects.toThrow();
    await expect(getDb().update(tasks).set({ inputSchema: { type: 'object' } }).where(eq(tasks.id, taskId))).rejects.toThrow();
    await expect(
      getDb().update(agentOffers).set({ notesEnabled: false }).where(eq(agentOffers.id, s.offers.draft.id)),
    ).rejects.toThrow();
    await getDb().update(agentOffers).set({ notesEnabled: false }).where(eq(agentOffers.id, s.offers.form.id));
  });
});
