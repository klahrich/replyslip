/**
 * Customer page API (spec section 15). Every function returns exactly the R1–R8 response shapes from
 * types.ts and throws ApiError with the spec's error codes.
 *
 * MOCK. Today this answers from mock-data.ts in the browser. To go live, replace the bodies in this one
 * file with `fetch` calls to /api/v1/c/... and /api/v1/auth/... (credentials: 'same-origin',
 * Content-Type: application/json on POSTs); no page or component changes are needed.
 *
 * Mock-only demo switches, read from the page URL:
 *   ?share=pending | revoked   force the share status on /c/<agent_id> pages
 *   ?cap=reached               today's request limit is used up
 *   ?mock=field_errors         the next submit returns invalid_input with details.fields
 * Link tokens: acme-jewellers, northline-windows, fernwood-furniture, expired, used-up; anything else is 404.
 */
import { ApiError } from './types';
import type {
  TextField,
  AcceptResponse,
  Answer,
  BotResponse,
  BotsResponse,
  CreateRequestBody,
  CustomerRequest,
  DisplayRow,
  InputField,
  InputObject,
  Job,
  LinkResponse,
  Me,
  RequestListResponse,
  RequestListRow,
  RequestResponse,
  RequestStatus,
  ResultDisplayRow,
} from './types';
import { MOCK_BOTS, MOCK_EMAIL, MOCK_REQUESTS, type MockBot, type MockRequestFixture } from './mock-data';
import { checkInput, displayValue, isChoice, labelFor, optionsFor, orderedFields, rangeMessage } from './schema';

/* ---------------- mock plumbing ---------------- */

type Created = MockRequestFixture & { createdMs: number; client_request_id?: string };
type MockState = {
  signedIn: boolean;
  email: string;
  accepted: Record<string, 'approved' | 'pending'>;
  created: Created[];
  answered: Record<string, { answers: Answer[]; atMs: number }>;
};

const KEY = 'vt-mock-state';
const blank = (): MockState => ({ signedIn: false, email: MOCK_EMAIL, accepted: {}, created: [], answered: {} });

function load(): MockState {
  if (typeof window === 'undefined') return blank();
  try {
    return { ...blank(), ...JSON.parse(sessionStorage.getItem(KEY) ?? '{}') };
  } catch {
    return blank();
  }
}
function save(s: MockState) {
  sessionStorage.setItem(KEY, JSON.stringify(s));
}
function param(name: string): string | null {
  return typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(name);
}
const wait = (ms = 350) => new Promise((r) => setTimeout(r, ms));
const fail = (status: number, code: string, message: string, details?: ApiError['details']): never => {
  throw new ApiError(status, { code, message, details });
};
const iso = (ms: number) => new Date(ms).toISOString();

function botById(agentId: string): MockBot {
  return MOCK_BOTS.find((b) => b.agent_id === agentId) ?? fail(404, 'not_found', "We couldn't find that page.");
}
function jobFor(bot: MockBot, offer: string): Job | undefined {
  return bot.jobs.find((j) => j.name === offer);
}

function shareStatus(bot: MockBot, s: MockState): 'approved' | 'pending' | 'revoked' {
  const forced = param('share');
  if (forced === 'pending' || forced === 'revoked' || forced === 'approved') return forced;
  return s.accepted[bot.agent_id] ?? 'approved';
}

/* ---------------- server-side builders the real API owns ---------------- */

function inputDisplay(job: Job | undefined, input: InputObject | null): DisplayRow[] {
  if (!job?.input_schema || !input) return [];
  return orderedFields(job.input_schema)
    .filter(([k]) => input[k] !== undefined)
    .map(([k, f]) => ({ key: k, label: labelFor(k, f), value: displayValue(f, input[k]) }));
}

