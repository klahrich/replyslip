import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { expect } from 'vitest';
import { PUT as putAccess } from '@/app/api/v1/agents/[id]/customer-access/route';
import { POST as postInvite } from '@/app/api/v1/agents/[id]/invites/route';
import { POST as postOffer } from '@/app/api/v1/agents/[id]/offers/route';
import { POST as revokeShareRoute } from '@/app/api/v1/agents/[id]/shares/[shareId]/revoke/route';
import { PUT as putSharing } from '@/app/api/v1/agents/[id]/sharing/route';
import { POST as acceptLink } from '@/app/api/v1/c/links/[token]/accept/route';
import { PATCH as patchWorkspace } from '@/app/api/v1/workspaces/current/route';
import { getDb } from '@/db';
import { agents, agentShares } from '@/db/schema';
import { createTask } from '@/lib/tasks';
import { call, createAgent, createKey, emailAddress, signIn } from './helpers';

export const ORIGIN = { origin: 'http://localhost' };

/** The 15.5 example form. */
export const quoteForm = {
  type: 'object',
  title: 'Table quote',
  properties: {
    wood: { type: 'string', title: 'Wood', enum: ['oak', 'walnut', 'black_metal'], 'x-enum-titles': ['Oak', 'Walnut', 'Black metal'] },
    length_cm: { type: 'integer', title: 'Length (cm)', minimum: 80, maximum: 300 },
    seats: { type: 'integer', title: 'Seats', minimum: 2, maximum: 12, default: 6 },
    extras: {
      type: 'array',
      title: 'Extras',
      maxItems: 2,
      uniqueItems: true,
      items: { type: 'string', enum: ['leaf', 'bench', 'pads'] },
      'x-enum-titles': ['Extension leaf', 'Matching bench', 'Felt pads'],
    },
    delivery: { type: 'boolean', title: 'Delivery' },
    postcode: { type: 'string', title: 'Postal code', maxLength: 7, pattern: '^[A-Za-z]\\d[A-Za-z] ?\\d[A-Za-z]\\d$' },
  },
  required: ['wood', 'length_cm', 'seats'],
  additionalProperties: false,
  'x-order': ['wood', 'length_cm', 'seats', 'extras', 'delivery', 'postcode'],
};

export const quoteResult = {
  type: 'object',
  additionalProperties: false,
  properties: {
    price_cad: { type: 'number', title: 'Price (CAD)' },
    lead_time_weeks: { type: 'integer', title: 'Lead time (weeks)' },
    message: { type: 'string' },
    rush: { type: 'boolean', title: 'Rush' },
    finishes: { type: 'array', items: { type: 'string' } },
    breakdown: { type: 'object' },
  },
};

const textResult = {
  type: 'object',
  additionalProperties: false,
  required: ['headline'],
  properties: { headline: { type: 'string' } },
};

export type Owner = { cookie: string; handle: string; agentId: string; agentKey: string; email: string };
export type Customer = Awaited<ReturnType<typeof signIn>>;

export const validInput = { wood: 'walnut', length_cm: 220, seats: 8, extras: ['leaf'], delivery: true, postcode: 'M5V 2T6' };

async function addOffer(o: { cookie: string; agentId: string }, body: Record<string, unknown>) {
  const res = await call(postOffer, `http://localhost/api/v1/agents/${o.agentId}/offers`, {
    cookie: o.cookie,
    params: { id: o.agentId },
    body,
  });
  expect(res.status, res.text).toBe(201);
}

/**
 * Owner with a handle and a shared agent named Grok. Offers: quote (form), draft (free text),
 * quiet (form, notes off), secret (free text, never granted by grantedLink).
 */
