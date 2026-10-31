import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db';
import {
  agentOffers,
  agentShareOffers,
  agentShares,
  agents,
  rateEvents,
  tasks,
  workspaces,
  type AgentRow,
  type AgentShareRow,
  type TaskRow,
} from '@/db/schema';
import type { AgentPrincipal } from './agents';
import { sessionUser, type SessionUser } from './auth';
import {
  ACCESS_REVOKED_REASON,
  CUSTOMER_BOTS_LIST_MAX,
  CUSTOMER_NOTES_MAX,
  CUSTOMER_REQUESTS_PAGE_DEFAULT,
  CUSTOMER_REQUESTS_PAGE_MAX,
  GUEST_TASK_RATE_KIND,
  SHARE_CAP_WINDOW_MS,
} from './constants';
import { brandingFor, brandingForMany, type Branding } from './customer-branding';
import { consumeOrThrow, ensureSenderAgent } from './customer-invites';
import { offerDisplayTitle } from './offer-title';
import { HttpError, isUniqueViolation } from './errors';
import { validateInput, type InputError, type InputSchema } from './input-schema';
import { weakEtag } from './http';
import { answerTask, createTask, serializeAnswer, taskAnswersFor } from './tasks';

/**
 * Customer API R3-R8 (spec 15, 17). A customer is the signed-in user's workspace, and a bot is
 * visible only through that workspace's agent_shares row. A request is a task with
 * from_workspace_id = the customer workspace. No owner ids, emails, handles, agent names, or
 * key data appear in any response, and every message is plain English for the page.
 */

type ShareStatus = 'pending' | 'approved' | 'revoked';
export type ReviewMode = 'auto' | 'review_first';
type RequestStatus = 'open' | 'done' | 'needs_info' | 'failed' | 'in_review' | 'awaiting_release';
export type FailCode = 'declined_by_owner' | 'bot_failed' | 'expired';

const SHARE_REVOKED = 'This business has turned off your access.';
const PENDING_APPROVAL = "This business hasn't approved your access yet.";
const NOT_FOUND = 'This page is not available.';
const REQUEST_NOT_FOUND = 'This request was not found.';
const OFFER_NOT_FOUND = "This job isn't available.";

/** Statuses R6 accepts (17.4). in_review and awaiting_release match nothing until review-first ships. */
export const REQUEST_STATUSES: readonly RequestStatus[] = [
  'open',
  'done',
  'needs_info',
  'failed',
  'in_review',
  'awaiting_release',
];

function notFound(): HttpError {
  return new HttpError(404, 'not_found', NOT_FOUND);
}

function workspaceOf(user: SessionUser): string {
  if (!user.workspace) throw notFound();
  return user.workspace.id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function humanize(key: string): string {
  const spaced = key.replace(/_/g, ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}

function labelFor(key: string, prop: unknown): string {
  if (isRecord(prop) && typeof prop.title === 'string' && prop.title.trim()) return prop.title;
  return humanize(key);
}

const numberFormat = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 20 });

function formatNumber(value: number): string {
  return numberFormat.format(value);
}

// ---------- shares and bots ----------

type BotShare = { share: AgentShareRow; agent: AgentRow };

/** The share row joining this customer to the bot. `live` also requires the bot to be shared and not revoked. */
async function botShare(db: Db, workspaceId: string, agentId: string, live: boolean): Promise<BotShare> {
  const conditions = [
    eq(agentShares.agentId, agentId),
    eq(agentShares.guestWorkspaceId, workspaceId),
    eq(agents.role, 'agent'),
  ];
  if (live) conditions.push(isNull(agents.revokedAt), eq(agents.shared, true));
  const [row] = await db
    .select({ share: agentShares, agent: agents })
    .from(agentShares)
    .innerJoin(agents, eq(agents.id, agentShares.agentId))
    .where(and(...conditions))
    .limit(1);
  if (!row) throw notFound();
  return row;
}