function resultDisplay(job: Job | undefined, result: unknown): ResultDisplayRow[] {
  const row = (key: string, label: string, v: unknown): ResultDisplayRow => {
    if (typeof v === 'number') return { key, label, kind: 'number', value: v.toLocaleString('en-CA') };
    if (typeof v === 'boolean') return { key, label, kind: 'boolean', value: v ? 'Yes' : 'No' };
    if (typeof v === 'string') return { key, label, kind: 'text', value: v };
    if (Array.isArray(v) && v.every((x) => ['string', 'number', 'boolean'].includes(typeof x)))
      return { key, label, kind: 'list', value: v.join(', ') };
    return { key, label, kind: 'json', value: JSON.stringify(v, null, 2) };
  };
  if (result === null || result === undefined) return [];
  if (typeof result !== 'object' || Array.isArray(result)) return [row('_value', 'Result', result)];
  const obj = result as Record<string, unknown>;
  const known = job?.result_fields ?? [];
  const keys = [...known.map((f) => f.key).filter((k) => k in obj), ...Object.keys(obj).filter((k) => !known.some((f) => f.key === k))];
  return keys.map((k) => row(k, known.find((f) => f.key === k)?.label ?? labelFor(k), obj[k]));
}

/** What a newly sent mock request looks like `t` ms after it was sent. */
function liveState(bot: MockBot, c: Created, s: MockState, now: number): Partial<MockRequestFixture> & { status: RequestStatus } {
  const t = now - c.createdMs;
  const answered = s.answered[c.id];
  const result = mockResult(c);
  const review = bot.review_mode === 'review_first';
  if (c.offer === 'measuring_visit') {
    if (!answered) return t < 6000 ? { status: 'open' } : { status: 'needs_info', question: 'Is there parking for a van on your street?' };
    return now - answered.atMs < 8000 ? { status: 'open' } : { status: 'done', result };
  }
  if (review) {
    if (t < 8000) return { status: 'in_review' };
    if (t < 16000) return { status: 'open' };
    if (t < 24000) return { status: 'awaiting_release' };
    return { status: 'done', result };
  }
  return t < 8000 ? { status: 'open' } : { status: 'done', result };
}

function mockResult(c: MockRequestFixture): Record<string, unknown> {
  const i = c.input ?? {};
  switch (c.offer) {
    case 'render_ring':
      return {
        preview_url: 'https://example.com/previews/ring-new.webp',
        price_cad: Math.round(900 + Number(i.carat ?? 1) * 1800 + (i.metal === 'platinum' ? 600 : 0)),
        ready_in_weeks: i.rush ? 2 : 5,
        message: 'Preview attached. Reply here if you want changes.',
      };
    case 'order_status':
      return { status: 'In the workshop', ready_date: 'Nov 6, 2026', pickup: true };
    case 'window_quote':
      return {
        price_cad: Math.round(Number(i.count ?? 1) * Number(i.width_cm ?? 100) * Number(i.height_cm ?? 100) * 0.075),
        install_weeks: 4,
        includes: i.removal ? ['Removal', 'Install', 'Trim'] : ['Install', 'Trim'],
        message: 'Price is for standard white frames.',
      };
    case 'measuring_visit':
      return { visit_date: 'Saturday, Nov 7', arrival_window: '9 to 11 am', message: 'The crew will call 30 minutes before.' };
    case 'delivery_status':
      return { status: 'At our warehouse', eta: 'Monday, Nov 2', tracking_url: 'https://example.com/track/' + String(i.order_number ?? '') };
    case 'change_delivery_date':
      return { confirmed_date: String(i.new_date ?? ''), time_window: 'Morning', message: 'Done. We emailed you the new date.' };
    default:
      return { message: 'Thanks. We will look into it and reply here.' };
  }
}

function toRequest(fx: MockRequestFixture, s: MockState, now = Date.now()): CustomerRequest {
  const bot = botById(fx.agent_id);
  const job = jobFor(bot, fx.offer);
  let r: MockRequestFixture = { ...fx };
  const created = s.created.find((c) => c.id === fx.id);
  if (created) r = { ...r, ...liveState(bot, created, s, now), updated_at: iso(now) };
  const answered = s.answered[fx.id];
  if (answered && !created) {
    // A fixture that was waiting on a question: open after the answer, then done.
    const done = now - answered.atMs > 8000;
    r = { ...r, status: done ? 'done' : 'open', question: null, result: done ? mockResult(fx) : null, updated_at: iso(now) };
  }
  const status = r.status;
  const showResult = status === 'done';
  return {
    id: r.id,
    bot: { agent_id: r.agent_id },
    offer: r.offer,
    title: job?.input_schema?.title ?? r.offer,
    status,
    input: r.input,
    input_display: inputDisplay(job, r.input),
    notes: r.notes,
    question: status === 'needs_info' ? (r.question ?? null) : null,
    answers: [...(r.answers ?? []), ...(answered?.answers ?? [])],
    result: showResult ? (r.result ?? null) : null,
    result_display: showResult ? resultDisplay(job, r.result) : [],
    fail_reason: status === 'failed' ? (r.fail_reason ?? null) : null,
    created_at: r.created_at,
    updated_at: r.updated_at,
    completed_at: status === 'done' || status === 'failed' ? r.updated_at : null,
  };
}

