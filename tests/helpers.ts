import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { loginCodes } from '@/db/schema';
import { POST as requestCode } from '@/app/api/v1/auth/request-code/route';
import { POST as verifyCode } from '@/app/api/v1/auth/verify-code/route';
import { POST as createAgentRoute } from '@/app/api/v1/agents/route';
import { POST as createKeyRoute } from '@/app/api/v1/agents/[id]/keys/route';
import { PUT as deliveryRoute } from '@/app/api/v1/agents/[id]/delivery/route';
import { POST as createJoinCodeRoute } from '@/app/api/v1/join-codes/route';
import { mcpAuthHandler } from '@/lib/mcp-server';
import { latestCode } from './inbox';

export function emailAddress(label: string): string {
  return `${label}-${randomUUID()}@example.com`;
}

export async function call(
  handler: (req: Request, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response> | Response,
  url: string,
  init: {
    method?: string;
    body?: unknown;
    cookie?: string;
    bearer?: string;
    headers?: Record<string, string>;
    params?: Record<string, string>;
  } = {},
): Promise<{ status: number; data: any; text: string; res: Response; cookie: string | null }> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.bearer) headers.set('authorization', `Bearer ${init.bearer}`);
  const res = await handler(
    new Request(url, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
    { params: Promise.resolve(init.params ?? {}) },
  );
  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  const setCookie = res.headers.get('set-cookie');
  const cookie = setCookie ? (setCookie.split(';')[0] ?? null) : null;
  return { status: res.status, data, text, res, cookie };
}

export async function signIn(email = emailAddress('owner')): Promise<{
  email: string;
  cookie: string;
  user: any;
  workspace: any;
}> {
  const requested = await call(requestCode, 'http://localhost/api/v1/auth/request-code', {
    body: { email },
  });
  if (requested.status !== 200) throw new Error(`request-code failed: ${requested.text}`);
  const code = latestCode(email);
  const verified = await call(verifyCode, 'http://localhost/api/v1/auth/verify-code', {
    body: { email, code },
  });
  if (verified.status !== 200 || !verified.cookie) {
    throw new Error(`verify-code failed: ${verified.text}`);
  }
  return { email, cookie: verified.cookie, user: verified.data.user, workspace: verified.data.workspace };
}

export async function createAgent(cookie: string, name: string, description?: string) {
  const res = await call(createAgentRoute, 'http://localhost/api/v1/agents', {
    cookie,
    body: { name, description },
  });
  if (res.status !== 201) throw new Error(`create agent failed: ${res.text}`);
  return res.data.agent as { id: string; name: string };
}

export async function createKey(cookie: string, agentId: string): Promise<string> {
  const res = await call(createKeyRoute, `http://localhost/api/v1/agents/${agentId}/keys`, {
    cookie,
    params: { id: agentId },
  });
  if (res.status !== 201) throw new Error(`create key failed: ${res.text}`);
  return res.data.key.secret as string;
}

export async function setWebhook(cookie: string, agentId: string, url: string, auth: Record<string, unknown> = { type: 'none' }) {
  const res = await call(deliveryRoute, `http://localhost/api/v1/agents/${agentId}/delivery`, {
    method: 'PUT',
    cookie,
    params: { id: agentId },
    body: { mode: 'webhook', url, auth },
  });
  if (res.status !== 200) throw new Error(`delivery failed: ${res.text}`);
}

export async function setHerdr(cookie: string, agentId: string, pane: string) {
  const res = await call(deliveryRoute, `http://localhost/api/v1/agents/${agentId}/delivery`, {
    method: 'PUT',
    cookie,
    params: { id: agentId },
    body: { mode: 'herdr', pane },
  });
  if (res.status !== 200) throw new Error(`herdr delivery failed: ${res.text}`);
}

export async function createJoinCode(cookie: string): Promise<{ id: string; secret: string }> {
  const res = await call(createJoinCodeRoute, 'http://localhost/api/v1/join-codes', {
    cookie,
    body: {},
  });
  if (res.status !== 201) throw new Error(`join code failed: ${res.text}`);
  return { id: res.data.join_code.id, secret: res.data.join_code.secret };
}

function parseRpc(text: string): any {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(trimmed);
  const dataLines = trimmed
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  if (dataLines.length === 0) throw new Error(`Unparsed MCP response: ${text.slice(0, 400)}`);
  return JSON.parse(dataLines[dataLines.length - 1]!);
}

export async function mcpTool(token: string, name: string, args: Record<string, unknown> = {}) {
  const res = await mcpAuthHandler(
    new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    }),
  );
  const text = await res.text();
  if (!res.ok) {
    return { httpStatus: res.status, isError: true, payload: text, text };
  }
  const rpc = parseRpc(text);
  if (rpc.error) {
    return { httpStatus: res.status, isError: true, payload: rpc.error, text };
  }
  const content = rpc.result?.content?.find((item: { type: string }) => item.type === 'text');
  const payload = content?.text ? JSON.parse(content.text) : rpc.result;
  return { httpStatus: res.status, isError: Boolean(rpc.result?.isError), payload, text };
}

export async function mcpListTools(token: string) {
  const res = await mcpAuthHandler(
    new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    }),
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`tools/list HTTP ${res.status}: ${text}`);
  const rpc = parseRpc(text);
  return rpc.result.tools as { name: string; inputSchema?: { properties?: Record<string, unknown> } }[];
}

export async function expireLatestCode(email: string): Promise<void> {
  await getDb()
    .update(loginCodes)
    .set({ expiresAt: new Date(Date.now() - 60_000) })
    .where(eq(loginCodes.email, email.toLowerCase()));
}

export type WebhookHit = {
  headers: Record<string, string | string[] | undefined>;
  raw: string;
  body: any;
};

export async function startReceiver(): Promise<{
  url: string;
  hits: WebhookHit[];
  close: () => Promise<void>;
}> {
  const hits: WebhookHit[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: any = raw;
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
      hits.push({ headers: req.headers, raw, body });
      res.writeHead(204);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/hook`,
    hits,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