export async function owner(name = 'Grok'): Promise<Owner> {
  const session = await signIn();
  const handle = `o${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  await call(patchWorkspace, 'http://localhost/api/v1/workspaces/current', {
    method: 'PATCH',
    cookie: session.cookie,
    body: { handle },
  });
  const agent = await createAgent(session.cookie, name);
  const o = { cookie: session.cookie, agentId: agent.id };
  await addOffer(o, { name: 'quote', description: 'Price a table.', result_schema: quoteResult, input_schema: quoteForm });
  await addOffer(o, { name: 'draft', description: 'Write a headline.', result_schema: textResult });
  await addOffer(o, {
    name: 'quiet',
    description: 'Form, no notes.',
    result_schema: textResult,
    input_schema: { type: 'object', properties: { size: { type: 'string', maxLength: 10 } } },
    notes_enabled: false,
  });
  await addOffer(o, { name: 'secret', description: 'Not for customers.', result_schema: textResult });
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

export async function createLink(o: Owner, body: Record<string, unknown>) {
  const res = await call(postInvite, `http://localhost/api/v1/agents/${o.agentId}/invites`, {
    cookie: o.cookie,
    params: { id: o.agentId },
    body,
  });
  expect(res.status, res.text).toBe(201);
  return res.data as { invite: any; token: string; url: string };
}

export async function setAccess(o: Owner, body: Record<string, unknown>) {
  const res = await call(putAccess, `http://localhost/api/v1/agents/${o.agentId}/customer-access`, {
    method: 'PUT',
    cookie: o.cookie,
    params: { id: o.agentId },
    body,
  });
  expect(res.status).toBe(200);
}

export async function accept(token: string, customer: Customer) {
  return call(acceptLink, `http://localhost/api/v1/c/links/${token}/accept`, {
    cookie: customer.cookie,
    params: { token },
    body: {},
    headers: ORIGIN,
  });
}

/** A signed-in customer with an approved share granting quote, draft, and quiet. */
export async function approvedCustomer(o: Owner, opts: { dailyCap?: number; email?: string } = {}) {
  const customer = await signIn(opts.email ?? emailAddress('customer'));
  const { token } = await createLink(o, {
    kind: 'personal',
    offers: ['quote', 'draft', 'quiet'],
    ...(opts.dailyCap ? { daily_cap: opts.dailyCap } : {}),
  });
  const res = await accept(token, customer);
  expect(res.status, res.text).toBe(200);
  expect(res.data.share.status).toBe('approved');
  return customer;
}

/** A signed-in customer whose access request is pending (public link, approve_each). */
export async function pendingCustomer(o: Owner) {
  await setAccess(o, { mode: 'approve_each' });
  const { token } = await createLink(o, { kind: 'public', offers: ['quote', 'draft'] });
  const customer = await signIn(emailAddress('pending'));
  const res = await accept(token, customer);
  expect(res.status, res.text).toBe(200);
  expect(res.data.share.status).toBe('pending');
  return customer;
}

export async function shareIdOf(o: Owner, customer: Customer): Promise<string> {
  const [share] = await getDb()
    .select({ id: agentShares.id })
    .from(agentShares)
    .where(and(eq(agentShares.agentId, o.agentId), eq(agentShares.guestWorkspaceId, customer.workspace.id)));
  return share!.id;
}

export async function revokeCustomer(o: Owner, shareId: string) {
  const res = await call(revokeShareRoute, `http://localhost/api/v1/agents/${o.agentId}/shares/${shareId}/revoke`, {
    method: 'POST',
    cookie: o.cookie,
    params: { id: o.agentId, shareId },
  });
  expect(res.status, res.text).toBe(200);
}

export async function senderOf(customer: Customer) {
  const [sender] = await getDb()
    .select()
    .from(agents)
    .where(and(eq(agents.workspaceId, customer.workspace.id), eq(agents.role, 'customer_sender')));
  return sender!;
}

/** Fast path for many requests: createTask as the customer's sender, the same call R5 makes. */
export async function directRequest(o: Owner, customer: Customer, notes = 'Please write one.') {
  const sender = await senderOf(customer);
  return createTask(
    { workspaceId: customer.workspace.id, agentId: sender.id, agentName: sender.name, keyId: 'test' },
    { to: `@${o.handle}/Grok`, offer: 'draft', title: 'draft', description: notes },
  );
}