/** R3: every bot this customer has a share for, newest first. Not a customer → an empty list. */
export async function listCustomerBots(user: SessionUser) {
  const workspaceId = user.workspace?.id;
  if (!workspaceId) return { bots: [] };
  const db = getDb();
  const rows = await db
    .select({ share: agentShares, agent: agents })
    .from(agentShares)
    .innerJoin(agents, eq(agents.id, agentShares.agentId))
    .where(
      and(
        eq(agentShares.guestWorkspaceId, workspaceId),
        eq(agents.role, 'agent'),
        isNull(agents.revokedAt),
        eq(agents.shared, true),
      ),
    )
    .orderBy(desc(agentShares.createdAt), desc(agentShares.id))
    .limit(CUSTOMER_BOTS_LIST_MAX);
  if (rows.length === 0) return { bots: [] };
  const ids = rows.map((row) => row.agent.id);
  const counts = await db
    .select({ agentId: tasks.toAgentId, count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(
        eq(tasks.fromWorkspaceId, workspaceId),
        inArray(tasks.toAgentId, ids),
        sql`${tasks.workspaceId} <> ${workspaceId}`,
        sql`${tasks.status} in ('open', 'needs_info')`,
      ),
    )
    .groupBy(tasks.toAgentId);
  const open = new Map(counts.map((row) => [row.agentId, row.count]));
  const branding = await brandingForMany(db, rows.map((row) => row.agent));
  return {
    bots: rows.map((row) => {
      const status = row.share.status as ShareStatus;
      return {
        agent_id: row.agent.id,
        branding: branding.get(row.agent.id)!,
        share_status: status,
        access: status,
        open_requests: open.get(row.agent.id) ?? 0,
        requested_at: row.share.createdAt.toISOString(),
        updated_at: row.share.updatedAt.toISOString(),
      };
    }),
  };
}

type ResultField = { key: string; label: string; type: string };

export function resultFields(schema: unknown): ResultField[] {
  if (!isRecord(schema) || !isRecord(schema.properties)) return [];
  return Object.entries(schema.properties)
    .slice(0, 20)
    .map(([key, prop]) => ({
      key,
      label: labelFor(key, prop),
      type: isRecord(prop) && typeof prop.type === 'string' ? prop.type : 'json',
    }));
}

async function jobsFor(db: Db, shareId: string, agentId: string) {
  const offers = await db
    .select({
      name: agentOffers.name,
      title: agentOffers.title,
      description: agentOffers.description,
      resultSchema: agentOffers.resultSchema,
      inputSchema: agentOffers.inputSchema,
      notesEnabled: agentOffers.notesEnabled,
    })
    .from(agentShareOffers)
    .innerJoin(agentOffers, eq(agentOffers.id, agentShareOffers.offerId))
    .where(and(eq(agentShareOffers.shareId, shareId), eq(agentOffers.agentId, agentId)))
    .orderBy(agentOffers.name);
  return offers.map((offer) => {
    // An offer without input_schema always takes notes (they are the whole request).
    const notesEnabled = offer.inputSchema ? offer.notesEnabled : true;
    return {
      name: offer.name,
      title: offerDisplayTitle(offer),
      description: offer.description,
      input_schema: offer.inputSchema ?? null,
      notes_enabled: notesEnabled,
      notes_max: notesEnabled ? CUSTOMER_NOTES_MAX : 0,
      result_fields: resultFields(offer.resultSchema),
    };
  });
}

async function shareUsage(db: Db, share: AgentShareRow) {
  const since = new Date(Date.now() - SHARE_CAP_WINDOW_MS);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int`, oldest: sql<Date | null>`min(${rateEvents.createdAt})` })
    .from(rateEvents)
    .where(and(eq(rateEvents.kind, GUEST_TASK_RATE_KIND), eq(rateEvents.email, share.id), gte(rateEvents.createdAt, since)));
  const used = row?.count ?? 0;
  const oldest = row?.oldest ? new Date(row.oldest) : null;
  return {
    used_today: used,
    resets_at: used > 0 && oldest ? new Date(oldest.getTime() + SHARE_CAP_WINDOW_MS).toISOString() : null,
  };
}

/** R4: one bot. 200 for any share status so the page can render pending and revoked states. */
export async function getCustomerBot(user: SessionUser, agentId: string) {
  const db = getDb();
  const { share, agent } = await botShare(db, workspaceOf(user), agentId, true);
  const status = share.status as ShareStatus;
  const branding: Branding = await brandingFor(db, agent);
  const reviewMode: ReviewMode = 'auto';
  let shareBody: Record<string, unknown>;
  let jobs: Awaited<ReturnType<typeof jobsFor>> = [];
  if (status === 'approved') {
    shareBody = { status, daily_cap: share.dailyCap, ...(await shareUsage(db, share)) };
    jobs = await jobsFor(db, share.id, agent.id);
  } else if (status === 'pending') {
    shareBody = { status, requested_at: share.createdAt.toISOString() };
    jobs = await jobsFor(db, share.id, agent.id);
  } else {
    shareBody = { status };
  }
  return {
    bot: { agent_id: agent.id, branding },
    share: shareBody,
    access: status,
    review_mode: reviewMode,
    jobs,
  };
}

// ---------- request serialization ----------

type DisplayRow = { key: string; label: string; value: string };
type ResultRow = DisplayRow & { kind: 'text' | 'number' | 'boolean' | 'list' | 'json' };

function enumTitle(prop: Record<string, unknown>, value: unknown): string {
  const items = isRecord(prop.items) ? prop.items : null;
  const values = Array.isArray(prop.enum) ? prop.enum : Array.isArray(items?.enum) ? (items!.enum as unknown[]) : null;
  const titles = Array.isArray(items?.['x-enum-titles'])
    ? (items!['x-enum-titles'] as unknown[])
    : Array.isArray(prop['x-enum-titles'])
      ? (prop['x-enum-titles'] as unknown[])
      : null;
  if (values && titles) {
    const index = values.indexOf(value);
    if (index >= 0 && typeof titles[index] === 'string') return titles[index] as string;
  }
  return displayScalar(value);
}

function displayScalar(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2) ?? 'null';
}

/** The input echo, in x-order, with enum titles (15.7). Absent fields are skipped. */
export function inputDisplay(schema: Record<string, unknown> | null, input: Record<string, unknown> | null): DisplayRow[] {
  if (!schema || !input) return [];
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const order = Array.isArray(schema['x-order'])
    ? (schema['x-order'] as unknown[]).filter((key): key is string => typeof key === 'string')
    : Object.keys(properties);
  const keys = [...order, ...Object.keys(properties).filter((key) => !order.includes(key))];
  const rows: DisplayRow[] = [];
  for (const key of keys) {
    if (!(key in input)) continue;
    const prop = isRecord(properties[key]) ? (properties[key] as Record<string, unknown>) : {};
    const value = input[key];
    const shown = Array.isArray(value) ? value.map((item) => enumTitle(prop, item)).join(', ') : enumTitle(prop, value);
    rows.push({ key, label: labelFor(key, prop), value: shown });
  }
  return rows;
}

function isScalar(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function resultRow(key: string, label: string, value: unknown): ResultRow {
  if (typeof value === 'string') return { key, label, kind: 'text', value };
  if (typeof value === 'number') return { key, label, kind: 'number', value: formatNumber(value) };
  if (typeof value === 'boolean') return { key, label, kind: 'boolean', value: value ? 'Yes' : 'No' };
  if (Array.isArray(value) && value.every((item) => isScalar(item) && item !== null)) {
    return { key, label, kind: 'list', value: value.map(displayScalar).join(', ') };
  }
  return { key, label, kind: 'json', value: JSON.stringify(value, null, 2) ?? 'null' };
}

/** Generic result rendering from result_schema titles (15.7). Values are bot output: plain text only. */
export function resultDisplay(schema: Record<string, unknown> | null, result: unknown): ResultRow[] {
  if (result === undefined) return [];
  if (!isRecord(result)) return [resultRow('_value', 'Value', result)];
  const properties = schema && isRecord(schema.properties) ? schema.properties : {};
  const keys = [
    ...Object.keys(properties).filter((key) => key in result),
    ...Object.keys(result).filter((key) => !(key in properties)),
  ];
  return keys.map((key) => resultRow(key, labelFor(key, properties[key]), result[key]));
}

function failFields(task: TaskRow): { fail_code: FailCode | null; fail_message: string | null } {
  if (task.status !== 'failed') return { fail_code: null, fail_message: null };
  // Tasks failed by a revoke or sharing turned off: the owner stopped them, and the stored reason is
  // system text, not the bot's. Everything else today is the bot's own fail_task.
  if (task.failReason === ACCESS_REVOKED_REASON) return { fail_code: 'declined_by_owner', fail_message: null };
  return { fail_code: 'bot_failed', fail_message: task.failReason ?? null };
}

function notesOf(task: TaskRow): string | null {
  return task.description ? task.description : null;
}

function summaryOf(task: TaskRow, title: string): string {
  // A free-text request's title is the job title, so its notes say more.
  const text = !task.inputSchema && task.description ? task.description : title;
  return [...text].slice(0, 120).join('');
}

type RequestCore = {
  id: string;
  bot: { agent_id: string };
  offer: string | null;
  offer_title: string | null;
  title: string;
  status: string;
  notes: string | null;
  question: string | null;
  fail_code: FailCode | null;
  fail_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type OfferLabel = { name: string; displayTitle: string };

/** The request's heading. Older requests stored the raw offer name as their title; show the job title instead. */
function requestTitle(task: TaskRow, offer: OfferLabel | null): string {
  return offer && task.title === offer.name ? offer.displayTitle : task.title;
}

function requestCore(task: TaskRow, offer: OfferLabel | null): RequestCore {
  // 17.8: a pending bot question stays hidden while the request is awaiting_release.
  const question = task.status === 'needs_info' ? task.question : null;
  return {
    id: task.id,
    bot: { agent_id: task.toAgentId },
    offer: offer?.name ?? null,
    offer_title: offer?.displayTitle ?? null,
    title: requestTitle(task, offer),
    status: task.status,
    notes: notesOf(task),
    question,
    ...failFields(task),
    created_at: task.createdAt.toISOString(),
    updated_at: task.updatedAt.toISOString(),
    completed_at: task.completedAt?.toISOString() ?? null,
  };
}

async function offerLabels(db: Db, rows: TaskRow[]): Promise<Map<string, OfferLabel>> {
  const ids = [...new Set(rows.map((row) => row.offerId).filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  const found = await db
    .select({ id: agentOffers.id, name: agentOffers.name, title: agentOffers.title })
    .from(agentOffers)
    .where(inArray(agentOffers.id, ids));
  return new Map(found.map((row) => [row.id, { name: row.name, displayTitle: offerDisplayTitle(row) }]));
}

export async function serializeRequest(db: Db, task: TaskRow) {
  const labels = await offerLabels(db, [task]);
  const core = requestCore(task, task.offerId ? (labels.get(task.offerId) ?? null) : null);
  const showResult = task.status === 'done';
  const answers = await taskAnswersFor(db, task.id);
  return {
    id: core.id,
    bot: core.bot,
    offer: core.offer,
    offer_title: core.offer_title,
    title: core.title,
    status: core.status,
    input: task.input ?? null,
    input_display: inputDisplay(task.inputSchema ?? null, task.input ?? null),
    notes: core.notes,
    question: core.question,
    answers: answers.map(serializeAnswer),
    result: showResult ? (task.result ?? null) : null,
    result_display: showResult ? resultDisplay(task.resultSchema, task.result) : [],
    fail_code: core.fail_code,
    fail_message: core.fail_message,
    created_at: core.created_at,
    updated_at: core.updated_at,
    completed_at: core.completed_at,
  };
}

/** A request is this customer's only when they sent it to a bot in another workspace. */
async function customerTask(db: Db, workspaceId: string, taskId: string): Promise<TaskRow> {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.fromWorkspaceId, workspaceId), sql`${tasks.workspaceId} <> ${workspaceId}`))
    .limit(1);
  if (!task) throw new HttpError(404, 'not_found', REQUEST_NOT_FOUND);
  return task;
}

/** R7. */
export async function getCustomerRequest(user: SessionUser, taskId: string) {
  const db = getDb();
  const task = await customerTask(db, workspaceOf(user), taskId);
  return { request: await serializeRequest(db, task) };
}

// ---------- R6 list ----------

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt},${id}`, 'utf8').toString('base64url');
}

