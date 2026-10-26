/** Browser helpers for the sign-in routes in app/api/v1/auth. */

import { MARKETING_CONSENT_TEXT } from './marketing-consent';

type ApiError = { error?: { code?: string; message?: string; retry_after_seconds?: number } };

export type AuthResult =
  | { ok: true; message?: string }
  | { ok: false; code: string; message: string; retryAfterSeconds?: number };

async function post(path: string, body: unknown): Promise<{ status: number; data: unknown; retryAfter: string | null }> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data, retryAfter: res.headers.get('retry-after') };
}

const NETWORK_ERROR: AuthResult = {
  ok: false,
  code: 'network_error',
  message: 'We couldn’t reach ReplySlip. Check your connection and try again.',
};

function failure(status: number, data: unknown, messages: Record<string, string>): AuthResult {
  const err = (data as ApiError | null)?.error;
  const code = err?.code ?? (status === 429 ? 'rate_limited' : 'unknown');
  const message =
    messages[code] ??
    (status === 429
      ? 'Too many requests. Wait a few minutes and try again.'
      : err?.message ?? 'Something went wrong. Try again.');
  return { ok: false, code, message };
}

/** "Too many requests, try again in X minutes", from the 429 body or the Retry-After header. */
export function retryMessage(seconds: number | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return 'Too many requests. Wait a few minutes and try again.';
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `Too many requests, try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
}

/** The server caps `source` at the same length. */
export const SOURCE_MAX = 200;

/** `?ref=` or `?utm_source=` on the current page, for `source` when the visitor leaves the field empty. */
export function sourceFromUrl(): string {
  try {
    const q = new URLSearchParams(window.location.search);
    return (q.get('ref') || q.get('utm_source') || '').trim().slice(0, SOURCE_MAX);
  } catch {
    return '';
  }
}

/**
 * `source` is the optional "how did you hear about us" answer. It goes out only when it has text; the server keeps
 * it only when this request creates the user, so it is fine to send on every sign-in.
 */
export async function requestSignInCode(email: string, source = ''): Promise<AuthResult> {
  try {
    const src = source.trim().slice(0, SOURCE_MAX);
    const { status, data, retryAfter } = await post('/api/v1/auth/request-code', src ? { email, source: src } : { email });
    // Older backends answer 200 even when rate-limited; that still reads as "maybe sent".
    if (status === 200) return { ok: true, message: (data as { message?: string } | null)?.message };
    if (status === 429) {
      const fromBody = (data as ApiError | null)?.error?.retry_after_seconds;
      const seconds = typeof fromBody === 'number' ? fromBody : retryAfter ? Number(retryAfter) : undefined;
      return { ok: false, code: 'rate_limited', message: retryMessage(seconds), retryAfterSeconds: seconds };
    }
    return failure(status, data, { validation_error: 'Enter a valid email address.' });
  } catch {
    return NETWORK_ERROR;
  }
}

/**
 * `marketingOptIn` is the sign-in checkbox. Only a checked box sends the
 * fields; leaving it unchecked sends nothing, which keeps any earlier choice.
 */
export async function verifySignInCode(email: string, code: string, marketingOptIn = false): Promise<AuthResult> {
  try {
    const body = marketingOptIn
      ? { email, code, marketing_opt_in: true, consent_text: MARKETING_CONSENT_TEXT }
      : { email, code };
    const { status, data } = await post('/api/v1/auth/verify-code', body);
    if (status === 200) return { ok: true };
    return failure(status, data, {
      invalid_code: 'That code isn’t right. Check the latest email and try again.',
      expired_code: 'That code has expired. Codes last 10 minutes. Send a new one.',
      code_exhausted: 'Too many wrong tries for this code. Send a new one.',
      code_already_used: 'That code was already used. Send a new one.',
      validation_error: 'Enter the email address the code was sent to.',
    });
  } catch {
    return NETWORK_ERROR;
  }
}

/*
 * The landing form hands the email to /sign-in through sessionStorage so it
 * never lands in a URL. Only the email is stored, never a code or key.
 */
const EMAIL_KEY = 'replyslip:sign-in-email';
const EMAIL_TTL_MS = 15 * 60 * 1000;

export function rememberSignInEmail(email: string): void {
  try {
    sessionStorage.setItem(EMAIL_KEY, JSON.stringify({ email, at: Date.now() }));
  } catch {
    // Storage blocked: /sign-in falls back to asking for the email.
  }
}

export function forgetSignInEmail(): void {
  try {
    sessionStorage.removeItem(EMAIL_KEY);
  } catch {}
}

/** Stored email if the handoff is fresh. Returns a string, so it is a stable useSyncExternalStore snapshot. */
export function storedSignInEmail(): string | null {
  try {
    const raw = sessionStorage.getItem(EMAIL_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { email?: unknown; at?: unknown };
    if (typeof v.email !== 'string' || typeof v.at !== 'number' || Date.now() - v.at > EMAIL_TTL_MS) return null;
    return v.email;
  } catch {
    return null;
  }
}