function allRequests(s: MockState): MockRequestFixture[] {
  return [...s.created, ...MOCK_REQUESTS];
}

function demoFieldError(f: InputField): string {
  if (f.type === 'integer' || f.type === 'number') return rangeMessage(f.minimum, f.maximum);
  if (f.type === 'array') return `Pick up to ${f.maxItems ?? 1}.`;
  if (f.type === 'boolean') return 'Must be yes or no.';
  if (isChoice(f)) return `Choose one of: ${optionsFor(f).map((o) => o.label).join(', ')}.`;
  const t = f as TextField;
  return t.pattern ? "Doesn't match the expected format." : `Use ${t.maxLength} characters or fewer.`;
}

function requireSession(s: MockState) {
  // The mock treats /c pages as signed in so they can be opened directly.
  void s;
}

/* ---------------- auth (existing /api/v1/auth routes) ---------------- */

/** `POST /api/v1/auth/request-code` */
export async function requestCode(email: string): Promise<{ ok: true; message: string }> {
  await wait();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'validation_error', 'Enter a valid email address.', { fields: { email: 'Enter a valid email address.' } });
  const s = load();
  s.email = email.trim().toLowerCase();
  save(s);
  return { ok: true, message: 'If that email can receive mail, we sent a sign-in code. It expires in 10 minutes.' };
}

/** `POST /api/v1/auth/verify-code`. In the mock any 6 digits work except 000000. */
export async function verifyCode(email: string, code: string): Promise<Me> {
  await wait();
  if (!/^\d{6}$/.test(code) || code === '000000') fail(400, 'invalid_code', "That code didn't work. Check it and try again.");
  const s = load();
  s.signedIn = true;
  s.email = email.trim().toLowerCase();
  save(s);
  return { user: { id: '5e0c7a1b-9d2f-4e3a-8b6c-7d1e2f3a4b5c', email: s.email } };
}

/** `GET /api/v1/auth/me` */
export async function getMe(): Promise<Me> {
  await wait(120);
  return { user: { id: '5e0c7a1b-9d2f-4e3a-8b6c-7d1e2f3a4b5c', email: load().email } };
}

/** `POST /api/v1/auth/logout` */
export async function signOut(): Promise<void> {
  await wait(150);
  sessionStorage.removeItem(KEY);
}

/* ---------------- R1–R8 ---------------- */

/** R1 `GET /api/v1/c/links/:token` */
export async function getLink(token: string): Promise<LinkResponse> {
  await wait();
  if (token === 'expired') fail(410, 'invite_expired', 'This link has expired.');
  if (token === 'used-up') fail(410, 'invite_used_up', 'This link has been used the maximum number of times.');
  const bot = MOCK_BOTS.find((b) => b.token === token) ?? fail(404, 'invite_not_found', "This link doesn't work.");
  const s = load();
  const forced = param('share');
  const status = s.signedIn ? (forced === 'revoked' ? 'revoked' : (s.accepted[bot.agent_id] ?? null)) : undefined;
  const next = !s.signedIn ? 'sign_in' : status === 'approved' ? 'open_bot' : status === 'pending' ? 'wait' : status === 'revoked' ? 'blocked' : 'accept';
  return {
    link: { kind: bot.link_kind, email_bound: bot.link_kind === 'personal', expires_at: null },
    bot: { agent_id: bot.agent_id, branding: bot.branding },
    access_mode: bot.link_kind === 'personal' ? 'open_link' : bot.access_mode,
    viewer: s.signedIn ? { signed_in: true, share_status: status ?? null } : { signed_in: false },
    next,
  };
}

