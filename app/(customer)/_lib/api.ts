/**
 * Customer page API client (spec section 15, with sections 16 and 17). Every function returns the R1–R8
 * response shapes from types.ts and throws ApiError with the server's error code and message.
 *
 * Sign-in (/api/v1/auth/*) and R1–R8 (/api/v1/c/*): same-origin fetch with the session cookie.
 * A failed fetch (offline, DNS, CORS) throws ApiError status 0 with code `network_error`.
 */
import { rememberBranding } from './brandMemory';
import { ApiError } from './types';
import type {
  AcceptResponse,
  ApiErrorBody,
  BotResponse,
  BotsResponse,
  CreateRequestBody,
  CustomerRequest,
  FailCode,
  LinkResponse,
  Me,
  RequestListFilter,
  RequestListResponse,
  RequestResponse,
  RequestStatus,
} from './types';

/** Fired on window when a signed-in route answers 401; SessionGate swaps the page for a sign-in notice. */
export const UNAUTHORIZED_EVENT = 'valetto:unauthorized';

/* ---------------- transport ---------------- */

const NETWORK: ApiErrorBody = { code: 'network_error', message: "We couldn't reach the server. Check your connection and try again." };
const UNKNOWN: ApiErrorBody = { code: 'internal_error', message: 'Something went wrong. Try again.' };

/** Last body per URL for the routes that send ETag (R4, R6, R7; spec 15.9): a 304 reuses it. */
const etagCache = new Map<string, { etag: string; body: unknown }>();

type CallOptions = { method?: 'GET' | 'POST'; body?: unknown; conditional?: boolean };

async function call<T>(path: string, { method = 'GET', body, conditional = false }: CallOptions = {}): Promise<{ data: T; status: number }> {
  const headers: Record<string, string> = { accept: 'application/json' };
  // Every POST is JSON: the server's CSRF guard rejects anything else with 415 (spec 15.1).
  if (method === 'POST') headers['content-type'] = 'application/json';
  const cached = conditional ? etagCache.get(path) : undefined;
  if (cached) headers['if-none-match'] = cached.etag;

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, NETWORK);
  }
  if (res.status === 304 && cached) return { data: cached.body as T, status: 200 };

  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    // The link routes (R1, R2) are meant for signed-out visitors and handle their own errors.
    if (res.status === 401 && path.startsWith('/api/v1/c/') && !path.startsWith('/api/v1/c/links/')) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(res.status, errorBody(json, res.status));
  }
  if (json === null) throw new ApiError(res.status, UNKNOWN);
  const etag = conditional ? res.headers.get('etag') : null;
  if (etag) etagCache.set(path, { etag, body: json });
  return { data: json as T, status: res.status };
}

/**
 * The envelope is `{ error: { code, message, details? } }`. The auth rate limit puts `retry_after_seconds`
 * next to `message` instead of in `details`; it's folded into details so callers read one place.
 */
function errorBody(json: unknown, status: number): ApiErrorBody {
  const err = (json as { error?: Record<string, unknown> } | null)?.error;
  if (!err || typeof err !== 'object') return { ...UNKNOWN, code: status === 404 ? 'not_found' : UNKNOWN.code };
  const details = (err.details && typeof err.details === 'object' ? err.details : {}) as NonNullable<ApiErrorBody['details']>;
  if (typeof err.retry_after_seconds === 'number' && details.retry_after_seconds === undefined) details.retry_after_seconds = err.retry_after_seconds;
  return {
    code: typeof err.code === 'string' ? err.code : UNKNOWN.code,
    message: typeof err.message === 'string' && err.message ? err.message : UNKNOWN.message,
    details,
  };
}

const enc = encodeURIComponent;

/* ---------------- response normalizing (the one place older or partial shapes are absorbed) ---------------- */

const STATUSES: readonly RequestStatus[] = ['in_review', 'open', 'needs_info', 'awaiting_release', 'done', 'failed'];
const FAIL_CODES: readonly FailCode[] = ['declined_by_owner', 'bot_failed', 'expired'];

function asStatus(v: unknown): RequestStatus {
  // A status this page doesn't know yet reads as "working on it" rather than breaking the page.
  return STATUSES.includes(v as RequestStatus) ? (v as RequestStatus) : 'open';
}

type WireRequest = Omit<CustomerRequest, 'status' | 'fail_code' | 'fail_message'> & {
  status: string;
  fail_code?: string | null;
  fail_message?: unknown;
  /** Pre-17.5 field. Read only to map `declined_by_owner`. */
  fail_reason?: string | null;
};

function normalizeRequest(r: WireRequest): CustomerRequest {
  const status = asStatus(r.status);
  const code = r.fail_code ?? r.fail_reason ?? null;
  const failed = status === 'failed';
  return {
    ...r,
    status,
    // 17.8: a question held for release is never shown, even if a server sends one.
    question: status === 'needs_info' ? (r.question ?? null) : null,
    answers: r.answers ?? [],
    input_display: r.input_display ?? [],
    result_display: status === 'done' ? (r.result_display ?? []) : [],
    fail_code: failed ? (FAIL_CODES.includes(code as FailCode) ? (code as FailCode) : 'bot_failed') : null,
    // Untrusted bot text: kept as a string and rendered as plain text only.
    fail_message: failed && typeof r.fail_message === 'string' && r.fail_message.trim() ? r.fail_message : null,
  };
}

