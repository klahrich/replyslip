/**
 * The demo page's only door to the server. One flag picks the mock: VALETTO_MOCK=1 in a dev build.
 * To switch to the real routes for good, delete site-demo-mock.ts and the two MOCK lines below.
 */
import { DemoApiError, type DemoConversation, type SendBody, type SendResponse } from './site-demo-types';
import { mockDemoApi } from './site-demo-mock';

const MOCK = process.env.VALETTO_MOCK === '1' && process.env.NODE_ENV !== 'production';

export type DemoApi = {
  load(token: string): Promise<DemoConversation>;
  send(token: string, body: SendBody): Promise<SendResponse>;
};

const base = (token: string) => `/api/v1/s/demo/${encodeURIComponent(token)}`;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, credentials: 'same-origin', cache: 'no-store', referrerPolicy: 'no-referrer' });
  } catch {
    throw new DemoApiError(0, 'network_error', 'Network error');
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
    throw new DemoApiError(res.status, err?.code ?? 'internal_error', err?.message ?? 'Request failed');
  }
  return json as T;
}

const realDemoApi: DemoApi = {
  load: (token) => call<DemoConversation>(base(token), { headers: { accept: 'application/json' } }),
  send: (token, body) =>
    call<SendResponse>(`${base(token)}/messages`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
};

export const demoApi: DemoApi = MOCK ? mockDemoApi : realDemoApi;

/** Screenshot routes (served by PlumberBot from the database, under /s so the noindex header covers them). */
export const shotUrl = (token: string, kind: 'desktop' | 'mobile') => `/s/demo/${encodeURIComponent(token)}/shot/${kind}`;