/** R2 `POST /api/v1/c/links/:token/accept` */
export async function acceptLink(token: string): Promise<AcceptResponse> {
  await wait();
  const bot = MOCK_BOTS.find((b) => b.token === token) ?? fail(404, 'invite_not_found', "This link doesn't work.");
  if (param('share') === 'revoked') fail(403, 'share_revoked', `${bot.branding.display_name} didn't approve this request.`);
  const s = load();
  const status = s.accepted[bot.agent_id] ?? (bot.access_mode === 'approve_each' && bot.link_kind === 'public' ? 'pending' : 'approved');
  s.accepted[bot.agent_id] = status;
  save(s);
  return { share: { status, requested_at: iso(Date.now()) }, bot: { agent_id: bot.agent_id }, next: status === 'approved' ? 'open_bot' : 'wait' };
}

/** R3 `GET /api/v1/c/bots` */
export async function listBots(): Promise<BotsResponse> {
  await wait();
  const s = load();
  return {
    bots: MOCK_BOTS.map((b) => ({
      agent_id: b.agent_id,
      branding: b.branding,
      share_status: shareStatus(b, s),
      open_requests: allRequests(s)
        .filter((r) => r.agent_id === b.agent_id)
        .map((r) => toRequest(r, s))
        .filter((r) => r.status !== 'done' && r.status !== 'failed').length,
    })),
  };
}

/** R4 `GET /api/v1/c/bots/:agent_id` */
export async function getBot(agentId: string): Promise<BotResponse> {
  await wait();
  const s = load();
  requireSession(s);
  const bot = botById(agentId);
  const status = shareStatus(bot, s);
  const base = { bot: { agent_id: bot.agent_id, branding: bot.branding } };
  if (status === 'pending') return { ...base, share: { status, requested_at: '2026-10-29T11:08:00.000Z' }, jobs: [] };
  if (status === 'revoked') return { ...base, share: { status }, jobs: [] };
  const sentToday = s.created.filter((c) => c.agent_id === agentId).length;
  const used = param('cap') === 'reached' ? bot.daily_cap : Math.min(bot.daily_cap, bot.used_today + sentToday);
  return { ...base, share: { status, daily_cap: bot.daily_cap, used_today: used, resets_at: '2026-10-30T04:00:00.000Z' }, jobs: bot.jobs };
}

/** R5 `POST /api/v1/c/bots/:agent_id/requests`. Resolves with the HTTP status (201 new, 200 retry). */
export async function createRequest(agentId: string, body: CreateRequestBody): Promise<RequestResponse & { http_status: 200 | 201 }> {
  await wait(500);
  const s = load();
  const bot = botById(agentId);
  const status = shareStatus(bot, s);
  if (status === 'pending') fail(403, 'share_pending', `${bot.branding.display_name} hasn't approved you yet.`);
  if (status === 'revoked') fail(403, 'share_revoked', `You no longer have access to ${bot.branding.display_name}.`);
  const job = jobFor(bot, body.offer) ?? fail(404, 'offer_not_found', "This job isn't available.");

  const retry = body.client_request_id && s.created.find((c) => c.client_request_id === body.client_request_id);
  if (retry) return { request: toRequest(retry, s), http_status: 200 };

  const notes = body.notes?.trim() ?? '';
  if (job.input_schema) {
    if (!body.input) fail(400, 'input_required', 'Fill in the form first.', { input_schema: job.input_schema });
    if (param('mock') === 'field_errors') {
      // A server-side rejection shaped like spec 15.6, for the field-error demo.
      const fields: Record<string, string> = {};
      for (const [k, f] of orderedFields(job.input_schema).slice(0, 3)) fields[k] = demoFieldError(f);
      fields._form = 'Remove unknown field "color".';
      const first = job.input_schema['x-order'][0];
      fail(400, 'invalid_input', 'Some fields need fixing.', {
        fields,
        validation_errors: [{ instancePath: '/' + first, keyword: 'enum', message: 'must be equal to one of the allowed values', params: {} }],
      });
    }
    const fields = checkInput(job.input_schema, body.input as InputObject);
    if (Object.keys(fields).length) fail(400, 'invalid_input', 'Some fields need fixing.', { fields, validation_errors: [] });
    if (!job.notes_enabled && notes) fail(400, 'validation_error', 'Notes are turned off for this job.', { fields: { notes: 'Notes are turned off for this job.' } });
  } else {
    if (body.input) fail(400, 'input_not_allowed', "This job doesn't take a form.");
    if (!notes) fail(400, 'validation_error', 'Tell us what you need.', { fields: { notes: 'Required.' } });
  }
  if (notes.length > job.notes_max) fail(400, 'validation_error', 'Notes are too long.', { fields: { notes: `Use ${job.notes_max.toLocaleString('en-CA')} characters or fewer.` } });

  const sentToday = s.created.filter((c) => c.agent_id === agentId).length;
  if (param('cap') === 'reached' || bot.used_today + sentToday >= bot.daily_cap)
    fail(429, 'rate_limited', "You've sent the most requests allowed today.", { retry_after_seconds: 3600, daily_cap: bot.daily_cap });

  const now = Date.now();
  const c: Created = {
    id: crypto.randomUUID(),
    agent_id: agentId,
    offer: job.name,
    status: 'open',
    input: body.input ?? null,
    notes,
    created_at: iso(now),
    updated_at: iso(now),
    createdMs: now,
    client_request_id: body.client_request_id,
  };
  s.created.unshift(c);
  save(s);
  return { request: toRequest(c, s, now), http_status: 201 };
}

