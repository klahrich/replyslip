import { InMemoryTransport, McpServer, type JSONRPCMessage } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { filterListedTools } from '@/lib/mcp-server';

// filterListedTools replaces setRequestHandler on the low-level server. These drive a real McpServer over an
// in-memory transport so both setRequestHandler forms, (method, handler) and (method, schemas, handler), are
// checked end to end through the patched method.

type Rpc = { id?: number; result?: Record<string, unknown>; error?: { code: number; message: string } };

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length) await closers.pop()!();
});

async function connect(server: McpServer) {
  const [client, serverSide] = InMemoryTransport.createLinkedPair();
  const replies = new Map<number, (msg: Rpc) => void>();
  client.onmessage = (msg: JSONRPCMessage) => {
    const rpc = msg as Rpc;
    if (typeof rpc.id === 'number') replies.get(rpc.id)?.(rpc);
  };
  await server.connect(serverSide);
  await client.start();
  closers.push(() => server.close());
  let nextId = 1;
  const request = (method: string, params: Record<string, unknown>, scopes?: string[]) => {
    const id = nextId++;
    const reply = new Promise<Rpc>((resolve) => replies.set(id, resolve));
    const authInfo = scopes ? { token: 't', clientId: 'c', scopes } : undefined;
    void client.send({ jsonrpc: '2.0', id, method, params } as JSONRPCMessage, { authInfo });
    return reply;
  };
  const init = await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' },
  });
  expect(init.error).toBeUndefined();
  await client.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as JSONRPCMessage);
  return request;
}

function patchedServer() {
  // No tools capability up front, as in lib/mcp-server.ts: declaring it makes McpServer install its tools/list
  // handler in the constructor, before filterListedTools could see it. registerTool adds the capability.
  const server = new McpServer({ name: 'test', version: '0' });
  filterListedTools(server);
  return server;
}

function registerTools(server: McpServer) {
  // whoami needs only 'agent'; complete_task needs 'agent:respond'; not_a_tool isn't in TOOL_SCOPES.
  for (const name of ['whoami', 'complete_task', 'not_a_tool']) {
    server.registerTool(name, { description: name }, async () => ({ content: [] }));
  }
}

describe('filterListedTools', () => {
  it('passes a three-argument (method, schemas, handler) registration through unchanged, and it still answers', async () => {
    const server = patchedServer();
    server.server.setRequestHandler('acme/echo', { params: z.object({ text: z.string() }) }, async (params) => ({
      echoed: params.text,
    }));
    const request = await connect(server);

    const res = await request('acme/echo', { text: 'hi' });
    expect(res.error).toBeUndefined();
    expect(res.result).toMatchObject({ echoed: 'hi' });

    // The schemas argument survived too: bad params are refused by its validation.
    const bad = await request('acme/echo', { text: 42 });
    expect(bad.error?.message).toMatch(/Invalid params for acme\/echo/);
  });

  it('filters tools/list registered in the two-argument form (the McpServer default)', async () => {
    const server = patchedServer();
    registerTools(server);
    const request = await connect(server);

    const oauth = await request('tools/list', {}, ['agent']);
    expect((oauth.result!.tools as { name: string }[]).map((t) => t.name)).toEqual(['whoami']);
    const rsk = await request('tools/list', {}, ['agent', 'agent:respond', 'agent:owner']);
    expect((rsk.result!.tools as { name: string }[]).map((t) => t.name)).toEqual(['whoami', 'complete_task']);
  });

  it('filters tools/list registered in the three-argument form, wrapping the last argument', async () => {
    const server = patchedServer();
    server.server.registerCapabilities({ tools: {} });
    server.server.setRequestHandler('tools/list', { params: z.object({}).passthrough() }, async () => ({
      tools: ['whoami', 'complete_task', 'not_a_tool'].map((name) => ({ name, inputSchema: { type: 'object' } })),
    }));
    const request = await connect(server);

    const oauth = await request('tools/list', {}, ['agent']);
    expect(oauth.error).toBeUndefined();
    expect((oauth.result!.tools as { name: string }[]).map((t) => t.name)).toEqual(['whoami']);
    const none = await request('tools/list', {});
    expect(none.result!.tools).toEqual([]);
  });
});
