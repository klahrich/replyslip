/** The demo page's only door to the server (PR #112's routes). */
import { DemoApiError, type DemoConversation, type SendBody, type SendResponse } from './site-demo-types';

export type DemoApi = {
  load(token: string): Promise<DemoConversation>;
  send(token: string, body: SendBody): Promise<SendResponse>;
};

/** A send that hasn't answered by then is given up on, like a network error; Try again reuses its id. */
export const SEND_TIMEOUT_MS = 30_000;

const base = (token: string) => `/api/v1/s/demo/${encodeURIComponent(token)}`;

async function call<T>(url: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  const abort = timeoutMs ? new AbortController() : null;
  const timer = abort ? setTimeout(() => abort.abort(), timeoutMs) : undefined;
  const lost = () => new DemoApiError(0, abort?.signal.aborted ? 'timeout' : 'network_error', 'Network error');
  try {
    const res = await fetch(url, { ...init, signal: abort?.signal, credentials: 'same-origin', cache: 'no-store', referrerPolicy: 'no-referrer' }).catch(() => {
      throw lost();
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
      throw new DemoApiError(res.status, err?.code ?? 'internal_error', err?.message ?? 'Request failed');
    }
    // A 200 whose body never arrived (cut off or timed out) counts as lost, so Try again can resend.
    if (json === null) throw lost();
    return json as T;
  } finally {
    clearTimeout(timer);
  }
}

export const demoApi: DemoApi = {
  load: (token) => call<DemoConversation>(base(token), { headers: { accept: 'application/json' } }),
  send: (token, body) =>
    call<SendResponse>(`${base(token)}/messages`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, SEND_TIMEOUT_MS),
};

/** Screenshot routes (served by PlumberBot from the database, under /s so the noindex header covers them). */
export const shotUrl = (token: string, kind: 'desktop' | 'mobile') => `/s/demo/${encodeURIComponent(token)}/shot/${kind}`;
