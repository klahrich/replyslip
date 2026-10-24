'use client';

/** Thin client for the session-cookie routes under /api/v1. */

/** Fired when the API says the session is gone; the dashboard sends the user to /sign-in. */
export const SIGNED_OUT_EVENT = 'replyslip:signed-out';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    /** `error.details` from the response, e.g. `{ issues: [{ path, message }] }` for validation_error. */
    public details?: unknown,
    /** Seconds to wait, from `error.retry_after_seconds` or the Retry-After header (429 only). */
    public retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT'; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network_error', 'We couldn’t reach ReplySlip. Check your connection and try again.');
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const raw = data as {
      error?: { code?: string; message?: string; details?: unknown; retry_after_seconds?: number } | string;
      message?: string;
      retry_after_seconds?: number;
    } | null;
    const err = typeof raw?.error === 'string' ? { code: raw.error, message: raw.message } : raw?.error;
    if (res.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
    }
    const header = Number(res.headers.get('retry-after'));
    const retryAfter =
      typeof err?.retry_after_seconds === 'number' ? err.retry_after_seconds : Number.isFinite(header) && header > 0 ? header : undefined;
    throw new ApiError(
      res.status,
      err?.code ?? 'error',
      err?.message ?? 'Something went wrong. Try again.',
      err?.details,
      retryAfter,
    );
  }
  return data as T;
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Try again.';
}

export function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