const CURSOR_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decodeCursor(raw: string): { createdAt: string; id: string } {
  const bad = () => new HttpError(400, 'bad_cursor', 'This page link is out of date. Start again from the first page.');
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(raw)) throw bad();
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const [createdAt, id, extra] = decoded.split(',');
  if (extra !== undefined || !createdAt || !id || !CURSOR_TIME.test(createdAt) || !UUID.test(id)) throw bad();
  return { createdAt, id };
}

export function parseListQuery(url: URL): { status: RequestStatus | null; limit: number; cursor: { createdAt: string; id: string } | null } {
  const statusRaw = url.searchParams.get('status');
  if (statusRaw !== null && !REQUEST_STATUSES.includes(statusRaw as RequestStatus)) {
    throw new HttpError(400, 'validation_error', `status must be one of ${REQUEST_STATUSES.join(', ')}.`, {
      fields: { status: 'Unknown status.' },
    });
  }
  const limitRaw = url.searchParams.get('limit');
  let limit = CUSTOMER_REQUESTS_PAGE_DEFAULT;
  if (limitRaw !== null) {
    limit = Number(limitRaw);
    if (!/^\d+$/.test(limitRaw) || limit < 1 || limit > CUSTOMER_REQUESTS_PAGE_MAX) {
      throw new HttpError(400, 'validation_error', `limit must be a whole number from 1 to ${CUSTOMER_REQUESTS_PAGE_MAX}.`, {
        fields: { limit: `Use 1 to ${CUSTOMER_REQUESTS_PAGE_MAX}.` },
      });
    }
  }
  const cursorRaw = url.searchParams.get('cursor');
  return {
    status: (statusRaw as RequestStatus | null) ?? null,
    limit,
    cursor: cursorRaw ? decodeCursor(cursorRaw) : null,
  };
}