/* ---------------- auth (existing /api/v1/auth routes) ---------------- */

/** `POST /api/v1/auth/request-code` */
export async function requestCode(email: string): Promise<{ ok: true; message: string }> {
  return (await call<{ ok: true; message: string }>('/api/v1/auth/request-code', { method: 'POST', body: { email } })).data;
}

/** `POST /api/v1/auth/verify-code`. Sets the session cookie; a new email gets its own customer workspace. */
export async function verifyCode(email: string, code: string): Promise<Me> {
  etagCache.clear(); // a different account may sign in on this tab
  return (await call<Me>('/api/v1/auth/verify-code', { method: 'POST', body: { email, code } })).data;
}

/** `GET /api/v1/auth/me` */
export async function getMe(): Promise<Me> {
  return (await call<Me>('/api/v1/auth/me')).data;
}

/** `POST /api/v1/auth/logout` */
export async function signOut(): Promise<void> {
  etagCache.clear();
  await call('/api/v1/auth/logout', { method: 'POST' });
}

/* ---------------- R1–R8 ---------------- */

/** R1 `GET /api/v1/c/links/:token` */
export async function getLink(token: string): Promise<LinkResponse> {
  const { data } = await call<LinkResponse>(`/api/v1/c/links/${enc(token)}`);
  rememberBranding(data.bot.agent_id, data.bot.branding);
  return data;
}

/** R2 `POST /api/v1/c/links/:token/accept` */
export async function acceptLink(token: string): Promise<AcceptResponse> {
  const { data } = await call<AcceptResponse>(`/api/v1/c/links/${enc(token)}/accept`, { method: 'POST', body: {} });
  return data;
}

/** R3 `GET /api/v1/c/bots` */
export async function listBots(): Promise<BotsResponse> {
  const { data } = await call<BotsResponse>('/api/v1/c/bots');
  return { bots: data.bots ?? [] };
}

/** R4 `GET /api/v1/c/bots/:agent_id` */
export async function getBot(agentId: string): Promise<BotResponse> {
  const { data } = await call<BotResponse & { access?: BotResponse['access']; review_mode?: BotResponse['review_mode'] }>(
    `/api/v1/c/bots/${enc(agentId)}`,
    { conditional: true },
  );
  rememberBranding(agentId, data.bot.branding);
  return {
    ...data,
    // 17.1 adds `access`; it mirrors share.status, which 15.5 already had.
    access: data.access ?? data.share.status,
    review_mode: data.review_mode === 'review_first' ? 'review_first' : 'auto',
    jobs: data.jobs ?? [],
  };
}

/** R5 `POST /api/v1/c/bots/:agent_id/requests`. Resolves with the HTTP status (201 new, 200 retry of the same client_request_id). */
export async function createRequest(agentId: string, body: CreateRequestBody): Promise<RequestResponse & { http_status: 200 | 201 }> {
  const { data, status } = await call<{ request: WireRequest }>(`/api/v1/c/bots/${enc(agentId)}/requests`, { method: 'POST', body });
  return { request: normalizeRequest(data.request), http_status: status === 201 ? 201 : 200 };
}

/** R6 `GET /api/v1/c/bots/:agent_id/requests` */
export async function listRequests(
  agentId: string,
  opts: { status?: RequestListFilter; limit?: number; cursor?: string | null } = {},
): Promise<RequestListResponse> {
  const q = new URLSearchParams();
  if (opts.status) q.set('status', opts.status);
  if (opts.limit) q.set('limit', String(opts.limit));
  if (opts.cursor) q.set('cursor', opts.cursor);
  const qs = q.toString();
  const { data } = await call<RequestListResponse>(`/api/v1/c/bots/${enc(agentId)}/requests${qs ? `?${qs}` : ''}`, { conditional: true });
  return { ...data, requests: (data.requests ?? []).map((r) => ({ ...r, status: asStatus(r.status) })), next_cursor: data.next_cursor ?? null };
}

/** R7 `GET /api/v1/c/requests/:task_id` */
export async function getRequest(taskId: string): Promise<RequestResponse> {
  const { data } = await call<{ request: WireRequest }>(`/api/v1/c/requests/${enc(taskId)}`, { conditional: true });
  return { request: normalizeRequest(data.request) };
}

/** R8 `POST /api/v1/c/requests/:task_id/answer` */
export async function answerRequest(taskId: string, answer: string): Promise<RequestResponse> {
  const { data } = await call<{ request: WireRequest }>(`/api/v1/c/requests/${enc(taskId)}/answer`, { method: 'POST', body: { answer } });
  return { request: normalizeRequest(data.request) };
}