/** R6 `GET /api/v1/c/bots/:agent_id/requests` */
export async function listRequests(
  agentId: string,
  opts: { status?: 'open' | 'done' | 'needs_info' | 'failed'; limit?: number; cursor?: string | null } = {},
): Promise<RequestListResponse> {
  await wait();
  const s = load();
  botById(agentId);
  const limit = Math.min(50, Math.max(1, opts.limit ?? 20));
  let start = 0;
  if (opts.cursor) {
    start = Number(atob(opts.cursor));
    if (!Number.isInteger(start)) fail(400, 'bad_cursor', "That page of results isn't available.");
  }
  const rows: RequestListRow[] = allRequests(s)
    .filter((r) => r.agent_id === agentId)
    .map((r) => toRequest(r, s))
    .filter((r) => !opts.status || r.status === opts.status)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((r) => ({
      id: r.id,
      offer: r.offer,
      title: r.title,
      status: r.status,
      summary: (r.input ? r.title : r.notes || r.title).slice(0, 120),
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
  const page = rows.slice(start, start + limit);
  const nextStart = start + limit;
  return { requests: page, next_cursor: nextStart < rows.length ? btoa(String(nextStart)) : null, etag: `W/"${rows.length}-${page[0]?.updated_at ?? ''}"` };
}

/** R7 `GET /api/v1/c/requests/:task_id` */
export async function getRequest(taskId: string): Promise<RequestResponse> {
  await wait(250);
  const s = load();
  const fx = allRequests(s).find((r) => r.id === taskId) ?? fail(404, 'not_found', "We couldn't find that request.");
  return { request: toRequest(fx, s) };
}

/** R8 `POST /api/v1/c/requests/:task_id/answer` */
export async function answerRequest(taskId: string, answer: string): Promise<RequestResponse> {
  await wait(450);
  const s = load();
  const fx = allRequests(s).find((r) => r.id === taskId) ?? fail(404, 'not_found', "We couldn't find that request.");
  if (param('share') === 'revoked') fail(403, 'share_revoked', "You can read this request but can't answer it anymore.");
  const current = toRequest(fx, s);
  if (current.status !== 'needs_info' || !current.question) fail(409, 'task_not_waiting', 'This request is no longer waiting for an answer.');
  const text = answer.trim();
  if (!text || text.length > 2000)
    fail(400, 'validation_error', 'Check your answer.', { fields: { answer: text ? 'Use 2,000 characters or fewer.' : 'Required.' } });
  const now = Date.now();
  const prev = s.answered[taskId]?.answers ?? [];
  s.answered[taskId] = {
    atMs: now,
    answers: [...prev, { question: current.question as string, answer: text, asked_at: current.updated_at, answered_at: iso(now) }],
  };
  save(s);
  return { request: { ...toRequest(fx, s, now), status: 'open', question: null } };
}