/** R6: newest first, cursor paging. Works for any share status, including revoked. */
export async function listCustomerRequests(user: SessionUser, agentId: string, query: ReturnType<typeof parseListQuery>) {
  const db = getDb();
  const workspaceId = workspaceOf(user);
  await botShare(db, workspaceId, agentId, false);
  const conditions = [
    eq(tasks.fromWorkspaceId, workspaceId),
    eq(tasks.toAgentId, agentId),
    sql`${tasks.workspaceId} <> ${workspaceId}`,
  ];
  if (query.status) conditions.push(eq(tasks.status, query.status));
  if (query.cursor) {
    conditions.push(
      sql`(${tasks.createdAt}, ${tasks.id}) < (${query.cursor.createdAt}::timestamptz, ${query.cursor.id}::uuid)`,
    );
  }
  const rows = await db
    .select({
      task: tasks,
      // Microsecond precision, so a cursor never skips rows created in the same millisecond.
      cursorTime: sql<string>`to_char(${tasks.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(tasks)
    .where(and(...conditions))
    .orderBy(desc(tasks.createdAt), desc(tasks.id))
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  const labels = await offerLabels(
    db,
    page.map((row) => row.task),
  );
  const requests = page.map(({ task }) => {
    const core = requestCore(task, task.offerId ? (labels.get(task.offerId) ?? null) : null);
    return { ...core, summary: summaryOf(task, core.title) };
  });
  const last = page[page.length - 1];
  const nextCursor = rows.length > query.limit && last ? encodeCursor(last.cursorTime, last.task.id) : null;
  const body = { requests, next_cursor: nextCursor };
  const etag = weakEtag(body);
  return { body: { ...body, etag }, etag };
}

// ---------- R5 create ----------

export type CreateRequestBody = {
  offer: string;
  input?: Record<string, unknown>;
  notes?: string | null;
  client_request_id?: string;
};

type Kind = 'text' | 'choice' | 'number' | 'boolean' | 'multi';

function kindOf(prop: Record<string, unknown>): Kind {
  if (prop.type === 'string') return prop.enum !== undefined ? 'choice' : 'text';
  if (prop.type === 'number' || prop.type === 'integer') return 'number';
  if (prop.type === 'boolean') return 'boolean';
  return 'multi';
}

function choiceTitles(prop: Record<string, unknown>): string[] {
  const items = isRecord(prop.items) ? prop.items : null;
  const values = (Array.isArray(prop.enum) ? prop.enum : Array.isArray(items?.enum) ? items!.enum : []) as unknown[];
  return values.map((value) => enumTitle(prop, value));
}

function fieldMessage(error: InputError, prop: Record<string, unknown>): string {
  const p = error.params;
  switch (error.keyword) {
    case 'required':
      return 'Required.';
    case 'minimum':
    case 'maximum':
    case 'exclusiveMinimum':
    case 'exclusiveMaximum': {
      const min = typeof prop.minimum === 'number' ? prop.minimum : null;
      const max = typeof prop.maximum === 'number' ? prop.maximum : null;
      if (min !== null && max !== null) return `Must be between ${formatNumber(min)} and ${formatNumber(max)}.`;
      if (max !== null) return `Must be at most ${formatNumber(max)}.`;
      if (min !== null) return `Must be at least ${formatNumber(min)}.`;
      return 'Out of range.';
    }
    case 'multipleOf':
      return `Must be a multiple of ${formatNumber(Number(p.multipleOf))}.`;
    case 'enum':
      return `Choose one of: ${choiceTitles(prop).join(', ')}.`;
    case 'pattern':
      return "Doesn't match the expected format.";
    case 'maxLength':
      return `Use ${formatNumber(Number(p.limit))} characters or fewer.`;
    case 'minLength':
      return Number(p.limit) <= 1 ? 'Required.' : `Use at least ${formatNumber(Number(p.limit))} characters.`;
    case 'maxItems':
      return `Pick up to ${formatNumber(Number(p.limit))}.`;
    case 'minItems':
      return `Pick at least ${formatNumber(Number(p.limit))}.`;
    case 'uniqueItems':
      return 'Pick each option once.';
    case 'type': {
      const type = String(p.type ?? prop.type ?? '');
      if (type === 'integer') return 'Must be a whole number.';
      if (type === 'number') return 'Must be a number.';
      if (type === 'boolean') return 'Must be yes or no.';
      if (type === 'array') return 'Pick from the list.';
      if (type === 'string') return kindOf(prop) === 'choice' ? `Choose one of: ${choiceTitles(prop).join(', ')}.` : 'Must be text.';
      return 'Has the wrong type.';
    }
    default:
      return 'Check this field.';
  }
}

/** First error per field, keyed for react-hook-form setError (15.6). */
export function fieldErrors(schema: InputSchema, errors: InputError[]): Record<string, string> {
  const properties = isRecord((schema as Record<string, unknown>).properties)
    ? ((schema as Record<string, unknown>).properties as Record<string, unknown>)
    : {};
  const fields: Record<string, string> = {};
  for (const error of errors) {
    let key: string;
    let message: string;
    if (error.keyword === 'additionalProperties') {
      key = '_form';
      message = `Remove unknown field "${String(error.params.additionalProperty ?? '')}".`;
    } else if (error.keyword === 'required') {
      key = String(error.params.missingProperty ?? '_form');
      message = 'Required.';
    } else {
      const first = error.instancePath.split('/')[1];
      key = first ? first.replace(/~1/g, '/').replace(/~0/g, '~') : '_form';
      const prop = isRecord(properties[key]) ? (properties[key] as Record<string, unknown>) : {};
      message = key === '_form' ? 'Check the form.' : fieldMessage(error, prop);
    }
    if (!(key in fields)) fields[key] = message;
  }
  return fields;
}

function notesError(message: string): HttpError {
  return new HttpError(400, 'validation_error', 'Some fields need fixing.', { fields: { notes: message } });
}

/** Maps createTask errors, written for agents, onto the customer contract without handles or agent names. */
function customerError(err: HttpError, schema: InputSchema | null): HttpError {
  const details = isRecord(err.details) ? err.details : {};
  switch (err.code) {
    case 'share_revoked':
      return new HttpError(403, 'share_revoked', SHARE_REVOKED);
    case 'share_pending':
      return new HttpError(403, 'pending_approval', PENDING_APPROVAL);
    case 'share_required':
    case 'agent_not_found':
    case 'not_found':
      return notFound();
    case 'offer_not_found':
      return new HttpError(404, 'offer_not_found', OFFER_NOT_FOUND);
    case 'rate_limited': {
      const message =
        details.scope === 'bot'
          ? 'This business is getting a lot of requests today. Try again later.'
          : "You've reached today's request limit for this business. Try again later.";
      return new HttpError(429, 'rate_limited', message, details);
    }
    case 'input_required':
      return new HttpError(400, 'input_required', 'Fill in the form for this job.', { input_schema: schema });
    case 'invalid_input': {
      const errors = Array.isArray(details.validation_errors) ? (details.validation_errors as InputError[]) : [];
      return new HttpError(400, 'invalid_input', 'Some fields need fixing.', {
        fields: schema ? fieldErrors(schema, errors) : {},
        validation_errors: errors,
      });
    }
    case 'input_not_allowed':
      return new HttpError(400, 'input_not_allowed', 'This job takes a message only. Leave out input.');
    case 'validation_error':
      return new HttpError(400, 'validation_error', 'Some fields need fixing.', {
        fields: isRecord(details.fields) ? details.fields : { notes: 'Check your notes.' },
      });
    default:
      return new HttpError(err.status, err.code, "This request couldn't be sent. Try again.");
  }
}

async function existingByClientId(db: Db, workspaceId: string, clientRequestId: string): Promise<TaskRow | null> {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.fromWorkspaceId, workspaceId), eq(tasks.clientRequestId, clientRequestId)))
    .limit(1);
  return task ?? null;
}

async function replay(db: Db, task: TaskRow, agentId: string) {
  if (task.toAgentId !== agentId) {
    throw new HttpError(409, 'client_request_id_conflict', 'This request id was already used for another business.');
  }
  return { status: 200, body: { request: await serializeRequest(db, task) } };
}

/** R5. Check order (4.5): share status → offer → input → cap → insert. */
export async function createCustomerRequest(user: SessionUser, agentId: string, body: CreateRequestBody) {
  const db = getDb();
  const workspaceId = workspaceOf(user);
  const { share, agent } = await botShare(db, workspaceId, agentId, true);
  if (body.client_request_id) {
    const existing = await existingByClientId(db, workspaceId, body.client_request_id);
    if (existing) return replay(db, existing, agent.id);
  }
  if (share.status === 'revoked') throw new HttpError(403, 'share_revoked', SHARE_REVOKED);
  if (share.status !== 'approved') throw new HttpError(403, 'pending_approval', PENDING_APPROVAL);
  const [offer] = await db
    .select({
      name: agentOffers.name,
      title: agentOffers.title,
      inputSchema: agentOffers.inputSchema,
      notesEnabled: agentOffers.notesEnabled,
    })
    .from(agentShareOffers)
    .innerJoin(agentOffers, eq(agentOffers.id, agentShareOffers.offerId))
    .where(and(eq(agentShareOffers.shareId, share.id), eq(agentOffers.agentId, agent.id), eq(agentOffers.name, body.offer)))
    .limit(1);
  if (!offer) throw new HttpError(404, 'offer_not_found', OFFER_NOT_FOUND);
  const schema = (offer.inputSchema as InputSchema | null) ?? null;
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  let title: string | undefined;
  if (schema) {
    if (body.input === undefined) {
      throw new HttpError(400, 'input_required', 'Fill in the form for this job.', { input_schema: schema });
    }
    if (notes && !offer.notesEnabled) throw notesError('Notes are turned off for this job.');
    if ([...notes].length > CUSTOMER_NOTES_MAX) throw notesError(`Use ${formatNumber(CUSTOMER_NOTES_MAX)} characters or fewer.`);
    const checked = validateInput(schema, body.input);
    if (!checked.ok) {
      throw new HttpError(400, 'invalid_input', 'Some fields need fixing.', {
        fields: fieldErrors(schema, checked.errors),
        validation_errors: checked.errors,
      });
    }
  } else {
    if (body.input !== undefined) {
      throw new HttpError(400, 'input_not_allowed', 'This job takes a message only. Leave out input.');
    }
    if (!notes) throw notesError('Required.');
    if ([...notes].length > CUSTOMER_NOTES_MAX) throw notesError(`Use ${formatNumber(CUSTOMER_NOTES_MAX)} characters or fewer.`);
    title = offerDisplayTitle(offer);
  }
  const [owner] = await db.select({ handle: workspaces.handle }).from(workspaces).where(eq(workspaces.id, agent.workspaceId)).limit(1);
  if (!owner?.handle) throw notFound();
  const sender = await db.transaction((tx) => ensureSenderAgent(tx, workspaceId));
  const principal: AgentPrincipal = {
    workspaceId,
    agentId: sender.id,
    agentName: sender.name,
    keyId: 'customer-session',
  };
  let created: { id: string };
  try {
    created = await createTask(principal, {
      to: `@${owner.handle}/${agent.name}`,
      offer: offer.name,
      title,
      description: notes,
      input: schema ? body.input : undefined,
      clientRequestId: body.client_request_id,
    });
  } catch (err) {
    if (body.client_request_id && isUniqueViolation(err)) {
      // A concurrent retry won the insert; its request is the answer.
      const existing = await existingByClientId(db, workspaceId, body.client_request_id);
      if (existing) return replay(db, existing, agent.id);
    }
    if (err instanceof HttpError) throw customerError(err, schema);
    throw err;
  }
  const task = await customerTask(db, workspaceId, created.id);
  return { status: 201, body: { request: await serializeRequest(db, task) } };
}

// ---------- R8 answer ----------

/** R8: the customer answers the bot's question. Rate limited per user; revoked customers can read but not answer. */
export async function answerCustomerRequest(user: SessionUser, taskId: string, answer: string) {
  await consumeOrThrow({ kind: 'customerAnswer', agentId: user.id });
  const db = getDb();
  const workspaceId = workspaceOf(user);
  const task = await customerTask(db, workspaceId, taskId);
  // A revoked bot is gone: its requests stay readable (R7) but cannot be answered or wake it.
  const [bot] = await db.select({ revokedAt: agents.revokedAt }).from(agents).where(eq(agents.id, task.toAgentId)).limit(1);
  if (!bot || bot.revokedAt) throw new HttpError(404, 'not_found', REQUEST_NOT_FOUND);
  const [share] = await db
    .select({ status: agentShares.status })
    .from(agentShares)
    .where(and(eq(agentShares.agentId, task.toAgentId), eq(agentShares.guestWorkspaceId, workspaceId)))
    .limit(1);
  if (!share || share.status === 'revoked') throw new HttpError(403, 'share_revoked', SHARE_REVOKED);
  const [sender] = await db.select().from(agents).where(eq(agents.id, task.fromAgentId)).limit(1);
  if (!sender || sender.workspaceId !== workspaceId) throw new HttpError(404, 'not_found', REQUEST_NOT_FOUND);
  try {
    await answerTask(
      { workspaceId, agentId: sender.id, agentName: sender.name, keyId: 'customer-session' },
      task.id,
      answer,
    );
  } catch (err) {
    if (err instanceof HttpError && err.code === 'validation_error') {
      throw new HttpError(400, 'validation_error', 'Some fields need fixing.', err.details);
    }
    if (err instanceof HttpError && err.code === 'not_found') {
      throw new HttpError(404, 'not_found', REQUEST_NOT_FOUND);
    }
    if (err instanceof HttpError && err.code === 'task_not_waiting') {
      throw new HttpError(409, 'task_not_waiting', 'This request is not waiting for an answer.');
    }
    throw err;
  }
  const fresh = await customerTask(db, workspaceId, task.id);
  return { request: await serializeRequest(db, fresh) };
}

/** /c routes: a valid session cookie, or 401. A user without a workspace is simply not a customer. */
export async function requireCustomer(req: Request): Promise<SessionUser> {
  const user = await sessionUser(req);
  if (!user) throw new HttpError(401, 'unauthorized', 'Sign in required.');
  return user;
}
